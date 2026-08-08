/**
 * gate.ts — one decision, one sentence, for every paid surface.
 *
 * Pure. No React, no I/O, no storage. The UI calls `checkGate()` at the top of
 * the HANDLER — not in the JSX — so that hiding a button and blocking the work
 * are never two different truths. If a button is ever left visible by mistake,
 * the handler still refuses.
 *
 * ── The rule this file is built around ───────────────────────────────────────
 * `canRead` and `canExport` are short-circuited to "allowed" before the
 * capability object is even consulted. A tampered, stale or plain buggy
 * Capabilities value therefore CANNOT lock someone out of their own financial
 * records — the only way to deny reading would be to add a new branch here, and
 * a test asserts that branch doesn't exist.
 */

import type { Capabilities, EntitlementStatus } from '@/lib/entitlement/types';

/** The four capabilities that are fair to gate. */
export type PaidCapability = 'canWrite' | 'canUseTax' | 'canUseAssistant' | 'canUseInsights';

/** Capabilities no status, and no bug, may ever deny. */
export const NEVER_GATED = ['canRead', 'canExport'] as const;
export type NeverGated = (typeof NEVER_GATED)[number];

export const PAID_CAPABILITIES: PaidCapability[] = [
  'canWrite',
  'canUseTax',
  'canUseAssistant',
  'canUseInsights',
];

/** Everything a locked surface needs to explain itself, in the user's words. */
export interface GateDenial {
  capability: PaidCapability;
  status: EntitlementStatus;
  /** Short heading. Never accusatory, never a countdown. */
  title: string;
  /** What is paused, and — always — what still works. */
  body: string;
  /** Label for the way out. The route is always /subscribe. */
  cta: string;
}

/** Where every locked surface sends the user. One route, so it can't rot. */
export const SUBSCRIBE_ROUTE = '/subscribe';

/** What each capability actually is, named the way the screen names it. */
const SUBJECT: Record<PaidCapability, string> = {
  canWrite: 'Adding, editing and deleting entries',
  canUseTax: 'The tax copilot',
  canUseAssistant: 'The voice assistant',
  canUseInsights: 'Search and subscription detection',
};

/**
 * Said on every single denial, without exception.
 *
 * A person who stops paying has not stopped owning their records, and the one
 * sentence that makes a paywall feel like a wall rather than a hostage note is
 * the one that tells them their data is still theirs.
 */
export const READ_PROMISE =
  'Everything you have already logged stays here — you can read it and export it at any time.';

function denialFor(capability: PaidCapability, status: EntitlementStatus): GateDenial {
  const lapsed = status === 'lapsed';
  return {
    capability,
    status,
    title: lapsed ? 'Your subscription ended' : 'Included with a subscription',
    body: lapsed
      ? `${SUBJECT[capability]} is paused. ${READ_PROMISE}`
      : `${SUBJECT[capability]} needs an active subscription. ${READ_PROMISE}`,
    cta: lapsed ? 'Resubscribe' : 'See plans',
  };
}

/**
 * The gate. Returns `null` when the action may proceed, or the copy to show
 * when it may not.
 *
 * Call it FIRST THING inside the handler:
 *
 *     const denial = checkGate('canWrite', capabilities, status);
 *     if (denial) { toast(denial); return; }
 *
 * Not in a `disabled=` prop, and not only in a conditional render.
 */
export function checkGate(
  capability: keyof Capabilities,
  capabilities: Capabilities,
  status: EntitlementStatus,
): GateDenial | null {
  // Short-circuited BEFORE the lookup, on purpose. See the file header.
  if (capability === 'canRead' || capability === 'canExport') return null;
  if (capabilities[capability]) return null;
  return denialFor(capability as PaidCapability, status);
}

/** Convenience for JSX that wants to render a locked panel instead of content. */
export function isLocked(
  capability: keyof Capabilities,
  capabilities: Capabilities,
  status: EntitlementStatus,
): boolean {
  return checkGate(capability, capabilities, status) !== null;
}
