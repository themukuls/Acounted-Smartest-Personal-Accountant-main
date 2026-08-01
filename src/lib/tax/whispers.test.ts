/**
 * whispers.test.ts — proactive nudges.
 * Run with:  bun test src/lib/tax
 */

import { test, expect, describe } from 'bun:test';
import { getTaxWhispers } from './whispers';
import { buildTaxState } from './ledger';

// Mid-February: ~44 days to 31 Mar, advance-tax Q4 (15 Mar) ~28 days out.
const FEB_15 = new Date(2026, 1, 15);

describe('getTaxWhispers — headroom deadline', () => {
  test('unused 80C headroom produces a dated saving whisper', () => {
    const state = buildTaxState({
      financialYear: '2025-26',
      ageCategory: '<60',
      hasSalaryOrPension: true,
      salaryIncome: 2000000,
      entries: [{ description: 'ELSS', amount: 50000 }], // 1L of 80C unused
    });
    const w = getTaxWhispers({ state, today: FEB_15 }).find((x) => x.id === 'headroom-deadline');
    expect(w).toBeDefined();
    expect(w!.daysLeft).toBe(44);
    expect(w!.potentialSaving).toBeGreaterThan(0);
    expect(w!.ask).toBe('How can I save more tax?');
  });
});

describe('getTaxWhispers — advance tax gating', () => {
  test('salaried-only user is NOT nagged about advance tax', () => {
    const state = buildTaxState({
      financialYear: '2025-26',
      ageCategory: '<60',
      hasSalaryOrPension: true,
      salaryIncome: 2000000,
    });
    const adv = getTaxWhispers({ state, today: FEB_15 }).find((x) => x.id.startsWith('advance-tax'));
    expect(adv).toBeUndefined();
  });

  test('user with capital gains DOES get an advance-tax whisper (Q4, within 45 days)', () => {
    const state = buildTaxState({
      financialYear: '2025-26',
      ageCategory: '<60',
      hasSalaryOrPension: false,
      salaryIncome: 0,
      capitalGains: { equityStcg: 500000, equityLtcg: 0, otherLtcg: 0, otherStcg: 0 },
    });
    const adv = getTaxWhispers({ state, today: FEB_15 }).find((x) => x.id === 'advance-tax-Q4');
    expect(adv).toBeDefined();
    expect(adv!.daysLeft).toBe(28); // 15 Feb → 15 Mar
  });
});

describe('getTaxWhispers — unclassified', () => {
  test('surfaces entries that need a category', () => {
    const state = buildTaxState({
      financialYear: '2025-26',
      ageCategory: '<60',
      hasSalaryOrPension: true,
      salaryIncome: 2000000,
      entries: [{ description: 'insurance', amount: 30000 }], // ambiguous
    });
    const w = getTaxWhispers({ state, today: FEB_15 }).find((x) => x.id === 'unclassified');
    expect(w).toBeDefined();
    expect(w!.ask).toBe('What needs review?');
  });
});
