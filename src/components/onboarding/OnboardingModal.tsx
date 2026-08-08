"use client";

/**
 * OnboardingModal — the six-screen funnel that has to earn a payment method.
 *
 * ── Why this is not a form ───────────────────────────────────────────────────
 *
 * The trial requires a card BEFORE the first use of the app, so onboarding is
 * the only place the persuasion can happen. What was here before did the
 * opposite: three steps of data entry (income → expenses → investments) whose
 * very first field asked a stranger for their annual salary, in exchange for
 * nothing. That is a form wearing marketing copy, and it converts nobody who
 * is being asked to pay ₹799 on the same visit.
 *
 * The order below is deliberate and load-bearing:
 *
 *   1  founder   — one person, one grievance. (Placeholder copy; see the file.)
 *   2  refuse    — what the app will not do. Trust BEFORE the ask; this is
 *                  the actual differentiator, not a feature.
 *   3  get       — three concrete things, tax first because it is the one
 *                  with a deadline and a rupee figure attached.
 *   4  offer     — PaywallScreen, owned by another module. Imported, never
 *                  reimplemented; its prop contract is final.
 *   5  income    — ONE question, with the reason attached, and Skip as a real
 *                  button. The old income/expenses/investment steps are gone
 *                  from this flow entirely — they belong in the app, asked at
 *                  the moment they matter.
 *   6  moment    — the app does its job once, on that one number, before the
 *                  user ever sees an empty ledger.
 *
 * ── Returning users ──────────────────────────────────────────────────────────
 * `forceStartStepZero` is how MobileHeader and WelcomeHeader open this for
 * "Update Financial Details". Someone who already has the app has already been
 * sold; making them sit through the pitch again to change one number would be
 * insulting. That path — and anyone whose onboarding is already marked
 * complete — gets screens 5 and 6 only.
 *
 * ── Copy rules this file is held to ──────────────────────────────────────────
 * Acknowledge the discomfort. State the reason at the moment of asking. Never
 * shame — no red, no warnings, no "you overspent" (same guard as
 * src/lib/nudges/rules.ts). If a field is skippable it must look skippable.
 * No exclamation marks and no mission statements.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';
import { auth } from '@/integrations/indexeddb/auth';
import { useQueryClient } from '@tanstack/react-query';
import {
  getIncomeDetails,
  saveIncomeDetails,
} from '@/integrations/indexeddb/services/onboardingService';

import { PaywallScreen } from '@/components/paywall/PaywallScreen';
import { FounderNote } from './screens/FounderNote';
import { WhatWeRefuse } from './screens/WhatWeRefuse';
import { WhatYouGet } from './screens/WhatYouGet';
import { IncomeQuestion } from './screens/IncomeQuestion';
import { ValueMoment } from './screens/ValueMoment';

interface OnboardingModalProps {
  open: boolean;
  onComplete: () => void;
  onClose?: () => void;
  /**
   * Opened from the header's "Update Financial Details". Kept under its
   * original name so the two existing call sites need no change; it now means
   * "this person already has the app — skip the pitch".
   */
  forceStartStepZero?: boolean;
}

type ScreenId = 'founder' | 'refuse' | 'get' | 'offer' | 'income' | 'moment';

/**
 * Screen headings. Body copy lives in each screen component so a copy change
 * is a one-file change; only the heading and the line under it are here,
 * because the modal chrome renders them.
 */
const SCREEN_COPY: Record<ScreenId, { title: string; lede?: string }> = {
  founder: {
    title: 'Before you decide anything',
    // The discomfort, named. Naming it is what disarms it — and it is said in
    // the app's voice, above the founder's note rather than inside it.
    lede: "Most people avoid opening apps like this. That's fair — money apps are usually where you go to feel bad about yourself. This one has about two minutes to convince you otherwise.",
  },
  refuse: { title: 'What this app refuses to do' },
  get: { title: 'What you actually get' },
  offer: { title: '' },
  income: {
    title: 'Roughly what lands in your account each month?',
  },
  moment: {
    title: 'One thing, before you see an empty screen',
  },
};

/**
 * Screen 6's heading depends on whether there is anything to show. Promising
 * a value moment and then delivering the empty state under the same heading
 * would read as a bait — so the skipped path gets its own, quieter title.
 */
