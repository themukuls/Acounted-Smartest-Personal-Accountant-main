"use client";

/**
 * useEntitlement — the app's single read of "what may this person do right now".
 *
 * ── The promise this hook has to keep ────────────────────────────────────────
 * IT NEVER BLOCKS A RENDER. There is no loading state to wait on, no suspense
 * boundary, no route guard. The first paint uses whatever is already in memory
 * (`peekEntitlement()`), the stored snapshot arrives a microtask later, and the
 * billing round-trip — which can hang for seconds on a bad connection, or
 * forever inside a WebView with no Play Store — happens entirely in the
 * background. A user opening the app in a tunnel sees their data, not a spinner.
 *
 * ── Why a module-level store instead of a context ────────────────────────────
 * Eight surfaces gate on this. A provider would mean every one of them breaks
 * if someone renders a page outside the tree (a test, a modal portal, a future
 * route), and eight independent `useState`s would mean eight billing queries on
 * one screen. So the snapshot lives in a tiny external store: one copy, one
 * in-flight query, `useSyncExternalStore` for the fan-out.
 *
 * ── Refresh is opportunistic, never authoritative ────────────────────────────
 * `reconcile()` already guarantees a failed query changes nothing, so the worst
 * case for a refresh that errors, times out, or hits the stub adapter is that
 * we learned nothing and wrote nothing. That is why every call site here is
 * fire-and-forget.
 */

import { useCallback, useEffect, useMemo, useSyncExternalStore } from 'react';
import { App as CapacitorApp } from '@capacitor/app';
import { isNative } from '@/lib/platform';
import { getBillingAdapter } from '@/lib/entitlement/adapter';
import {
  capabilitiesOf,
  beginLocalTrial,
  effectiveStatus,
  needsPaywall,
  reconcile,
  trialDaysRemaining,
} from '@/lib/entitlement/state';
import {
  loadEntitlement,
  peekEntitlement,
  saveEntitlement,
} from '@/lib/entitlement/storage';
import {
  FRESH_INSTALL,
  type BillingResult,
  type Capabilities,
  type EntitlementSnapshot,
  type EntitlementStatus,
  type PlanId,
} from '@/lib/entitlement/types';

/**
 * Don't re-query Play every time a component mounts. Navigating between five
 * gated screens is not five reasons to ask the store the same question.
 */
const REFRESH_COOLDOWN_MS = 60_000;

// ─── The store ────────────────────────────────────────────────────────────────

interface StoreState {
  snapshot: EntitlementSnapshot;
  /**
   * False until the stored snapshot has actually been read.
   *
   * This exists for exactly one reason: FRESH_INSTALL is `none`, and `none` is
   * the status that shows a paywall. Without this flag a paying subscriber
   * would see the offer screen flash on every cold start. Callers must treat
   * "not hydrated" as "don't wall anyone yet" — never as "show a spinner".
   */
  hydrated: boolean;
}

let state: StoreState = {
  snapshot: peekEntitlement() ?? FRESH_INSTALL,
  hydrated: peekEntitlement() !== null,
};

const listeners = new Set<() => void>();

function emit(next: StoreState): void {
  // Identity-stable: useSyncExternalStore re-renders on reference change, so an
  // unchanged snapshot must not produce a new object.
  if (next.snapshot === state.snapshot && next.hydrated === state.hydrated) return;
  state = next;
  listeners.forEach((l) => l());
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function getState(): StoreState {
  return state;
}

// ─── Refresh ──────────────────────────────────────────────────────────────────

let inFlight: Promise<void> | null = null;
let lastAttemptAt = 0;

/**
 * Read storage, ask billing, fold the answer in, persist.
 *
 * Every step is defensive:
 *  - storage is hydrated and published BEFORE the network call, so a hanging
 *    billing query never delays the app learning it has an active subscriber;
 *  - `query()` is contractually not allowed to throw, but it is wrapped anyway
 *    because a third-party plugin will eventually break that contract;
 *  - `reconcile()` returns the SAME object when nothing was learned, so the
 *    `!==` check below turns a failed refresh into zero writes.
 */
async function runRefresh(): Promise<void> {
  const stored = await loadEntitlement();
  emit({ snapshot: stored, hydrated: true });

  let result: BillingResult;
  try {
    result = await getBillingAdapter().query();
  } catch (err) {
    // Learning nothing. Explicitly NOT a downgrade.
    result = { ok: false, reason: (err as Error)?.message ?? 'Billing query failed.' };
  }

  const next = reconcile(stored, result, Date.now());
  if (next !== stored) {
    await saveEntitlement(next);
    emit({ snapshot: next, hydrated: true });
  }
}

/**
 * @param force skip the cooldown (an explicit user action, or a resume).
 */
export function refreshEntitlement(force = false): Promise<void> {
  if (inFlight) return inFlight;
  if (!force && Date.now() - lastAttemptAt < REFRESH_COOLDOWN_MS) {
    return Promise.resolve();
  }
  lastAttemptAt = Date.now();
  inFlight = runRefresh()
    .catch(() => {
      /* storage unreadable — the in-memory snapshot still serves this session */
    })
    .finally(() => {
      inFlight = null;
    });
  return inFlight;
}

/** Fold a purchase result in immediately, so the UI unlocks without a round-trip. */
async function commit(result: BillingResult): Promise<void> {
  if (!result.ok) return;
  const stored = await loadEntitlement();
  const next = reconcile(stored, result, Date.now());
  if (next !== stored) {
    await saveEntitlement(next);
    emit({ snapshot: next, hydrated: true });
  }
}

// ─── Resume ───────────────────────────────────────────────────────────────────

/**
 * One listener for the whole app, attached on the first mount and never torn
 * down — the app-wide entitlement outlives any single component, and a
 * per-component listener would fire N times per resume.
 */
let resumeWired = false;

function wireResume(): void {
  if (resumeWired) return;
  resumeWired = true;

  if (isNative()) {
    // Coming back from the Play purchase flow, or from the background after a
    // renewal, is the single most valuable moment to re-check.
    void CapacitorApp.addListener('appStateChange', ({ isActive }) => {
      if (isActive) void refreshEntitlement(true);
    }).catch(() => {
      /* plugin missing — the mount-time refresh still runs */
    });
    return;
  }

  // Web equivalent, so dev and PWA builds behave the same way.
  if (typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') void refreshEntitlement(true);
    });
  }
}

