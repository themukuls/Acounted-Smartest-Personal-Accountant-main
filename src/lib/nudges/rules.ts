/**
 * rules.ts — the nudge rule engine. Pure function, no I/O, no clock.
 *
 * Input: a `NudgeSnapshot` of the user's own data. Output: a ranked list of
 * candidate nudges. The scheduler decides whether any of them are actually
 * worth sending; this file only decides what is TRUE and worth saying.
 *
 * ── The bar every rule here has to clear ────────────────────────────────────
 *
 *  1. EARNED, NOT SCHEDULED. A rule may only fire on something that happened
 *     in the user's data, and the copy must state that specific thing. There
 *     is no "Don't forget to track!" in this file and there never will be —
 *     a message that would read identically to every user is noise wearing a
 *     notification's clothes.
 *
 *  2. NEVER MORALISE. Money is loaded. Not one string here says "again",
 *     "too much", "you should have", or attaches a value judgement to a
 *     number. Overspending is reported the same flat way as underspending:
 *     the amount, the period, and nothing else. A finance app that makes
 *     someone feel judged gets uninstalled, and deservedly.
 *
 *  3. SILENCE IS THE DEFAULT. Every rule returns null unless its evidence is
 *     unambiguous. Two gates matter most:
 *       - `establishedHabit` — nothing about logging behaviour is said to
 *         someone who has not yet built any. The worst first impression a
 *         finance app can make is nagging a stranger.
 *       - `denseLogging` — claims of the form "you spent nothing on Thursday"
 *         are only made when the user logs most days. Absence of a logged
 *         expense is not the same as absence of a spend, and asserting one
 *         from the other is how an app loses a user's trust in one sentence.
 *
 *  4. EVERY RULE STATES ITS OWN COOLDOWN. A rule knows how often its own
 *     subject matter can honestly be new. Streaks can speak most days;
 *     "you're under budget" cannot.
 *
 * Rules are listed roughly by priority, highest first.
 */

import { inr } from '@/lib/tax/qa';
import {
  addDaysToKey,
  dayKey,
  daysBetweenKeys,
  monthName,
  plural,
  relativeDayPhrase,
  shortDate,
  weekdayName,
} from './dates';
import type {
  Nudge,
  NudgeCategory,
  NudgePreferences,
  NudgeSnapshot,
  SnapshotTransaction,
} from './types';

// ── Thresholds ───────────────────────────────────────────────────────────────

/**
 * Below this many lifetime entries the user has no logging habit for us to
 * comment on, encourage, or miss. We say nothing about their behaviour.
 */
const ESTABLISHED_HABIT_ENTRIES = 12;
/** …and they must have been around long enough for a gap to mean something. */
const ESTABLISHED_HABIT_DAYS = 14;
/**
 * "Dense" logging: entries on at least this many of the last 7 days. Only
 * then will we assert a negative ("nothing went out on Thursday").
 */
const DENSE_LOGGING_DAYS = 5;
/** Rupee floor below which a difference is not worth anyone's attention. */
const MEANINGFUL_RUPEES = 500;

const ROUTES = {
  dashboard: '/dashboard',
  expenses: '/expenses',
  budget: '/budget',
  udhar: '/udhar-tracker',
} as const;

// ── Derived facts ────────────────────────────────────────────────────────────

interface Derived {
  todayKey: string;
  /** Day keys that have at least one entry of any type. */
  entryDays: Set<string>;
  /** Expense total per day key. */
  expenseByDay: Map<string, number>;
  /** Whole days since the most recent entry, or null when there are none. */
  daysSinceLastEntry: number | null;
  lastEntryKey: string | null;
  establishedHabit: boolean;
  denseLogging: boolean;
}