const MOMENT_TITLE_WHEN_SKIPPED = "That's everything I'll ask";

const FULL_FLOW: ScreenId[] = ['founder', 'refuse', 'get', 'offer', 'income', 'moment'];
const RETURNING_FLOW: ScreenId[] = ['income', 'moment'];

export const OnboardingModal = ({
  open,
  onComplete,
  onClose,
  forceStartStepZero = false,
}: OnboardingModalProps) => {
  const { user, refreshUser } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [index, setIndex] = useState(0);
  const [dataLoading, setDataLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  /** Raw field value on screen 5. */
  const [monthlyInput, setMonthlyInput] = useState('');
  /**
   * What screen 6 is allowed to use: the number actually committed, or null
   * when the question was skipped. Deliberately separate from `monthlyInput`
   * so a half-typed value that was then skipped can never become a "result".
   */
  const [committedMonthly, setCommittedMonthly] = useState<number | null>(null);

  const alreadyOnboarded = Boolean((user as { onboarding_completed?: boolean } | null)?.onboarding_completed);
  const isReturning = forceStartStepZero || alreadyOnboarded;
  const flow = useMemo(() => (isReturning ? RETURNING_FLOW : FULL_FLOW), [isReturning]);

  const screen = flow[Math.min(index, flow.length - 1)];

  // Load whatever income figure already exists, so a returning user sees their
  // own number rather than an empty box.
  useEffect(() => {
    if (!open) return;

    let cancelled = false;
    setIndex(0);
    setCommittedMonthly(null);

    // No session yet (first render after signup, or a preview harness). Nothing
    // to prefill — but the skeleton must still come down, or screens 5 and 6
    // would sit on a loading state forever.
    if (!user) {
      setMonthlyInput('');
      setDataLoading(false);
      return;
    }

    setDataLoading(true);

    (async () => {
      try {
        const existing = await getIncomeDetails(user.id);
        if (cancelled) return;
        const salary = existing?.monthly_salary;
        if (typeof salary === 'number' && Number.isFinite(salary) && salary > 0) {
          setMonthlyInput(String(salary));
        } else {
          setMonthlyInput('');
        }
      } catch (error) {
        console.error('Error loading income details:', error);
        if (!cancelled) setMonthlyInput('');
      } finally {
        if (!cancelled) setDataLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [open, user, forceStartStepZero]);

  const invalidate = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ['monthlyBudgetSummary'] });
    queryClient.invalidateQueries({ queryKey: ['activeNotifications'] });
    queryClient.invalidateQueries({ queryKey: ['seenNotificationIds'] });
  }, [queryClient]);

  const goNext = useCallback(() => {
    setIndex((i) => Math.min(i + 1, flow.length - 1));
  }, [flow.length]);

  const goBack = useCallback(() => setIndex((i) => Math.max(0, i - 1)), []);

  /** Screen 5, answered. Persistence is `saveIncomeDetails` — unchanged. */
  const handleIncomeContinue = useCallback(async () => {
    const parsed = Number.parseFloat(monthlyInput);
    if (!Number.isFinite(parsed) || parsed <= 0) return;
    if (!user) {
      setCommittedMonthly(parsed);
      goNext();
      return;
    }

    setSaving(true);
    try {
      // Only the one field. `saveIncomeDetails` merges into any existing
      // record, so nothing a returning user already entered is overwritten.
      await saveIncomeDetails(user.id, { monthly_salary: parsed });
      setCommittedMonthly(parsed);
      invalidate();
      goNext();
    } catch (error) {
      console.error('Error saving income details:', error);
      toast({
        title: "That didn't save",
        description: 'The number is still in the box — try Continue once more.',
        variant: 'destructive',
      });
    } finally {
      setSaving(false);
    }
  }, [monthlyInput, user, goNext, invalidate, toast]);

  /** Screen 5, skipped. Nothing is written and nothing is inferred. */
  const handleIncomeSkip = useCallback(() => {
    setCommittedMonthly(null);
    goNext();
  }, [goNext]);

  /** Screen 6. The end of the flow, for both paths. */
  const handleFinish = useCallback(async () => {
    setSaving(true);
    try {
      if (user) {
        const { error } = await auth.markOnboardingCompletedLocal(user.id);
        if (error) throw new Error(error);
        await refreshUser();
      }
      invalidate();
    } catch (error) {
      console.error('Error marking onboarding complete:', error);
    } finally {
      setSaving(false);
      onComplete();
    }
  }, [user, refreshUser, invalidate, onComplete]);

  const canGoBack = !isReturning && (screen === 'refuse' || screen === 'get');
  const showChrome = screen !== 'offer';
  /** Screens 5 and the paywall carry their own action buttons. */
  const showModalFooter = screen !== 'offer' && screen !== 'income';

  const stepNumber = index + 1;

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent
        className="pointer-events-auto max-h-[88vh] max-w-lg overflow-y-auto rounded-2xl border-0 bg-gradient-to-br from-background to-muted/20 shadow-2xl"
        onInteractOutside={(e) => e.preventDefault()}
      >
        {showChrome && (
          <DialogHeader className="space-y-3 pb-1 text-left">
            <div className="flex items-center gap-3">
              {canGoBack && (
                <button
                  type="button"
                  onClick={goBack}
                  className="pointer-events-auto -ml-1 flex items-center gap-0.5 text-[11px] font-medium text-muted-foreground transition-colors hover:text-foreground"
                >
                  <ChevronLeft className="h-3.5 w-3.5" />
                  Back
                </button>
              )}
              <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                {stepNumber} of {flow.length}
              </span>
            </div>

            {/* Progress: one bar per screen. No percentages, no stepper icons
                pretending each screen is a task to complete. */}
            <div className="flex items-center gap-1.5">
              {flow.map((id, i) => (
                <span
                  key={id}
                  className={cn(
                    'h-1 flex-1 rounded-full transition-colors duration-300',
                    i <= index ? 'bg-primary' : 'bg-border/60',
                  )}
                />
              ))}
            </div>

            <DialogTitle className="text-xl font-black leading-tight tracking-tight text-foreground">
              {screen === 'moment' && committedMonthly === null
                ? MOMENT_TITLE_WHEN_SKIPPED
                : SCREEN_COPY[screen].title}
            </DialogTitle>
            {SCREEN_COPY[screen].lede && (
              <p className="text-sm leading-relaxed text-muted-foreground">
                {SCREEN_COPY[screen].lede}
              </p>
            )}
          </DialogHeader>
        )}

        <div className={cn(showChrome ? 'py-3' : 'py-0')}>
          {dataLoading && (screen === 'income' || screen === 'moment') ? (
            <div className="space-y-3 py-4">
              <div className="h-14 animate-pulse rounded-xl bg-muted" />
              <div className="h-12 animate-pulse rounded-xl bg-muted" />
            </div>
          ) : (
            <>
              {screen === 'founder' && <FounderNote />}
              {screen === 'refuse' && <WhatWeRefuse />}
              {screen === 'get' && <WhatYouGet />}
              {screen === 'offer' && (
                // Owned by the paywall module. Prop contract is final; no
                // `onDismiss` here, because during first-run onboarding there
                // is no app behind this screen to dismiss to.
                <PaywallScreen variant="onboarding" onSubscribed={() => goNext()} />
              )}
              {screen === 'income' && (
                <IncomeQuestion
                  value={monthlyInput}
                  onChange={setMonthlyInput}
                  onContinue={handleIncomeContinue}
                  onSkip={handleIncomeSkip}
                  saving={saving}
                />
              )}
              {screen === 'moment' && <ValueMoment monthlyIncome={committedMonthly} />}
            </>
          )}
        </div>

        {showModalFooter && (
          <div className="flex items-center justify-end border-t border-border/40 pt-4">
            {screen === 'moment' ? (
              <Button
                onClick={handleFinish}
                disabled={saving}
                className="pointer-events-auto h-11 rounded-xl px-7 text-sm font-semibold"
              >
                {saving ? 'One moment…' : isReturning ? 'Done' : 'Take me in'}
              </Button>
            ) : (
              <Button
                onClick={goNext}
                className="pointer-events-auto h-11 rounded-xl px-7 text-sm font-semibold"
              >
                Continue
                <ChevronRight className="ml-0.5 h-4 w-4" />
              </Button>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
};
