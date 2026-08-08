/**
 * adapter.ts — the seam between the entitlement state machine and Play Billing.
 *
 * Everything above this file is pure and testable; everything below it is a
 * store plugin that can't run in a test or on the web. Keeping the boundary
 * this thin is also what makes the trial mechanism swappable — if the
 * card-upfront funnel converts badly and we move to an app-managed trial, only
 * this file and its implementation change.
 */

import type { BillingResult, PlanId } from './types';

export interface BillingAdapter {
  /** Is a real billing service reachable on this device? */
  available(): Promise<boolean>;
  /** Ask what the store knows. MUST resolve `{ok:false}` rather than throw. */
  query(): Promise<BillingResult>;
  /** Launch the purchase flow for a plan. */
  purchase(plan: PlanId): Promise<BillingResult>;
  /** Deep-link to Play's subscription management. */
  openManage(): Promise<void>;
}

/**
 * The no-store adapter: web builds, dev, and tests.
 *
 * Every method reports "I couldn't find out" rather than "you're not entitled".
 * That distinction is the whole safety property — `{ ok: false }` can never
 * downgrade anyone, so running the app in a browser can't strip a paying user's
 * access when they next open it on their phone.
 */
export const stubBillingAdapter: BillingAdapter = {
  async available() {
    return false;
  },
  async query() {
    return { ok: false, reason: 'No billing service on this platform.' };
  },
  async purchase() {
    return { ok: false, reason: 'Purchases are only available in the Android app.' };
  },
  async openManage() {
    /* no-op */
  },
};

let active: BillingAdapter = stubBillingAdapter;

export function getBillingAdapter(): BillingAdapter {
  return active;
}

/** Install the real Play adapter at startup, or a fake in tests. */
export function setBillingAdapter(adapter: BillingAdapter | null): void {
  active = adapter ?? stubBillingAdapter;
}
