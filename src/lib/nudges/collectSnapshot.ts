/**
 * collectSnapshot.ts — turns the repository into a `NudgeSnapshot`.
 *
 * READ-ONLY, by design and by review. This module calls exactly `getAll` and
 * `getAllByIndex` and nothing else; a `put` in here would mean the act of
 * thinking about a notification mutates the user's ledger, which is both a
 * correctness bug and a very unpleasant surprise in a backup diff.
 *
 * The only real thinking here is the savings-goal number. The dashboard shows
 * *expected* progress (monthly target × months elapsed), which is a plan, not
 * an outcome — perfectly reasonable in a progress bar the user can see the
 * context of, and completely unusable in a notification, where "₹50,000 saved"
 * would be an assertion about reality. So the snapshot computes actual net
 * savings from logged income minus logged expenses, month by month, floored at
 * zero per month, and the copy in `rules.ts` says "going by what you've logged"
 * so the user knows exactly which number they are being told.
 */

import { getAllByIndex } from '@/integrations/storage/repository';
import type { MyDB } from '@/integrations/indexeddb/db';
import { getISTDate } from '@/lib/date-utils';
import { computeStreak } from './rules';
import { dayKey, dayKeyOf } from './dates';
import type {
  NudgeSnapshot,
  SnapshotBudget,
  SnapshotGoal,
  SnapshotRecurringBill,
  SnapshotTransaction,
  SnapshotUdhar,
} from './types';

type TransactionRow = MyDB['transactions']['value'];
type BudgetRow = MyDB['monthly_budgets']['value'];
type VariableEntryRow = MyDB['variable_budget_entries']['value'];
type ExpenseCategoryRow = MyDB['expense_categories']['value'];
type GoalRow = MyDB['savings_goals']['value'];
type UdharRow = MyDB['udhar_entries']['value'];
type RecallRow = MyDB['recall_products']['value'];

/** How much history the rule engine actually looks at. */
const RECENT_WINDOW_DAYS = 120;

const pad = (n: number): string => (n < 10 ? `0${n}` : String(n));
const monthKeyOf = (dayKeyValue: string): string => dayKeyValue.slice(0, 7);

function lastDayOfMonth(year: number, monthIndex: number): Date {
  return new Date(year, monthIndex + 1, 0);
}

// ── Budget ───────────────────────────────────────────────────────────────────

/**
 * The active budget period.
 *
 * `monthly_budgets` may carry custom start/end dates (the budget-date-range
 * picker lets a user run "5th to 4th" salary months), so those win. When there
 * is no row, we fall back to the calendar month, which is what the rest of the
 * app assumes.
 */
async function collectBudget(userId: string, today: Date): Promise<SnapshotBudget | null> {
  const monthKey = `${today.getFullYear()}-${pad(today.getMonth() + 1)}`;

  const [budgets, categories] = await Promise.all([
    getAllByIndex<BudgetRow>('monthly_budgets', 'user_id', userId),
    getAllByIndex<ExpenseCategoryRow>('expense_categories', 'user_id', userId),
  ]);

  const row = budgets.find((b) => b.budget_month === monthKey);

  const periodStart = row?.budget_start_date
    ? dayKeyOf(row.budget_start_date)
    : dayKey(new Date(today.getFullYear(), today.getMonth(), 1));
  const periodEnd = row?.budget_end_date
    ? dayKeyOf(row.budget_end_date)
    : dayKey(lastDayOfMonth(today.getFullYear(), today.getMonth()));

  if (!periodStart || !periodEnd) return null;

  const periodKey = `${periodStart}_${periodEnd}`;
  const entries = await getAllByIndex<VariableEntryRow>(
    'variable_budget_entries',
    'user_id',
    userId,
  );
  const variableBudget = entries
    .filter((e) => e.budget_month === periodKey)
    .reduce((sum, e) => sum + Number(e.allocated_amount ?? 0), 0);

  let fixedBudget = 0;
  for (const c of categories) {
    if (c.category_type !== 'fixed') continue;
    if (c.frequency === 'monthly') fixedBudget += Number(c.amount ?? 0);
    else if (c.frequency === 'annually') fixedBudget += Number(c.amount ?? 0) / 12;
  }

  if (variableBudget <= 0 && fixedBudget <= 0) return null;
  return { periodStart, periodEnd, variableBudget, fixedBudget };
}

// ── Goals ────────────────────────────────────────────────────────────────────

function collectGoals(
  goals: GoalRow[],
  transactions: SnapshotTransaction[],
  today: Date,
): SnapshotGoal[] {
  // Net per calendar month, floored at zero — a month where you spent more
  // than you earned did not eat into what you had already put aside.
  const netByMonth = new Map<string, { income: number; expense: number }>();
  for (const t of transactions) {
    const m = monthKeyOf(t.date);
    const bucket = netByMonth.get(m) ?? { income: 0, expense: 0 };
    if (t.type === 'income') bucket.income += t.amount;
    else bucket.expense += t.amount;
    netByMonth.set(m, bucket);
  }

  const todayMonth = monthKeyOf(dayKey(today));

  return goals.map((g) => {
    const createdKey = dayKeyOf(g.created_at) || dayKey(today);
    const startMonth = monthKeyOf(createdKey);

    let saved = 0;
    for (const [month, { income, expense }] of netByMonth) {
      if (month < startMonth || month > todayMonth) continue;
      saved += Math.max(0, income - expense);
    }

    const created = new Date(createdKey);
    const monthsPassed =
      (today.getFullYear() - created.getFullYear()) * 12 +
      (today.getMonth() - created.getMonth()) +
      1;
    const targetMonths = Number(g.target_months ?? 0);

    return {
      id: g.id,
      name: g.goal_name,
      targetAmount: Number(g.goal_amount ?? 0),
      savedAmount: saved,
      createdAt: createdKey,
      monthsRemaining: targetMonths > 0 ? Math.max(0, targetMonths - monthsPassed) : null,
    };
  });
}

