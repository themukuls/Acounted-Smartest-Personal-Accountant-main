/**
 * rules.test.ts — correctness gate for the nudge engine.
 *
 * Run with:  bun test src/lib/nudges
 *
 * Two halves. The first proves each rule fires on the evidence it claims and
 * is silent without it. The second proves the scheduler's promises to the user
 * — one a day, four a week, nothing at night, off means off — because those
 * are the parts that decide whether this feature is respectful or annoying,
 * and "we tested it on a phone once" is not a guarantee.
 *
 * The single most important test in this file is the last one in
 * "brand-new user": someone who just installed the app must receive nothing.
 */

import { test, expect, describe } from 'bun:test';
import { evaluateNudges, computeStreak, RULE_CATALOGUE } from './rules';
import {
  inQuietHours,
  resolveDeliveryTime,
  selectNudge,
  notificationIdFor,
} from './scheduler';
import { normalisePreferences } from './storage';
import { addDaysToKey, dayKey } from './dates';
import {
  DEFAULT_PREFERENCES,
  type Nudge,
  type NudgeHistory,
  type NudgeHistoryEntry,
  type NudgePreferences,
  type NudgeSnapshot,
  type SnapshotTransaction,
} from './types';

// ── Fixtures ─────────────────────────────────────────────────────────────────

/** Thursday, 20 August 2026, 14:00 — a plain weekday afternoon. */
const TODAY = new Date(2026, 7, 20, 14, 0, 0);
const TODAY_KEY = dayKey(TODAY);
const ago = (n: number): string => addDaysToKey(TODAY_KEY, -n);

let seq = 0;
function txn(
  daysAgo: number,
  amount = 500,
  type: 'income' | 'expense' = 'expense',
): SnapshotTransaction {
  seq += 1;
  return {
    id: `t${seq}`,
    type,
    amount,
    category: 'Food',
    date: ago(daysAgo),
    createdAt: TODAY.toISOString(),
    description: null,
  };
}

/** One ₹500 expense a day for `days` days ending `endingDaysAgo` days ago. */
function dailyExpenses(days: number, endingDaysAgo = 0, amount = 500): SnapshotTransaction[] {
  return Array.from({ length: days }, (_, i) => txn(endingDaysAgo + i, amount));
}

function snapshot(overrides: Partial<NudgeSnapshot> = {}): NudgeSnapshot {
  const transactions = overrides.transactions ?? dailyExpenses(45);
  const dates = transactions.map((t) => t.date).sort();
  return {
    today: TODAY,
    transactions,
    totalTransactionCount: transactions.length,
    firstEntryDate: dates.length > 0 ? dates[0] : null,
    budget: null,
    goals: [],
    udhar: [],
    recurringBills: [],
    streak: computeStreak(transactions, overrides.today ?? TODAY),
    ...overrides,
  };
}

const byRule = (s: NudgeSnapshot, ruleId: string): Nudge | undefined =>
  evaluateNudges(s).find((n) => n.ruleId === ruleId);

const prefs = (patch: Partial<NudgePreferences> = {}): NudgePreferences => ({
  ...DEFAULT_PREFERENCES,
  enabled: true,
  categories: { ...DEFAULT_PREFERENCES.categories, ...(patch.categories ?? {}) },
  ...patch,
});

const history = (...entries: Partial<NudgeHistoryEntry>[]): NudgeHistory => ({
  entries: entries.map((e, i) => ({
    id: e.id ?? `h${i}`,
    ruleId: e.ruleId ?? 'streak',
    category: e.category ?? 'encouragement',
    deliveryDay: e.deliveryDay ?? TODAY_KEY,
    deliverAt: e.deliverAt ?? TODAY.toISOString(),
  })),
});

// ── Brand-new user ───────────────────────────────────────────────────────────