function derive(s: NudgeSnapshot): Derived {
  const todayKey = dayKey(s.today);
  const entryDays = new Set<string>();
  const expenseByDay = new Map<string, number>();

  for (const t of s.transactions) {
    entryDays.add(t.date);
    if (t.type === 'expense') {
      expenseByDay.set(t.date, (expenseByDay.get(t.date) ?? 0) + t.amount);
    }
  }

  const lastEntryKey = s.streak.lastEntryDate;
  const daysSinceLastEntry =
    lastEntryKey === null ? null : daysBetweenKeys(lastEntryKey, todayKey);

  const daysKnown =
    s.firstEntryDate === null ? 0 : daysBetweenKeys(s.firstEntryDate, todayKey);

  return {
    todayKey,
    entryDays,
    expenseByDay,
    daysSinceLastEntry,
    lastEntryKey,
    establishedHabit:
      s.totalTransactionCount >= ESTABLISHED_HABIT_ENTRIES &&
      daysKnown >= ESTABLISHED_HABIT_DAYS,
    denseLogging: s.streak.activeDaysLast7 >= DENSE_LOGGING_DAYS,
  };
}

/** Sum of expenses whose day key falls in `[fromKey, toKey]` inclusive. */
function expensesBetween(d: Derived, fromKey: string, toKey: string): number {
  let total = 0;
  for (const [key, amount] of d.expenseByDay) {
    if (key >= fromKey && key <= toKey) total += amount;
  }
  return total;
}

/**
 * Consecutive days ending today (or yesterday — a streak is not broken until
 * a day has fully passed without an entry) that have at least one entry.
 *
 * Exported because `collectSnapshot` needs it and it must stay pure so the
 * tests can build streaks by hand.
 */
export function computeStreak(
  transactions: Pick<SnapshotTransaction, 'date'>[],
  today: Date,
): NudgeSnapshot['streak'] {
  const days = new Set(transactions.map((t) => t.date));
  if (days.size === 0) {
    return { currentDays: 0, startedOn: null, lastEntryDate: null, activeDaysLast7: 0 };
  }

  const todayKey = dayKey(today);
  const sorted = Array.from(days).sort();
  const lastEntryDate = sorted[sorted.length - 1];

  let activeDaysLast7 = 0;
  for (let i = 0; i < 7; i += 1) {
    if (days.has(addDaysToKey(todayKey, -i))) activeDaysLast7 += 1;
  }

  // Anchor on today if today has an entry, else on yesterday. Anything older
  // and the streak has already been broken.
  let cursor: string;
  if (days.has(todayKey)) cursor = todayKey;
  else if (days.has(addDaysToKey(todayKey, -1))) cursor = addDaysToKey(todayKey, -1);
  else return { currentDays: 0, startedOn: null, lastEntryDate, activeDaysLast7 };

  let currentDays = 0;
  let startedOn = cursor;
  while (days.has(cursor)) {
    currentDays += 1;
    startedOn = cursor;
    cursor = addDaysToKey(cursor, -1);
  }

  return { currentDays, startedOn, lastEntryDate, activeDaysLast7 };
}

// ── Rule shape ───────────────────────────────────────────────────────────────

interface Rule {
  ruleId: string;
  category: NudgeCategory;
  priority: number;
  /** Days this rule stays quiet after it fires. The rule's own judgement. */
  cooldownDays: number;
  /** Human-readable description, shown in the settings preview. */
  what: string;
  evaluate(s: NudgeSnapshot, d: Derived): Candidate[] | null;
}

/** What a rule returns per candidate: everything except the rule's own metadata. */
type Candidate = Pick<Nudge, 'id' | 'title' | 'body' | 'deepLink'>;

// ── The rules ────────────────────────────────────────────────────────────────

