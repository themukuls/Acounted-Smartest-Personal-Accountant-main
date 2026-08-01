/**
 * qa.test.ts — the conversational Q&A engine.
 * Run with:  bun test src/lib/tax
 */

import { test, expect, describe } from 'bun:test';
import { answerQuestion, extractAmount, inr } from './qa';
import { buildTaxState } from './ledger';

const state = buildTaxState({
  financialYear: '2025-26',
  ageCategory: '<60',
  hasSalaryOrPension: true,
  salaryIncome: 2000000,
  entries: [
    { description: 'ELSS', amount: 50000 }, // 80C partly used → headroom
    { description: 'insurance', amount: 30000 }, // ambiguous → unclassified
  ],
});

describe('inr formatting (Indian grouping)', () => {
  test('152400 → ₹1,52,400', () => expect(inr(152400)).toBe('₹1,52,400'));
  test('900 → ₹900', () => expect(inr(900)).toBe('₹900'));
  test('10000000 → ₹1,00,00,000', () => expect(inr(10000000)).toBe('₹1,00,00,000'));
});

describe('extractAmount', () => {
  test('50000 → 50000', () => expect(extractAmount('invest 50000')).toBe(50000));
  test('50k → 50000', () => expect(extractAmount('put 50k in nps')).toBe(50000));
  test('1.5 lakh → 150000', () => expect(extractAmount('1.5 lakh in ppf')).toBe(150000));
  test('section code 80c is not read as an amount', () => expect(extractAmount('invest in 80c')).toBeNull());
});

describe('answerQuestion — intent routing', () => {
  test('"where do I stand?" → current position with both regimes', () => {
    const a = answerQuestion('where do I stand?', state);
    expect(a.intent).toBe('current_position');
    expect(a.text).toContain('new regime');
    expect(a.text).toContain('old regime');
  });

  test('"how can I save more tax?" → headroom advice', () => {
    const a = answerQuestion('how can I save more tax?', state);
    expect(a.intent).toBe('how_to_save');
    expect(a.text.toLowerCase()).toContain('80c'); // has 80C headroom
  });

  test('"which regime should I pick?" → regime recommendation', () => {
    const a = answerQuestion('which regime should I pick?', state);
    expect(a.intent).toBe('regime_compare');
  });

  test('"what if I invest 50000 in 80C?" → quantified saving', () => {
    const a = answerQuestion('what if I invest 50000 in 80C?', state);
    expect(a.intent).toBe('whatif_invest');
    expect(a.data?.saving).toBeGreaterThan(0);
    expect(a.text).toContain('80C');
  });

  test('what-if without an amount asks for one', () => {
    const a = answerQuestion('what if I invest more?', state);
    expect(a.needsInput).toBe(true);
  });

  test('"what is 80C?" → explanation from the knowledge base', () => {
    const a = answerQuestion('what is 80C?', state);
    expect(a.intent).toBe('explain');
    expect(a.text).toContain('1.5 lakh');
  });

  test('"how much 80C have I used?" → section status with headroom', () => {
    const a = answerQuestion('how much 80C have I used?', state);
    expect(a.intent).toBe('section_status');
    expect(a.text).toContain('50,000'); // used
    expect(a.text).toContain('1,00,000'); // remaining headroom
  });

  test('"what needs review?" → surfaces the unclassified entry', () => {
    const a = answerQuestion('what needs review?', state);
    expect(a.intent).toBe('unclassified');
    expect(a.text).toContain('insurance');
  });

  test('"which ITR form should I file?" → ITR draft summary', () => {
    const a = answerQuestion('which ITR form should I file?', state);
    expect(a.intent).toBe('itr');
    expect(a.text).toContain('ITR-');
    expect(a.data?.assessmentYear).toBe('2026-27');
  });

  test('gibberish → help, never a bluff', () => {
    const a = answerQuestion('asdfghjkl', state);
    expect(a.intent).toBe('help');
    expect(a.suggestions.length).toBeGreaterThan(0);
  });
});
