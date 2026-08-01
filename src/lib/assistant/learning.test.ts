/**
 * learning.test.ts — the local personalisation layer, and the privacy promise.
 *
 * Run with:  bun test src/lib/assistant
 *
 * Two jobs here. The first is ordinary correctness: a merchant the user visits
 * every week should file itself, a merchant they visited once should not, and a
 * correction the user made by hand should beat both.
 *
 * The second is the one that actually matters. AssistantSettingsModal tells the
 * user that "only the sentence you speak or type is sent to the provider —
 * never your balances, transactions, name or contact details". The last block
 * of this file holds the code to that sentence mechanically, because a promise
 * that is only enforced by a comment is a promise that eventually gets broken
 * by someone trying to make the model a bit smarter.
 */

import { test, expect, describe, beforeEach } from 'bun:test';
import {
  EMPTY_PROFILE,
  amountNoticeFor,
  beginCorrectionCapture,
  buildProfile,
  captureCorrection,
  dominantAccount,
  getAmountNotice,
  getCorrections,
  lookupCorrection,
  matchHistory,
  merchantTokens,
  personaliseAction,
  rememberCorrection,
  resetLearningState,
  setCorrectionStorage,
  utteranceNamesAccount,
  utteranceNamesCategory,
  type CorrectionStorage,
  type HistoryTransaction,
} from './learning';
import { extractAction, type ExtractDeps } from './extract';
import { buildSystemPrompt, buildUserPrompt } from './prompt';
import { DEFAULT_CATEGORIES } from '@/lib/categories';
import type { AddTransactionAction, WritableAction } from './types';

const TODAY = new Date('2026-03-15T00:00:00+05:30');

/** The default slugs plus one the user made up — the real shape of the list. */
const SLUGS = [...DEFAULT_CATEGORIES.map((c) => c.category_name), 'kanatal-trip'];

const USER = 'user-1';

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const txn = (
  description: string,
  category: string,
  over: Partial<HistoryTransaction> = {},
): HistoryTransaction => ({
  type: 'expense',
  amount: 300,
  category,
  account: 'upi',
  description,
  transaction_date: '2026-03-01T12:00:00.000Z',
  ...over,
});

const repeat = (n: number, make: (i: number) => HistoryTransaction) =>
  Array.from({ length: n }, (_, i) => make(i));

const expense = (over: Partial<AddTransactionAction> = {}): WritableAction => ({
  kind: 'add_transaction',
  type: 'expense',
  amount: 400,
  category: 'others',
  account: 'cash',
  description: '',
  transaction_date: '2026-03-15',
  assumed: ['category', 'account'],
  ...over,
});

const personalise = (
  action: WritableAction,
  utterance: string,
  history: HistoryTransaction[],
  corrections = {},
) =>
  personaliseAction(action, utterance, {
    profile: buildProfile(history, TODAY),
    corrections,
    categorySlugs: SLUGS,
  });

/** A localStorage stand-in — bun's global storage is not something to rely on. */
function fakeStorage(): CorrectionStorage {
  const map = new Map<string, string>();
  return {
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => void map.set(k, v),
    removeItem: (k) => void map.delete(k),
  };
}

beforeEach(() => {
  setCorrectionStorage(fakeStorage());
  resetLearningState();
});

// ─── Tokenising ───────────────────────────────────────────────────────────────

describe('merchantTokens', () => {
  test('keeps the merchant and drops the noise', () => {
    expect(merchantTokens('Blinkit rice bag 5 kg')).toEqual(['blinkit', 'rice', 'bag']);
  });

  test('drops filler verbs, dates and bare numbers from an utterance', () => {
    expect(merchantTokens('spent 450 at Blinkit yesterday')).toEqual(['blinkit']);
  });

  test('a sentence with nothing nameable in it yields nothing', () => {
    expect(merchantTokens('paid 200 today')).toEqual([]);
  });
});

// ─── Merchant → category ──────────────────────────────────────────────────────

