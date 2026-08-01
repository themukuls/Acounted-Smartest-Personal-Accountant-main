/**
 * classifier.test.ts — routing correctness for the tax classifier.
 * Run with:  bun test src/lib/tax
 */

import { test, expect, describe } from 'bun:test';
import { classifyEntry } from './classifier';

describe('classifyEntry — confident deduction routing', () => {
  const cases: [string, string][] = [
    ['LIC premium 25000', 'sec_80c'],
    ['PPF deposit', 'sec_80c'],
    ['ELSS mutual fund SIP', 'sec_80c'],
    ['home loan principal repayment', 'sec_80c'],
    ['NPS Tier-I contribution', 'sec_80ccd1b'],
    ['health insurance premium', 'sec_80d'],
    ['mediclaim for parents', 'sec_80d'],
    ['home loan interest', 'sec_24b'],
    ['education loan interest', 'sec_80e'],
    ['donation to PM Cares', 'sec_80g'],
    ['rent paid for flat', 'hra'],
  ];
  for (const [text, expected] of cases) {
    test(`"${text}" → ${expected}`, () => {
      const r = classifyEntry(text);
      expect(r.bucketId).toBe(expected);
      expect(r.needsConfirmation).toBe(false);
    });
  }
});

describe('classifyEntry — income routing', () => {
  const cases: [string, string][] = [
    ['Salary credited', 'income_salary'],
    ['freelance client payment', 'income_professional'],
    ['rent received from tenant', 'income_rental'],
    ['FD interest', 'income_interest'],
    ['dividend received', 'income_dividend'],
    ['sold shares capital gain', 'income_capital_gains'],
  ];
  for (const [text, expected] of cases) {
    test(`"${text}" → ${expected}`, () => {
      expect(classifyEntry(text).bucketId).toBe(expected);
    });
  }
});

describe('classifyEntry — non-taxable is recognised (so it can be excluded)', () => {
  test('gift from dad', () => {
    const r = classifyEntry('gift from dad');
    expect(r.bucket?.kind).toBe('non_taxable');
  });
  test('reimbursement of travel', () => {
    expect(classifyEntry('reimbursement of travel').bucket?.kind).toBe('non_taxable');
  });
});

describe('classifyEntry — specificity: longer phrase wins', () => {
  test('"home loan interest" routes to 24(b), not 80C principal', () => {
    expect(classifyEntry('home loan interest paid').bucketId).toBe('sec_24b');
  });
  test('"health insurance" routes to 80D, not 80C life insurance', () => {
    expect(classifyEntry('health insurance').bucketId).toBe('sec_80d');
  });
  test('"rent paid" (HRA) is distinct from "rent received" (income)', () => {
    expect(classifyEntry('rent paid').bucketId).toBe('hra');
    expect(classifyEntry('rent received').bucketId).toBe('income_rental');
  });
});

describe('classifyEntry — asks for confirmation when unsure', () => {
  test('bare "insurance" is ambiguous (life 80C vs health 80D) → confirm', () => {
    const r = classifyEntry('insurance 30000');
    // Either it is unsure (needsConfirmation) or it declined to pick — never a
    // confident auto-file.
    expect(r.needsConfirmation).toBe(true);
  });
  test('gibberish returns no bucket and asks', () => {
    const r = classifyEntry('zxcvbnm qwerty');
    expect(r.bucketId).toBeNull();
    expect(r.needsConfirmation).toBe(true);
  });
  test('hintCategory sharpens a vague description', () => {
    // "premium 30000" alone is vague; the Health category tips it to 80D.
    const r = classifyEntry('premium 30000', { hintCategory: 'Health Insurance' });
    expect(r.bucketId).toBe('sec_80d');
  });
});
