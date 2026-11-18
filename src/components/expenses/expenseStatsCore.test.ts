import { describe, expect, test } from 'bun:test';
import type { StatsTransaction } from './expenseStatsCore';
import { buildCategoryMonthlyTrend, buildCategorySummaries, transactionsForCategory } from './expenseStatsCore';

const transaction = (id: string, category: string, amount: number, date: string): StatsTransaction => ({
  id, category, amount, transaction_date: date, type: 'expense', account: 'upi',
  description: id, created_at: date,
});

const DATA = [
  transaction('a', 'food', 100, '2026-09-02T10:00:00.000Z'),
  transaction('b', 'food', 300, '2026-10-03T10:00:00.000Z'),
  transaction('c', 'fuel', 200, '2026-10-04T10:00:00.000Z'),
];

describe('expense stats drill-down', () => {
  test('summarises category total, count, average and share', () => {
    const food = buildCategorySummaries(DATA)[0];
    expect(food).toMatchObject({ key: 'food', total: 400, count: 2, average: 200 });
    expect(food.percentage).toBeCloseTo(66.67, 2);
  });

  test('returns category transactions newest first', () => {
    expect(transactionsForCategory(DATA, 'food').map(row => row.id)).toEqual(['b', 'a']);
  });

  test('builds a chronological multi-month trend', () => {
    expect(buildCategoryMonthlyTrend(DATA, 'food')).toEqual([
      { month: '2026-09', total: 100, count: 1 },
      { month: '2026-10', total: 300, count: 1 },
    ]);
  });
});
