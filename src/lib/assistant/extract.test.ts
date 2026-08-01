/**
 * extract.test.ts — correctness gate for the LLM-to-record normalisation.
 *
 * Run with:  bun test src/lib/assistant
 *
 * Everything here is offline: the provider is a stub that returns whatever
 * string the test hands it. What's under test is the layer that decides
 * whether a model's reply is safe to write, which is the part that can quietly
 * corrupt a ledger if it's wrong.
 */

import { test, expect, describe } from 'bun:test';
import { parseISO, format, subDays } from 'date-fns';
import {
  extractAction,
  parseActionJson,
  stripCodeFences,
  snapCategory,
  sanitizeDate,
  type ExtractDeps,
} from './extract';
import { parseIndianAmount } from './types';

const TODAY = parseISO('2026-03-15'); // a Sunday
const CATEGORIES = [
  'food', 'fuel', 'entertainment', 'investment', 'health', 'medicine',
  'clothing', 'household', 'books', 'education', 'recharge', 'rent',
  'vehicle', 'tech-products', 'professional-fee', 'trips-outings',
  'emis', 'others',
];

const opts = { today: TODAY, categorySlugs: CATEGORIES };

/** A provider stub that replays a fixed list of responses, one per call. */
function stubDeps(...responses: string[]): ExtractDeps & { calls: number } {
  let calls = 0;
  const deps = {
    today: TODAY,
    categorySlugs: CATEGORIES,
    complete: async () => {
      const reply = responses[Math.min(calls, responses.length - 1)];
      calls++;
      deps.calls = calls;
      return reply;
    },
    calls: 0,
  };
  return deps;
}

// ─── Amount parsing ───────────────────────────────────────────────────────────

describe('parseIndianAmount', () => {
  test('passes numbers through', () => {
    expect(parseIndianAmount(450)).toBe(450);
    expect(parseIndianAmount(1234.56)).toBe(1234.56);
  });

  test('parses plain numeric strings', () => {
    expect(parseIndianAmount('450')).toBe(450);
    expect(parseIndianAmount('1234.50')).toBe(1234.5);
  });

  test('strips rupee symbols, commas and spaces', () => {
    expect(parseIndianAmount('₹1,200')).toBe(1200);
    expect(parseIndianAmount(' 2,50,000 ')).toBe(250000);
  });

  test('expands Indian magnitude suffixes', () => {
    expect(parseIndianAmount('2.5k')).toBe(2500);
    expect(parseIndianAmount('1 lakh')).toBe(100000);
    expect(parseIndianAmount('1.5lakhs')).toBe(150000);
    expect(parseIndianAmount('3L')).toBe(300000);
    expect(parseIndianAmount('2 crore')).toBe(20000000);
    expect(parseIndianAmount('5 thousand')).toBe(5000);
  });

  test('rejects junk rather than silently truncating', () => {
    expect(parseIndianAmount('45abc')).toBeNaN();
    expect(parseIndianAmount('')).toBeNaN();
    expect(parseIndianAmount('lots')).toBeNaN();
  });
});

// ─── Fence stripping ──────────────────────────────────────────────────────────

describe('stripCodeFences', () => {
  test('unwraps a ```json fence', () => {
    expect(stripCodeFences('```json\n{"a":1}\n```')).toBe('{"a":1}');
  });

  test('unwraps a bare fence', () => {
    expect(stripCodeFences('```\n{"a":1}\n```')).toBe('{"a":1}');
  });

  test('rescues JSON surrounded by prose', () => {
    expect(stripCodeFences('Sure! {"a":1} Hope that helps.')).toBe('{"a":1}');
  });

  test('leaves clean JSON alone', () => {
    expect(stripCodeFences('{"a":1}')).toBe('{"a":1}');
  });
});

// ─── Category snapping ────────────────────────────────────────────────────────

