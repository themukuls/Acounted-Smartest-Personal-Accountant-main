"use client";

/**
 * PaywallScreen — the offer.
 *
 * The prop contract is FINAL and is what OnboardingModal imports. Do not change
 * the props without updating every caller.
 *
 * ── Why the price, the renewal period and the cancellation route are all
 *    above the fold, in body text, before anything is tappable ───────────────
 * Google Play's subscription policy requires that a user can see what they will
 * be charged, how often it recurs, and how to cancel BEFORE the purchase flow
 * starts. Burying any of the three in fine print, or behind a "details" toggle,
 * is one of the most common reasons a subscription app is rejected. So the
 * three facts are plain sentences at the same size as everything else, and the
 * selected plan restates them directly above the button that starts billing.
 *
 * ── Why the annual saving is a rupee figure and not a percentage badge ───────
 * "Save 33%!" is a number the reader has to trust. "₹99.00 a month is ₹1,188.00
 * over a year — the annual plan costs ₹389.00 less" is a number they can check.
 * Both plans are shown at full price with no default-selected trap.
 *
 * ── Failure is a message, never a dead button ───────────────────────────────
 * Three genuinely different things can go wrong and they must not be conflated:
 * the user backed out (nothing charged, no apology needed), the store could not
 * be reached at all (their fault-free, retryable), or Play returned a real "no"
 * (a payment method problem they have to fix in Play, not here).
 */

import { useState } from 'react';
import { useEntitlement } from '@/hooks/useEntitlement';
import { formatFullINR } from '@/lib/currency';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import {
  Check,
  ChevronLeft,
  Loader2,
  Lock,
  AlertCircle,
  FileDown,
  ShieldCheck,
} from 'lucide-react';
import type { BillingResult, PlanId } from '@/lib/entitlement/types';

export interface PaywallScreenProps {
  /** Fires once billing has confirmed an entitlement. */
  onSubscribed: (plan: PlanId) => void;
  /**
   * Present only where backing out is allowed — i.e. a lapsed user who reached
   * this from inside the app and must still be able to read and export their
   * own records. Undefined during first-run onboarding.
   */
  onDismiss?: () => void;
  /** Copy shifts between "start your trial" and "come back". */
  variant?: 'onboarding' | 'lapsed';
}

/** Mirrors the base plans in Play Console. Changing these changes nothing in
 *  Play — the store is the source of truth for what is actually charged. */
const ANNUAL_PRICE = 799;
const MONTHLY_PRICE = 99;
const TRIAL_DAYS = 14;

/** The comparison, computed rather than asserted, so it can't drift. */
const MONTHLY_OVER_A_YEAR = MONTHLY_PRICE * 12; // ₹1,188
const ANNUAL_SAVING = MONTHLY_OVER_A_YEAR - ANNUAL_PRICE; // ₹389

interface PlanCopy {
  id: PlanId;
  name: string;
  price: number;
  /** Singular, as it appears after the slash. */
  per: string;
  /** The renewal sentence Play requires, in full. */
  renewal: string;
}

const PLANS: PlanCopy[] = [
  {
    id: 'annual',
    name: 'Yearly',
    price: ANNUAL_PRICE,
    per: 'year',
    renewal: `Renews automatically every 12 months at ${formatFullINR(ANNUAL_PRICE)} until you cancel.`,
  },
  {
    id: 'monthly',
    name: 'Monthly',
    price: MONTHLY_PRICE,
    per: 'month',
    renewal: `Renews automatically every month at ${formatFullINR(MONTHLY_PRICE)} until you cancel.`,
  },
];

const INCLUDED = [
  'Log income and expenses, and edit them later',
  'The tax copilot, regime comparison and ITR draft',
  'Voice quick-add',
  'Search and automatic subscription detection',
];

type Failure = { tone: 'neutral' | 'warn'; title: string; detail: string };

/** Turn a BillingResult into something a person can act on. */
function failureFor(result: BillingResult): Failure {
  // `in` rather than a `!result.ok` discriminant check: this project compiles
  // with strictNullChecks off, which weakens narrowing on the boolean tag.
  if ('reason' in result) {
    return {
      tone: 'warn',
      title: 'Couldn’t reach the Play Store',
      detail: `${result.reason} Nothing has been charged. Check your connection and try again.`,
    };
  }
  // ok, but not entitled: the flow ran and ended without a subscription. By far
  // the most common cause is the user backing out, and treating that as an
  // error would be both wrong and rude.
  return {
    tone: 'neutral',
    title: 'Nothing was charged',
    detail:
      'The purchase didn’t go through — you may have cancelled it, or Play may need a payment method added to your account. You can try again whenever you like.',
  };
}

