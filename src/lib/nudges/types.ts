/**
 * types.ts — the vocabulary of the nudge system.
 *
 * Three things live here and nothing else:
 *   1. The SNAPSHOT — a flat, serialisable picture of the user's own data.
 *      The rule engine sees only this. It never touches storage, never reads
 *      a clock, never knows a user id exists.
 *   2. The NUDGE — one candidate message, already written, with the priority
 *      and cooldown its rule chose for it.
 *   3. PREFERENCES + HISTORY — what the user allowed, and what we have already
 *      said to them. The scheduler needs both to decide whether to say anything
 *      at all today.
 *
 * The split is deliberate. Everything interesting about a notification system
 * is a judgement call ("is this worth interrupting someone for?"), and
 * judgement calls belong in a pure function you can put under test.
 */

// ── Categories ───────────────────────────────────────────────────────────────

/**
 * Four kinds of reason to speak. The user can switch each one off
 * independently, so they are a product surface, not an implementation detail.
 */
export type NudgeCategory =
  /** You have not logged in a while, and you usually do. */
  | 'reengagement'
  /** Something in the data went well and nobody would otherwise notice. */
  | 'encouragement'
  /** A dated obligation is close: udhar, EMI, end of a budget period. */
  | 'reminders'
  /** A threshold was crossed: a goal, a settled loan, a new month opened. */
  | 'milestones';

export const NUDGE_CATEGORIES: readonly NudgeCategory[] = [
  'reengagement',
  'encouragement',
  'reminders',
  'milestones',
] as const;

export const CATEGORY_META: Record<
  NudgeCategory,
  { label: string; description: string }
> = {
  reengagement: {
    label: 'Gentle check-ins',
    description: 'Only when a few days have gone by without an entry.',
  },
  encouragement: {
    label: 'Good news',
    description: 'Streaks, no-spend days, weeks that came in lighter.',
  },
  reminders: {
    label: 'Dated reminders',
    description: 'Udhar due, EMIs, and the end of a budget month.',
  },
  milestones: {
    label: 'Milestones',
    description: 'Savings goals, loans repaid, a new month opened.',
  },
};

// ── The nudge ────────────────────────────────────────────────────────────────

export interface Nudge {
  /**
   * Unique for this exact message, forever. A goal crossing 50% and the same
   * goal crossing 75% are different ids; the scheduler uses that to guarantee
   * the user is never told the same specific thing twice.
   */
  id: string;
  /** The rule family. Cooldowns are keyed on this. */
  ruleId: string;
  category: NudgeCategory;
  /** Notification title. Short, specific, true. */
  title: string;
  /** Notification body. One sentence, ideally. */
  body: string;
  /** 0–100. Higher wins when several rules fire on the same day. */
  priority: number;
  /** In-app route to open when tapped. */
  deepLink: string;
  /** How many days this rule stays quiet after firing. Set by the rule. */
  cooldownDays: number;
}

// ── The snapshot ─────────────────────────────────────────────────────────────

export interface SnapshotTransaction {
  id: string;
  type: 'income' | 'expense';
  amount: number;
  category: string;
  /** Local day key, `yyyy-MM-dd`. */
  date: string;
  /** ISO timestamp of when the row was created. */
  createdAt: string;
  description: string | null;
}

export interface SnapshotBudget {
  /** `yyyy-MM-dd` */
  periodStart: string;
  /** `yyyy-MM-dd` */
  periodEnd: string;
  /** Total allocated across variable categories for this period. */
  variableBudget: number;
  /** Monthly-equivalent total of the user's fixed commitments. */
  fixedBudget: number;
}

export interface SnapshotGoal {
  id: string;
  name: string;
  targetAmount: number;
  /**
   * Net saved since the goal was created, derived from logged income minus
   * logged expenses, month by month, floored at zero per month. It is an
   * estimate from the user's own entries — copy must say so.
   */
  savedAmount: number;
  /** `yyyy-MM-dd` */
  createdAt: string;
  /** Whole months left against the goal's target duration, or null. */
  monthsRemaining: number | null;
}

