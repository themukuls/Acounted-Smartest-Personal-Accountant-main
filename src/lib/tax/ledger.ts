/**
 * ledger.ts — the Live Tax Ledger.
 *
 * Pure function. Takes the user's real financial entries, routes each through
 * the classifier, aggregates them into the engine's TaxInput, computes the live
 * tax position for both regimes, and surfaces deduction HEADROOM (the "invest
 * ₹X more before Mar 31 to save ₹Y" opportunity) plus anything the classifier
 * wasn't sure about.
 *
 * Deliberate MVP simplifications (documented, not hidden):
 *  - Income entries are added at face value, except professional (44ADA → 50%)
 *    and business (44AD → 8% presumptive, conservative). Capital gains come via
 *    the `capitalGains` param, not from free-text entries yet.
 *  - HRA exemption is passed in (`hraExemption`) since it needs basic salary +
 *    city; rent-paid entries are aggregated for display only.
 */

import { computeTax, computeTaxOnTaxableIncome } from './engine';
import { classifyEntry } from './classifier';
import { BUCKET_BY_ID, type BucketKind } from './taxonomy';
import {
  CAP_80C,
  CAP_80CCD1B,
  CAP_24B_SELF_OCCUPIED,
  CAP_80TTA,
  CAP_80TTB,
  CAP_80D_SELF_NON_SENIOR,
  CAP_80D_SELF_SENIOR,
  EQUITY_LTCG_EXEMPT,
} from './constants';
import type {
  AgeCategory,
  CapitalGains,
  OldRegimeDeductions,
  TaxComputation,
  TaxInput,
} from './types';

export interface LedgerEntry {
  id?: string;
  description: string; // free text (e.g. transaction note)
  category?: string; // structured hint (e.g. picker category)
  amount: number;
}

export interface BucketAggregate {
  bucketId: string;
  label: string;
  section?: string;
  kind: BucketKind;
  total: number;
  entryCount: number;
}

export interface HeadroomItem {
  bucketId: string;
  section: string;
  used: number;
  cap: number;
  remaining: number;
  /** Tax saved (old regime) if the remaining headroom is filled. */
  potentialSaving: number;
}

export interface UnclassifiedItem {
  description: string;
  amount: number;
  suggestionBucketId?: string;
  confidence: number;
}

/** Income split by ITR head, for the ITR draft and summaries. */
export interface IncomeBreakdown {
  salary: number;
  business: number; // presumptive profit (44AD)
  professional: number; // presumptive profit (44ADA)
  houseProperty: number; // net rental
  otherSources: number; // interest + dividend + other + non-equity STCG
  capitalGains: CapitalGains;
  grossTotalIncome: number;
}

export interface TaxState {
  financialYear: string;
  input: TaxInput;
  computation: TaxComputation;
  income: IncomeBreakdown;
  buckets: BucketAggregate[];
  headroom: HeadroomItem[];
  unclassified: UnclassifiedItem[];
  /** 0..1 — share of classifiable entries the classifier was confident about. */
  confidence: number;
}

const NO_CG: CapitalGains = { equityStcg: 0, equityLtcg: 0, otherLtcg: 0, otherStcg: 0 };

// Deduction section caps, keyed by the engine field.
function capFor(field: keyof OldRegimeDeductions, isSenior: boolean): number | null {
  switch (field) {
    case 'section80C': return CAP_80C;
    case 'section80CCD1B': return CAP_80CCD1B;
    case 'section24b': return CAP_24B_SELF_OCCUPIED;
    case 'section80TTA': return CAP_80TTA;
    case 'section80TTB': return CAP_80TTB;
    case 'section80D': return isSenior ? CAP_80D_SELF_SENIOR : CAP_80D_SELF_NON_SENIOR;
    default: return null; // 80E, 80G, HRA, other — no simple flat cap
  }
}

/** How much an income entry contributes to slab income. */
function incomeContribution(bucketId: string, amount: number): number {
  switch (bucketId) {
    // Salary is taken from the salaryIncome param (the income profile), so a
    // logged "salary credited" transaction must NOT be counted again here.
    case 'income_salary': return 0;
    case 'income_professional': return amount * 0.5; // 44ADA presumptive profit
    case 'income_business': return amount * 0.08; // 44AD presumptive (conservative)
    case 'income_capital_gains': return 0; // handled via capitalGains param
    default: return amount; // rental, interest, dividend, other
  }
}