describe('a brand-new user is left completely alone', () => {
  test('no data at all produces no nudges', () => {
    const s = snapshot({
      transactions: [],
      totalTransactionCount: 0,
      firstEntryDate: null,
      streak: { currentDays: 0, startedOn: null, lastEntryDate: null, activeDaysLast7: 0 },
    });
    expect(evaluateNudges(s)).toEqual([]);
  });

  test('a few entries on day one produce no nudges about behaviour', () => {
    const txns = [txn(0), txn(0), txn(0)];
    const s = snapshot({ transactions: txns, totalTransactionCount: 3 });
    expect(evaluateNudges(s)).toEqual([]);
  });

  test('a week-old user hears about their own streak and nothing else', () => {
    // A seven-day streak is earned on day seven as much as on day seven
    // hundred, so that one is allowed. Everything that needs a baseline to
    // mean anything — gaps, pace, weekly comparisons — stays quiet.
    const txns = Array.from({ length: 12 }, (_, i) => txn(i % 7));
    const s = snapshot({ transactions: txns, totalTransactionCount: 12 });
    expect(evaluateNudges(s).map((n) => n.ruleId)).toEqual(['streak']);
  });

  test('a sparse first fortnight produces nothing at all', () => {
    const txns = [txn(0), txn(2), txn(5), txn(9)];
    const s = snapshot({ transactions: txns, totalTransactionCount: 4 });
    expect(evaluateNudges(s)).toEqual([]);
  });

  test('a dated udhar still works for someone with no transaction history', () => {
    // Reminders are about a thing the user themselves entered with a date on
    // it. Those are honest even on day one.
    const s = snapshot({
      transactions: [],
      totalTransactionCount: 0,
      firstEntryDate: null,
      streak: { currentDays: 0, startedOn: null, lastEntryDate: null, activeDaysLast7: 0 },
      udhar: [
        {
          id: 'u1',
          type: 'given',
          personName: 'Riya',
          outstanding: 2000,
          originalAmount: 2000,
          dueDate: ago(-2),
          isSettled: false,
          updatedOn: ago(10),
        },
      ],
    });
    expect(byRule(s, 'udhar-due-soon')).toBeDefined();
  });
});

// ── Re-engagement ────────────────────────────────────────────────────────────

describe('gap-short', () => {
  test('fires after four quiet days', () => {
    const s = snapshot({ transactions: dailyExpenses(45, 4) });
    const n = byRule(s, 'gap-short');
    expect(n).toBeDefined();
    expect(n!.title).toBe('Nothing logged since Sunday');
    expect(n!.body).toContain('4 days of spends');
    expect(n!.body).toContain('August');
  });

  test('stays silent after two quiet days', () => {
    const s = snapshot({ transactions: dailyExpenses(45, 2) });
    expect(byRule(s, 'gap-short')).toBeUndefined();
  });

  test('hands over to gap-long after a week', () => {
    const s = snapshot({ transactions: dailyExpenses(45, 9) });
    expect(byRule(s, 'gap-short')).toBeUndefined();
    expect(byRule(s, 'gap-long')).toBeDefined();
  });

  test('never fires for someone without an established habit', () => {
    const txns = [txn(20), txn(19), txn(18), txn(17)];
    const s = snapshot({ transactions: txns, totalTransactionCount: 4 });
    expect(byRule(s, 'gap-short')).toBeUndefined();
    expect(byRule(s, 'gap-long')).toBeUndefined();
  });
});

describe('gap-long', () => {
  test('fires at ten days with no catching-up demand', () => {
    const s = snapshot({ transactions: dailyExpenses(45, 10) });
    const n = byRule(s, 'gap-long');
    expect(n).toBeDefined();
    expect(n!.title).toBe("It's been 10 days");
    expect(n!.body).toContain('No catching up required');
  });

  test('goes quiet entirely past three weeks — a dormant user is left alone', () => {
    const s = snapshot({ transactions: dailyExpenses(45, 30) });
    expect(byRule(s, 'gap-long')).toBeUndefined();
    expect(evaluateNudges(s).filter((n) => n.category === 'reengagement')).toEqual([]);
  });
});

// ── Encouragement ────────────────────────────────────────────────────────────

