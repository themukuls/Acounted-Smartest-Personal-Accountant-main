/**
 * state.test.ts — the entitlement state machine.
 *
 * Run with:  npx --yes bun@latest test src/lib/entitlement
 *
 * This file guards commercial logic that can silently harm a user. The two
 * failure modes worth losing sleep over:
 *
 *   1. A PAYING USER LOCKED OUT because the app couldn't reach Play.
 *   2. A USER LOSING ACCESS TO THEIR OWN FINANCIAL RECORDS.
 *
 * Both are asserted exhaustively rather than by example.
 */

import { test, expect, describe } from 'bun:test';
import {
  capabilitiesFor,
  capabilitiesOf,
  effectiveStatus,
  reconcile,
  trialDaysRemaining,
  needsPaywall,
  dayKey,
  OFFLINE_GRACE_DAYS,
  NEGATIVE_DAYS_TO_LAPSE,
} from './state';
import { FRESH_INSTALL, type EntitlementSnapshot, type EntitlementStatus } from './types';

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.UTC(2026, 7, 2, 12, 0, 0); // 2 Aug 2026, midday

const ALL_STATUSES: EntitlementStatus[] = ['trialing', 'active', 'grace', 'lapsed', 'none'];

function snap(over: Partial<EntitlementSnapshot> = {}): EntitlementSnapshot {
  return { ...FRESH_INSTALL, ...over };
}

// ─── The inviolable rule ──────────────────────────────────────────────────────

describe('reading and exporting are never gated', () => {
  test('every status can read and export', () => {
    // Exhaustive, not by example — a new status added later fails here until
    // someone consciously decides what it means.
    for (const status of ALL_STATUSES) {
      const caps = capabilitiesFor(status);
      expect(caps.canRead).toBe(true);
      expect(caps.canExport).toBe(true);
    }
  });

  test('a lapsed user keeps read and export but loses everything else', () => {
    const caps = capabilitiesFor('lapsed');
    expect(caps).toEqual({
      canRead: true,
      canExport: true,
      canWrite: false,
      canUseTax: false,
      canUseAssistant: false,
      canUseInsights: false,
    });
  });

  test('a long-expired snapshot still permits read and export', () => {
    const s = snap({ status: 'active', expiresAt: NOW - 400 * DAY });
    const caps = capabilitiesOf(s, NOW);
    expect(effectiveStatus(s, NOW)).toBe('lapsed');
    expect(caps.canRead).toBe(true);
    expect(caps.canExport).toBe(true);
  });
});

// ─── A failed check must never cost anyone access ────────────────────────────

describe('a failed billing check changes nothing', () => {
  test('an unreachable store leaves every status untouched', () => {
    for (const status of ALL_STATUSES) {
      const before = snap({ status, plan: 'annual', expiresAt: NOW + 30 * DAY });
      const after = reconcile(before, { ok: false, reason: 'offline' }, NOW);
      expect(after).toEqual(before);
    }
  });

  test('a thousand consecutive failures still change nothing', () => {
    let s = snap({ status: 'active', plan: 'annual', expiresAt: NOW + 300 * DAY });
    for (let i = 0; i < 1000; i++) {
      s = reconcile(s, { ok: false, reason: 'offline' }, NOW + i * DAY);
    }
    expect(s.status).toBe('active');
    expect(s.negativeDays).toEqual([]);
  });
});

// ─── Downgrade requires two distinct days ────────────────────────────────────

describe('downgrading to lapsed', () => {
  test('one confirmed "not entitled" is not enough', () => {
    const before = snap({ status: 'active', plan: 'annual', expiresAt: NOW + 10 * DAY });
    const after = reconcile(before, { ok: true, entitled: false }, NOW);
    expect(after.status).toBe('active');
    expect(after.negativeDays).toHaveLength(1);
  });

  test('twice on the SAME day is still not enough', () => {
    let s = snap({ status: 'active', plan: 'annual', expiresAt: NOW + 10 * DAY });
    s = reconcile(s, { ok: true, entitled: false }, NOW);
    s = reconcile(s, { ok: true, entitled: false }, NOW + 60 * 1000);
    expect(s.status).toBe('active');
    expect(s.negativeDays).toHaveLength(1);
  });

  test('two distinct days does downgrade', () => {
    let s = snap({ status: 'active', plan: 'annual', expiresAt: NOW + 10 * DAY });
    s = reconcile(s, { ok: true, entitled: false }, NOW);
    s = reconcile(s, { ok: true, entitled: false }, NOW + DAY);
    expect(s.status).toBe('lapsed');
    expect(s.negativeDays).toHaveLength(NEGATIVE_DAYS_TO_LAPSE);
  });

  test('a confirmed entitlement in between forgives the earlier negative', () => {
    // The real scenario: Play's cache lags just after a renewal, reports no
    // entitlement once, then catches up. That must not accumulate toward a lapse.
    let s = snap({ status: 'active', plan: 'annual', expiresAt: NOW + 10 * DAY });
    s = reconcile(s, { ok: true, entitled: false }, NOW);
    expect(s.negativeDays).toHaveLength(1);

    s = reconcile(s, { ok: true, entitled: true, plan: 'annual', trialing: false, expiresAt: NOW + 365 * DAY }, NOW + DAY);
    expect(s.negativeDays).toEqual([]);

    s = reconcile(s, { ok: true, entitled: false }, NOW + 2 * DAY);
    expect(s.status).toBe('active');
  });

  test('a fresh install stays "none" rather than becoming "lapsed"', () => {
    // Calling someone who never subscribed "lapsed" would wrongly imply they
    // once paid — and would route them to the wrong screen.
    let s = snap({ status: 'none' });
    s = reconcile(s, { ok: true, entitled: false }, NOW);
    s = reconcile(s, { ok: true, entitled: false }, NOW + DAY);
    s = reconcile(s, { ok: true, entitled: false }, NOW + 2 * DAY);
    expect(s.status).toBe('none');
  });
});