export function buildTaxState(params: {
  financialYear: string;
  ageCategory: AgeCategory;
  hasSalaryOrPension: boolean;
  salaryIncome?: number;
  entries?: LedgerEntry[];
  capitalGains?: CapitalGains;
  hraExemption?: number;
  learned?: Record<string, string>;
}): TaxState {
  const {
    financialYear,
    ageCategory,
    hasSalaryOrPension,
    salaryIncome = 0,
    entries = [],
    capitalGains = NO_CG,
    hraExemption = 0,
    learned,
  } = params;

  const isSenior = ageCategory === '60-80' || ageCategory === '>80';

  const aggregates = new Map<string, BucketAggregate>();
  const unclassified: UnclassifiedItem[] = [];
  let classifiableCount = 0;
  let confidentCount = 0;

  for (const entry of entries) {
    if (!entry.amount) continue;
    classifiableCount++;
    const result = classifyEntry(entry.description, {
      hintCategory: entry.category,
      learned,
    });

    if (!result.bucketId || result.needsConfirmation) {
      unclassified.push({
        description: entry.description || entry.category || '(unlabelled)',
        amount: entry.amount,
        suggestionBucketId: result.bucketId ?? undefined,
        confidence: result.confidence,
      });
      continue;
    }

    confidentCount++;
    const bucket = BUCKET_BY_ID[result.bucketId];
    const agg = aggregates.get(bucket.id) ?? {
      bucketId: bucket.id,
      label: bucket.label,
      section: bucket.section,
      kind: bucket.kind,
      total: 0,
      entryCount: 0,
    };
    agg.total += entry.amount;
    agg.entryCount++;
    aggregates.set(bucket.id, agg);
  }

  // ── Build the engine input from the aggregates ────────────────────────────
  const deductions: OldRegimeDeductions = { hra: hraExemption };
  const heads = { business: 0, professional: 0, houseProperty: 0, otherSources: 0 };
  let entryIncome = 0;

  for (const agg of aggregates.values()) {
    const bucket = BUCKET_BY_ID[agg.bucketId];
    if (bucket.kind === 'deduction' && bucket.engineField && bucket.engineField !== 'hra') {
      const cap = capFor(bucket.engineField, isSenior);
      const value = cap == null ? agg.total : Math.min(agg.total, cap);
      deductions[bucket.engineField] = (deductions[bucket.engineField] ?? 0) + value;
    } else if (bucket.kind === 'income') {
      const contrib = incomeContribution(bucket.id, agg.total);
      entryIncome += contrib;
      switch (bucket.id) {
        case 'income_business': heads.business += contrib; break;
        case 'income_professional': heads.professional += contrib; break;
        case 'income_rental': heads.houseProperty += contrib; break;
        case 'income_interest':
        case 'income_dividend':
        case 'income_other': heads.otherSources += contrib; break;
        // income_salary → 0 (salary from param); income_capital_gains → 0 (via param)
      }
    }
    // non_taxable buckets are intentionally excluded from tax.
  }

  // Non-equity STCG is taxed at slab rates, so it belongs in slab income.
  const input: TaxInput = {
    ageCategory,
    hasSalaryOrPension,
    slabIncome: salaryIncome + entryIncome + capitalGains.otherStcg,
    capitalGains,
    deductions,
  };

  const computation = computeTax(input);

  // Income split by head, for the ITR draft and summaries.
  const specialRateCg =
    capitalGains.equityStcg +
    Math.max(0, capitalGains.equityLtcg - EQUITY_LTCG_EXEMPT) +
    capitalGains.otherLtcg;
  const income: IncomeBreakdown = {
    salary: salaryIncome,
    business: heads.business,
    professional: heads.professional,
    houseProperty: heads.houseProperty,
    otherSources: heads.otherSources + capitalGains.otherStcg,
    capitalGains,
    grossTotalIncome: input.slabIncome + specialRateCg,
  };

  // ── Headroom on capped deduction sections (old regime opportunity) ────────
  const taxableOld = computation.old.taxableIncome;
  const baseTaxOld = computeTaxOnTaxableIncome(taxableOld, 'old', ageCategory).totalTax;
  const headroom: HeadroomItem[] = [];

  for (const agg of aggregates.values()) {
    const bucket = BUCKET_BY_ID[agg.bucketId];
    if (bucket.kind !== 'deduction' || !bucket.engineField) continue;
    const cap = capFor(bucket.engineField, isSenior);
    if (cap == null) continue;
    const used = Math.min(agg.total, cap);
    const remaining = cap - used;
    if (remaining <= 0) continue;

    // Filling `remaining` more deduction lowers taxable income by that amount.
    const taxIfFilled = computeTaxOnTaxableIncome(
      Math.max(0, taxableOld - remaining),
      'old',
      ageCategory,
    ).totalTax;
    headroom.push({
      bucketId: bucket.id,
      section: bucket.section ?? bucket.label,
      used,
      cap,
      remaining,
      potentialSaving: Math.max(0, baseTaxOld - taxIfFilled),
    });
  }
  headroom.sort((a, b) => b.potentialSaving - a.potentialSaving);

  return {
    financialYear,
    input,
    computation,
    income,
    buckets: [...aggregates.values()].sort((a, b) => b.total - a.total),
    headroom,
    unclassified,
    confidence: classifiableCount === 0 ? 1 : confidentCount / classifiableCount,
  };
}