describe('streak', () => {
  test('fires at seven consecutive days', () => {
    const txns = [...dailyExpenses(7), ...dailyExpenses(30, 8)];
    const s = snapshot({ transactions: txns });
    expect(s.streak.currentDays).toBe(7);
    const n = byRule(s, 'streak');
    expect(n).toBeDefined();
    expect(n!.title).toBe('7 days in a row');
  });

  test('says nothing at six days — only milestone lengths speak', () => {
    const txns = [...dailyExpenses(6), ...dailyExpenses(30, 8)];
    const s = snapshot({ transactions: txns });
    expect(s.streak.currentDays).toBe(6);
    expect(byRule(s, 'streak')).toBeUndefined();
  });

  test('three days gets its own copy', () => {
    const txns = [...dailyExpenses(3), ...dailyExpenses(30, 5)];
    const s = snapshot({ transactions: txns });
    const n = byRule(s, 'streak');
    expect(n!.title).toBe('Three days in a row');
    expect(n!.body).toContain('actually becomes a habit');
  });

  test('computeStreak survives a gap and an empty ledger', () => {
    expect(computeStreak([], TODAY).currentDays).toBe(0);
    // Yesterday counts — a streak is not broken until a day has fully passed.
    expect(computeStreak(dailyExpenses(4, 1), TODAY).currentDays).toBe(4);
    expect(computeStreak(dailyExpenses(4, 2), TODAY).currentDays).toBe(0);
  });
});

describe('no-spend-day', () => {
  const denseWithGap = (): SnapshotTransaction[] => [
    txn(0),
    // Yesterday: an income entry, so we know they were logging, and no expense.
    txn(1, 15000, 'income'),
    ...dailyExpenses(40, 2),
  ];

  test('fires when yesterday had entries but no spend', () => {
    const s = snapshot({ transactions: denseWithGap() });
    const n = byRule(s, 'no-spend-day');
    expect(n).toBeDefined();
    expect(n!.title).toBe('Yesterday was a no-spend day');
    expect(n!.body).toContain('Wednesday');
  });

  test('never claims a no-spend day from an unlogged day', () => {
    // Sparse logger: yesterday has nothing at all, which is silence, not a win.
    const sparse = [txn(0), txn(3), txn(6), txn(9), ...dailyExpenses(20, 12)];
    const s = snapshot({ transactions: sparse });
    expect(s.streak.activeDaysLast7).toBeLessThan(5);
    expect(byRule(s, 'no-spend-day')).toBeUndefined();
  });

  test('stays silent when yesterday did have spending', () => {
    const s = snapshot({ transactions: dailyExpenses(45) });
    expect(byRule(s, 'no-spend-day')).toBeUndefined();
  });
});

describe('lighter-week', () => {
  test('fires when the last seven days cost meaningfully less', () => {
    const txns = [
      ...dailyExpenses(7, 0, 400), //  2800 this week
      ...dailyExpenses(7, 7, 1200), // 8400 the week before
      ...dailyExpenses(30, 14, 800),
    ];
    const s = snapshot({ transactions: txns });
    const n = byRule(s, 'lighter-week');
    expect(n).toBeDefined();
    expect(n!.title).toBe('This week cost ₹5,600 less');
    expect(n!.body).toContain('₹2,800');
    expect(n!.body).toContain('₹8,400');
  });

  test('ignores a difference that is not worth anyone reading', () => {
    const txns = [
      ...dailyExpenses(7, 0, 490),
      ...dailyExpenses(7, 7, 500),
      ...dailyExpenses(30, 14, 500),
    ];
    expect(byRule(snapshot({ transactions: txns }), 'lighter-week')).toBeUndefined();
  });
});

describe('under-budget-pace', () => {
  const budget = { periodStart: '2026-08-01', periodEnd: '2026-08-31', variableBudget: 31000, fixedBudget: 0 };

  test('fires when spending is comfortably below the pro-rata pace', () => {
    // 20 days into a 31-day period: pace is ₹20,000, spend is ₹10,000.
    const s = snapshot({ transactions: dailyExpenses(45), budget });
    const n = byRule(s, 'under-budget-pace');
    expect(n).toBeDefined();
    expect(n!.title).toBe("You're ₹10,000 under pace this month");
    expect(n!.body).toContain('20 days in');
    expect(n!.body).toContain('₹31,000');
  });

  test('says nothing when spending is on or above pace', () => {
    const s = snapshot({ transactions: dailyExpenses(45, 0, 1500), budget });
    expect(byRule(s, 'under-budget-pace')).toBeUndefined();
  });

  test('says nothing without a budget to be under', () => {
    expect(byRule(snapshot(), 'under-budget-pace')).toBeUndefined();
  });
});

// ── Reminders ────────────────────────────────────────────────────────────────