// ─── Offline expiry and the grace window ─────────────────────────────────────

describe('offline behaviour around expiry', () => {
  test('a trialing snapshot survives the full 14 days offline', () => {
    const s = snap({ status: 'trialing', plan: 'annual', expiresAt: NOW + 14 * DAY });
    for (let d = 0; d <= 14; d++) {
      expect(effectiveStatus(s, NOW + d * DAY)).toBe('trialing');
      expect(capabilitiesOf(s, NOW + d * DAY).canWrite).toBe(true);
    }
  });

  test('past expiry it grants grace, not a lockout', () => {
    // A trial converting to paid (or an annual renewing) while offline is the
    // exact case this protects: Google took the money, we just can't see it.
    const s = snap({ status: 'trialing', plan: 'annual', expiresAt: NOW });
    expect(effectiveStatus(s, NOW + DAY)).toBe('grace');
    expect(capabilitiesOf(s, NOW + DAY).canWrite).toBe(true);
    expect(capabilitiesOf(s, NOW + OFFLINE_GRACE_DAYS * DAY).canWrite).toBe(true);
  });

  test('grace eventually ends', () => {
    const s = snap({ status: 'trialing', plan: 'annual', expiresAt: NOW });
    expect(effectiveStatus(s, NOW + (OFFLINE_GRACE_DAYS + 1) * DAY)).toBe('lapsed');
  });

  test('an active subscription with no known expiry is trusted indefinitely', () => {
    const s = snap({ status: 'active', plan: 'monthly', expiresAt: null });
    expect(effectiveStatus(s, NOW + 999 * DAY)).toBe('active');
  });

  test('"none" and "lapsed" never improve with time alone', () => {
    expect(effectiveStatus(snap({ status: 'none' }), NOW + 999 * DAY)).toBe('none');
    expect(effectiveStatus(snap({ status: 'lapsed' }), NOW + 999 * DAY)).toBe('lapsed');
  });
});

// ─── Purchase ────────────────────────────────────────────────────────────────

describe('a successful purchase', () => {
  test('a trial purchase lands as trialing with an expiry', () => {
    const s = reconcile(
      snap({ status: 'none' }),
      { ok: true, entitled: true, plan: 'annual', trialing: true, expiresAt: NOW + 14 * DAY },
      NOW,
    );
    expect(s.status).toBe('trialing');
    expect(s.plan).toBe('annual');
    expect(trialDaysRemaining(s, NOW)).toBe(14);
    expect(capabilitiesOf(s, NOW).canUseTax).toBe(true);
  });

  test('a lapsed user who resubscribes is fully restored', () => {
    const s = reconcile(
      snap({ status: 'lapsed', negativeDays: ['2026-08-02', '2026-08-03'] }),
      { ok: true, entitled: true, plan: 'monthly', trialing: false, expiresAt: NOW + 30 * DAY },
      NOW,
    );
    expect(s.status).toBe('active');
    expect(s.negativeDays).toEqual([]);
    expect(capabilitiesOf(s, NOW).canWrite).toBe(true);
  });

  test('reconcile never mutates its input', () => {
    const before = snap({ status: 'active', plan: 'annual', expiresAt: NOW + DAY });
    const copy = JSON.parse(JSON.stringify(before));
    reconcile(before, { ok: true, entitled: false }, NOW);
    expect(before).toEqual(copy);
  });
});

// ─── Helpers ─────────────────────────────────────────────────────────────────

describe('helpers', () => {
  test('trialDaysRemaining is never negative and is zero when not trialing', () => {
    expect(trialDaysRemaining(snap({ status: 'trialing', expiresAt: NOW - 5 * DAY }), NOW)).toBe(0);
    expect(trialDaysRemaining(snap({ status: 'active', expiresAt: NOW + 5 * DAY }), NOW)).toBe(0);
  });

  test('only a never-subscribed user sees the paywall', () => {
    expect(needsPaywall(snap({ status: 'none' }), NOW)).toBe(true);
    // A lapsed user gets the read-only app plus an in-app resubscribe prompt,
    // NOT a wall between them and their own records.
    expect(needsPaywall(snap({ status: 'lapsed' }), NOW)).toBe(false);
    expect(needsPaywall(snap({ status: 'trialing', expiresAt: NOW + DAY }), NOW)).toBe(false);
  });

  test('dayKey is a local calendar day', () => {
    expect(dayKey(new Date(2026, 7, 2, 23, 59).getTime())).toBe('2026-08-02');
    expect(dayKey(new Date(2026, 7, 3, 0, 1).getTime())).toBe('2026-08-03');
  });
});
