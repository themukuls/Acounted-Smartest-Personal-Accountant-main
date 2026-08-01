/**
 * itr.test.ts — ITR draft generation.
 * Run with:  bun test src/lib/tax
 */

import { test, expect, describe } from 'bun:test';
import { buildITRDraft, determineITRForm, itrDraftToJSON } from './itr';
import { buildTaxState } from './ledger';

const salaried = buildTaxState({
  financialYear: '2025-26',
  ageCategory: '<60',
  hasSalaryOrPension: true,
  salaryIncome: 1500000,
  entries: [
    { description: 'ELSS', amount: 150000 },
    { description: 'health insurance', amount: 20000 },
  ],
});

describe('determineITRForm', () => {
  test('simple salaried → ITR-1', () => {
    expect(determineITRForm(salaried)).toBe('ITR-1');
  });

  test('with capital gains → ITR-2', () => {
    const s = buildTaxState({
      financialYear: '2025-26',
      ageCategory: '<60',
      hasSalaryOrPension: true,
      salaryIncome: 1500000,
      capitalGains: { equityStcg: 200000, equityLtcg: 0, otherLtcg: 0, otherStcg: 0 },
    });
    expect(determineITRForm(s)).toBe('ITR-2');
  });

  test('with business/professional income → ITR-3/4', () => {
    const s = buildTaxState({
      financialYear: '2025-26',
      ageCategory: '<60',
      hasSalaryOrPension: false,
      salaryIncome: 0,
      entries: [{ description: 'freelance client payment', amount: 1000000 }],
    });
    expect(determineITRForm(s)).toBe('ITR-3/4');
  });
});

describe('buildITRDraft', () => {
  test('assessment year is FY + 1', () => {
    expect(buildITRDraft(salaried).assessmentYear).toBe('2026-27');
  });

  test('tax figures match the recommended regime computation', () => {
    const draft = buildITRDraft(salaried);
    const rec =
      salaried.computation.recommendedRegime === 'new'
        ? salaried.computation.new
        : salaried.computation.old;
    expect(draft.taxComputation.totalTaxLiability).toBe(rec.totalTax);
    expect(draft.taxComputation.taxableIncome).toBe(rec.taxableIncome);
    expect(draft.income.salary).toBe(1500000);
  });

  test('carries a not-portal-ready disclaimer', () => {
    expect(buildITRDraft(salaried).disclaimer).toContain('not a portal-ready');
  });

  test('itrDraftToJSON returns valid, parseable JSON', () => {
    const parsed = JSON.parse(itrDraftToJSON(salaried));
    expect(parsed.form).toBe('ITR-1');
    expect(parsed.financialYear).toBe('2025-26');
  });
});