// ─── The hook ─────────────────────────────────────────────────────────────────

export interface UseEntitlement {
  /** Effective status now — expiry and the offline grace window applied. */
  status: EntitlementStatus;
  /** What the app may do. `canRead` and `canExport` are always true. */
  capabilities: Capabilities;
  /** Whole days left in the trial. 0 when not trialing. */
  trialDaysLeft: number;
  /** ms epoch the current period ends, or null when unknown. */
  expiresAt: number | null;
  /** The raw stored snapshot, for anything that needs the plan or expiry. */
  snapshot: EntitlementSnapshot;
  /**
   * True only once the stored snapshot has been read AND it says `none`.
   * Callers MUST NOT show a wall before hydration — see StoreState.hydrated.
   */
  showPaywall: boolean;
  /** False for the first tick of a cold start. Never render a spinner on it. */
  hydrated: boolean;
  /** Opportunistic re-check. Safe to call at any time; never throws. */
  refresh: () => void;
  /**
   * Launch the store's purchase flow and fold the answer in.
   * Resolves with the raw BillingResult so the caller can be honest about
   * cancellation, a missing payment method, or no store at all.
   */
  purchase: (plan: PlanId) => Promise<BillingResult>;
  /** Restore a subscription already owned by the current Google Play account. */
  restore: () => Promise<BillingResult>;
  /** Start the one-time seven-day trial that does not involve Google Play. */
  startLocalTrial: () => Promise<boolean>;
  /** Deep-link to Play's subscription management. Never throws. */
  manage: () => Promise<void>;
}

export function useEntitlement(): UseEntitlement {
  const { snapshot, hydrated } = useSyncExternalStore(subscribe, getState, getState);

  useEffect(() => {
    wireResume();
    void refreshEntitlement();
  }, []);

  const derived = useMemo(() => {
    const now = Date.now();
    return {
      status: effectiveStatus(snapshot, now),
      capabilities: capabilitiesOf(snapshot, now),
      trialDaysLeft: trialDaysRemaining(snapshot, now),
      // Deliberately AND-ed with hydration: an un-read snapshot is `none`, and
      // walling a paying subscriber for one frame is worse than showing the
      // app for one frame to someone who hasn't paid.
      showPaywall: hydrated && needsPaywall(snapshot, now),
    };
  }, [snapshot, hydrated]);

  const refresh = useCallback(() => {
    void refreshEntitlement(true);
  }, []);

  const purchase = useCallback(async (plan: PlanId): Promise<BillingResult> => {
    let result: BillingResult;
    try {
      result = await getBillingAdapter().purchase(plan);
    } catch (err) {
      result = {
        ok: false,
        reason: (err as Error)?.message ?? 'The purchase could not be started.',
        kind: 'error',
      };
    }
    await commit(result);
    return result;
  }, []);

  const startLocalTrial = useCallback(async (): Promise<boolean> => {
    const stored = await loadEntitlement();
    const next = beginLocalTrial(stored, Date.now());
    if (next === stored) return false;
    await saveEntitlement(next);
    emit({ snapshot: next, hydrated: true });
    return true;
  }, []);

  const restore = useCallback(async (): Promise<BillingResult> => {
    let result: BillingResult;
    try {
      result = await getBillingAdapter().restore();
    } catch (err) {
      result = {
        ok: false,
        reason: (err as Error)?.message ?? 'Purchases could not be restored.',
        kind: 'error',
      };
    }
    await commit(result);
    return result;
  }, []);

  const manage = useCallback(async (): Promise<void> => {
    try {
      await getBillingAdapter().openManage();
    } catch {
      /* no store on this platform — the on-screen instructions still apply */
    }
  }, []);

  return {
    ...derived,
    expiresAt: snapshot.expiresAt,
    snapshot,
    hydrated,
    refresh,
    purchase,
    restore,
    startLocalTrial,
    manage,
  };
}

/** Tests only — resets the module store between cases. */
export function __resetEntitlementStore(): void {
  state = { snapshot: FRESH_INSTALL, hydrated: false };
  inFlight = null;
  lastAttemptAt = 0;
  listeners.clear();
}
