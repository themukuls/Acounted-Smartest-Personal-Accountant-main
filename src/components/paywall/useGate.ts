"use client";

/**
 * useGate — how a paid surface actually refuses.
 *
 * The rule for every caller: `guard()` is the FIRST statement inside the
 * handler, before any state is set, any dialog is opened and any write is
 * issued. Hiding or disabling the control is presentation; this is the gate.
 * If the two ever disagree — a stale render, a keyboard shortcut, a deep link,
 * a second call site nobody remembered — the handler is the one that decides.
 *
 *     const handleSave = async () => {
 *       if (!guard('canWrite')) return;   // ← always here, never only in JSX
 *       …
 *     };
 */

import { useCallback } from 'react';
import { useToast } from '@/hooks/use-toast';
import { useEntitlement } from '@/hooks/useEntitlement';
import { checkGate, type GateDenial } from '@/lib/paywall/gate';
import type { Capabilities, EntitlementStatus } from '@/lib/entitlement/types';

export interface UseGate {
  /** The denial, or null when the action may proceed. */
  check: (capability: keyof Capabilities) => GateDenial | null;
  /**
   * True when allowed. When not, shows the explanation and returns false, so
   * the handler's guard clause is a single readable line.
   *
   * Deliberately NOT a destructive-variant toast: an expired subscription is a
   * fact about billing, not a mistake the user just made.
   */
  guard: (capability: keyof Capabilities) => boolean;
  capabilities: Capabilities;
  status: EntitlementStatus;
}

export function useGate(): UseGate {
  const { capabilities, status } = useEntitlement();
  const { toast } = useToast();

  const check = useCallback(
    (capability: keyof Capabilities) => checkGate(capability, capabilities, status),
    [capabilities, status],
  );

  const guard = useCallback(
    (capability: keyof Capabilities) => {
      const denial = check(capability);
      if (!denial) return true;
      toast({ title: denial.title, description: denial.body });
      return false;
    },
    [check, toast],
  );

  return { check, guard, capabilities, status };
}