describe('snapCategory', () => {
  test('accepts an exact slug', () => {
    expect(snapCategory('food', CATEGORIES)).toBe('food');
  });

  test('slugifies a spaced label', () => {
    expect(snapCategory('Tech Products', CATEGORIES)).toBe('tech-products');
  });

  test('matches a less specific candidate to its slug', () => {
    expect(snapCategory('tech', CATEGORIES)).toBe('tech-products');
    expect(snapCategory('trips', CATEGORIES)).toBe('trips-outings');
  });

  test('matches a more specific candidate back to its slug', () => {
    expect(snapCategory('Food & Dining', CATEGORIES)).toBe('food');
  });

  test('tolerates a plural', () => {
    expect(snapCategory('book', CATEGORIES)).toBe('books');
  });

  test('does not match on an incidental substring', () => {
    // Regression: a plain `candidate.includes(slug)` filed these under
    // "fuel" and "rent" respectively, because a long unfamiliar phrase
    // happens to contain a short slug.
    expect(snapCategory('spaceship-fuel-tax', CATEGORIES)).toBe('others');
    expect(snapCategory('current account charges', CATEGORIES)).toBe('others');
  });

  test('falls back to others for anything unknown', () => {
    expect(snapCategory('interstellar travel', CATEGORIES)).toBe('others');
    expect(snapCategory('', CATEGORIES)).toBe('others');
  });

  test('lets the income pseudo-category through', () => {
    expect(snapCategory('income', CATEGORIES)).toBe('income');
  });
});

// ─── Date sanitising ──────────────────────────────────────────────────────────

describe('sanitizeDate', () => {
  test('keeps a plausible date', () => {
    expect(sanitizeDate('2026-03-14', TODAY)).toEqual({ date: '2026-03-14', corrected: false });
  });

  test('replaces an unparseable date with today', () => {
    expect(sanitizeDate('not-a-date', TODAY)).toEqual({ date: '2026-03-15', corrected: true });
  });

  test('replaces a wildly out-of-range date with today', () => {
    expect(sanitizeDate('1998-01-01', TODAY)).toEqual({ date: '2026-03-15', corrected: true });
  });
});

// ─── Full parse path ──────────────────────────────────────────────────────────

describe('parseActionJson', () => {
  test('coerces a string amount to a number', () => {
    const action = parseActionJson(
      '{"kind":"add_transaction","type":"expense","amount":"450","category":"food","account":"cash","description":"Groceries","transaction_date":"2026-03-14","assumed":[]}',
      opts,
    );
    // This is the one that matters most: saveTransaction writes ₹0 for a
    // string amount, so a leaked string is a silently wrong ledger row.
    expect(action?.kind).toBe('add_transaction');
    expect(action && 'amount' in action && action.amount).toBe(450);
    expect(typeof (action as any).amount).toBe('number');
  });

  test('expands a spoken magnitude in the amount field', () => {
    const action = parseActionJson(
      '{"kind":"add_udhar","type":"given","person":"Rahul","amount":"1 lakh","due_date":"2026-04-15","description":"","assumed":[]}',
      opts,
    );
    expect((action as any).amount).toBe(100000);
  });

  test('forces the income pseudo-category for income', () => {
    const action = parseActionJson(
      '{"kind":"add_transaction","type":"income","amount":85000,"category":"food","account":"bank-transfer","description":"Salary","transaction_date":"2026-03-15","assumed":[]}',
      opts,
    );
    expect((action as any).category).toBe('income');
  });

  test('snaps an invented category to others', () => {
    const action = parseActionJson(
      '{"kind":"add_transaction","type":"expense","amount":100,"category":"interstellar-travel","account":"upi","description":"x","transaction_date":"2026-03-15","assumed":[]}',
      opts,
    );
    expect((action as any).category).toBe('others');
  });

  test('flags a corrected date as assumed', () => {
    const action = parseActionJson(
      '{"kind":"add_transaction","type":"expense","amount":100,"category":"food","account":"upi","description":"x","transaction_date":"1980-01-01","assumed":[]}',
      opts,
    );
    expect((action as any).transaction_date).toBe('2026-03-15');
    expect((action as any).assumed).toContain('transaction_date');
  });

  test('applies defaults for omitted optional fields', () => {
    const action = parseActionJson(
      '{"kind":"add_transaction","type":"expense","amount":100,"transaction_date":"2026-03-15"}',
      opts,
    );
    expect((action as any).category).toBe('others');
    // An omitted account is UPI (see DEFAULT_ACCOUNT), and — crucially — is
    // reported as assumed. The schema's own `.default()` would otherwise make a
    // field the model never mentioned look like a confident answer, and the
    // local personalisation layer would leave that invention in place.
    expect((action as any).account).toBe('upi');
    expect((action as any).description).toBe('');
    expect((action as any).assumed).toEqual(['category', 'account']);
  });

  test('rejects a zero or negative amount', () => {
    expect(parseActionJson(
      '{"kind":"add_transaction","type":"expense","amount":0,"category":"food","account":"upi","description":"x","transaction_date":"2026-03-15","assumed":[]}',
      opts,
    )).toBeNull();
    expect(parseActionJson(
      '{"kind":"add_transaction","type":"expense","amount":-50,"category":"food","account":"upi","description":"x","transaction_date":"2026-03-15","assumed":[]}',
      opts,
    )).toBeNull();
  });

  test('rejects an unparseable amount rather than defaulting it', () => {
    expect(parseActionJson(
      '{"kind":"add_transaction","type":"expense","amount":"a few hundred","category":"food","account":"upi","description":"x","transaction_date":"2026-03-15","assumed":[]}',
      opts,
    )).toBeNull();
  });

  test('rejects an unknown action kind', () => {
    expect(parseActionJson('{"kind":"launch_rocket","amount":5}', opts)).toBeNull();
  });

  test('returns null for malformed JSON', () => {
    expect(parseActionJson('not json at all', opts)).toBeNull();
  });

  test('passes an unclear result straight through', () => {
    const action = parseActionJson('{"kind":"unclear","reason":"No amount given."}', opts);
    expect(action).toEqual({ kind: 'unclear', reason: 'No amount given.' });
  });

  test('never produces an explicit undefined field', () => {
    // The write services spread the payload LAST over their defaults, and
    // Object.entries includes undefined-valued keys — so an undefined here
    // would overwrite a default with undefined in IndexedDB.
    const action = parseActionJson(
      '{"kind":"add_transaction","type":"expense","amount":100,"transaction_date":"2026-03-15"}',
      opts,
    );
    expect(Object.values(action!).every((v) => v !== undefined)).toBe(true);
  });
});

