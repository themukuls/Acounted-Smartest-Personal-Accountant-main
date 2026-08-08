/**
 * types.ts — what the user is currently entitled to.
 *
 * ── The one rule that outranks every other ───────────────────────────────────
 * A user can ALWAYS read and export their own financial records. There is no
 * status, no expiry, no billing failure that takes that away. Losing access to
 * two years of your own transactions because a card expired is a real harm, not
 * a growth lever, and this app doesn't do it.
 *
 * Everything else — writing, the tax suite, the assistant — is fair to gate.
 */

/** Play subscription plans, mirroring the base plans in Play Console. */
export type PlanId = 'annual' | 'monthly';

export type EntitlementStatus =
  /** Inside the 14-day Play free trial. Full access. */
  | 'trialing'
  /** Paying. Full access. */
  | 'active'
  /**
   * Full access, but we can't currently confirm the subscription — either
   * Google's billing-retry window, or we're offline past a known expiry and are
   * deliberately giving the benefit of the doubt. See OFFLINE_GRACE_DAYS.
   */
  | 'grace'
  /** Subscription confirmed over. Read-only + export, forever. */
  | 'lapsed'
  /** Never subscribed — a fresh install that hasn't reached the paywall. */
  | 'none';

export interface EntitlementSnapshot {
  status: EntitlementStatus;
  plan: PlanId | null;
  /** ms epoch the current period ends. null when unknown/not applicable. */
  expiresAt: number | null;
  /** ms epoch of the last SUCCESSFUL billing query, whatever it reported. */
  lastVerifiedAt: number | null;
  /**
   * ISO dates (yyyy-MM-dd) on which billing successfully reported NO
   * entitlement. A downgrade needs two DISTINCT days — see reconcile().
   */
  negativeDays: string[];
}

/**
 * What the app may actually do. Derived from status; never stored, so a tampered
 * snapshot can't invent a capability that the status doesn't imply.
 */
export interface Capabilities {
  /** Always true. Not negotiable. */
  canRead: boolean;
  /** Always true. Their data, their exit. */
  canExport: boolean;
  canWrite: boolean;
  canUseTax: boolean;
  canUseAssistant: boolean;
  /** Search, subscription detection — the analysis layer. */
  canUseInsights: boolean;
}

/** The result of asking the billing layer what it knows. */
export type BillingResult =
  /** A real answer: there is an active entitlement. */
  | { ok: true; entitled: true; plan: PlanId; trialing: boolean; expiresAt: number | null }
  /** A real answer: there is no entitlement. */
  | { ok: true; entitled: false }
  /**
   * We could NOT get an answer — offline, plugin missing, Play Store absent.
   * This must never change the user's status. Ever.
   */
  | { ok: false; reason: string };

export const FRESH_INSTALL: EntitlementSnapshot = {
  status: 'none',
  plan: null,
  expiresAt: null,
  lastVerifiedAt: null,
  negativeDays: [],
};
