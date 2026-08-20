/**
 * state.ts — the entitlement state machine. Pure functions only.
 *
 * No I/O, no plugin, no React. Everything here is decidable from a snapshot and
 * a timestamp, which is what makes the offline behaviour testable rather than
 * hopeful.
 *
 * ── The three rules that matter ──────────────────────────────────────────────
 *
 * 1. READ AND EXPORT ARE NEVER GATED. Whatever the status, the user can open
 *    the app, see their records and take a CSV out.
 *
 * 2. A FAILED CHECK NEVER DOWNGRADES. `{ ok: false }` means we learned nothing
 *    — offline, no Play Store, plugin missing. Learning nothing must not cost
 *    a paying user their access.
 *
 * 3. DOWNGRADE NEEDS TWO SEPARATE DAYS. Even a successful "no entitlement" can
 *    be wrong once (a Play cache still settling after a renewal, an account
 *    switch). Requiring two distinct calendar days makes a spurious lockout
 *    essentially impossible while still catching a genuine cancellation within
 *    ~24 hours.
 */

import type {
  BillingResult,
  Capabilities,
  EntitlementSnapshot,
  EntitlementStatus,
} from './types';

/**
 * How long full access continues past a known expiry when we cannot reach Play.
 *
 * This exists for a specific, real case: a trial converts to paid (or an annual
 * plan renews) while the phone is offline. Google charged the card, the user is
 * entitled, and we have no way to see it. Cutting them off at the stroke of
 * expiry would punish exactly the person who paid. Seven days is long enough to
 * get back online at least once.
 */
export const OFFLINE_GRACE_DAYS = 7;

/** The explicit no-card fallback offered after the Play offer is dismissed. */
export const LOCAL_TRIAL_DAYS = 7;

/** Distinct days of a confirmed "no entitlement" before we downgrade. */
export const NEGATIVE_DAYS_TO_LAPSE = 2;

const DAY_MS = 24 * 60 * 60 * 1000;

/** Local calendar day key. Deliberately local, not UTC — a "day" is the user's. */
export function dayKey(ms: number): string {
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/**
 * What the app may do, given a status.
 *
 * `canRead` and `canExport` are hard-coded true on every branch. That is the
 * point — there is no path through this function that returns false for either,
 * and a test asserts it across every status.
 */
export function capabilitiesFor(status: EntitlementStatus): Capabilities {
  const full = status === 'trialing' || status === 'active' || status === 'grace';
  return {
    canRead: true,
    canExport: true,
    canWrite: full,
    canUseTax: full,
    canUseAssistant: full,
    canUseInsights: full,
  };
}

/**
 * Resolve the *effective* status now, applying local expiry to a stored
 * snapshot. Called on every read, so a cached snapshot ages correctly without
 * needing the network.
 */
export function effectiveStatus(snap: EntitlementSnapshot, now: number): EntitlementStatus {
  // 'none' and 'lapsed' are stable — nothing about the passage of time improves
  // them, and only a successful billing result can move them.
  if (snap.status === 'none' || snap.status === 'lapsed') return snap.status;

  // No known expiry: trust what we last confirmed. This is the normal state for
  // an active subscriber between renewals.
  if (snap.expiresAt === null) return snap.status;

  if (now <= snap.expiresAt) return snap.status;

  // A local trial has no renewal in flight to wait for. It ends at the exact
  // stored timestamp; the offline grace window is only for Play entitlements.
  if (snap.status === 'trialing' && snap.trialSource === 'local') return 'lapsed';

  // Past expiry and we haven't been able to confirm a renewal. Give the benefit
  // of the doubt for the grace window rather than locking out someone whose
  // payment probably went through while they were offline.
  if (now <= snap.expiresAt + OFFLINE_GRACE_DAYS * DAY_MS) return 'grace';

  return 'lapsed';
}

/** Convenience: capabilities for a snapshot at a point in time. */
export function capabilitiesOf(snap: EntitlementSnapshot, now: number): Capabilities {
  return capabilitiesFor(effectiveStatus(snap, now));
}

/**
 * Fold a billing result into the stored snapshot.
 *
 * Returns a NEW snapshot; never mutates. The caller persists whatever comes
 * back — including on the `ok: false` path, where nothing changes, so a caller
 * that blindly saves is still correct.
 */
export function reconcile(
  snap: EntitlementSnapshot,
  result: BillingResult,
  now: number,
): EntitlementSnapshot {
  // ── Rule 2: we learned nothing. Change nothing. ──────────────────────────
  if (!result.ok) return snap;

  // ── Entitled: refresh everything, forgive any past negatives. ────────────
  if (result.entitled) {
    return {
      status: result.trialing ? 'trialing' : 'active',
      plan: result.plan,
      expiresAt: result.expiresAt,
      lastVerifiedAt: now,
      // Cleared deliberately: a confirmed entitlement means any earlier
      // negative reading was wrong or is now irrelevant.
      negativeDays: [],
      trialSource: result.trialing ? 'play' : null,
      localTrialStartedAt: snap.localTrialStartedAt,
      localTrialUsed: snap.localTrialUsed,
    };
  }

  // Google Play correctly reports no purchase during an app-managed trial.
  // That answer must not shorten or invalidate the local seven days.
  if (snap.status === 'trialing' && snap.trialSource === 'local') return snap;

  // ── Confirmed not entitled ───────────────────────────────────────────────
  const today = dayKey(now);
  const negativeDays = snap.negativeDays.includes(today)
    ? snap.negativeDays
    : [...snap.negativeDays, today];

  // Someone who never subscribed stays 'none' — there's nothing to lapse from,
  // and calling a fresh install "lapsed" would wrongly imply they once paid.
  if (snap.status === 'none') {
    return { ...snap, lastVerifiedAt: now, negativeDays };
  }

  // ── Rule 3: two distinct days before we take access away. ────────────────
  if (negativeDays.length < NEGATIVE_DAYS_TO_LAPSE) {
    return { ...snap, lastVerifiedAt: now, negativeDays };
  }

  return {
    status: 'lapsed',
    plan: null,
    expiresAt: null,
    lastVerifiedAt: now,
    negativeDays,
    trialSource: null,
    localTrialStartedAt: snap.localTrialStartedAt,
    localTrialUsed: snap.localTrialUsed,
  };
}

/** Start the one-time, no-card fallback trial. Returns the same object if denied. */
export function beginLocalTrial(
  snap: EntitlementSnapshot,
  now: number,
): EntitlementSnapshot {
  if (effectiveStatus(snap, now) !== 'none' || snap.localTrialUsed) return snap;
  return {
    ...snap,
    status: 'trialing',
    plan: null,
    trialSource: 'local',
    localTrialStartedAt: now,
    localTrialUsed: true,
    expiresAt: now + LOCAL_TRIAL_DAYS * DAY_MS,
    negativeDays: [],
  };
}

/** Whole days of trial left, for the countdown banner. Never negative. */
export function trialDaysRemaining(snap: EntitlementSnapshot, now: number): number {
  if (snap.status !== 'trialing' || snap.expiresAt === null) return 0;
  return Math.max(0, Math.ceil((snap.expiresAt - now) / DAY_MS));
}

/** True when the user should be shown the paywall rather than the app. */
export function needsPaywall(snap: EntitlementSnapshot, now: number): boolean {
  return effectiveStatus(snap, now) === 'none';
}
