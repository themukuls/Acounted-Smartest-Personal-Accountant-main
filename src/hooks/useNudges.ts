"use client";

/**
 * useNudges.ts — the two React entry points to the nudge system.
 *
 *   `useNudgeEngine()`  — mounted once, from AppLayout. Runs an evaluation
 *                         cycle on resume and after data changes.
 *   `useNudgeSettings()`— everything the Reminders UI needs: preferences,
 *                         the live preview, and the toggles.
 *
 * The engine deliberately does almost nothing. It never asks for permission,
 * never schedules at cold start, and throttles itself hard: the caps inside
 * the scheduler already make repeat cycles idempotent, so the throttle here is
 * only about not doing pointless work on a mid-range phone.
 */

import { useCallback, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/contexts/AuthContext';
import { getISTDate } from '@/lib/date-utils';
import { isNative } from '@/lib/platform';
import { collectSnapshot } from '@/lib/nudges/collectSnapshot';
import {
  previewNudges,
  runNudgeCycle,
  setNudgesEnabled,
  updatePreferences,
} from '@/lib/nudges/scheduler';
import { loadHistory, loadPreferences } from '@/lib/nudges/storage';
import type { NudgeCategory, NudgePreferences } from '@/lib/nudges/types';

/** Don't re-evaluate more than once every two minutes. */
const CYCLE_THROTTLE_MS = 2 * 60_000;

/**
 * Query keys whose invalidation means the user's financial picture moved.
 * A change to, say, the tax co-pilot's cache is not a reason to re-evaluate.
 */
const DATA_KEYS = [
  'transactions',
  'monthlyTransactions',
  'monthlyBudgetSummary',
  'savingsGoals',
  'udhar',
  'variableBudget',
  'quickActionsSummary',
  'recentActivity',
];

// ── The background engine ────────────────────────────────────────────────────

export function useNudgeEngine(): void {
  const { user } = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const lastRun = useRef(0);
  const running = useRef(false);
  const userId = user?.id ?? null;

  const cycle = useCallback(
    async (force = false) => {
      if (!userId || running.current) return;
      const now = Date.now();
      if (!force && now - lastRun.current < CYCLE_THROTTLE_MS) return;

      running.current = true;
      lastRun.current = now;
      try {
        // Cheap early exit: don't read the whole ledger for a user who has
        // never switched reminders on.
        const prefs = await loadPreferences();
        if (!prefs.enabled) return;

        const snapshot = await collectSnapshot(userId, getISTDate());
        await runNudgeCycle(snapshot);
      } catch (err) {
        console.error('[nudges] cycle failed', err);
      } finally {
        running.current = false;
      }
    },
    [userId],
  );

  // Resume + first mount.
  useEffect(() => {
    if (!userId) return;
    void cycle();

    let remove: (() => void) | undefined;
    void (async () => {
      try {
        const { App } = await import('@capacitor/app');
        const handle = await App.addListener('appStateChange', ({ isActive }) => {
          if (isActive) void cycle();
        });
        remove = () => void handle.remove();
      } catch {
        // Browser fallback so `npm run dev` exercises the same path.
        const onVisible = () => {
          if (document.visibilityState === 'visible') void cycle();
        };
        document.addEventListener('visibilitychange', onVisible);
        remove = () => document.removeEventListener('visibilitychange', onVisible);
      }
    })();

    return () => remove?.();
  }, [userId, cycle]);

  // After a data change. React Query is the app's single source of truth for
  // "something was saved", so we listen there rather than threading a callback
  // through every save site.
  useEffect(() => {
    if (!userId) return;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const unsubscribe = queryClient.getQueryCache().subscribe((event) => {
      if (event.type !== 'updated') return;
      const key = String(event.query.queryKey[0] ?? '');
      if (!DATA_KEYS.some((k) => key.startsWith(k))) return;
      if (timer) clearTimeout(timer);
      // Saving one transaction fires several cache updates; coalesce them.
      timer = setTimeout(() => void cycle(), 1500);
    });

    return () => {
      if (timer) clearTimeout(timer);
      unsubscribe();
    };
  }, [userId, cycle, queryClient]);

  // Tapping a notification should land on the screen it was about.
  useEffect(() => {
    if (!isNative()) return;
    let remove: (() => void) | undefined;
    void (async () => {
      try {
        const { LocalNotifications } = await import('@capacitor/local-notifications');
        const handle = await LocalNotifications.addListener(
          'localNotificationActionPerformed',
          (action) => {
            const link = action.notification?.extra?.deepLink;
            if (typeof link === 'string' && link.startsWith('/')) navigate(link);
          },
        );
        remove = () => void handle.remove();
      } catch (err) {
        console.warn('[nudges] tap listener unavailable', err);
      }
    })();
    return () => remove?.();
  }, [navigate]);
}

// ── Settings + preview ───────────────────────────────────────────────────────

export interface UseNudgeSettings {
  preferences: NudgePreferences | undefined;
  isLoading: boolean;
  /** What would actually be delivered right now, and why the rest were not. */
  preview: ReturnType<typeof previewNudges> | undefined;
  isPreviewLoading: boolean;
  isSaving: boolean;
  setEnabled: (enabled: boolean) => void;
  setCategory: (category: NudgeCategory, enabled: boolean) => void;
}

export function useNudgeSettings(enabled = true): UseNudgeSettings {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const userId = user?.id ?? null;

  const prefsQuery = useQuery({
    queryKey: ['nudgePreferences'],
    queryFn: loadPreferences,
    enabled,
    staleTime: 0,
  });

  const previewQuery = useQuery({
    queryKey: ['nudgePreview', userId, prefsQuery.data],
    queryFn: async () => {
      if (!userId) return undefined;
      const [snapshot, history] = await Promise.all([
        collectSnapshot(userId, getISTDate()),
        loadHistory(),
      ]);
      return previewNudges(snapshot, history, prefsQuery.data ?? (await loadPreferences()));
    },
    enabled: enabled && !!userId && !!prefsQuery.data,
    staleTime: 30_000,
  });

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ['nudgePreferences'] });
    void queryClient.invalidateQueries({ queryKey: ['nudgePreview'] });
  };

  const master = useMutation({
    mutationFn: (next: boolean) => setNudgesEnabled(next),
    onSuccess: (prefs) => {
      queryClient.setQueryData(['nudgePreferences'], prefs);
      invalidate();
    },
  });

  const category = useMutation({
    mutationFn: ({ cat, value }: { cat: NudgeCategory; value: boolean }) =>
      updatePreferences({ categories: { [cat]: value } }),
    onSuccess: (prefs) => {
      queryClient.setQueryData(['nudgePreferences'], prefs);
      invalidate();
    },
  });

  return {
    preferences: prefsQuery.data,
    isLoading: prefsQuery.isLoading,
    preview: previewQuery.data,
    isPreviewLoading: previewQuery.isLoading || previewQuery.isFetching,
    isSaving: master.isPending || category.isPending,
    setEnabled: (next) => master.mutate(next),
    setCategory: (cat, value) => category.mutate({ cat, value }),
  };
}
