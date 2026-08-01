/**
 * constants.ts — Indian income-tax constants, centralised.
 *
 * Single source of truth for slab rates, exemptions, caps and special
 * rates. Values mirror the Income Tax Act 2025 / FY 2025-26 figures that
 * were previously hard-coded inside TaxPlanOutput.tsx and
 * SalaryRestructuring.tsx, so behaviour is preserved while the numbers
 * now live in exactly one place.
 *
 * When the Budget changes a number, it changes here and nowhere else.
 */

import type { AgeCategory } from './types';

// ─── Slabs ────────────────────────────────────────────────────────────────────
// A slab is { upto, rate }: `rate` applies to income between the previous
// slab's `upto` and this one's `upto`.

export interface Slab {
  upto: number;
  rate: number;
}

export const TAX_SLABS_OLD: Slab[] = [
  { upto: 250000, rate: 0 },
  { upto: 500000, rate: 0.05 },
  { upto: 1000000, rate: 0.2 },
  { upto: Infinity, rate: 0.3 },
];

export const TAX_SLABS_NEW: Slab[] = [
  { upto: 400000, rate: 0 },
  { upto: 800000, rate: 0.05 },
  { upto: 1200000, rate: 0.1 },
  { upto: 1600000, rate: 0.15 },
  { upto: 2000000, rate: 0.2 },
  { upto: 2400000, rate: 0.25 },
  { upto: Infinity, rate: 0.3 },
];

// Old-regime basic-exemption limit by age (senior-citizen benefit).
// New regime has no age-based higher exemption.
export const OLD_REGIME_EXEMPTION: Record<AgeCategory, number> = {
  '<60': 250000,
  '60-80': 300000,
  '>80': 500000,
};

// ─── Standard deduction ─────────────────────────────────────────────────────
export const STD_DEDUCTION_OLD = 50000;
export const STD_DEDUCTION_NEW = 75000;

// ─── Section 87A rebate ──────────────────────────────────────────────────────
export const REBATE_OLD = { limit: 500000, amount: 12500 };
export const REBATE_NEW = { limit: 1200000, amount: 60000 };

// ─── Health & Education Cess ─────────────────────────────────────────────────
export const CESS_RATE = 0.04;

// ─── Surcharge ───────────────────────────────────────────────────────────────
// Bands are on TOTAL taxable income. `newCap` caps the rate in the new
// regime (the 37% band does not exist there — capped at 25%).
export interface SurchargeBand {
  over: number; // income strictly above this
  rate: number;
  newRegimeRate: number;
}

export const SURCHARGE_BANDS: SurchargeBand[] = [
  { over: 50000000, rate: 0.37, newRegimeRate: 0.25 }, // > 5 Cr
  { over: 20000000, rate: 0.25, newRegimeRate: 0.25 }, // 2 Cr – 5 Cr
  { over: 10000000, rate: 0.15, newRegimeRate: 0.15 }, // 1 Cr – 2 Cr
  { over: 5000000, rate: 0.1, newRegimeRate: 0.1 }, //  50 L – 1 Cr
];

// ─── Capital-gains flat rates ────────────────────────────────────────────────
export const EQUITY_STCG_RATE = 0.2; //  Sec 111A
export const EQUITY_LTCG_RATE = 0.125; // Sec 112A (above exemption)
export const EQUITY_LTCG_EXEMPT = 125000; // ₹1.25 L annual exemption
export const OTHER_LTCG_RATE = 0.125; //  Sec 112 (post 23-Jul-2024)
// "Other STCG" (non-111A) is added to slab income, so it has no flat rate.

// ─── HRA ─────────────────────────────────────────────────────────────────────
// Metro cities eligible for the 50% (vs 40%) HRA exemption.
export const METRO_CITIES_50 = [
  'mumbai',
  'delhi',
  'new delhi',
  'kolkata',
  'chennai',
  'bengaluru',
  'bangalore',
  'pune',
  'hyderabad',
  'ahmedabad',
];

// ─── Old-regime deduction caps ───────────────────────────────────────────────
export const CAP_80C = 150000;
export const CAP_80CCD1B = 50000; // extra NPS Tier-I
export const CAP_24B_SELF_OCCUPIED = 200000;
export const CAP_80TTA = 10000; // savings interest, non-senior
export const CAP_80TTB = 100000; // savings + FD interest, senior
export const CAP_80D_SELF_NON_SENIOR = 25000;
export const CAP_80D_SELF_SENIOR = 50000;