describe('budget-period-ending', () => {
  test('reports what is left, with two days to go', () => {
    const s = snapshot({
      transactions: dailyExpenses(45),
      budget: {
        periodStart: '2026-08-01',
        periodEnd: ago(-2),
        variableBudget: 31000,
        fixedBudget: 0,
      },
    });
    const n = byRule(s, 'budget-period-ending');
    expect(n).toBeDefined();
    expect(n!.title).toBe('2 days left in this budget month');
    expect(n!.body).toContain('still unspent');
  });

  test('reports an overrun flatly, with no scolding', () => {
    const s = snapshot({
      transactions: dailyExpenses(45, 0, 1000),
      budget: {
        periodStart: '2026-08-01',
        periodEnd: ago(-2),
        variableBudget: 5000,
        fixedBudget: 0,
      },
    });
    const n = byRule(s, 'budget-period-ending');
    expect(n!.body).toContain('past the ₹5,000 you set');
    expect(n!.body).not.toMatch(/careful|too much|overspent|slow down/i);
  });
});

describe('udhar', () => {
  const base = {
    id: 'u1',
    outstanding: 2500,
    originalAmount: 2500,
    isSettled: false,
    updatedOn: ago(30),
  };

  test('due soon, money owed to you', () => {
    const s = snapshot({
      udhar: [{ ...base, type: 'given' as const, personName: 'Riya', dueDate: ago(-2) }],
    });
    const n = byRule(s, 'udhar-due-soon');
    expect(n!.title).toBe('Riya owes you ₹2,500 on Saturday');
  });

  test('due soon, money you owe', () => {
    const s = snapshot({
      udhar: [{ ...base, type: 'taken' as const, personName: 'Anil', dueDate: ago(-1) }],
    });
    const n = byRule(s, 'udhar-due-soon');
    expect(n!.title).toBe('₹2,500 due to Anil tomorrow');
  });

  test('nothing four days out — three days is the window', () => {
    const s = snapshot({
      udhar: [{ ...base, type: 'given' as const, personName: 'Riya', dueDate: ago(-4) }],
    });
    expect(byRule(s, 'udhar-due-soon')).toBeUndefined();
  });

  test('overdue offers the settle action instead of a telling-off', () => {
    const s = snapshot({
      udhar: [{ ...base, type: 'given' as const, personName: 'Riya', dueDate: ago(9) }],
    });
    const n = byRule(s, 'udhar-overdue');
    expect(n!.title).toBe("Riya's ₹2,500 is still open");
    expect(n!.body).toContain('mark it settled');
  });

  test('gives up after six weeks rather than repeating itself forever', () => {
    const s = snapshot({
      udhar: [{ ...base, type: 'given' as const, personName: 'Riya', dueDate: ago(60) }],
    });
    expect(byRule(s, 'udhar-overdue')).toBeUndefined();
  });

  test('a settled loan is celebrated, not reminded about', () => {
    const s = snapshot({
      udhar: [
        {
          ...base,
          type: 'taken' as const,
          personName: 'Anil',
          outstanding: 0,
          dueDate: ago(3),
          isSettled: true,
          updatedOn: ago(1),
        },
      ],
    });
    expect(byRule(s, 'udhar-overdue')).toBeUndefined();
    const n = byRule(s, 'udhar-repaid');
    expect(n!.title).toBe("You've cleared ₹2,500 to Anil");
  });
});

describe('recurring-bill-due', () => {
  test('fires two days before an EMI', () => {
    const s = snapshot({
      recurringBills: [
        { id: 'p1', label: 'HDFC Credit Card', amount: 4499, nextDueDate: ago(-2) },
      ],
    });
    const n = byRule(s, 'recurring-bill-due');
    expect(n!.title).toBe('HDFC Credit Card — ₹4,499 due on Saturday');
  });

  test('says nothing a week out', () => {
    const s = snapshot({
      recurringBills: [{ id: 'p1', label: 'HDFC', amount: 4499, nextDueDate: ago(-7) }],
    });
    expect(byRule(s, 'recurring-bill-due')).toBeUndefined();
  });
});

// ── Milestones ───────────────────────────────────────────────────────────────