describe('merchant category memory', () => {
  test('a merchant the user always files under one category wins', () => {
    const history = repeat(6, (i) => txn(`Blinkit order ${i}`, 'food'));
    const { action, applied } = personalise(expense(), 'blinkit 400', history);

    expect((action as AddTransactionAction).category).toBe('food');
    expect(applied).toContain('category');
    // The user must be able to see that this was inferred, not heard.
    expect(action.assumed).toContain('category');
  });

  test('a merchant seen exactly once does NOT override the model', () => {
    const history = [txn('Zerodha brokerage', 'investment')];
    const { action, applied } = personalise(
      expense({ category: 'others' }),
      'zerodha 2500',
      history,
    );

    expect((action as AddTransactionAction).category).toBe('others');
    expect(applied).not.toContain('category');
  });

  test('a merchant with no clear majority does NOT override the model', () => {
    // Two food, two household — 50%, below the 60% bar.
    const history = [
      txn('Blinkit run', 'food'),
      txn('Blinkit run', 'food'),
      txn('Blinkit run', 'household'),
      txn('Blinkit run', 'household'),
    ];
    const { action } = personalise(expense({ category: 'others' }), 'blinkit 400', history);
    expect((action as AddTransactionAction).category).toBe('others');
  });

  test('a distinctive merchant outweighs incidental word collisions', () => {
    // "food" appears everywhere and would win a naive vote; "zerodha" is rare,
    // and inverse document frequency is what makes it count for more.
    const history = [
      ...repeat(30, () => txn('Street food', 'food')),
      ...repeat(3, () => txn('Zerodha food coupon', 'investment')),
    ];
    const { action } = personalise(expense(), 'zerodha 5000', history);
    expect((action as AddTransactionAction).category).toBe('investment');
  });

  test('never overrides a category the user said out loud', () => {
    const history = repeat(8, () => txn('Blinkit order', 'household'));
    const { action, applied } = personalise(
      expense({ category: 'food', assumed: [] }),
      'spent 400 on food at blinkit',
      history,
    );

    expect((action as AddTransactionAction).category).toBe('food');
    expect(applied).not.toContain('category');
  });

  test('income is never re-categorised, however strong the history', () => {
    const history = repeat(8, () => txn('Zerodha payout', 'investment'));
    const { action } = personalise(
      expense({ type: 'income', category: 'income', amount: 46154 }),
      'zerodha credited 46154',
      history,
    );
    expect((action as AddTransactionAction).category).toBe('income');
  });

  test('a suggestion outside the allowed slug list is discarded', () => {
    const history = repeat(6, () => txn('Blinkit order', 'a-category-that-no-longer-exists'));
    const { action } = personalise(expense(), 'blinkit 400', history);
    expect((action as AddTransactionAction).category).toBe('others');
  });
});

// ─── Corrections ──────────────────────────────────────────────────────────────

describe('learned corrections', () => {
  test('round-trips through storage and matches on the distinctive token', () => {
    rememberCorrection(USER, 'blinkit 400', { category: 'household' });
    const map = getCorrections(USER);
    expect(lookupCorrection(map, 'blinkit 250')?.category).toBe('household');
  });

  test('a user correction beats a strong history majority', () => {
    const history = repeat(10, () => txn('Blinkit order', 'food'));

    // Baseline: history alone says food.
    expect(
      (personalise(expense(), 'blinkit 400', history).action as AddTransactionAction).category,
    ).toBe('food');

    // The user fixes it once on the review card…
    const offered = personalise(expense(), 'blinkit 400', history).action;
    beginCorrectionCapture(USER, 'blinkit 400', offered);
    captureCorrection(USER, { ...offered, category: 'household' } as WritableAction);

    // …and from then on their correction wins.
    const next = personalise(expense(), 'blinkit 250', history, getCorrections(USER));
    expect((next.action as AddTransactionAction).category).toBe('household');
    expect(next.applied).toContain('category');
  });

  test('a correction to the payment method is remembered too', () => {
    const offered = expense({ account: 'upi', description: 'Indane gas' });
    beginCorrectionCapture(USER, 'indane gas cylinder 1150', offered);
    captureCorrection(USER, { ...offered, account: 'cash' } as WritableAction);

    const map = getCorrections(USER);
    expect(lookupCorrection(map, 'indane cylinder')?.account).toBe('cash');
  });

  test('saving without editing anything records no correction', () => {
    const offered = expense({ category: 'food', account: 'upi' });
    beginCorrectionCapture(USER, 'blinkit 400', offered);
    captureCorrection(USER, offered);
    expect(getCorrections(USER)).toEqual({});
  });

  test('a correction from a different user is not applied to this one', () => {
    const offered = expense();
    beginCorrectionCapture('someone-else', 'blinkit 400', offered);
    captureCorrection(USER, { ...offered, category: 'household' } as WritableAction);
    expect(getCorrections(USER)).toEqual({});
  });

  test('storage being unavailable is survivable, not fatal', () => {
    setCorrectionStorage(null);
    expect(() => rememberCorrection(USER, 'blinkit 400', { category: 'food' })).not.toThrow();
    expect(getCorrections(USER)).toEqual({});
  });
});