const RULES: Rule[] = [
  // ───────────────────────────────────────────────────────────── milestones ──
  {
    ruleId: 'udhar-repaid',
    category: 'milestones',
    priority: 90,
    cooldownDays: 5,
    what: 'A loan you were tracking got fully settled',
    evaluate(s, d) {
      const out: Candidate[] = [];
      for (const u of s.udhar) {
        if (!u.isSettled || u.originalAmount <= 0) continue;
        const daysAgo = daysBetweenKeys(u.updatedOn, d.todayKey);
        if (daysAgo < 0 || daysAgo > 2) continue;

        const when = daysAgo === 0 ? 'today' : `on ${weekdayName(u.updatedOn)}`;
        out.push(
          u.type === 'given'
            ? {
                id: `udhar-repaid:${u.id}`,
                title: `${u.personName} has paid back ${inr(u.originalAmount)}`,
                body: `Settled ${when}. That one's closed — nothing left to follow up on.`,
                deepLink: ROUTES.udhar,
              }
            : {
                id: `udhar-repaid:${u.id}`,
                title: `You've cleared ${inr(u.originalAmount)} to ${u.personName}`,
                body: `Settled ${when}. That's the whole loan repaid.`,
                deepLink: ROUTES.udhar,
              },
        );
      }
      return out.length > 0 ? out : null;
    },
  },

  {
    ruleId: 'goal-reached',
    category: 'milestones',
    priority: 88,
    cooldownDays: 30,
    what: 'A savings goal reached its full amount',
    evaluate(s, d) {
      if (!d.establishedHabit) return null;
      const out: Candidate[] = [];
      for (const g of s.goals) {
        if (g.targetAmount <= 0 || g.savedAmount < g.targetAmount) continue;
        out.push({
          id: `goal-reached:${g.id}`,
          title: `${g.name} is fully funded`,
          body: `${inr(g.savedAmount)} set aside against a ${inr(g.targetAmount)} goal, going by everything you've logged. Worth stopping to notice.`,
          deepLink: ROUTES.dashboard,
        });
      }
      return out.length > 0 ? out : null;
    },
  },

  // ────────────────────────────────────────────────────────────── reminders ──
  {
    ruleId: 'udhar-due-soon',
    category: 'reminders',
    priority: 84,
    cooldownDays: 3,
    what: 'Udhar falling due in the next three days',
    evaluate(s, d) {
      const out: Candidate[] = [];
      for (const u of s.udhar) {
        if (u.isSettled || u.outstanding <= 0) continue;
        const daysOut = daysBetweenKeys(d.todayKey, u.dueDate);
        if (daysOut < 0 || daysOut > 3) continue;

        const when = relativeDayPhrase(d.todayKey, u.dueDate);
        out.push(
          u.type === 'given'
            ? {
                id: `udhar-due:${u.id}:${u.dueDate}`,
                title: `${u.personName} owes you ${inr(u.outstanding)} ${when}`,
                body: 'A short message now is a lot easier than a long one next month.',
                deepLink: ROUTES.udhar,
              }
            : {
                id: `udhar-due:${u.id}:${u.dueDate}`,
                title: `${inr(u.outstanding)} due to ${u.personName} ${when}`,
                body: "Small thing, but nicer to close it than to carry it.",
                deepLink: ROUTES.udhar,
              },
        );
      }
      return out.length > 0 ? out : null;
    },
  },

  {
    ruleId: 'recurring-bill-due',
    category: 'reminders',
    priority: 80,
    cooldownDays: 20,
    what: 'An EMI or recurring instalment due in the next two days',
    evaluate(s, d) {
      const out: Candidate[] = [];
      for (const bill of s.recurringBills) {
        if (bill.amount <= 0) continue;
        const daysOut = daysBetweenKeys(d.todayKey, bill.nextDueDate);
        if (daysOut < 0 || daysOut > 2) continue;

        out.push({
          id: `bill-due:${bill.id}:${bill.nextDueDate}`,
          title: `${bill.label} — ${inr(bill.amount)} due ${relativeDayPhrase(d.todayKey, bill.nextDueDate)}`,
          body: `Worth keeping ${inr(bill.amount)} in the account so it goes through without a second thought.`,
          deepLink: ROUTES.budget,
        });
      }
      return out.length > 0 ? out : null;
    },
  },

  {
    ruleId: 'udhar-overdue',
    category: 'reminders',
    priority: 76,
    cooldownDays: 7,
    what: 'Udhar that is past its due date and still open',
    evaluate(s, d) {
      const out: Candidate[] = [];
      for (const u of s.udhar) {
        if (u.isSettled || u.outstanding <= 0) continue;
        const daysPast = daysBetweenKeys(u.dueDate, d.todayKey);
        // Stop after ~6 weeks. Past that, repeating ourselves adds nothing.
        if (daysPast < 1 || daysPast > 45) continue;

        const bucket = Math.floor(daysPast / 7);
        const ago = `${plural(daysPast, 'day')} past the ${shortDate(u.dueDate)} you set`;
        out.push(
          u.type === 'given'
            ? {
                id: `udhar-overdue:${u.id}:${bucket}`,
                title: `${u.personName}'s ${inr(u.outstanding)} is still open`,
                body: `${ago}. If it's already come back, mark it settled and it'll stop appearing.`,
                deepLink: ROUTES.udhar,
              }
            : {
                id: `udhar-overdue:${u.id}:${bucket}`,
                title: `${inr(u.outstanding)} to ${u.personName} is still open`,
                body: `${ago}. If you've already paid it, mark it settled and it'll stop appearing.`,
                deepLink: ROUTES.udhar,
              },
        );
      }
      return out.length > 0 ? out : null;
    },
  },

  // ────────────────────────────────────────────────────────── encouragement ──
  {
    ruleId: 'under-budget-pace',
    category: 'encouragement',
    priority: 72,
    cooldownDays: 10,
    what: "You're comfortably below the pace your variable budget implies",
    evaluate(s, d) {
      const b = s.budget;
      if (!b || b.variableBudget <= 0 || !d.establishedHabit) return null;

      const totalDays = daysBetweenKeys(b.periodStart, b.periodEnd) + 1;
      const daysIn = daysBetweenKeys(b.periodStart, d.todayKey) + 1;
      // Too early to mean anything; too late and `budget-period-ending` owns it.
      if (daysIn < 10 || daysIn > totalDays - 4 || totalDays <= 0) return null;

      const spent = expensesBetween(d, b.periodStart, d.todayKey);
      const pace = (b.variableBudget * daysIn) / totalDays;
      const under = pace - spent;
      if (under < MEANINGFUL_RUPEES || under < pace * 0.15) return null;

      return [
        {
          id: `under-budget-pace:${b.periodStart}`,
          title: `You're ${inr(under)} under pace this month`,
          body: `${plural(daysIn, 'day')} in, ${inr(spent)} spent of a ${inr(b.variableBudget)} variable budget. Nothing to do — just worth knowing.`,
          deepLink: ROUTES.budget,
        },
      ];
    },
  },

  {
    ruleId: 'budget-period-ending',
    category: 'reminders',
    priority: 70,
    cooldownDays: 20,
    what: 'Your budget period is about to end',
    evaluate(s, d) {
      const b = s.budget;
      if (!b || b.variableBudget <= 0 || !d.establishedHabit) return null;

      const daysLeft = daysBetweenKeys(d.todayKey, b.periodEnd);
      if (daysLeft < 1 || daysLeft > 3) return null;

      const spent = expensesBetween(d, b.periodStart, b.periodEnd);
      const remaining = b.variableBudget - spent;

      // Both branches report the same two numbers in the same flat tone. The
      // over-budget one is deliberately not a warning.
      const body =
        remaining >= 0
          ? `${inr(remaining)} of your ${inr(b.variableBudget)} variable budget is still unspent.`
          : `You're ${inr(-remaining)} past the ${inr(b.variableBudget)} you set — useful to know before the next month starts.`;

      return [
        {
          id: `budget-ending:${b.periodEnd}`,
          title: `${plural(daysLeft, 'day')} left in this budget month`,
          body,
          deepLink: ROUTES.budget,
        },
      ];
    },
  },

  {
    ruleId: 'goal-progress',
    category: 'milestones',
    priority: 68,
    cooldownDays: 14,
    what: 'A savings goal crossed 25%, 50%, 75% or 90%',
    evaluate(s, d) {
      if (!d.establishedHabit) return null;
      const out: Candidate[] = [];

      for (const g of s.goals) {
        if (g.targetAmount <= 0 || g.savedAmount <= 0) continue;
        const pct = (g.savedAmount / g.targetAmount) * 100;
        if (pct >= 100) continue; // `goal-reached` owns that moment.

        const milestone = [90, 75, 50, 25].find((m) => pct >= m);
        if (milestone === undefined) continue;

        const tail =
          g.monthsRemaining !== null && g.monthsRemaining > 0
            ? ` ${plural(g.monthsRemaining, 'month')} still to run.`
            : '';

        out.push({
          id: `goal-progress:${g.id}:${milestone}`,
          title:
            milestone === 50
              ? `${g.name} is halfway there`
              : `${g.name} is ${milestone}% of the way there`,
          body: `${inr(g.savedAmount)} of ${inr(g.targetAmount)}, going by what you've logged.${tail}`,
          deepLink: ROUTES.dashboard,
        });
      }
      return out.length > 0 ? out : null;
    },
  },

  {
    ruleId: 'streak',
    category: 'encouragement',
    priority: 66,
    // Short, because the rule only produces anything at 3/7/14/30/60/100 days,
    // which spaces itself out far better than any cooldown could.
    cooldownDays: 2,
    what: 'A run of consecutive days with an entry',
    evaluate(s, d) {
      const n = s.streak.currentDays;
      const startedOn = s.streak.startedOn;
      if (startedOn === null) return null;
      if (![3, 7, 14, 30, 60, 100].includes(n)) return null;
      // The streak has to be live today, not a leftover from yesterday.
      if (!d.entryDays.has(d.todayKey)) return null;

      return [
        {
          id: `streak:${startedOn}:${n}`,
          title: n === 3 ? 'Three days in a row' : `${n} days in a row`,
          body:
            n === 3
              ? 'Three days of logging without a gap. This is the part that actually becomes a habit.'
              : `Something logged every single day since ${shortDate(startedOn)}. That's the whole trick.`,
          deepLink: ROUTES.dashboard,
        },
      ];
    },
  },

  {
    ruleId: 'no-spend-day',
    category: 'encouragement',
    priority: 64,
    cooldownDays: 7,
    what: 'A day with entries logged but nothing spent',
    evaluate(s, d) {
      // Only claim this for someone who logs most days — otherwise "no spend"
      // is really "nothing logged", and saying so would be a lie.
      if (!d.establishedHabit || !d.denseLogging) return null;

      const yesterday = addDaysToKey(d.todayKey, -1);
      if (!d.entryDays.has(yesterday)) return null;
      if ((d.expenseByDay.get(yesterday) ?? 0) > 0) return null;

      return [
        {
          id: `no-spend:${yesterday}`,
          title: 'Yesterday was a no-spend day',
          body: `Nothing went out on ${weekdayName(yesterday)}. Those days quietly do a lot of the work.`,
          deepLink: ROUTES.expenses,
        },
      ];
    },
  },

  {
    ruleId: 'lighter-week',
    category: 'encouragement',
    priority: 60,
    cooldownDays: 14,
    what: 'The last seven days cost noticeably less than the seven before',
    evaluate(s, d) {
      if (!d.establishedHabit || !d.denseLogging) return null;

      const thisWeek = expensesBetween(d, addDaysToKey(d.todayKey, -6), d.todayKey);
      const lastWeek = expensesBetween(
        d,
        addDaysToKey(d.todayKey, -13),
        addDaysToKey(d.todayKey, -7),
      );
      if (lastWeek <= 0 || thisWeek <= 0) return null;

      const diff = lastWeek - thisWeek;
      if (diff < MEANINGFUL_RUPEES || diff < lastWeek * 0.2) return null;

      return [
        {
          id: `lighter-week:${d.todayKey}`,
          title: `This week cost ${inr(diff)} less`,
          body: `${inr(thisWeek)} over the last seven days, against ${inr(lastWeek)} the seven before. No action needed.`,
          deepLink: ROUTES.expenses,
        },
      ];
    },
  },

  // ─────────────────────────────────────────────────────────── reengagement ──
  {
    ruleId: 'gap-short',
    category: 'reengagement',
    priority: 56,
    cooldownDays: 4,
    what: 'Three to six days since your last entry',
    evaluate(s, d) {
      if (!d.establishedHabit) return null;
      const gap = d.daysSinceLastEntry;
      const last = d.lastEntryKey;
      if (gap === null || last === null || gap < 3 || gap > 6) return null;

      return [
        {
          id: `gap-short:${last}`,
          title: `Nothing logged since ${weekdayName(last)}`,
          body: `${plural(gap, 'day')} of spends aren't in yet. Two minutes now and your ${monthName(s.today)} numbers stay accurate.`,
          deepLink: ROUTES.expenses,
        },
      ];
    },
  },

  {
    ruleId: 'month-opened',
    category: 'milestones',
    priority: 48,
    cooldownDays: 25,
    what: 'You logged the first entry of a new month',
    evaluate(s, d) {
      if (!d.establishedHabit) return null;

      const monthPrefix = d.todayKey.slice(0, 7);
      const thisMonth = s.transactions.filter((t) => t.date.startsWith(monthPrefix));
      if (thisMonth.length === 0) return null;

      // The earliest entry of the month must have landed today or yesterday —
      // this is a "well done, you've started" note, not a mid-month remark.
      const firstOfMonth = thisMonth.reduce((a, b) => (a.date <= b.date ? a : b));
      const age = daysBetweenKeys(firstOfMonth.date, d.todayKey);
      if (age < 0 || age > 1) return null;
      // And they must have had a previous month to compare against.
      if (s.totalTransactionCount <= thisMonth.length) return null;

      return [
        {
          id: `month-opened:${monthPrefix}`,
          title: `${monthName(s.today)} is open`,
          body: "First entry of the month is in. From here it's only keeping up.",
          deepLink: ROUTES.dashboard,
        },
      ];
    },
  },

  {
    ruleId: 'gap-long',
    category: 'reengagement',
    priority: 44,
    cooldownDays: 8,
    what: 'A week or more since your last entry',
    evaluate(s, d) {
      if (!d.establishedHabit) return null;
      const gap = d.daysSinceLastEntry;
      const last = d.lastEntryKey;
      // Past three weeks we stop entirely. Someone who has been away that long
      // does not need a fourth reminder; they need to be left alone.
      if (gap === null || last === null || gap < 7 || gap > 21) return null;

      return [
        {
          id: `gap-long:${last}:${Math.floor(gap / 7)}`,
          title: `It's been ${plural(gap, 'day')}`,
          body: 'No catching up required. Adding just today picks the thread back up.',
          deepLink: ROUTES.expenses,
        },
      ];
    },
  },
];