describe('savings goals', () => {
  const goal = (savedAmount: number) => ({
    id: 'g1',
    name: 'Goa trip',
    targetAmount: 100000,
    savedAmount,
    createdAt: ago(120),
    monthsRemaining: 4,
  });

  test('halfway gets its own phrasing and hedges the number honestly', () => {
    const n = byRule(snapshot({ goals: [goal(52000)] }), 'goal-progress');
    expect(n!.id).toBe('goal-progress:g1:50');
    expect(n!.title).toBe('Goa trip is halfway there');
    expect(n!.body).toContain('going by what you');
    expect(n!.body).toContain('4 months still to run');
  });

  test('quarter marks use a percentage', () => {
    const n = byRule(snapshot({ goals: [goal(78000)] }), 'goal-progress');
    expect(n!.title).toBe('Goa trip is 75% of the way there');
  });

  test('below a quarter is not a milestone', () => {
    expect(byRule(snapshot({ goals: [goal(10000)] }), 'goal-progress')).toBeUndefined();
  });

  test('full funding is its own moment, and progress steps aside', () => {
    const s = snapshot({ goals: [goal(100000)] });
    expect(byRule(s, 'goal-progress')).toBeUndefined();
    expect(byRule(s, 'goal-reached')!.title).toBe('Goa trip is fully funded');
  });
});

describe('month-opened', () => {
  test('fires the day the first entry of a new month lands', () => {
    const firstDay = new Date(2026, 8, 1, 10, 0, 0); // 1 Sep 2026
    const txns = [
      { ...txn(0), date: '2026-09-01' },
      ...Array.from({ length: 30 }, (_, i) => ({
        ...txn(0),
        date: addDaysToKey('2026-09-01', -(i + 1)),
      })),
    ];
    const s = snapshot({
      today: firstDay,
      transactions: txns,
      totalTransactionCount: txns.length,
      firstEntryDate: '2026-08-02',
      streak: computeStreak(txns, firstDay),
    });
    const n = byRule(s, 'month-opened');
    expect(n!.title).toBe('September is open');
    expect(n!.id).toBe('month-opened:2026-09');
  });

  test('does not fire mid-month', () => {
    expect(byRule(snapshot(), 'month-opened')).toBeUndefined();
  });
});

// ── Ranking, categories, copy ────────────────────────────────────────────────

describe('ranking and category switches', () => {
  const busy = () =>
    snapshot({
      transactions: dailyExpenses(45, 4),
      udhar: [
        {
          id: 'u1',
          type: 'given',
          personName: 'Riya',
          outstanding: 2500,
          originalAmount: 2500,
          dueDate: ago(-1),
          isSettled: false,
          updatedOn: ago(30),
        },
      ],
      goals: [
        {
          id: 'g1',
          name: 'Goa trip',
          targetAmount: 100000,
          savedAmount: 52000,
          createdAt: ago(120),
          monthsRemaining: 4,
        },
      ],
    });

  test('candidates come back ranked, most important first', () => {
    const list = evaluateNudges(busy());
    expect(list.length).toBeGreaterThan(2);
    for (let i = 1; i < list.length; i += 1) {
      expect(list[i - 1].priority).toBeGreaterThanOrEqual(list[i].priority);
    }
    expect(list[0].ruleId).toBe('udhar-due-soon');
  });

  test('a disabled category never produces a nudge', () => {
    const p = prefs({
      categories: { ...DEFAULT_PREFERENCES.categories, reminders: false },
    });
    const list = evaluateNudges(busy(), { preferences: p });
    expect(list.length).toBeGreaterThan(0);
    expect(list.some((n) => n.category === 'reminders')).toBe(false);
  });

  test('every category off, or the master switch off, means nothing at all', () => {
    const allOff = prefs({
      categories: {
        reengagement: false,
        encouragement: false,
        reminders: false,
        milestones: false,
      },
    });
    expect(evaluateNudges(busy(), { preferences: allOff })).toEqual([]);
    expect(evaluateNudges(busy(), { preferences: prefs({ enabled: false }) })).toEqual([]);
  });

  test('the catalogue covers all four categories with distinct ids', () => {
    const ids = RULE_CATALOGUE.map((r) => r.ruleId);
    expect(new Set(ids).size).toBe(ids.length);
    expect(new Set(RULE_CATALOGUE.map((r) => r.category)).size).toBe(4);
    expect(RULE_CATALOGUE.every((r) => r.cooldownDays >= 1)).toBe(true);
  });

  test('no copy anywhere moralises about money', () => {
    const banned =
      /\b(you should|overspen|again|shame|bad|wasted|splurg|guilty|too much|stop spending|failed)\b/i;
    const all = [
      ...evaluateNudges(busy()),
      ...evaluateNudges(
        snapshot({
          transactions: dailyExpenses(45, 0, 3000),
          budget: {
            periodStart: '2026-08-01',
            periodEnd: ago(-2),
            variableBudget: 5000,
            fixedBudget: 0,
          },
        }),
      ),
    ];
    expect(all.length).toBeGreaterThan(3);
    for (const n of all) {
      expect(n.title).not.toMatch(banned);
      expect(n.body).not.toMatch(banned);
      expect(n.title.length).toBeLessThanOrEqual(65);
      expect(n.body.length).toBeLessThanOrEqual(140);
      expect(n.deepLink.startsWith('/')).toBe(true);
    }
  });
});

