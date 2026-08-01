/**
 * taxCopilot.test.ts — the LLM's role in the Tax Copilot.
 *
 * Run with:  bun test src/lib/assistant
 *
 * The single most important property asserted here: the LLM never supplies a
 * number that reaches the user. It picks an intent; the deterministic engine
 * computes every rupee. These tests pin that down with a stub provider so a
 * future refactor can't quietly start trusting the model with arithmetic.
 */

import { test, expect, describe } from 'bun:test';
import { routeTaxQuestion, buildTaxRouterPrompt } from './taxCopilot';
import { answerQuestion, buildTaxState, type TaxState } from '@/lib/tax';

// ─── A real tax state to answer against ───────────────────────────────────────

function makeState(): TaxState {
  return buildTaxState({
    financialYear: '2026-27',
    ageCategory: '<60',
    hasSalaryOrPension: true,
    salaryIncome: 1_200_000,
    entries: [
      { description: 'LIC premium', category: 'investment', amount: 50_000 },
      { description: 'Health insurance', category: 'health', amount: 12_000 },
    ],
    capitalGains: { equityStcg: 0, equityLtcg: 0, otherLtcg: 0, otherStcg: 0 },
    learned: {},
  });
}

/** Stub provider that returns a canned reply. */
const stub = (reply: string) => ({
  complete: async () => reply,
});

// ─── Routing ──────────────────────────────────────────────────────────────────

describe('routeTaxQuestion', () => {
  test('parses a well-formed route', async () => {
    const route = await routeTaxQuestion(
      'mera tax kitna hai',
      stub('{"onTopic":true,"intent":"current_position","section":null,"amount":null,"note":null,"suggestions":["How can I save more tax?"]}'),
    );
    expect(route?.onTopic).toBe(true);
    expect(route?.intent).toBe('current_position');
    expect(route?.suggestions).toEqual(['How can I save more tax?']);
  });

  test('tolerates a fenced reply', async () => {
    const route = await routeTaxQuestion(
      'what is 80C',
      stub('```json\n{"onTopic":true,"intent":"explain","section":"80C","amount":null,"note":null,"suggestions":[]}\n```'),
    );
    expect(route?.intent).toBe('explain');
    expect(route?.section).toBe('80C');
  });

  test('normalises a string amount to a number', async () => {
    const route = await routeTaxQuestion(
      'what if I put 50k in ELSS',
      stub('{"onTopic":true,"intent":"whatif_invest","section":"80C","amount":"50000","note":null,"suggestions":[]}'),
    );
    expect(route?.amount).toBe(50000);
    expect(typeof route?.amount).toBe('number');
  });

  test('drops a section code the engine does not know', async () => {
    const route = await routeTaxQuestion(
      'what about section 80ZZ',
      stub('{"onTopic":true,"intent":"section_status","section":"80ZZ","amount":null,"note":null,"suggestions":[]}'),
    );
    expect(route?.section).toBeNull();
  });

  test('flags an off-topic question', async () => {
    const route = await routeTaxQuestion(
      'log 500 for lunch',
      stub('{"onTopic":false,"intent":null,"section":null,"amount":null,"note":null,"suggestions":[]}'),
    );
    expect(route?.onTopic).toBe(false);
    expect(route?.intent).toBeNull();
  });

  test('returns null on unparseable output so the caller can fall back', async () => {
    expect(await routeTaxQuestion('hi', stub('I think your tax is about ₹80,000'))).toBeNull();
    expect(await routeTaxQuestion('hi', stub('{"onTopic":"maybe"}'))).toBeNull();
  });
});

// ─── The prompt must not leak user data ───────────────────────────────────────

describe('router prompt', () => {
  test('contains no placeholder for user figures', () => {
    const prompt = buildTaxRouterPrompt();
    // The prompt is static: it is built with no arguments at all, so there is
    // no code path that could interpolate the user's numbers into it.
    expect(buildTaxRouterPrompt.length).toBe(0);
    expect(prompt).toContain('which you cannot see');
    expect(prompt).toContain('TAX ONLY');
  });

  test('lists every intent the engine can answer', () => {
    const prompt = buildTaxRouterPrompt();
    for (const intent of [
      'current_position', 'how_to_save', 'regime_compare', 'whatif_invest',
      'section_status', 'explain', 'unclassified', 'itr', 'help',
    ]) {
      expect(prompt).toContain(intent);
    }
  });
});

// ─── The override path: LLM chooses, engine computes ─────────────────────────

describe('answerQuestion with an override', () => {
  test('an override routes to the intended handler regardless of wording', () => {
    const state = makeState();
    // Wording the keyword matcher would never classify correctly.
    const gibberish = 'yaar batao na kya scene hai';

    const withoutOverride = answerQuestion(gibberish, state);
    const withOverride = answerQuestion(gibberish, state, { intent: 'current_position' });

    expect(withoutOverride.intent).toBe('help');       // keyword matcher gives up
    expect(withOverride.intent).toBe('current_position'); // LLM rescued it
    expect(withOverride.text).toContain('₹');            // and the engine supplied real figures
  });

  test('an override supplies slots the text does not contain', () => {
    const state = makeState();
    const answer = answerQuestion('would that pension thing help', state, {
      intent: 'whatif_invest',
      section: '80CCD(1B)',
      amount: 50_000,
    });
    expect(answer.intent).toBe('whatif_invest');
    expect(answer.data?.section).toBe('80CCD(1B)');
    expect(answer.data?.amount).toBe(50_000);
  });

  test('an unknown section in the override falls back to text detection', () => {
    const state = makeState();
    const answer = answerQuestion('how much 80C have I used', state, {
      intent: 'section_status',
      section: null,
    });
    expect(answer.intent).toBe('section_status');
    expect(answer.text).toContain('80C');
  });

  test('omitting the override leaves the offline behaviour untouched', () => {
    const state = makeState();
    expect(answerQuestion('which regime should I pick', state).intent)
      .toBe(answerQuestion('which regime should I pick', state, {}).intent);
  });

  test('the engine, not the model, produces the figures', () => {
    const state = makeState();
    // Same intent, two different phrasings -> byte-identical answer text,
    // because the text is templated from local state and nothing else.
    const a = answerQuestion('where do I stand', state, { intent: 'current_position' });
    const b = answerQuestion('completely different words', state, { intent: 'current_position' });
    expect(a.text).toBe(b.text);
  });
});