// ── Public API ───────────────────────────────────────────────────────────────

/** Every rule's id, category and one-line description. For the settings UI. */
export const RULE_CATALOGUE = RULES.map((r) => ({
  ruleId: r.ruleId,
  category: r.category,
  priority: r.priority,
  cooldownDays: r.cooldownDays,
  what: r.what,
}));

export interface EvaluateOptions {
  /**
   * Preferences, if you want disabled categories filtered here rather than in
   * the scheduler. The settings preview passes them so what it shows is
   * exactly what the user would receive.
   */
  preferences?: NudgePreferences;
}

/**
 * Evaluate every rule against the snapshot and return the candidates, ranked.
 *
 * Ranking is by priority descending, ties broken by rule declaration order,
 * which is itself priority order — so the result is stable and testable.
 *
 * Returns `[]` for a user with no data. That case is checked first and on
 * purpose: nagging someone who has just installed the app is the single worst
 * first impression this feature could make.
 */
export function evaluateNudges(
  snapshot: NudgeSnapshot,
  options: EvaluateOptions = {},
): Nudge[] {
  const prefs = options.preferences;
  if (prefs && !prefs.enabled) return [];

  // Hard gate: a brand-new user has nothing true to be told.
  const hasAnyData =
    snapshot.totalTransactionCount > 0 ||
    snapshot.udhar.length > 0 ||
    snapshot.goals.length > 0 ||
    snapshot.recurringBills.length > 0;
  if (!hasAnyData) return [];

  const d = derive(snapshot);
  const nudges: Nudge[] = [];

  for (const rule of RULES) {
    if (prefs && !prefs.categories[rule.category]) continue;

    let candidates: Candidate[] | null = null;
    try {
      candidates = rule.evaluate(snapshot, d);
    } catch (err) {
      // One malformed record must never take the whole engine down; the user
      // would simply stop receiving every nudge with no way to find out why.
      console.error(`[nudges] rule "${rule.ruleId}" threw`, err);
      continue;
    }
    if (!candidates) continue;

    for (const c of candidates) {
      nudges.push({
        ...c,
        ruleId: rule.ruleId,
        category: rule.category,
        priority: rule.priority,
        cooldownDays: rule.cooldownDays,
      });
    }
  }

  return nudges.sort((a, b) => b.priority - a.priority);
}
