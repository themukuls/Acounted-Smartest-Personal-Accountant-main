"use client";

import { useCallback, useEffect, useMemo, useState } from 'react';
import { format } from 'date-fns';
import {
  AlertCircle,
  Check,
  ChevronLeft,
  FileDown,
  Loader2,
  Lock,
  ShieldCheck,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useEntitlement } from '@/hooks/useEntitlement';
import { getBillingAdapter } from '@/lib/entitlement/adapter';
import { LOCAL_TRIAL_DAYS } from '@/lib/entitlement/state';
import type { BillingPlanDetails, BillingResult, PlanId } from '@/lib/entitlement/types';
import { cn } from '@/lib/utils';

export interface PaywallScreenProps {
  onSubscribed: (plan: PlanId) => void;
  onLocalTrialStarted?: () => void;
  onDismiss?: () => void;
  variant?: 'onboarding' | 'lapsed';
  embedded?: boolean;
}

const INCLUDED = [
  'Log and edit income and expenses',
  'Automatic payment capture and expense reconciliation',
  'Voice quick-add, search and subscription detection',
  'Read and export your records even after access ends',
];

type Notice = { tone: 'neutral' | 'warn'; title: string; detail: string };

function noticeFor(result: BillingResult): Notice {
  if (result.kind === 'cancelled') {
      return {
        tone: 'neutral',
        title: 'Purchase cancelled',
        detail: 'Nothing was charged. You can subscribe or start the no-card trial whenever you are ready.',
      };
  }
  if (result.kind === 'pending') {
      return {
        tone: 'neutral',
        title: 'Payment is pending',
        detail: 'Google Play is still processing it. Access will unlock when Play confirms the payment.',
      };
  }

  return {
    tone: 'warn',
    title: result.kind === 'unavailable' ? 'Google Play is unavailable' : 'Purchase not completed',
    detail: `${'reason' in result ? result.reason : 'Google Play did not confirm access.'} Nothing was charged.`,
  };
}