// ─── extractAction end-to-end (stubbed provider) ──────────────────────────────

describe('extractAction', () => {
  test('returns unclear for empty input without calling the model', async () => {
    const deps = stubDeps('{"kind":"unclear","reason":"x"}');
    const result = await extractAction('   ', deps);
    expect(result.kind).toBe('unclear');
    expect(deps.calls).toBe(0);
  });

  test('parses a well-formed first response', async () => {
    const deps = stubDeps(
      '{"kind":"add_transaction","type":"expense","amount":450,"category":"food","account":"cash","description":"Groceries","transaction_date":"2026-03-14","assumed":["account"]}',
    );
    const result = await extractAction('spent 450 on groceries yesterday', deps);
    expect(result.kind).toBe('add_transaction');
    expect((result as any).amount).toBe(450);
    expect(deps.calls).toBe(1);
  });

  test('retries once when the first reply is not JSON', async () => {
    const deps = stubDeps(
      'Sure, let me help with that!',
      '{"kind":"add_transaction","type":"expense","amount":450,"category":"food","account":"cash","description":"Groceries","transaction_date":"2026-03-14","assumed":[]}',
    );
    const result = await extractAction('spent 450 on groceries', deps);
    expect(result.kind).toBe('add_transaction');
    expect(deps.calls).toBe(2);
  });

  test('gives up with unclear after the retry also fails', async () => {
    const deps = stubDeps('nope', 'still nope');
    const result = await extractAction('spent 450 on groceries', deps);
    expect(result.kind).toBe('unclear');
    expect(deps.calls).toBe(2);
  });

  test('tolerates a fenced response', async () => {
    const deps = stubDeps(
      '```json\n{"kind":"add_udhar","type":"given","person":"Rahul","amount":2000,"due_date":"2026-04-15","description":"","assumed":["due_date"]}\n```',
    );
    const result = await extractAction('Rahul owes me 2000', deps);
    expect(result.kind).toBe('add_udhar');
    expect((result as any).person).toBe('Rahul');
    expect(deps.calls).toBe(1);
  });
});

// ─── Sanity check on the relative-date reference used by the prompt ───────────

describe('date reference', () => {
  test('yesterday relative to the test date is what the examples claim', () => {
    expect(format(subDays(TODAY, 1), 'yyyy-MM-dd')).toBe('2026-03-14');
  });
});
