"use client";

/**
 * TrialBanner — a quiet line of fact during the free trial.
 *
 * ── What this deliberately is not ────────────────────────────────────────────
 * It is not a countdown, not amber, not red, and it never says "only 3 days
 * left!". A trial countdown that escalates in colour and urgency is a pressure
 * tactic, and the person reading it is looking at their own money at the time.
 *
 * So it states two facts and stops: the date the trial ends, and what happens
 * on that date. A date is checkable and calm; "3 days left" is neither — it
 * also silently changes meaning depending on what hour you read it.
 *
 * ── Dismissible per day, not forever ─────────────────────────────────────────
 * Dismissing it forever risks the genuine surprise this banner exists to
 * prevent — a charge nobody saw coming. Dismissing it for the rest of today
 * gets it out of the way without ever letting the fact go unstated for long.
 */

import { useState } from 'react';
import { format, isSameDay } from 'date-fns';
import { CalendarClock, X } from 'lucide-react';
import { useEntitlement } from '@/hooks/useEntitlement';
import { dayKey } from '@/lib/entitlement/state';
import { formatFullINR } from '@/lib/currency';

const DISMISS_KEY = 'vidhence_trial_banner_dismissed';

/** Prices repeated here rather than imported, so the banner can be read alone. */
const ANNUAL_PRICE = 799;
const MONTHLY_PRICE = 99;

function readDismissedDay(): string | null {
  try {
    return localStorage.getItem(DISMISS_KEY);
  } catch {
    return null;
  }
}

function writeDismissedDay(day: string): void {
  try {
    localStorage.setItem(DISMISS_KEY, day);
  } catch {
    /* storage blocked — the component state still hides it for this session */
  }
}

export const TrialBanner = () => {
  const { status, expiresAt, snapshot } = useEntitlement();
  const today = dayKey(Date.now());
  const [dismissedDay, setDismissedDay] = useState<string | null>(() => readDismissedDay());

  // Only during the trial, and only when we actually know the end date. Guessing
  // a date would be worse than saying nothing.
  if (status !== 'trialing' || expiresAt === null) return null;
  if (dismissedDay === today) return null;

  const end = new Date(expiresAt);
  const endsToday = isSameDay(end, new Date());
  const price = snapshot.plan === 'monthly' ? MONTHLY_PRICE : ANNUAL_PRICE;
  const per = snapshot.plan === 'monthly' ? 'month' : 'year';

  const dismiss = () => {
    writeDismissedDay(today);
    setDismissedDay(today);
  };

  return (
    <div className="mb-3 flex items-start gap-2.5 rounded-2xl border border-border/60 bg-muted/30 px-3 py-2.5">
      <CalendarClock className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
      <p className="min-w-0 flex-1 text-[11px] leading-relaxed text-muted-foreground">
        Your free trial runs until{' '}
        <span className="font-semibold text-foreground">
          {format(end, 'd MMMM')}
          {endsToday ? ' (today)' : ''}
        </span>
        . Google Play then charges {formatFullINR(price)} for the first {per}. Cancel any time
        before then in Play → Subscriptions and you won’t be charged.
      </p>
      <button
        type="button"
        onClick={dismiss}
        aria-label="Hide this for today"
        className="pointer-events-auto -mr-1 -mt-0.5 shrink-0 rounded-lg p-1 text-muted-foreground/70 hover:text-foreground"
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  );
};
