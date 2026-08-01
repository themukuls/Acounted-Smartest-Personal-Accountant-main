/**
 * whispers.ts — proactive, time-sensitive tax nudges. Pure function.
 *
 * Turns the live tax state + today's date into a small set of "whispers":
 * the deduction-headroom countdown to 31 March, advance-tax due dates, and
 * entries that still need categorising. The co-pilot and dashboard surface
 * these; tapping one routes to the relevant Q&A answer.
 *
 * Deliberate simplifications (documented):
 *  - Advance-tax whispers fire only when there is income NOT covered by salary
 *    TDS (capital gains or non-salary income). Salaried-only users whose TDS
 *    usually covers their liability aren't nagged. TDS-exact adjustment is a
 *    later refinement.
 */

import { inr } from './qa';
import type { TaxState } from './ledger';

export type WhisperSeverity = 'deadline' | 'opportunity' | 'info';

export interface Whisper {
  id: string;
  severity: WhisperSeverity;
  title: string;
  detail: string;
  daysLeft?: number;
  potentialSaving?: number;
  /** A question to route to the co-pilot when tapped. */
  ask?: string;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const fmtDate = (d: Date) => `${d.getDate()} ${MONTHS[d.getMonth()]}`;
const daysBetween = (from: Date, to: Date) =>
  Math.ceil((to.getTime() - from.getTime()) / 86_400_000);

/** 31 March that ends the financial year containing `today`. */
function fyEndMarch31(today: Date): Date {
  const y = today.getFullYear();
  const endYear = today.getMonth() >= 3 ? y + 1 : y; // Apr–Dec → next year's Mar
  return new Date(endYear, 2, 31);
}

/** The next advance-tax installment on/after `today`, within the current FY. */
function nextAdvanceTaxDue(today: Date): { label: string; date: Date; cumulativePct: number } | null {
  const y = today.getFullYear();
  const fyStartYear = today.getMonth() >= 3 ? y : y - 1;
  const installments = [
    { label: 'Q1', date: new Date(fyStartYear, 5, 15), cumulativePct: 15 }, //  15 Jun
    { label: 'Q2', date: new Date(fyStartYear, 8, 15), cumulativePct: 45 }, //  15 Sep
    { label: 'Q3', date: new Date(fyStartYear, 11, 15), cumulativePct: 75 }, // 15 Dec
    { label: 'Q4', date: new Date(fyStartYear + 1, 2, 15), cumulativePct: 100 }, // 15 Mar
  ];
  return installments.find((i) => i.date.getTime() >= today.getTime()) ?? null;
}

function hasNonSalaryIncome(state: TaxState): boolean {
  const cg = state.input.capitalGains;
  const cgTotal = cg.equityStcg + cg.equityLtcg + cg.otherLtcg + cg.otherStcg;
  const otherIncome = state.buckets.some(
    (b) => b.kind === 'income' && b.bucketId !== 'income_salary' && b.total > 0,
  );
  return cgTotal > 0 || otherIncome;
}

export function getTaxWhispers({ state, today }: { state: TaxState; today: Date }): Whisper[] {
  const whispers: Whisper[] = [];

  // 1. Deduction headroom before 31 March.
  const totalSaving = state.headroom.reduce((s, h) => s + h.potentialSaving, 0);
  if (totalSaving > 0) {
    const days = Math.max(0, daysBetween(today, fyEndMarch31(today)));
    const topSection = state.headroom[0]?.section ?? '80C';
    whispers.push({
      id: 'headroom-deadline',
      severity: 'deadline',
      title: `Save up to ${inr(totalSaving)} before 31 Mar`,
      detail:
        days > 0
          ? `${days} day${days === 1 ? '' : 's'} left — filling your unused ${topSection} headroom is the quickest win.`
          : 'The window for this financial year has closed.',
      daysLeft: days,
      potentialSaving: totalSaving,
      ask: 'How can I save more tax?',
    });
  }

  // 2. Advance-tax installment due (only when income isn't fully TDS-covered).
  const projectedTax =
    state.computation.recommendedRegime === 'new'
      ? state.computation.new.totalTax
      : state.computation.old.totalTax;
  if (projectedTax >= 10000 && hasNonSalaryIncome(state)) {
    const due = nextAdvanceTaxDue(today);
    if (due) {
      const days = daysBetween(today, due.date);
      if (days >= 0 && days <= 45) {
        const cumulativeAmt = Math.round((projectedTax * due.cumulativePct) / 100);
        whispers.push({
          id: `advance-tax-${due.label}`,
          severity: 'deadline',
          title: `Advance tax ${due.label} due in ${days} day${days === 1 ? '' : 's'}`,
          detail: `By ${fmtDate(due.date)} you should have paid about ${inr(cumulativeAmt)} (${due.cumulativePct}% of your ${inr(projectedTax)} projected tax).`,
          daysLeft: days,
        });
      }
    }
  }

  // 3. Entries that still need a tax category.
  if (state.unclassified.length > 0) {
    const n = state.unclassified.length;
    whispers.push({
      id: 'unclassified',
      severity: 'info',
      title: `${n} entr${n === 1 ? 'y' : 'ies'} need a tax category`,
      detail: 'Categorise them so I can count them toward your deductions.',
      ask: 'What needs review?',
    });
  }

  return whispers;
}
