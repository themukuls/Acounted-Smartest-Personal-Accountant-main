"use client";

/**
 * ValueMoment — screen 6 of 6. The app does its job once, before the user
 * meets an empty ledger.
 *
 * Everything shown here comes from `computeTax()` in src/lib/tax/engine.ts —
 * the same engine the Tax Planner and the Tax Ledger call. This screen does
 * no arithmetic of its own and must never start; a number here that the tax
 * section later contradicts would undo the entire funnel.
 *
 * Honesty constraints, in order of importance:
 *
 *  - The estimate is built from ONE figure and no deductions. It is stated as
 *    such, in the same breath as the number, not in a footnote. An estimate
 *    that quietly implies precision is worse than no estimate.
 *  - If the user skipped the question, there is NO number. Inventing a
 *    plausible one — from an average, a slab midpoint, anything — would be
 *    the first thing the app ever told them, and it would be false.
 *  - Nothing here is framed as a warning. A tax liability is a fact about
 *    the slabs, not a judgement about the person. Same guard as
 *    src/lib/nudges/rules.ts.
 */

import { useMemo } from 'react';
import { computeTax } from '@/lib/tax/engine';
import { inr } from '@/lib/tax/qa';
import { cn } from '@/lib/utils';
import { TAX_FEATURE_ENABLED } from '@/lib/features';

/** Shown when screen 5 was skipped. No number, and no pretending there is one. */
export const EMPTY_STATE_TITLE = 'Nothing to show you yet, honestly';
export const EMPTY_STATE_BODY =
  'The tax estimate needs one income figure before it can say anything true, and you have not given it one — which is fine. Add a few entries, or drop the number in from your profile, and this fills itself in on the dashboard.';

/** The caveat that travels with every number on this screen. */
export const ESTIMATE_CAVEAT =
  'That is one figure and nothing else — no 80C, no HRA, no TDS already deducted. Each of those pulls it down, and adding them is most of what the tax section does.';

interface ValueMomentProps {
  /** Monthly figure from screen 5, or null when it was skipped. */
  monthlyIncome: number | null;
}

export const ValueMoment = ({ monthlyIncome }: ValueMomentProps) => {
  const result = useMemo(() => {
    if (!TAX_FEATURE_ENABLED || monthlyIncome === null || !Number.isFinite(monthlyIncome) || monthlyIncome <= 0) {
      return null;
    }
    const annual = Math.round(monthlyIncome * 12);
    return {
      annual,
      tax: computeTax({
        ageCategory: '<60',
        hasSalaryOrPension: true,
        slabIncome: annual,
        capitalGains: { equityStcg: 0, equityLtcg: 0, otherLtcg: 0, otherStcg: 0 },
        deductions: {},
      }),
    };
  }, [monthlyIncome]);

  if (!TAX_FEATURE_ENABLED) {
    return (
      <div className="space-y-3">
        <div className="rounded-xl border border-primary/20 bg-primary/5 p-5">
          <p className="text-sm font-bold text-foreground">Your money view is ready</p>
          <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
            Acounted will organize captured payments, expenses, budgets and reminders in one private place. You can change your income baseline any time.
          </p>
        </div>
      </div>
    );
  }

  if (result === null) {
    return (
      <div className="space-y-3">
        <div className="rounded-xl border border-dashed border-border/70 bg-muted/30 p-5">
          <p className="text-sm font-bold text-foreground">{EMPTY_STATE_TITLE}</p>
          <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
            {EMPTY_STATE_BODY}
          </p>
        </div>
      </div>
    );
  }

  const { annual, tax } = result;
  const cheaper = tax.recommendedRegime === 'old' ? tax.old : tax.new;
  const cheaperLabel = tax.recommendedRegime === 'old' ? 'old regime' : 'new regime';
  const bothZero = tax.old.totalTax === 0 && tax.new.totalTax === 0;

  const verdict = bothZero
    ? `Nothing is due under either regime at ${inr(annual)}, once the standard deduction and the 87A rebate are applied.`
    : tax.potentialSaving === 0
      ? `Both regimes land on the same ${inr(cheaper.totalTax)} at that income.`
      : `The ${cheaperLabel} is ${inr(tax.potentialSaving)} cheaper for you as things stand.`;

  return (
    <div className="space-y-4">
      <p className="text-sm leading-relaxed text-muted-foreground">
        On {inr(annual)} a year, this is what the slabs come to before you have
        claimed a single deduction.
      </p>

      <div className="grid grid-cols-2 gap-2.5">
        {([tax.old, tax.new] as const).map((r) => {
          const isCheaper = !bothZero && tax.potentialSaving > 0 && r.regime === tax.recommendedRegime;
          return (
            <div
              key={r.regime}
              className={cn(
                'space-y-1 rounded-xl border p-4',
                isCheaper
                  ? 'border-primary/40 bg-primary/5'
                  : 'border-border/50 bg-background/60',
              )}
            >
              <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                {r.regime === 'old' ? 'Old regime' : 'New regime'}
              </p>
              <p
                className={cn(
                  'text-xl font-black leading-none',
                  isCheaper ? 'text-primary' : 'text-foreground',
                )}
              >
                {inr(r.totalTax)}
              </p>
              <p className="text-[10px] text-muted-foreground">
                after a {inr(r.standardDeduction)} standard deduction
              </p>
            </div>
          );
        })}
      </div>

      <p className="rounded-xl bg-muted/50 p-3.5 text-xs font-semibold leading-relaxed text-foreground">
        {verdict}
      </p>

      <p className="text-[11px] leading-relaxed text-muted-foreground">
        {ESTIMATE_CAVEAT}
      </p>
    </div>
  );
};