export interface SnapshotUdhar {
  id: string;
  /** `given` = they owe you. `taken` = you owe them. */
  type: 'given' | 'taken';
  personName: string;
  /** amount − amount_paid. */
  outstanding: number;
  originalAmount: number;
  /** `yyyy-MM-dd` */
  dueDate: string;
  isSettled: boolean;
  /** `yyyy-MM-dd` the row last changed — our best proxy for "settled on". */
  updatedOn: string;
}

/** A real, dated recurring outflow. Today these come from Recall EMIs. */
export interface SnapshotRecurringBill {
  id: string;
  /** e.g. "HDFC Credit Card" — whatever the user typed. */
  label: string;
  amount: number;
  /** `yyyy-MM-dd` of the next instalment. */
  nextDueDate: string;
}

export interface SnapshotStreak {
  /** Consecutive days ending today or yesterday with at least one entry. */
  currentDays: number;
  /** `yyyy-MM-dd` the current streak began, or null. */
  startedOn: string | null;
  /** `yyyy-MM-dd` of the most recent entry, or null. */
  lastEntryDate: string | null;
  /** How many of the last 7 days (including today) have at least one entry. */
  activeDaysLast7: number;
}

/**
 * Everything the rule engine is allowed to know.
 *
 * `transactions` is a recent window (the collector sends ~120 days), sorted
 * newest first. `totalTransactionCount` is the lifetime count — the rules use
 * it to tell a brand-new user apart from a lapsed one, which matters a great
 * deal, because the correct thing to say to a brand-new user is nothing.
 */
export interface NudgeSnapshot {
  /** "Now", already in the user's local (IST) frame. */
  today: Date;
  transactions: SnapshotTransaction[];
  totalTransactionCount: number;
  /** `yyyy-MM-dd` of the very first entry ever, or null. */
  firstEntryDate: string | null;
  budget: SnapshotBudget | null;
  goals: SnapshotGoal[];
  udhar: SnapshotUdhar[];
  recurringBills: SnapshotRecurringBill[];
  streak: SnapshotStreak;
}

// ── Preferences ──────────────────────────────────────────────────────────────

export interface NudgePreferences {
  /** Master switch. Off means the scheduler does not even evaluate. */
  enabled: boolean;
  /** Per-category switches. A false here is honoured immediately. */
  categories: Record<NudgeCategory, boolean>;
  /** Hour (0–23) when quiet hours begin. Default 22. */
  quietStartHour: number;
  /** Hour (0–23) when quiet hours end. Default 8. */
  quietEndHour: number;
  /** True once the OS permission prompt has been answered. */
  permissionAsked: boolean;
}

export const DEFAULT_PREFERENCES: NudgePreferences = {
  // Off until the user asks for it. Nobody opted into notifications by
  // installing a budgeting app.
  enabled: false,
  categories: {
    reengagement: true,
    encouragement: true,
    reminders: true,
    milestones: true,
  },
  quietStartHour: 22,
  quietEndHour: 8,
  permissionAsked: false,
};

// ── History ──────────────────────────────────────────────────────────────────

export interface NudgeHistoryEntry {
  /** The exact `Nudge.id` that was scheduled. */
  id: string;
  ruleId: string;
  category: NudgeCategory;
  /** `yyyy-MM-dd` of the day it was scheduled to be DELIVERED, not evaluated. */
  deliveryDay: string;
  /** ISO timestamp of the scheduled delivery. */
  deliverAt: string;
}

export interface NudgeHistory {
  entries: NudgeHistoryEntry[];
}

export const EMPTY_HISTORY: NudgeHistory = { entries: [] };

// ── Caps ─────────────────────────────────────────────────────────────────────

/** At most one notification per delivery day. Not negotiable. */
export const MAX_PER_DAY = 1;
/** At most four in any rolling seven days. */
export const MAX_PER_WEEK = 4;
/** History older than this is pruned; a nudge id is unique within it. */
export const HISTORY_RETENTION_DAYS = 400;
