/**
 * gate.test.ts — the UI-side gate.
 *
 * Run with:  npx --yes bun@latest test src/lib/paywall
 *
 * The state machine already proves that `capabilitiesFor()` never returns false
 * for reading or exporting. This file proves the layer ABOVE it can't undo
 * that: even handed a capabilities object that claims reading is forbidden,
 * the gate lets the read through.
 */

import { test, expect, describe } from 'bun:test';
import { capabilitiesFor } from '@/lib/entitlement/state';
import type { Capabilities, EntitlementStatus } from '@/lib/entitlement/types';
import {
  checkGate,
  isLocked,
  PAID_CAPABILITIES,
  NEVER_GATED,
  SUBSCRIBE_ROUTE,
  READ_PROMISE,
} from './gate';

const ALL_STATUSES: EntitlementStatus[] = ['trialing', 'active', 'grace', 'lapsed', 'none'];
const FULL_ACCESS: EntitlementStatus[] = ['trialing', 'active', 'grace'];
const NO_ACCESS: EntitlementStatus[] = ['lapsed', 'none'];

// ─── The inviolable rule ──────────────────────────────────────────────────────

describe('reading and exporting can never be gated', () => {
  test('every status allows them', () => {
    for (const status of ALL_STATUSES) {
      const caps = capabilitiesFor(status);
      for (const cap of NEVER_GATED) {
        expect(checkGate(cap, caps, status)).toBeNull();
        expect(isLocked(cap, caps, status)).toBe(false);
      }
    }
  });

  test('a corrupted capabilities object still cannot lock the door', () => {
    // The whole point of the short-circuit: if anything upstream ever regresses
    // and reports canRead:false, the user still gets to their own records.
    const sabotaged: Capabilities = {
      canRead: false,
      canExport: false,
      canWrite: false,
      canUseTax: false,
      canUseAssistant: false,
      canUseInsights: false,
    };
    for (const status of ALL_STATUSES) {
      for (const cap of NEVER_GATED) {
        expect(checkGate(cap, sabotaged, status)).toBeNull();
      }
    }
  });
});

// ─── The paid surfaces ────────────────────────────────────────────────────────

describe('paid capabilities follow the state machine exactly', () => {
  test('open while trialing, active or in grace', () => {
    for (const status of FULL_ACCESS) {
      const caps = capabilitiesFor(status);
      for (const cap of PAID_CAPABILITIES) {
        expect(checkGate(cap, caps, status)).toBeNull();
      }
    }
  });

  test('closed when lapsed or never subscribed', () => {
    for (const status of NO_ACCESS) {
      const caps = capabilitiesFor(status);
      for (const cap of PAID_CAPABILITIES) {
        expect(checkGate(cap, caps, status)).not.toBeNull();
      }
    }
  });

  test('grace is treated as paid — a billing hiccup is not a lockout', () => {
    const caps = capabilitiesFor('grace');
    expect(checkGate('canWrite', caps, 'grace')).toBeNull();
  });
});

// ─── What the user is told ────────────────────────────────────────────────────

describe('the denial copy', () => {
  test('always promises the data is still readable and exportable', () => {
    for (const status of NO_ACCESS) {
      const caps = capabilitiesFor(status);
      for (const cap of PAID_CAPABILITIES) {
        const denial = checkGate(cap, caps, status)!;
        expect(denial.body).toContain(READ_PROMISE);
      }
    }
  });

  test('lapsed reads as "ended", not as "never had"', () => {
    const denial = checkGate('canUseTax', capabilitiesFor('lapsed'), 'lapsed')!;
    expect(denial.title).toBe('Your subscription ended');
    expect(denial.cta).toBe('Resubscribe');
  });

  test('a fresh install is invited, not scolded', () => {
    const denial = checkGate('canUseTax', capabilitiesFor('none'), 'none')!;
    expect(denial.title).not.toContain('ended');
    expect(denial.cta).toBe('See plans');
  });

  test('names the surface that is actually locked', () => {
    const caps = capabilitiesFor('lapsed');
    expect(checkGate('canWrite', caps, 'lapsed')!.body).toContain('Adding');
    expect(checkGate('canUseAssistant', caps, 'lapsed')!.body).toContain('assistant');
    expect(checkGate('canUseInsights', caps, 'lapsed')!.body).toContain('Search');
  });

  test('every denial carries the status and capability that produced it', () => {
    const denial = checkGate('canUseInsights', capabilitiesFor('lapsed'), 'lapsed')!;
    expect(denial.capability).toBe('canUseInsights');
    expect(denial.status).toBe('lapsed');
  });

  test('there is exactly one route out, and it is absolute', () => {
    expect(SUBSCRIBE_ROUTE.startsWith('/')).toBe(true);
  });
});
