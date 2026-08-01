/**
 * ledger.test.ts — the Live Tax Ledger end to end.
 * Run with:  bun test src/lib/tax
 */

import { test, expect, describe } from 'bun:test';
import { buildTaxState, type LedgerEntry } from './ledger';
import { classifyEntry } from './classifier';

const salaried = {
  financialYear: '2025-26',
  ageCategory: '<60' as const,
  hasSalaryOrPension: true,
  salaryIncome: 2000000,
};

describe('buildTaxState — aggregation + engine wiring', () => {
  const entries: LedgerEntry[] = [
    { description: 'LIC premium', amount: 40000 },
    { description: 'ELSS SIP', amount: 60000 },
    { description: 'PPF deposit', amount: 60000 },
    { description: 'NPS Tier-I', amount: 50000 },
    { description: 'health insurance premium', amount: 22000 },
    { description: 'gift from dad', amount: 100000 }, // non-taxable → excluded
  ];

  test('deduction buckets aggregate and feed the engine (80C capped at 1.5L)', () => {
    const s = buildTaxState({ ...salaried, entries });
    // 80C total 40k+60k+60k = 160k, capped to 150000
    expect(s.input.deductions.section80C).toBe(150000);
    expect(s.input.deductions.section80CCD1B).toBe(50000);
    expect(s.input.deductions.section80D).toBe(22000);
  });

  test('non-taxable gift is excluded from income and deductions', () => {
    const s = buildTaxState({ ...salaried, entries });
    // slabIncome is just the salary — the gift did not inflate it
    expect(s.input.slabIncome).toBe(2000000);
    expect(s.buckets.find((b) => b.bucketId === 'non_taxable_gift')?.total).toBe(100000);
  });

  test('computes both regimes', () => {
    const s = buildTaxState({ ...salaried, entries });
    expect(s.computation.old.totalTax).toBeGreaterThan(0);
    expect(s.computation.new.totalTax).toBeGreaterThan(0);
    expect(['old', 'new']).toContain(s.computation.recommendedRegime);
  });
});

describe('buildTaxState — headroom (the opportunity)', () => {
  test('unused 80C headroom yields a positive potential saving', () => {
    const s = buildTaxState({
      ...salaried,
      entries: [{ description: 'ELSS', amount: 50000 }], // only 50k of 1.5L used
    });
    const c80 = s.headroom.find((h) => h.bucketId === 'sec_80c');
    expect(c80).toBeDefined();
    expect(c80!.remaining).toBe(100000); // 150000 - 50000
    // At ₹20L salary the marginal rate is 30% → saving ≈ 100000 * 0.312
    expect(c80!.potentialSaving).toBeGreaterThan(30000);
  });

  test('a maxed section produces no headroom entry', () => {
    const s = buildTaxState({
      ...salaried,
      entries: [{ description: 'PPF', amount: 200000 }], // over the 1.5L cap
    });
    expect(s.headroom.find((h) => h.bucketId === 'sec_80c')).toBeUndefined();
  });
});

describe('buildTaxState — unclassified entries surface for confirmation', () => {
  test('a vague entry lands in unclassified, not silently mis-filed', () => {
    const s = buildTaxState({
      ...salaried,
      entries: [{ description: 'insurance', amount: 30000 }],
    });
    expect(s.unclassified.length).toBe(1);
    expect(s.confidence).toBeLessThan(1);
  });
});

describe('buildTaxState — income handling', () => {
  test('a logged salary income entry does NOT double-count on top of salaryIncome', () => {
    const s = buildTaxState({
      ...salaried,
      entries: [{ description: 'salary credited', amount: 166000 }],
    });
    // slabIncome stays the profile salary; the entry is ignored to avoid double count
    expect(s.input.slabIncome).toBe(2000000);
  });

  test('non-salary income (interest, dividend) adds to slab income', () => {
    const s = buildTaxState({
      ...salaried,
      salaryIncome: 0,
      hasSalaryOrPension: false,
      entries: [
        { description: 'FD interest', amount: 8000 },
        { description: 'dividend received', amount: 12000 },
      ],
    });
    expect(s.input.slabIncome).toBe(20000);
  });

  test('capital gains flow through to the engine', () => {
    const s = buildTaxState({
      ...salaried,
      salaryIncome: 0,
      hasSalaryOrPension: false,
      capitalGains: { equityStcg: 100000, equityLtcg: 0, otherLtcg: 0, otherStcg: 0 },
    });
    // equity STCG @20% + 4% cess = 20800
    expect(s.computation.new.capitalGainsTax).toBe(20000);
    expect(s.computation.new.totalTax).toBeGreaterThanOrEqual(20800);
  });
});

describe('classifier memory — a learned mapping wins and skips confirmation', () => {
  test('remembered text routes with full confidence', () => {
    // "jeevan anand" is not in the dictionary → would be unsure...
    const cold = classifyEntry('jeevan anand policy');
    expect(cold.needsConfirmation).toBe(true);
    // ...but once learned → confident 80C, no confirmation
    const warm = classifyEntry('jeevan anand policy', {
      learned: { 'jeevan anand policy': 'sec_80c' },
    });
    expect(warm.bucketId).toBe('sec_80c');
    expect(warm.confidence).toBe(1);
    expect(warm.needsConfirmation).toBe(false);
  });

  test('ledger honours learned mappings', () => {
    const s = buildTaxState({
      ...salaried,
      entries: [{ description: 'jeevan anand policy', amount: 30000 }],
      learned: { 'jeevan anand policy': 'sec_80c' },
    });
    expect(s.input.deductions.section80C).toBe(30000);
    expect(s.unclassified.length).toBe(0);
  });
});
