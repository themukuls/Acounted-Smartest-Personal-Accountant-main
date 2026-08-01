/**
 * itr.ts — ITR filing prep. Pure function.
 *
 * Freezes the live TaxState into a structured, ITR-shaped JSON draft: the
 * applicable form, income by head, Chapter VI-A deductions, and the tax
 * computation — all from the numbers the co-pilot already computed.
 *
 * IMPORTANT — what this IS and IS NOT:
 *  - IT IS: a computed, reviewable ITR draft/summary the user can check, export,
 *    or hand to a CA. It mirrors the ITR structure and carries the real figures.
 *  - IT IS NOT: a portal-ready, signed ITR JSON. The official upload file needs
 *    PAN + personal details + bank + verification blocks and must match the exact
 *    ITD schema version for the assessment year — out of scope here and clearly
 *    flagged so nothing is misrepresented as a filing-ready government file.
 */

import { sumDeductions } from './engine';
import type { TaxState } from './ledger';
import type { CapitalGains, Regime } from './types';

export type ITRForm = 'ITR-1' | 'ITR-2' | 'ITR-3/4';

export interface ITRDraft {
  form: ITRForm;
  financialYear: string;
  assessmentYear: string;
  regime: Regime;
  income: {
    salary: number;
    houseProperty: number;
    businessProfession: number;
    capitalGains: CapitalGains;
    otherSources: number;
    grossTotalIncome: number;
  };
  deductions: {
    standardDeduction: number;
    chapterVIA: Record<string, number>;
    totalDeductions: number;
  };
  taxComputation: {
    taxableIncome: number;
    taxBeforeRebate: number;
    rebate87A: number;
    capitalGainsTax: number;
    surcharge: number;
    cess: number;
    totalTaxLiability: number;
  };
  disclaimer: string;
}

/** AY is the year after the FY: "2025-26" → "2026-27". */
function assessmentYearFromFY(fy: string): string {
  const m = fy.match(/^(\d{4})-(\d{2})$/);
  if (!m) return fy;
  const start = parseInt(m[1], 10) + 1;
  return `${start}-${String((start + 1) % 100).padStart(2, '0')}`;
}

/** Pick the applicable ITR form from what the taxpayer actually has. */
export function determineITRForm(state: TaxState): ITRForm {
  const { income } = state;
  const cg = income.capitalGains;
  const hasCapitalGains =
    cg.equityStcg + cg.equityLtcg + cg.otherLtcg + cg.otherStcg > 0;
  if (income.business > 0 || income.professional > 0) return 'ITR-3/4';
  if (hasCapitalGains || income.grossTotalIncome > 5000000 || income.houseProperty > 0) {
    return 'ITR-2';
  }
  return 'ITR-1';
}

export function buildITRDraft(state: TaxState): ITRDraft {
  const regime = state.computation.recommendedRegime;
  const result = regime === 'new' ? state.computation.new : state.computation.old;
  const { income } = state;

  // Chapter VI-A deductions only apply in the old regime.
  const chapterVIA: Record<string, number> =
    regime === 'old'
      ? Object.fromEntries(
          Object.entries(state.input.deductions).filter(([, v]) => (v ?? 0) > 0),
        )
      : {};
  const chapterVIATotal = regime === 'old' ? sumDeductions(state.input.deductions) : 0;

  return {
    form: determineITRForm(state),
    financialYear: state.financialYear,
    assessmentYear: assessmentYearFromFY(state.financialYear),
    regime,
    income: {
      salary: income.salary,
      houseProperty: income.houseProperty,
      businessProfession: income.business + income.professional,
      capitalGains: income.capitalGains,
      otherSources: income.otherSources,
      grossTotalIncome: income.grossTotalIncome,
    },
    deductions: {
      standardDeduction: result.standardDeduction,
      chapterVIA,
      totalDeductions: result.totalDeductions,
    },
    taxComputation: {
      taxableIncome: result.taxableIncome,
      taxBeforeRebate: result.slabTax,
      rebate87A: result.rebate87A,
      capitalGainsTax: result.capitalGainsTax,
      surcharge: result.surcharge,
      cess: result.cess,
      totalTaxLiability: result.totalTax,
    },
    disclaimer:
      'Draft summary for review only — not a portal-ready ITR JSON. Add PAN, ' +
      'personal, bank and verification details and validate against the official ' +
      'ITD schema before filing.',
  };
}

/** Pretty-printed JSON string, ready to download or copy. */
export function itrDraftToJSON(state: TaxState): string {
  return JSON.stringify(buildITRDraft(state), null, 2);
}
