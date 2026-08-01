/**
 * engine.ts — the deterministic Indian income-tax engine.
 *
 * Pure functions only. No React, no IndexedDB, no side effects. Every rupee
 * of arithmetic lives here so there is exactly one source of truth that the
 * UI, the future Tax Ledger, and the Q&A layer all call. (The conversational
 * layer must NEVER do tax math itself — it asks this engine.)
 */

import {
  TAX_SLABS_OLD,
  TAX_SLABS_NEW,
  OLD_REGIME_EXEMPTION,
  STD_DEDUCTION_OLD,
  STD_DEDUCTION_NEW,
  REBATE_OLD,
  REBATE_NEW,
  CESS_RATE,
  SURCHARGE_BANDS,
  EQUITY_STCG_RATE,
  EQUITY_LTCG_RATE,
  EQUITY_LTCG_EXEMPT,
  OTHER_LTCG_RATE,
  type Slab,
} from './constants';
import type {
  AgeCategory,
  CapitalGains,
  OldRegimeDeductions,
  Regime,
  RegimeResult,
  TaxComputation,
  TaxInput,
} from './types';

/** Round to whole rupees (the unit the ITD works in). */
const rupees = (n: number): number => Math.round(n);

/**
 * Progressive slab tax on a taxable income.
 * In the old regime the first (zero-rate) slab is widened for senior citizens.
 */
export function computeSlabTax(
  taxableIncome: number,
  regime: Regime,
  ageCategory: AgeCategory,
): number {
  if (taxableIncome <= 0) return 0;

  let slabs: Slab[] = regime === 'old' ? TAX_SLABS_OLD : TAX_SLABS_NEW;

  // Senior-citizen higher basic exemption — old regime only.
  if (regime === 'old' && ageCategory !== '<60') {
    const exemption = OLD_REGIME_EXEMPTION[ageCategory];
    slabs = slabs.map((s, i) => (i === 0 ? { ...s, upto: exemption } : s));
  }

  let tax = 0;
  let prev = 0;
  for (const slab of slabs) {
    if (taxableIncome <= prev) break;
    const chunk = Math.min(taxableIncome, slab.upto) - prev;
    tax += chunk * slab.rate;
    prev = slab.upto;
  }
  return tax;
}

/**
 * Section 87A rebate. Returns the rupee amount rebated (0 if not eligible).
 * Applies to the slab tax only (not to capital-gains tax).
 */
export function computeRebate87A(
  slabTax: number,
  taxableIncome: number,
  regime: Regime,
): number {
  const { limit, amount } = regime === 'old' ? REBATE_OLD : REBATE_NEW;
  if (taxableIncome <= limit) return Math.min(slabTax, amount);
  return 0;
}

/**
 * Capital-gains tax at the applicable flat rates.
 * Equity LTCG gets the ₹1.25 L annual exemption before 12.5%.
 * "Other STCG" is NOT here — it is taxed at slab rates and folded into
 * slab income by the caller.
 */
export function computeCapitalGainsTax(cg: CapitalGains): number {
  const taxableEquityLtcg = Math.max(0, cg.equityLtcg - EQUITY_LTCG_EXEMPT);
  return (
    cg.equityStcg * EQUITY_STCG_RATE +
    taxableEquityLtcg * EQUITY_LTCG_RATE +
    cg.otherLtcg * OTHER_LTCG_RATE
  );
}

/**
 * Surcharge on tax. The rate is set by total taxable income; the new regime
 * caps it at 25% (the 37% band does not exist there).
 *
 * KNOWN LIMITATIONS (deferred, documented — all only bite above ₹50 L income,
 * out of scope for the salaried users this first targets):
 *  1. Marginal relief is not yet applied. It caps the extra (tax + surcharge)
 *     at the income earned above the band threshold; adding it correctly needs
 *     the tax computed at the threshold income, which the caller will thread
 *     through in a later refinement.
 *  2. The 15% cap on surcharge attributable to 111A/112A capital gains is not
 *     modelled.
 * A subtly-wrong relief is worse than an honestly-absent one, so we return the
 * plain banded surcharge until relief can be done right.
 */
export function computeSurcharge(
  taxBeforeSurcharge: number,
  totalIncome: number,
  regime: Regime,
): number {
  if (taxBeforeSurcharge <= 0) return 0;

  const band = SURCHARGE_BANDS.find((b) => totalIncome > b.over);
  if (!band) return 0;

  const rate = regime === 'new' ? band.newRegimeRate : band.rate;
  return taxBeforeSurcharge * rate;
}

