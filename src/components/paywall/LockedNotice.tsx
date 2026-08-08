"use client";

/**
 * LockedNotice — what a paid surface shows instead of a broken one.
 *
 * A lapsed user must never meet a screen that looks empty, failed, or like the
 * app forgot them. Three things are therefore non-negotiable here: it names the
 * subscription as the reason, it says out loud that their records are still
 * readable and exportable, and it offers a route back in. Nothing else.
 *
 * Renders null when the capability is available, so a caller can drop it in
 * unconditionally.
 */

import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Lock } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useGate } from './useGate';
import { SUBSCRIBE_ROUTE } from '@/lib/paywall/gate';
import type { Capabilities } from '@/lib/entitlement/types';

interface LockedNoticeProps {
  capability: keyof Capabilities;
  className?: string;
  /** A thin single-line strip, for headers rather than page bodies. */
  compact?: boolean;
  /** Optional extra way out — usually a link back to the raw records. */
  children?: ReactNode;
}

export const LockedNotice = ({
  capability,
  className,
  compact = false,
  children,
}: LockedNoticeProps) => {
  const { check } = useGate();
  const denial = check(capability);
  if (!denial) return null;

  if (compact) {
    return (
      <div
        className={cn(
          'flex items-center gap-2 rounded-xl border border-border/60 bg-muted/30 px-3 py-2',
          className,
        )}
      >
        <Lock className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        <p className="min-w-0 flex-1 text-[11px] leading-snug text-muted-foreground">
          {denial.title}. You can still read and export everything.
        </p>
        <Link
          to={SUBSCRIBE_ROUTE}
          className="pointer-events-auto shrink-0 text-[11px] font-semibold text-primary"
        >
          {denial.cta}
        </Link>
      </div>
    );
  }

  return (
    <div
      className={cn(
        'space-y-3 rounded-2xl border border-border/60 bg-muted/20 p-5 text-center',
        className,
      )}
    >
      <div className="mx-auto flex h-11 w-11 items-center justify-center rounded-2xl bg-primary/10">
        <Lock className="h-5 w-5 text-primary" />
      </div>
      <div className="space-y-1.5">
        <p className="text-sm font-bold text-foreground">{denial.title}</p>
        <p className="mx-auto max-w-sm text-xs leading-relaxed text-muted-foreground">
          {denial.body}
        </p>
      </div>
      <Link
        to={SUBSCRIBE_ROUTE}
        className="pointer-events-auto inline-flex h-9 items-center rounded-xl bg-primary px-4 text-xs font-bold text-primary-foreground"
      >
        {denial.cta}
      </Link>
      {children && <div className="pt-1">{children}</div>}
    </div>
  );
};