// ── Udhar ────────────────────────────────────────────────────────────────────

function collectUdhar(rows: UdharRow[]): SnapshotUdhar[] {
  return rows.map((u) => {
    const amount = Number(u.amount ?? 0);
    const paid = Number((u as Partial<UdharRow>).amount_paid ?? 0);
    const outstanding = Math.max(0, amount - paid);
    return {
      id: u.id,
      type: u.type === 'taken' ? 'taken' : 'given',
      personName: (u.type === 'taken' ? u.lender_name : u.person_name) || 'them',
      outstanding,
      originalAmount: amount,
      dueDate: dayKeyOf(u.due_date),
      // A row can be marked settled explicitly, or become settled by the
      // payments adding up. Both count.
      isSettled: Boolean(u.is_settled) || (amount > 0 && outstanding <= 0),
      updatedOn: dayKeyOf(u.updated_at ?? u.created_at),
    };
  });
}

// ── Recurring bills (EMIs from Recall) ───────────────────────────────────────

/**
 * The next unpaid instalment for each active EMI.
 *
 * Recall stores a start date, an amount and a tenure; the due day is the day
 * of the month the first instalment fell on. We walk forward from the start
 * until we pass today, and drop the bill entirely once the tenure is done —
 * reminding someone about an EMI they finished paying is exactly the kind of
 * confidently-wrong notification that gets a feature switched off.
 */
function collectRecurringBills(rows: RecallRow[], today: Date): SnapshotRecurringBill[] {
  const bills: SnapshotRecurringBill[] = [];
  const todayKeyValue = dayKey(today);

  for (const p of rows) {
    if (!p.emi_enabled) continue;
    const amount = Number(p.emi_amount ?? 0);
    const tenure = Number(p.emi_tenure_months ?? 0);
    if (amount <= 0 || tenure <= 0 || !p.emi_start_date) continue;

    const startKey = dayKeyOf(p.emi_start_date);
    if (!startKey) continue;
    const [sy, sm, sd] = startKey.split('-').map(Number);

    let next: string | null = null;
    for (let i = 0; i < tenure; i += 1) {
      // Clamp to the month's length so a 31st EMI lands on the 30th/28th
      // rather than silently rolling into the next month.
      const anchor = new Date(sy, sm - 1 + i, 1);
      const maxDay = lastDayOfMonth(anchor.getFullYear(), anchor.getMonth()).getDate();
      const candidate = dayKey(
        new Date(anchor.getFullYear(), anchor.getMonth(), Math.min(sd, maxDay)),
      );
      if (candidate >= todayKeyValue) {
        next = candidate;
        break;
      }
    }
    if (next === null) continue; // tenure finished

    const label =
      p.emi_bank_or_provider?.trim() || p.name?.trim() || 'EMI';
    bills.push({ id: p.id, label, amount, nextDueDate: next });
  }

  return bills;
}

// ── Entry point ──────────────────────────────────────────────────────────────

/**
 * Build the rule-engine input for a user. Read-only; never throws.
 *
 * `now` is injectable purely so a test or the settings preview can ask
 * "what would fire on a Tuesday evening?" without touching the system clock.
 */
export async function collectSnapshot(
  userId: string,
  now: Date = getISTDate(),
): Promise<NudgeSnapshot> {
  const empty: NudgeSnapshot = {
    today: now,
    transactions: [],
    totalTransactionCount: 0,
    firstEntryDate: null,
    budget: null,
    goals: [],
    udhar: [],
    recurringBills: [],
    streak: { currentDays: 0, startedOn: null, lastEntryDate: null, activeDaysLast7: 0 },
  };
  if (!userId) return empty;

  try {
    const [txnRows, goalRows, udharRows, recallRows, budget] = await Promise.all([
      getAllByIndex<TransactionRow>('transactions', 'user_id', userId),
      getAllByIndex<GoalRow>('savings_goals', 'user_id', userId),
      getAllByIndex<UdharRow>('udhar_entries', 'user_id', userId),
      getAllByIndex<RecallRow>('recall_products', 'user_id', userId),
      collectBudget(userId, now),
    ]);

    const all: SnapshotTransaction[] = txnRows
      .filter((t) => t.type === 'income' || t.type === 'expense')
      .map((t): SnapshotTransaction => ({
        id: t.id,
        type: t.type === 'income' ? 'income' : 'expense',
        amount: Number(t.amount ?? 0),
        category: t.category ?? '',
        date: dayKeyOf(t.transaction_date),
        createdAt: t.created_at,
        description: t.description ?? null,
      }))
      .filter((t) => t.date !== '');

    all.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));

    const todayKeyValue = dayKey(now);
    const windowStart = dayKey(
      new Date(now.getFullYear(), now.getMonth(), now.getDate() - RECENT_WINDOW_DAYS),
    );
    // Future-dated rows are excluded from the rules' window: "you spent
    // ₹2,000 yesterday" must never be built out of a post-dated entry.
    const recent = all.filter((t) => t.date >= windowStart && t.date <= todayKeyValue);
    const past = all.filter((t) => t.date <= todayKeyValue);

    return {
      today: now,
      transactions: recent,
      totalTransactionCount: past.length,
      firstEntryDate: past.length > 0 ? past[past.length - 1].date : null,
      budget,
      goals: collectGoals(goalRows, past, now),
      udhar: collectUdhar(udharRows),
      recurringBills: collectRecurringBills(recallRows, now),
      streak: computeStreak(recent, now),
    };
  } catch (err) {
    console.error('[nudges] snapshot collection failed', err);
    return empty;
  }
}
