/**
 * apply.ts — the only place the assistant writes anything.
 *
 * A plain switch over a validated action. No LLM involvement: if the whole
 * extraction layer were deleted, this would still work off a hand-built object,
 * which is exactly the point.
 *
 * Three things here are load-bearing and easy to get wrong:
 *  1. `amount` must be a real number — saveTransaction silently writes ₹0 for a
 *     string, so a slipped coercion becomes a wrong ledger rather than an error.
 *  2. Never pass an explicit `undefined` — the services spread the payload LAST
 *     over their defaults, and Object.entries includes undefined-valued keys, so
 *     `{ category: undefined }` overwrites the default with undefined.
 *  3. notifyDatabaseChanged() must be called by us. Of all the write services
 *     only learnedTaxMappingsService does it, so without this the Android
 *     WebView backup goes stale after every assistant write.
 */

import { parseISO } from 'date-fns';
import DOMPurify from 'dompurify';
import { saveTransaction } from '@/integrations/indexeddb/services/dataService';
import {
  getUdharEntries,
  saveUdharEntry,
  logPayment,
} from '@/integrations/indexeddb/services/udharService';
import { notifyDatabaseChanged } from '@/utils/dbSync';
import { categoryLabel } from '@/lib/categories';
import { formatFullINR } from '@/lib/currency';
import { captureCorrection } from './learning';
import type { WritableAction } from './types';

export interface ApplyResult {
  /** Human summary for the success toast. */
  summary: string;
  /** Which react-query keys the caller should invalidate. */
  invalidate: string[][];
}

/** Thrown when the action is well-formed but can't be applied to this user's data. */
export class ApplyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ApplyError';
  }
}

/** A YYYY-MM-DD day becomes an ISO timestamp at local noon. */
function toIsoTimestamp(day: string): string {
  const parsed = parseISO(day);
  if (isNaN(parsed.getTime())) return new Date().toISOString();
  // Noon avoids a midnight timestamp shifting to the previous day under a
  // timezone conversion, which would put transactions in the wrong week.
  parsed.setHours(12, 0, 0, 0);
  return parsed.toISOString();
}

/**
 * The canonical post-transaction invalidation set, matching src/pages/Index.tsx.
 * (Expenses.tsx only invalidates 3 of these and consequently leaves the
 * dashboard stale — this is the correct list.)
 */
const TRANSACTION_KEYS: string[][] = [
  ['quickActionsWeeklySummary'],
  ['weeklyBudgetProjections'],
  ['monthlyTransactionsForSavings'],
  ['recentTransactions'],
  ['monthlyBudgetSummary'],
  ['activeNotifications'],
  ['seenNotificationIds'],
];

export async function applyAction(
  userId: string,
  action: WritableAction,
): Promise<ApplyResult> {
  switch (action.kind) {
    case 'add_transaction': {
      await saveTransaction(userId, {
        type: action.type,
        amount: action.amount,
        category: action.category,
        account: action.account,
        description: DOMPurify.sanitize(action.description ?? ''),
        transaction_date: toIsoTimestamp(action.transaction_date),
      });

      notifyDatabaseChanged();

      // The action we're saving is whatever the user left on the review card.
      // Anything they changed from what we offered is a correction, and a
      // correction beats history the next time this merchant comes up. Purely
      // local, and never allowed to fail a save that already succeeded.
      try {
        captureCorrection(userId, action);
      } catch {
        /* learning is best-effort */
      }

      const what =
        action.type === 'income'
          ? 'Income'
          : categoryLabel(action.category);
      return {
        summary: `${what} · ${formatFullINR(action.amount)} saved`,
        invalidate: TRANSACTION_KEYS,
      };
    }

    case 'add_udhar': {
      const isGiven = action.type === 'given';
      await saveUdharEntry(userId, {
        type: action.type,
        // The app reads person_name for 'given' and lender_name for 'taken'.
        // Setting both keeps every existing screen readable either way.
        person_name: isGiven ? action.person : null,
        lender_name: isGiven ? null : action.person,
        amount: action.amount,
        due_date: toIsoTimestamp(action.due_date),
        is_settled: false,
        phone_number: '',
        description: DOMPurify.sanitize(action.description ?? ''),
      });

      notifyDatabaseChanged();

      return {
        summary: isGiven
          ? `${action.person} owes you ${formatFullINR(action.amount)}`
          : `You owe ${action.person} ${formatFullINR(action.amount)}`,
        invalidate: [['udharEntries', userId, action.type]],
      };
    }

    case 'log_udhar_payment': {
      const target = await findUdharEntryByPerson(userId, action.person);
      if (!target) {
        throw new ApplyError(
          `No open udhar entry found for "${action.person}". Add the loan first, then log the repayment.`,
        );
      }

      await logPayment(target.id, {
        amount: action.amount,
        date: toIsoTimestamp(action.date),
        note: 'Logged by assistant',
      });

      notifyDatabaseChanged();

      return {
        summary: `${formatFullINR(action.amount)} payment logged against ${action.person}`,
        invalidate: [['udharEntries', userId, target.type]],
      };
    }
  }
}

/**
 * Match a spoken name to an open udhar entry.
 * Prefers an exact (case-insensitive) name match, then a partial one, and only
 * considers unsettled entries so a repaid loan isn't reopened by accident.
 */
async function findUdharEntryByPerson(userId: string, person: string) {
  const all = await getUdharEntries(userId);
  const needle = person.trim().toLowerCase();
  if (!needle) return null;

  const open = all.filter((e) => !e.is_settled);
  const nameOf = (e: (typeof open)[number]) =>
    (e.type === 'given' ? e.person_name : e.lender_name)?.trim().toLowerCase() ?? '';

  return (
    open.find((e) => nameOf(e) === needle) ??
    open.find((e) => nameOf(e).includes(needle) || needle.includes(nameOf(e))) ??
    null
  );
}
