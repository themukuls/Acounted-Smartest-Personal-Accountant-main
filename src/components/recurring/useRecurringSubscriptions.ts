/**
 * useRecurringSubscriptions — the whole ledger in, detected subscriptions out.
 *
 * The detector needs EVERY transaction, not a month's worth: a quarterly
 * insurance premium is invisible inside a 30-day window, and even a monthly
 * subscription needs three months of history before it can be claimed. So this
 * reads the full `transactions` store for the user — the one place in the app
 * that deliberately ignores the month selector.
 *
 * That is affordable because the repository holds each store in memory after
 * first touch (see `src/integrations/storage/repository.ts`); a full read is an
 * array copy, not I/O, and the detection pass over ~450 rows is sub-millisecond.
 * react-query then keeps the result off the render path entirely.
 */

import { useCallback, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { getAllByIndex } from '@/integrations/storage/repository';
import { useAuth } from '@/contexts/AuthContext';
import {
  detectRecurring,
  summarise,
  type RecurringInput,
  type RecurringSeries,
  type RecurringSummary,
} from '@/lib/recurring/detect';
import { dismissKey, getDismissedKeys, restoreAll, restoreKey } from '@/lib/recurring/dismissed';

/** Matches the queryKey convention used across the app: [name, userId, ...]. */
export const RECURRING_QUERY_KEY = 'recurringTransactions';

interface UseRecurringResult {
  /** Detected series, minus anything dismissed, sorted by annual cost. */
  series: RecurringSeries[];
  summary: RecurringSummary;
  /** Series the user dismissed, so the screen can offer them back. */
  dismissed: RecurringSeries[];
  isLoading: boolean;
  isError: boolean;
  dismiss: (key: string) => void;
  restore: (key: string) => void;
  restoreEverything: () => void;
}

export function useRecurringSubscriptions(): UseRecurringResult {
  const { user } = useAuth();
  const userId = user?.id;

  // Dismissals live in localStorage, not in the query cache — they are a device
  // preference, not server state. Mirrored into React state so a dismissal
  // re-renders immediately instead of waiting for a refetch.
  const [dismissedKeys, setDismissedKeys] = useState<string[]>(() => getDismissedKeys(userId));

  const { data, isLoading, isError } = useQuery({
    queryKey: [RECURRING_QUERY_KEY, userId],
    enabled: !!userId,
    // The ledger only changes when the user logs something, and every such path
    // already invalidates this key. A minute of staleness costs nothing here.
    staleTime: 60_000,
    queryFn: async (): Promise<RecurringInput[]> => {
      const rows = await getAllByIndex<Record<string, unknown>>('transactions', 'user_id', userId!);
      return rows.map((r) => ({
        id: String(r.id),
        amount: Number(r.amount) || 0,
        category: String(r.category ?? 'others'),
        description: (r.description as string | null) ?? '',
        transaction_date: String(r.transaction_date),
        type: (r.type as string | null) ?? 'expense',
        account: (r.account as string | null) ?? null,
      }));
    },
  });

  // Detection runs against the raw ledger ONCE and is filtered afterwards, so
  // toggling a dismissal doesn't re-run the whole pass.
  const detected = useMemo(() => detectRecurring(data ?? []), [data]);

  const { series, dismissed } = useMemo(() => {
    const dismissedSet = new Set(dismissedKeys);
    return {
      series: detected.filter((s) => !dismissedSet.has(s.key)),
      dismissed: detected.filter((s) => dismissedSet.has(s.key)),
    };
  }, [detected, dismissedKeys]);

  const summary = useMemo(() => summarise(series), [series]);

  const dismiss = useCallback((key: string) => setDismissedKeys(dismissKey(userId, key)), [userId]);
  const restore = useCallback((key: string) => setDismissedKeys(restoreKey(userId, key)), [userId]);
  const restoreEverything = useCallback(() => setDismissedKeys(restoreAll(userId)), [userId]);

  return {
    series,
    summary,
    dismissed,
    isLoading: isLoading && !!userId,
    isError,
    dismiss,
    restore,
    restoreEverything,
  };
}