export const PaywallScreen = ({
  onSubscribed,
  onLocalTrialStarted,
  onDismiss,
  variant = 'onboarding',
  embedded = false,
}: PaywallScreenProps) => {
  const { purchase, restore, startLocalTrial, snapshot } = useEntitlement();
  const [plans, setPlans] = useState<BillingPlanDetails[]>([]);
  const [catalogLoading, setCatalogLoading] = useState(true);
  const [selected, setSelected] = useState<PlanId>('annual');
  const [busy, setBusy] = useState<'purchase' | 'restore' | 'trial' | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);

  const loadCatalog = useCallback(async () => {
    setCatalogLoading(true);
    try {
      const next = await getBillingAdapter().plans();
      setPlans(next);
      setSelected((current) =>
        next.some((item) => item.plan === current) ? current : (next[0]?.plan ?? 'annual'),
      );
    } catch {
      setPlans([]);
    } finally {
      setCatalogLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadCatalog();
  }, [loadCatalog]);

  const plan = useMemo(() => plans.find((item) => item.plan === selected), [plans, selected]);
  const lapsed = variant === 'lapsed';
  const localTrialAvailable = !snapshot.localTrialUsed && snapshot.localTrialStartedAt === null;

  const handlePurchase = async () => {
    if (!plan || busy) return;
    setBusy('purchase');
    setNotice(null);
    const result = await purchase(plan.plan);
    setBusy(null);
    if (result.ok && result.entitled) onSubscribed(plan.plan);
    else setNotice(noticeFor(result));
  };

  const handleRestore = async () => {
    if (busy) return;
    setBusy('restore');
    setNotice(null);
    const result = await restore();
    setBusy(null);
    if (result.ok && result.entitled && result.plan) onSubscribed(result.plan);
    else {
      setNotice(
        result.ok
          ? { tone: 'neutral', title: 'No active purchase found', detail: 'Use the Google account that originally subscribed, or choose a plan below.' }
          : noticeFor(result),
      );
    }
  };

  const handleLocalTrial = async () => {
    if (busy) return;
    setBusy('trial');
    setNotice(null);
    const started = await startLocalTrial();
    setBusy(null);
    if (started) onLocalTrialStarted?.();
    else setNotice({ tone: 'neutral', title: 'Trial already used', detail: 'Choose a Google Play plan to continue using Pro actions.' });
  };

  const renewalCopy = plan
    ? plan.trialEligible
      ? `${plan.trialDays} days free through Google Play, then ${plan.priceLabel} ${plan.billingPeriod} until cancelled.`
      : `${plan.priceLabel} ${plan.billingPeriod}, charged by Google Play and renewed automatically until cancelled.`
    : 'Google Play will show the exact price and terms before you confirm.';

  return (
    <div
      className={cn('w-full overflow-y-auto bg-background', !embedded && 'min-h-screen')}
      style={embedded ? undefined : {
        paddingTop: 'calc(1.25rem + env(safe-area-inset-top, 0px))',
        paddingBottom: 'calc(1.5rem + env(safe-area-inset-bottom, 0px))',
      }}
    >
      <div className={cn('mx-auto w-full max-w-md space-y-5', !embedded && 'px-5')}>
        {onDismiss && (
          <button type="button" onClick={onDismiss} className="-ml-1 flex items-center gap-1 rounded-xl py-1 pr-2 text-xs font-semibold text-muted-foreground hover:text-foreground">
            <ChevronLeft className="h-4 w-4" /> Back to my records
          </button>
        )}

        <div className="space-y-2">
          <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-primary/10">
            <ShieldCheck className="h-5 w-5 text-primary" />
          </div>
          <h1 className="text-2xl font-black leading-tight tracking-tight text-foreground">
            {lapsed ? 'Continue with Acounted Pro' : 'Choose how you want to start'}
          </h1>
          <p className="text-sm leading-relaxed text-muted-foreground">
            {lapsed
              ? snapshot.trialSource === 'local'
                ? 'Your free trial ended. Your records remain available; subscribe to unlock adding, search, voice and automatic capture.'
                : 'Your paid access ended. Your records remain available; choose a plan to unlock Pro actions again.'
              : `Subscribe through Google Play now, or continue with a one-time ${LOCAL_TRIAL_DAYS}-day trial without adding a payment method.`}
          </p>
        </div>

        <div className="space-y-2.5">
          {catalogLoading ? (
            <div className="flex items-center justify-center rounded-2xl border border-border/60 p-6 text-xs text-muted-foreground">
              <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Loading Google Play plans…
            </div>
          ) : plans.length > 0 ? (
            plans.map((item) => {
              const active = item.plan === selected;
              return (
                <button
                  key={item.plan}
                  type="button"
                  onClick={() => setSelected(item.plan)}
                  aria-pressed={active}
                  className={cn('flex w-full items-start gap-3 rounded-2xl border-2 p-4 text-left transition-all', active ? 'border-primary bg-primary/5' : 'border-border/60 hover:border-primary/40')}
                >
                  <span className={cn('mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2', active ? 'border-primary bg-primary' : 'border-border')}>
                    {active && <Check className="h-3 w-3 text-primary-foreground" strokeWidth={3} />}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-baseline justify-between gap-2">
                      <span className="text-sm font-bold text-foreground">{item.plan === 'annual' ? 'Yearly' : 'Monthly'}</span>
                      <span className="text-base font-black text-foreground">{item.priceLabel}</span>
                    </span>
                    <span className="mt-1 block text-[11px] leading-relaxed text-muted-foreground">
                      {item.trialEligible ? `${item.trialDays}-day Play trial, then ` : ''}{item.priceLabel} {item.billingPeriod}. Auto-renews until cancelled.
                    </span>
                  </span>
                </button>
              );
            })
          ) : (
            <div className="rounded-2xl border border-border/60 bg-muted/30 p-4 text-xs leading-relaxed text-muted-foreground">
              Google Play plans are not available on this installation. Install the testing build from Google Play with an eligible tester account, then retry.
              <button type="button" onClick={() => void loadCatalog()} className="ml-1 font-bold text-primary">Retry</button>
            </div>
          )}
        </div>

        <ul className="space-y-1.5">
          {INCLUDED.map((item) => (
            <li key={item} className="flex items-start gap-2 text-xs leading-relaxed text-foreground">
              <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" strokeWidth={3} /> {item}
            </li>
          ))}
        </ul>

        {notice && (
          <div role="status" className={cn('flex items-start gap-2.5 rounded-2xl border p-3', notice.tone === 'warn' ? 'border-amber-500/30 bg-amber-500/5' : 'border-border/60 bg-muted/40')}>
            <AlertCircle className={cn('mt-0.5 h-4 w-4 shrink-0', notice.tone === 'warn' ? 'text-amber-600' : 'text-muted-foreground')} />
            <div><p className="text-xs font-semibold text-foreground">{notice.title}</p><p className="mt-0.5 text-[11px] leading-relaxed text-muted-foreground">{notice.detail}</p></div>
          </div>
        )}

        <div className="space-y-2.5">
          <p className="text-[11px] leading-relaxed text-muted-foreground">{renewalCopy}</p>
          <Button onClick={() => void handlePurchase()} disabled={Boolean(busy) || !plan} className="h-12 w-full rounded-2xl text-sm font-bold">
            {busy === 'purchase' ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Opening Google Play…</> : plan?.trialEligible ? `Start ${plan.trialDays}-day Play trial` : plan ? `Subscribe — ${plan.priceLabel}` : 'Google Play plan unavailable'}
          </Button>

          {localTrialAvailable && !lapsed && (
            <button type="button" disabled={Boolean(busy)} onClick={() => void handleLocalTrial()} className="w-full rounded-xl border border-border/70 py-3 text-xs font-bold text-foreground disabled:opacity-50">
              {busy === 'trial' ? 'Starting trial…' : `Not ready to pay? Try ${LOCAL_TRIAL_DAYS} days without a payment method`}
            </button>
          )}

          <button type="button" disabled={Boolean(busy)} onClick={() => void handleRestore()} className="w-full py-1 text-center text-xs font-semibold text-primary disabled:opacity-50">
            {busy === 'restore' ? 'Checking Google Play…' : 'Restore an existing purchase'}
          </button>

          <div className="flex items-start gap-2 pt-1">
            <Lock className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
            <p className="text-[11px] leading-relaxed text-muted-foreground">
              Google Play shows the final price and charge date before confirmation. Subscriptions renew automatically. Cancel in Play Store → profile → Payments &amp; subscriptions → Subscriptions → Acounted. Cancelling a Play trial keeps access until its displayed end date and prevents the first charge.
            </p>
          </div>
          {snapshot.trialSource === 'play' && snapshot.expiresAt && (
            <p className="text-[11px] text-muted-foreground">Current Play access is scheduled through {format(new Date(snapshot.expiresAt), 'd MMMM yyyy')}.</p>
          )}
          <div className="flex items-start gap-2 rounded-2xl border border-border/60 bg-muted/30 p-3">
            <FileDown className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
            <p className="text-[11px] leading-relaxed text-foreground"><span className="font-semibold">Reading and exporting are never locked.</span> Your financial records remain on your phone if a trial or subscription ends.</p>
          </div>
        </div>

        {onDismiss && (
          <button type="button" onClick={onDismiss} className="w-full rounded-xl py-2 text-center text-xs font-semibold text-muted-foreground hover:text-foreground">
            Not now — take me to my records
          </button>
        )}
      </div>
    </div>
  );
};