// ── Quiet hours ──────────────────────────────────────────────────────────────

describe('quiet hours', () => {
  const p = prefs();

  test('the overnight window is closed at both ends', () => {
    expect(inQuietHours(22, 22, 8)).toBe(true);
    expect(inQuietHours(2, 22, 8)).toBe(true);
    expect(inQuietHours(7, 22, 8)).toBe(true);
    expect(inQuietHours(8, 22, 8)).toBe(false);
    expect(inQuietHours(21, 22, 8)).toBe(false);
  });

  test('an afternoon nudge goes out almost straight away', () => {
    const at = resolveDeliveryTime(new Date(2026, 7, 20, 14, 0), p);
    expect(at.getHours()).toBe(14);
    expect(at.getMinutes()).toBe(2);
    expect(dayKey(at)).toBe('2026-08-20');
  });

  test('a late-night evaluation waits for the morning', () => {
    const at = resolveDeliveryTime(new Date(2026, 7, 20, 23, 40), p);
    expect(dayKey(at)).toBe('2026-08-21');
    expect(at.getHours()).toBe(8);
    expect(at.getMinutes()).toBe(0);
  });

  test('a 01:00 evaluation waits for 08:00 the SAME morning, not the next', () => {
    const at = resolveDeliveryTime(new Date(2026, 7, 20, 1, 0), p);
    expect(dayKey(at)).toBe('2026-08-20');
    expect(at.getHours()).toBe(8);
  });

  test('21:59 is pushed out because the two-minute delay crosses 22:00', () => {
    const at = resolveDeliveryTime(new Date(2026, 7, 20, 21, 59), p);
    expect(dayKey(at)).toBe('2026-08-21');
    expect(at.getHours()).toBe(8);
  });

  test('the user can widen the window and it is honoured', () => {
    const at = resolveDeliveryTime(new Date(2026, 7, 20, 20, 30), prefs({ quietStartHour: 20 }));
    expect(at.getHours()).toBe(8);
    expect(dayKey(at)).toBe('2026-08-21');
  });
});

// ── Caps and cooldowns ───────────────────────────────────────────────────────