const NO_CAPITAL_GAINS: CapitalGains = {
  equityStcg: 0,
  equityLtcg: 0,
  otherLtcg: 0,
  otherStcg: 0,
};

/** The tax breakdown for an already-computed taxable (slab) income. */
export interface TaxOnIncomeResult {
  slabTax: number;
  rebate87A: number;
  taxAfterRebate: number;
  capitalGainsTax: number;
  surcharge: number;
  cess: number;
  totalTax: number;
}

/**
 * Assemble the full tax (rebate → capital gains → surcharge → cess) for an
 * income that has ALREADY had its deductions subtracted. This is the shared
 * primitive both the Tax Planner and Salary Restructuring pages call, so the
 * slab/surcharge/cess assembly lives in exactly one place.
 */
export function computeTaxOnTaxableIncome(
  taxableIncome: number,
  regime: Regime,
  ageCategory: AgeCategory,
  capitalGains: CapitalGains = NO_CAPITAL_GAINS,
): TaxOnIncomeResult {
  const slabTax = computeSlabTax(taxableIncome, regime, ageCategory);
  const rebate87A = computeRebate87A(slabTax, taxableIncome, regime);
  const taxAfterRebate = slabTax - rebate87A;

  const capitalGainsTax = computeCapitalGainsTax(capitalGains);

  // Surcharge threshold looks at total income (slab-taxable + taxable CG).
  const taxableCg =
    capitalGains.equityStcg +
    Math.max(0, capitalGains.equityLtcg - EQUITY_LTCG_EXEMPT) +
    capitalGains.otherLtcg;
  const surcharge = computeSurcharge(
    taxAfterRebate + capitalGainsTax,
    taxableIncome + taxableCg,
    regime,
  );

  const cess = (taxAfterRebate + capitalGainsTax + surcharge) * CESS_RATE;
  const totalTax = rupees(taxAfterRebate + capitalGainsTax + surcharge + cess);

  return {
    slabTax: rupees(slabTax),
    rebate87A: rupees(rebate87A),
    taxAfterRebate: rupees(taxAfterRebate),
    capitalGainsTax: rupees(capitalGainsTax),
    surcharge: rupees(surcharge),
    cess: rupees(cess),
    totalTax,
  };
}

/** Compute the full liability for a single regime. */
function computeRegimeResult(input: TaxInput, regime: Regime): RegimeResult {
  const { slabIncome, capitalGains, ageCategory, hasSalaryOrPension } = input;

  const standardDeduction = hasSalaryOrPension
    ? regime === 'old'
      ? STD_DEDUCTION_OLD
      : STD_DEDUCTION_NEW
    : 0;

  // New regime allows only the standard deduction (plus a few not modelled
  // here); the old regime allows the full deduction set.
  const otherDeductions =
    regime === 'old' ? sumDeductions(input.deductions) : 0;

  const totalDeductions = standardDeduction + otherDeductions;
  const taxableIncome = Math.max(0, slabIncome - totalDeductions);

  const t = computeTaxOnTaxableIncome(
    taxableIncome,
    regime,
    ageCategory,
    capitalGains,
  );

  return {
    regime,
    grossSlabIncome: slabIncome,
    standardDeduction,
    totalDeductions,
    taxableIncome,
    ...t,
  };
}

/** Sum the resolved old-regime deduction amounts. */
export function sumDeductions(d: OldRegimeDeductions): number {
  return (
    (d.hra ?? 0) +
    (d.section24b ?? 0) +
    (d.section80C ?? 0) +
    (d.section80CCD1B ?? 0) +
    (d.section80D ?? 0) +
    (d.section80E ?? 0) +
    (d.section80G ?? 0) +
    (d.section80TTA ?? 0) +
    (d.section80TTB ?? 0) +
    (d.other ?? 0)
  );
}

/**
 * The main entry point: compute both regimes and recommend the cheaper one.
 */
export function computeTax(input: TaxInput): TaxComputation {
  const oldResult = computeRegimeResult(input, 'old');
  const newResult = computeRegimeResult(input, 'new');

  const recommendedRegime: Regime =
    oldResult.totalTax <= newResult.totalTax ? 'old' : 'new';
  const potentialSaving = Math.abs(oldResult.totalTax - newResult.totalTax);

  return {
    old: oldResult,
    new: newResult,
    recommendedRegime,
    potentialSaving,
  };
}