// ─── Account defaulting ───────────────────────────────────────────────────────

describe('account defaulting', () => {
  test('with no history at all, the default is UPI — not cash', () => {
    const { action, applied } = personalise(expense({ account: 'cash' }), 'lunch 250', []);
    expect((action as AddTransactionAction).account).toBe('upi');
    expect(applied).toContain('account');
    expect(action.assumed).toContain('account');
  });

  test('follows the user\'s own dominant method once there is history', () => {
    const history = repeat(10, (i) =>
      txn(`Shop visit ${i}`, 'household', { account: 'credit-card' }),
    );
    const { action } = personalise(expense({ account: 'cash' }), 'lunch 250', history);
    expect((action as AddTransactionAction).account).toBe('credit-card');
  });

  test('one or two transactions is not yet a habit — falls back to UPI', () => {
    const history = [txn('Shop', 'household', { account: 'cash' })];
    expect(dominantAccount(buildProfile(history, TODAY))).toBeNull();
    const { action } = personalise(expense({ account: 'cash' }), 'lunch 250', history);
    expect((action as AddTransactionAction).account).toBe('upi');
  });

  test('a specific merchant beats the overall habit', () => {
    const history = [
      ...repeat(20, (i) => txn(`Shop visit ${i}`, 'household', { account: 'upi' })),
      ...repeat(4, () => txn('Indane gas cylinder', 'household', { account: 'cash' })),
    ];
    const { action } = personalise(expense(), 'indane cylinder 1150', history);
    expect((action as AddTransactionAction).account).toBe('cash');
  });

  test('never overrides a payment method the user said out loud', () => {
    const history = repeat(10, (i) => txn(`Shop ${i}`, 'household', { account: 'upi' }));
    const { action, applied } = personalise(
      expense({ account: 'credit-card', assumed: [] }),
      'paid 1200 for petrol on my credit card',
      history,
    );
    expect((action as AddTransactionAction).account).toBe('credit-card');
    expect(applied).not.toContain('account');
  });

  test('income keeps the account the model heard', () => {
    const history = repeat(20, (i) => txn(`Shop ${i}`, 'household', { account: 'upi' }));
    const { action } = personalise(
      expense({ type: 'income', category: 'income', account: 'bank-transfer', amount: 85000 }),
      'got my salary of 85000',
      history,
    );
    expect((action as AddTransactionAction).account).toBe('bank-transfer');
  });

  test('income transactions do not skew the spending habit', () => {
    const history = [
      ...repeat(6, () => txn('Salary', 'income', { account: 'bank-transfer', type: 'income' })),
      ...repeat(5, (i) => txn(`Shop ${i}`, 'household', { account: 'upi' })),
    ];
    expect(dominantAccount(buildProfile(history, TODAY))).toBe('upi');
  });

  test('utterance account detection', () => {
    expect(utteranceNamesAccount('paid 1200 on my credit card')).toBe(true);
    expect(utteranceNamesAccount('gave 300 cash to the driver')).toBe(true);
    expect(utteranceNamesAccount('blinkit 400')).toBe(false);
  });

  test('utterance category detection', () => {
    expect(utteranceNamesCategory('spent 400 on food', SLUGS)).toBe(true);
    expect(utteranceNamesCategory('paid 12000 rent', SLUGS)).toBe(true);
    expect(utteranceNamesCategory('blinkit 400', SLUGS)).toBe(false);
  });
});