describe('caps and cooldowns', () => {
  const candidates = (): Nudge[] => evaluateNudges(snapshot({ transactions: dailyExpenses(45, 4) }));

  test('something goes out on a clean day', () => {
    const r = selectNudge(candidates(), { entries: [] }, prefs(), TODAY_KEY);
    expect(r.selected).not.toBeNull();
    expect(r.blockedReason).toBeNull();
  });

  test('the master switch blocks everything', () => {
    const r = selectNudge(candidates(), { entries: [] }, prefs({ enabled: false }), TODAY_KEY);
    expect(r.selected).toBeNull();
    expect(r.blockedReason).toBe('Reminders are switched off.');
  });

  test('one a day — a second is refused', () => {
    const r = selectNudge(
      candidates(),
      history({ id: 'x', deliveryDay: TODAY_KEY, ruleId: 'streak' }),
      prefs(),
      TODAY_KEY,
    );
    expect(r.selected).toBeNull();
    expect(r.blockedReason).toContain('already queued');
  });

  test('four in seven days is the ceiling', () => {
    const four = history(
      ...[1, 2, 3, 4].map((d) => ({
        id: `x${d}`,
        ruleId: `r${d}`,
        deliveryDay: ago(d),
        category: 'milestones' as const,
      })),
    );
    const r = selectNudge(candidates(), four, prefs(), TODAY_KEY);
    expect(r.selected).toBeNull();
    expect(r.blockedReason).toContain('more than 4 in seven days');
  });

  test('three in the last seven days still leaves room for one more', () => {
    const three = history(
      ...[2, 4, 6].map((d) => ({
        id: `x${d}`,
        ruleId: `r${d}`,
        deliveryDay: ago(d),
        category: 'milestones' as const,
      })),
    );
    expect(selectNudge(candidates(), three, prefs(), TODAY_KEY).selected).not.toBeNull();
  });

  test('old entries fall out of the rolling window', () => {
    const old = history(
      ...[8, 9, 10, 11].map((d) => ({
        id: `x${d}`,
        ruleId: `r${d}`,
        deliveryDay: ago(d),
        category: 'milestones' as const,
      })),
    );
    expect(selectNudge(candidates(), old, prefs(), TODAY_KEY).selected).not.toBeNull();
  });

  test('the same rule respects the cooldown it set for itself', () => {
    const list = candidates();
    const top = list[0];
    const recent = history({
      id: 'other',
      ruleId: top.ruleId,
      category: top.category,
      deliveryDay: ago(1),
    });
    const r = selectNudge(list, recent, prefs(), TODAY_KEY);
    expect(r.selected?.ruleId).not.toBe(top.ruleId);
    expect(r.suppressed.some((s) => s.reason.includes('Cooling down'))).toBe(true);
  });

  test('the same category never lands two days running', () => {
    const list = candidates();
    const cats = new Set(list.map((n) => n.category));
    const yesterdayAll = history(
      ...Array.from(cats).map((c, i) => ({
        id: `y${i}`,
        ruleId: `unused${i}`,
        category: c,
        deliveryDay: ago(1),
      })),
    );
    // Every candidate's category went out yesterday, so nothing is left.
    const r = selectNudge(list, yesterdayAll, prefs(), TODAY_KEY);
    expect(r.selected).toBeNull();
    expect(r.suppressed.every((s) => s.reason.includes('yesterday') || s.reason.includes('Cooling'))).toBe(
      true,
    );
  });

  test('the exact same message is never sent twice', () => {
    const list = candidates();
    const seen = history(
      ...list.map((n, i) => ({
        id: n.id,
        ruleId: `unrelated${i}`,
        category: n.category,
        deliveryDay: ago(200),
      })),
    );
    const r = selectNudge(list, seen, prefs(), TODAY_KEY);
    expect(r.selected).toBeNull();
    expect(r.suppressed.some((s) => s.reason.includes('never repeated'))).toBe(true);
  });

  test('a category switched off is skipped at selection time too', () => {
    const list = candidates();
    const off = prefs({
      categories: {
        ...DEFAULT_PREFERENCES.categories,
        reengagement: false,
        encouragement: false,
      },
    });
    const r = selectNudge(list, { entries: [] }, off, TODAY_KEY);
    expect(r.selected?.category).not.toBe('reengagement');
    expect(r.selected?.category).not.toBe('encouragement');
  });
});

// ── Plumbing ─────────────────────────────────────────────────────────────────

describe('plumbing', () => {
  test('notification ids are stable, positive 32-bit ints', () => {
    const a = notificationIdFor('goal-progress:g1:50');
    expect(a).toBe(notificationIdFor('goal-progress:g1:50'));
    expect(a).toBeGreaterThan(0);
    expect(Number.isSafeInteger(a)).toBe(true);
    expect(a).not.toBe(notificationIdFor('goal-progress:g1:75'));
  });

  test('preferences default to OFF — nobody opts in by installing the app', () => {
    expect(DEFAULT_PREFERENCES.enabled).toBe(false);
  });

  test('a category added in a later release defaults to on, not silently off', () => {
    const stored = { enabled: true, categories: { reminders: false } };
    const p = normalisePreferences(stored);
    expect(p.enabled).toBe(true);
    expect(p.categories.reminders).toBe(false);
    expect(p.categories.milestones).toBe(true);
    expect(p.quietStartHour).toBe(22);
  });

  test('nonsense stored values fall back to the defaults', () => {
    const p = normalisePreferences({ quietStartHour: 99, quietEndHour: 'eight' });
    expect(p.quietStartHour).toBe(22);
    expect(p.quietEndHour).toBe(8);
  });
});
