/**
 * engine.test.ts — correctness gate for the tax engine.
 *
 * Run with:  bun test src/lib/tax
 *
 * Cases are hand-computed from the slab tables so a regression in the engine
 * shows up as a failing number, not a silent wrong tax.
 */

import { test, expect, describe } from 'bun:test';
import {
  computeTax,
  computeSlabTax,
  computeRebate87A,
  computeCapitalGainsTax,
} from './engine';
import type { TaxInput } from './types';

const base: TaxInput = {
  ageCategory: '<60',
  hasSalaryOrPension: true,
  slabIncome: 0,
  capitalGains: { equityStcg: 0, equityLtcg: 0, otherLtcg: 0, otherStcg: 0 },
  deductions: {},
};

describe('computeSlabTax — new regime', () => {
  test('income below first slab pays nothing', () => {
    expect(computeSlabTax(400000, 'new', '<60')).toBe(0);
  });

  test('₹12 L taxable: 5% of 4L + 10% of 4L = 20000 + 40000 = 60000', () => {
    // 0–4L @0, 4–8L @5% = 20000, 8–12L @10% = 40000
    expect(computeSlabTax(1200000, 'new', '<60')).toBe(60000);
  });

  test('₹16 L taxable: +15% of 4L = 60000 more → 120000', () => {
    expect(computeSlabTax(1600000, 'new', '<60')).toBe(120000);
  });
});

describe('computeSlabTax — old regime', () => {
  test('₹10 L taxable: 5% of 2.5L + 20% of 5L = 12500 + 100000 = 112500', () => {
    // 0–2.5L @0, 2.5–5L @5% = 12500, 5–10L @20% = 100000
    expect(computeSlabTax(1000000, 'old', '<60')).toBe(112500);
  });

  test('senior (60-80) gets ₹3 L exemption: ₹10 L → 5% of 2L + 20% of 5L = 110000', () => {
    // 0–3L @0, 3–5L @5% = 10000, 5–10L @20% = 100000
    expect(computeSlabTax(1000000, 'old', '60-80')).toBe(110000);
  });
});

describe('computeRebate87A', () => {
  test('new regime rebates up to 60000 at ≤ 12 L taxable', () => {
    expect(computeRebate87A(60000, 1200000, 'new')).toBe(60000);
  });
  test('new regime: no rebate just above 12 L', () => {
    expect(computeRebate87A(60001, 1200001, 'new')).toBe(0);
  });
  test('old regime rebates up to 12500 at ≤ 5 L taxable', () => {
    expect(computeRebate87A(12500, 500000, 'old')).toBe(12500);
  });
  test('rebate never exceeds the tax itself', () => {
    expect(computeRebate87A(8000, 480000, 'old')).toBe(8000);
  });
});

describe('computeCapitalGainsTax', () => {
  test('equity STCG @20%', () => {
    expect(computeCapitalGainsTax({ equityStcg: 100000, equityLtcg: 0, otherLtcg: 0, otherStcg: 0 })).toBe(20000);
  });
  test('equity LTCG: ₹2.25 L → taxable ₹1 L above exemption @12.5% = 12500', () => {
    expect(computeCapitalGainsTax({ equityStcg: 0, equityLtcg: 225000, otherLtcg: 0, otherStcg: 0 })).toBe(12500);
  });
  test('equity LTCG within ₹1.25 L exemption is tax-free', () => {
    expect(computeCapitalGainsTax({ equityStcg: 0, equityLtcg: 120000, otherLtcg: 0, otherStcg: 0 })).toBe(0);
  });
});

describe('computeTax — end to end', () => {
  test('₹12 L salary, no deductions: new regime wins and is ₹0 after rebate', () => {
    const r = computeTax({ ...base, slabIncome: 1200000 });
    // New: taxable = 1200000 - 75000 std = 1125000 → tax 45000 → rebate (≤12L) → 0
    expect(r.new.totalTax).toBe(0);
    expect(r.recommendedRegime).toBe('new');
  });

  test('₹20 L salary, ₹1.5 L 80C + ₹50k NPS: both regimes computed, cheaper recommended', () => {
    const r = computeTax({
      ...base,
      slabIncome: 2000000,
      deductions: { section80C: 150000, section80CCD1B: 50000 },
    });
    // New regime: taxable = 2000000 - 75000 = 1925000
    //   tax = 20000 + 40000 + 60000 + 20% of (1925000-1600000)=65000 → 185000
    //   +4% cess = 192400
    expect(r.new.totalTax).toBe(192400);
    // Old regime: taxable = 2000000 - 50000 std - 150000 - 50000 = 1750000
    //   tax = 12500 + 100000 + 30% of 750000 (225000) = 337500 → +cess 351000
    expect(r.old.totalTax).toBe(351000);
    expect(r.recommendedRegime).toBe('new');
    expect(r.potentialSaving).toBe(351000 - 192400);
  });

  test('surcharge kicks in above ₹50 L (new regime, 10%)', () => {
    const r = computeTax({ ...base, slabIncome: 6000000 });
    // taxable = 6000000 - 75000 = 5925000 (> 50L → 10% surcharge)
    // slab tax = 20000+40000+60000+80000+100000 (25% of 400k) + 30% of (5925000-2400000=3525000)=1057500
    //          = 300000 + 1057500 = 1357500
    // surcharge 10% = 135750 ; cess 4% of (1357500+135750=1493250)=59730 → total 1552980
    expect(r.new.surcharge).toBe(135750);
    expect(r.new.totalTax).toBe(1552980);
  });
});