// ─── Amount sanity ────────────────────────────────────────────────────────────

describe('amount sanity', () => {
  const foodHistory = repeat(8, (i) => txn(`Chai ${i}`, 'food', { amount: 100 }));

  test('flags an amount far above the usual for that category', () => {
    const notice = amountNoticeFor('food', 5000, buildProfile(foodHistory, TODAY));
    expect(notice).toEqual({ direction: 'high', typical: 100, category: 'food' });
  });

  test('never rewrites the amount it flagged', () => {
    const { action, amountNotice } = personalise(
      expense({ amount: 5000, category: 'food' }),
      'chai 5000',
      foodHistory,
    );
    expect(amountNotice?.direction).toBe('high');
    expect((action as AddTransactionAction).amount).toBe(5000);
  });

  test('a normal amount raises nothing', () => {
    expect(amountNoticeFor('food', 250, buildProfile(foodHistory, TODAY))).toBeNull();
  });

  test('too few samples to have an opinion', () => {
    const thin = repeat(4, () => txn('Chai', 'food', { amount: 100 }));
    expect(amountNoticeFor('food', 5000, buildProfile(thin, TODAY))).toBeNull();
  });

  test('the review card stops showing the notice once the amount is edited', () => {
    const { action } = personalise(
      expense({ amount: 5000, category: 'food' }),
      'chai 5000',
      foodHistory,
    );
    expect(getAmountNotice(action)).not.toBeNull();
    expect(getAmountNotice({ ...action, amount: 50 } as WritableAction)).toBeNull();
  });
});

// ─── A brand-new user ─────────────────────────────────────────────────────────

describe('a user with no history', () => {
  test('buildProfile of nothing is inert', () => {
    const profile = buildProfile([], TODAY);
    expect(profile.entries).toHaveLength(0);
    expect(dominantAccount(profile)).toBeNull();
    expect(matchHistory('blinkit 400', profile)).toEqual({ category: null, account: null });
    expect(amountNoticeFor('food', 999999, profile)).toBeNull();
  });

  test('invents no category and raises no amount warning', () => {
    const { action, applied, amountNotice } = personalise(
      expense({ category: 'food', assumed: ['account'] }),
      'blinkit 400',
      [],
    );

    // The model's answer survives untouched…
    expect((action as AddTransactionAction).category).toBe('food');
    expect(applied).not.toContain('category');
    expect(amountNotice).toBeNull();
    // …and the only thing we supply is the documented UPI default.
    expect((action as AddTransactionAction).account).toBe('upi');
  });

  test('EMPTY_PROFILE behaves the same as a freshly built empty one', () => {
    expect(matchHistory('anything at all', EMPTY_PROFILE)).toEqual({
      category: null,
      account: null,
    });
  });

  test('udhar actions pass through untouched', () => {
    const udhar: WritableAction = {
      kind: 'add_udhar',
      type: 'given',
      person: 'Rahul',
      amount: 2000,
      due_date: '2026-04-15',
      description: '',
      assumed: [],
    };
    const result = personalise(udhar, 'rahul owes me 2000', repeat(9, () => txn('Blinkit', 'food')));
    expect(result.action).toBe(udhar);
    expect(result.applied).toEqual([]);
  });
});

// ─── THE PRIVACY PROMISE ──────────────────────────────────────────────────────

/**
 * A ledger full of things that must never leave the device: distinctive
 * merchant names, and amounts chosen so they cannot collide with the fixed
 * numbers in the prompt's own few-shot examples.
 */
