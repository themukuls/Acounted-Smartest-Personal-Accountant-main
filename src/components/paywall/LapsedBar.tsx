"use client";

/**
 * LapsedBar — the one permanent, app-wide route back for a lapsed user.
 *
 * ── Why it isn't dismissible ─────────────────────────────────────────────────
 * Every other paywall surface in the app is a dead end without it: the mic FAB
 * is hidden, the write handlers refuse, the tax chat is paused. If this could
 * be dismissed for good, a user could end up in an app that quietly does less
 * than it used to with no visible explanation and nothing to tap. It stays.
 *
 * ── Why it isn't red ─────────────────────────────────────────────────────────
 * Nothing has gone wrong. A subscription ended, which is a normal thing that
 * people choose. It reads as information with an offer attached, and it leads
 * with the sentence that matters most — the records are still theirs.
 */

import { Link } from 'react-router-dom';
import { Lock } from 'lucide-react';
import { useEntitlement } from '@/hooks/useEntitlement';
import { SUBSCRIBE_ROUTE } from '@/lib/paywall/gate';

export const LapsedBar = () => {
  const { status, snapshot } = useEntitlement();
  if (status !== 'lapsed') return null;

  const localTrialEnded = snapshot.trialSource === 'local';

  return (
    <div className="mb-3 flex items-start gap-2.5 rounded-2xl border border-primary/20 bg-primary/5 px-3 py-2.5">
      <Lock className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" />
      <p className="min-w-0 flex-1 text-[11px] leading-relaxed text-muted-foreground">
        <span className="font-semibold text-foreground">
          {localTrialEnded ? 'Your free trial ended.' : 'Your subscription ended.'}
        </span>{' '}
        Everything you have logged is still here to read and export — adding entries,
        automatic capture, the assistant and search are paused until you resubscribe.
      </p>
      <Link
        to={SUBSCRIBE_ROUTE}
        className="pointer-events-auto mt-0.5 shrink-0 text-[11px] font-bold text-primary"
      >
        {localTrialEnded ? 'Subscribe' : 'Resubscribe'}
      </Link>
    </div>
  );
};