export const PaywallScreen = ({
  onSubscribed,
  onDismiss,
  variant = 'onboarding',
}: PaywallScreenProps) => {
  const { purchase } = useEntitlement();
  const [selected, setSelected] = useState<PlanId>('annual');
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<Failure | null>(null);

  const lapsed = variant === 'lapsed';
  const plan = PLANS.find((p) => p.id === selected)!;

  const handleSubscribe = async () => {
    if (busy) return;
    setBusy(true);
    setFailure(null);
    const result = await purchase(selected);
    setBusy(false);

    if (result.ok && result.entitled) {
      onSubscribed(selected);
      return;
    }
    setFailure(failureFor(result));
  };

  return (
    <div
      className="min-h-screen w-full overflow-y-auto bg-background"
      style={{
        paddingTop: 'calc(1.25rem + env(safe-area-inset-top, 0px))',
        paddingBottom: 'calc(1.5rem + env(safe-area-inset-bottom, 0px))',
      }}
    >
      <div className="mx-auto w-full max-w-md space-y-5 px-5">

        {/* ── Back out ───────────────────────────────────────────────────
            Only rendered when dismissal is legitimate. A lapsed user MUST be
            able to get to their own records from here, so this is not a
            decorative X — it is the thing that keeps the screen from being a
            hostage note. */}
        {onDismiss && (
          <button
            type="button"
            onClick={onDismiss}
            className="pointer-events-auto -ml-1 flex items-center gap-1 rounded-xl py-1 pr-2 text-xs font-semibold text-muted-foreground hover:text-foreground"
          >
            <ChevronLeft className="h-4 w-4" />
            Back to my records
          </button>
        )}

        {/* ── Headline ───────────────────────────────────────────────── */}
        <div className="space-y-2 pt-1">
          <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-primary/10">
            <ShieldCheck className="h-5 w-5 text-primary" />
          </div>
          <h1 className="text-2xl font-black leading-tight tracking-tight text-foreground">
            {lapsed ? 'Come back any time' : `${TRIAL_DAYS} days free, then choose a plan`}
          </h1>
          <p className="text-sm leading-relaxed text-muted-foreground">
            {lapsed
              ? 'Your subscription has ended, so adding entries, the tax copilot, the assistant and search are paused. Your records are untouched — pick a plan below and everything switches back on.'
              : `Try everything for ${TRIAL_DAYS} days. Google asks for a payment method up front; nothing is charged until the ${TRIAL_DAYS} days are up, and cancelling before then costs nothing.`}
          </p>
        </div>

        {/* ── Plans ──────────────────────────────────────────────────────
            Both prices visible at once, at the same weight. The yearly card
            is pre-selected but the monthly one is a full, equal option. */}
        <div className="space-y-2.5">
          {PLANS.map((p) => {
            const isSelected = p.id === selected;
            return (
              <button
                key={p.id}
                type="button"
                onClick={() => setSelected(p.id)}
                aria-pressed={isSelected}
                className={cn(
                  'pointer-events-auto flex w-full items-start gap-3 rounded-2xl border-2 p-4 text-left transition-all',
                  isSelected
                    ? 'border-primary bg-primary/5 shadow-sm'
                    : 'border-border/60 bg-background/60 hover:border-primary/40',
                )}
              >
                <div
                  className={cn(
                    'mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2',
                    isSelected ? 'border-primary bg-primary' : 'border-border',
                  )}
                >
                  {isSelected && <Check className="h-3 w-3 text-primary-foreground" strokeWidth={3} />}
                </div>

                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline justify-between gap-2">
                    <p className="text-sm font-bold text-foreground">{p.name}</p>
                    <p className="text-base font-black tracking-tight text-foreground">
                      {formatFullINR(p.price)}
                      <span className="text-xs font-semibold text-muted-foreground"> / {p.per}</span>
                    </p>
                  </div>
                  <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
                    {p.renewal}
                  </p>
                </div>
              </button>
            );
          })}

          {/* The saving, as arithmetic anyone can check. */}
          <p className="px-1 text-[11px] leading-relaxed text-muted-foreground">
            {formatFullINR(MONTHLY_PRICE)} a month comes to {formatFullINR(MONTHLY_OVER_A_YEAR)}{' '}
            over a year. The yearly plan is {formatFullINR(ANNUAL_SAVING)} less.
          </p>
        </div>

        {/* ── What you get ───────────────────────────────────────────── */}
        <ul className="space-y-1.5">
          {INCLUDED.map((item) => (
            <li key={item} className="flex items-start gap-2">
              <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" strokeWidth={3} />
              <span className="text-xs leading-relaxed text-foreground">{item}</span>
            </li>
          ))}
        </ul>

        {/* ── The promise that outranks the offer ─────────────────────── */}
        <div className="flex items-start gap-2.5 rounded-2xl border border-border/60 bg-muted/30 p-3">
          <FileDown className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
          <p className="text-[11px] leading-relaxed text-foreground">
            <span className="font-semibold">Reading and exporting are never locked.</span>{' '}
            If you cancel, or a payment fails, or you simply stop paying, you keep
            opening the app and reading every entry you have ever logged — and you
            can take it all out as a file. That doesn’t expire.
          </p>
        </div>

        {/* ── Failure ────────────────────────────────────────────────────
            Sits directly above the button, so the retry is where the eye
            already is. */}
        {failure && (
          <div
            role="status"
            className={cn(
              'flex items-start gap-2.5 rounded-2xl border p-3',
              failure.tone === 'warn'
                ? 'border-amber-500/30 bg-amber-500/5'
                : 'border-border/60 bg-muted/40',
            )}
          >
            <AlertCircle
              className={cn(
                'mt-0.5 h-4 w-4 shrink-0',
                failure.tone === 'warn' ? 'text-amber-600' : 'text-muted-foreground',
              )}
            />
            <div className="min-w-0">
              <p className="text-xs font-semibold text-foreground">{failure.title}</p>
              <p className="mt-0.5 text-[11px] leading-relaxed text-muted-foreground">
                {failure.detail}
              </p>
            </div>
          </div>
        )}

        {/* ── Commit ─────────────────────────────────────────────────────
            Everything Play requires is restated here, immediately above the
            control that starts billing — not only at the top of the page. */}
        <div className="space-y-2.5">
          <p className="text-[11px] leading-relaxed text-muted-foreground">
            {lapsed
              ? `You’ll be charged ${formatFullINR(plan.price)} today, then ${formatFullINR(plan.price)} every ${plan.per} until you cancel.`
              : `Free for ${TRIAL_DAYS} days. After that, ${formatFullINR(plan.price)} every ${plan.per} until you cancel.`}
          </p>

          <Button
            onClick={() => void handleSubscribe()}
            disabled={busy}
            className="pointer-events-auto h-12 w-full rounded-2xl text-sm font-bold"
          >
            {busy ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Opening Google Play…
              </>
            ) : lapsed ? (
              `Resubscribe — ${formatFullINR(plan.price)} / ${plan.per}`
            ) : (
              `Start my ${TRIAL_DAYS} free days`
            )}
          </Button>

          {failure && (
            <p className="text-center text-[11px] text-muted-foreground">
              Nothing has been charged.
            </p>
          )}

          {/* How to cancel — required before the purchase flow, so it is here
              and not on a settings screen the user hasn't reached yet. */}
          <div className="flex items-start gap-2 pt-1">
            <Lock className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
            <p className="text-[11px] leading-relaxed text-muted-foreground">
              Billing is handled by Google Play. To cancel, open the Play Store →
              your profile picture → <span className="text-foreground">Payments &amp; subscriptions</span>{' '}
              → <span className="text-foreground">Subscriptions</span> → Acounted →{' '}
              <span className="text-foreground">Cancel subscription</span>. Cancel at least 24 hours
              before the renewal date to avoid the next charge. You keep access until the period you
              have paid for ends.
            </p>
          </div>
        </div>

        {/* ── Second way out ─────────────────────────────────────────────
            Repeated at the bottom because a lapsed user who scrolled past the
            top one should not have to scroll back up to reach their data. */}
        {onDismiss && (
          <button
            type="button"
            onClick={onDismiss}
            className="pointer-events-auto w-full rounded-xl py-2 text-center text-xs font-semibold text-muted-foreground hover:text-foreground"
          >
            Not now — take me to my records
          </button>
        )}
      </div>
    </div>
  );
};