const PRIVATE_HISTORY: HistoryTransaction[] = [
  ...repeat(9, () => txn('Blinkit grocery order', 'food', { amount: 379, account: 'credit-card' })),
  ...repeat(5, () => txn('Zerodha brokerage', 'investment', { amount: 9137, account: 'credit-card' })),
  ...repeat(4, () => txn('Indane Gas Cylinder', 'household', { amount: 1150, account: 'credit-card' })),
  ...repeat(3, () => txn('Netflix Youtube automated bill', 'recharge', { amount: 72400, account: 'credit-card' })),
  ...repeat(3, () => txn('Rupali Engagement Venue Fee', 'others', { amount: 46154, account: 'credit-card' })),
];

/** Every string above that identifies what this user buys, where, or for how much. */
const MUST_NOT_LEAK = [
  'blinkit', 'zerodha', 'indane', 'netflix', 'youtube', 'rupali', 'engagement',
  'venue', 'cylinder', 'brokerage', 'grocery order',
  '379', '9137', '1150', '72400', '46154',
];

describe('the privacy promise: no user data reaches the provider', () => {
  test('the prompt is built from the date and the slug list, and nothing else', () => {
    // The profile exists and is rich — the prompt builder simply has no way to
    // reach it. buildSystemPrompt takes exactly two things.
    const profile = buildProfile(PRIVATE_HISTORY, TODAY);
    expect(profile.entries.length).toBeGreaterThan(20);

    const system = buildSystemPrompt({ today: TODAY, categorySlugs: SLUGS }).toLowerCase();

    for (const secret of MUST_NOT_LEAK) {
      expect(system).not.toContain(secret);
    }

    // What IS allowed through: the static slug list, including the user's own
    // custom category names. That predates this feature and is what lets the
    // model answer with a slug that exists.
    expect(system).toContain('kanatal-trip');
  });

  test('a full personalised extraction sends only the utterance', async () => {
    const profile = buildProfile(PRIVATE_HISTORY, TODAY);
    const sent: { system: string; user: string }[] = [];

    const deps: ExtractDeps = {
      today: TODAY,
      categorySlugs: SLUGS,
      complete: async (system, user) => {
        sent.push({ system, user });
        return '{"kind":"add_transaction","type":"expense","amount":640,"category":"others","account":"cash","description":"Coffee","transaction_date":"2026-03-15","assumed":["category","account"]}';
      },
      personalise: (action, utterance) =>
        personaliseAction(action, utterance, {
          profile,
          corrections: getCorrections(USER),
          categorySlugs: SLUGS,
        }).action,
    };

    const utterance = 'paid 640 for a coffee';
    const result = await extractAction(utterance, deps);

    // Personalisation demonstrably ran: 'cash' became the card this user
    // actually pays with, which could only come from their local history.
    expect(result.kind).toBe('add_transaction');
    expect((result as AddTransactionAction).account).toBe('credit-card');

    // And yet the wire carried none of it.
    expect(sent).toHaveLength(1);
    expect(sent[0].user).toBe(utterance);
    expect(buildUserPrompt(utterance)).toBe(utterance);

    const wire = `${sent[0].system}\n${sent[0].user}`.toLowerCase();
    for (const secret of MUST_NOT_LEAK) {
      expect(wire).not.toContain(secret);
    }
  });

  test('a learned correction changes the answer without changing the prompt', async () => {
    rememberCorrection(USER, 'coffee', { category: 'food' });
    const profile = buildProfile(PRIVATE_HISTORY, TODAY);
    let systemSent = '';

    const deps: ExtractDeps = {
      today: TODAY,
      categorySlugs: SLUGS,
      complete: async (system) => {
        systemSent = system;
        return '{"kind":"add_transaction","type":"expense","amount":640,"category":"others","account":"upi","description":"Coffee","transaction_date":"2026-03-15","assumed":["category"]}';
      },
      personalise: (action, utterance) =>
        personaliseAction(action, utterance, {
          profile,
          corrections: getCorrections(USER),
          categorySlugs: SLUGS,
        }).action,
    };

    const result = await extractAction('paid 640 for a coffee', deps);
    expect((result as AddTransactionAction).category).toBe('food');
    expect(systemSent.toLowerCase()).not.toContain('coffee');
    expect(systemSent).toBe(buildSystemPrompt({ today: TODAY, categorySlugs: SLUGS }));
  });
});
