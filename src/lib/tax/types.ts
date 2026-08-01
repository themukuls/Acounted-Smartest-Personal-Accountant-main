/**
 * types.ts — canonical, framework-free tax types.
 *
 * These describe a tax situation independent of any UI form or DB record,
 * so the same engine can be driven by the Tax Planner form today and by the
 * live Tax Ledger (aggregated from real transactions) tomorrow.
 */

export type Regime = 'old' | 'new';
export type AgeCategory = '<60' | '60-80' | '>80';

/** Capital gains, split by the head that determines their tax treatment. */
export interface CapitalGains {
  /** Equity STCG — Sec 111A, flat 20%. */
  equityStcg: number;
  /** Equity LTCG — Sec 112A, flat 12.5% above the ₹1.25 L exemption. */
  equityLtcg: number;
  /** Other LTCG (property, gold, debt) — Sec 112, flat 12.5%. */
  otherLtcg: number;
  /** Other STCG (non-111A) — taxed at slab rates, so folded into slab income. */
  otherStcg: number;
}

/**
 * Old-regime deductions, already resolved to rupee amounts.
 * Capping/derivation (HRA formula, 80C aggregation, senior 80D limits) is
 * done by the helpers in `deductions.ts`; the engine just sums these.
 * The new regime ignores everything here except the standard deduction,
 * which the engine applies itself per regime.
 */
export interface OldRegimeDeductions {
  hra?: number;
  section24b?: number;
  section80C?: number;
  section80CCD1B?: number;
  section80D?: number;
  section80E?: number;
  section80G?: number;
  section80TTA?: number;
  section80TTB?: number;
  /** Any additional deduction not covered above. */
  other?: number;
}

/** The complete, normalised input to the tax engine. */
export interface TaxInput {
  ageCategory: AgeCategory;
  /** Eligible for the standard deduction (salaried or pensioner). */
  hasSalaryOrPension: boolean;
  /**
   * Income taxed at slab rates, BEFORE deductions and BEFORE the standard
   * deduction — i.e. salary + presumptive business/professional profit +
   * net rental income + other STCG + other income.
   */
  slabIncome: number;
  capitalGains: CapitalGains;
  /** Old-regime deductions (rupee amounts). Ignored for the new regime. */
  deductions: OldRegimeDeductions;
}

/** Per-regime computed breakdown. */
export interface RegimeResult {
  regime: Regime;
  grossSlabIncome: number;
  standardDeduction: number;
  totalDeductions: number; // includes standard deduction
  taxableIncome: number; // slab-taxed portion, after deductions
  slabTax: number; // before rebate
  rebate87A: number; // amount rebated (>= 0)
  taxAfterRebate: number;
  capitalGainsTax: number;
  surcharge: number;
  cess: number;
  /** Final rounded liability for the regime. */
  totalTax: number;
}

/** The engine's full output: both regimes plus the recommendation. */
export interface TaxComputation {
  old: RegimeResult;
  new: RegimeResult;
  recommendedRegime: Regime;
  /** Positive rupee saving from choosing the recommended regime. */
  potentialSaving: number;
}
