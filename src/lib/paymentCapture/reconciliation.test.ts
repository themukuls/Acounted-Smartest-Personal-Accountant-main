import { describe, expect, test } from 'bun:test';
import { nextPendingPayment, reconciliationProgress } from './reconciliation';
import type { PendingPayment } from './native';

const payment = (id: string): PendingPayment => ({
  id, amount: '141', merchant: '78***@ybl', occurredAt: 1,
  reference: null, source: 'paytm', appName: 'Paytm',
  sourcePackage: 'net.one97.paytm', status: 'pending',
});

describe('continuous reconciliation', () => {
  test('opens the next remaining payment after resolving the current one', () => {
    expect(nextPendingPayment([payment('one'), payment('two'), payment('three')], 'one')?.id)
      .toBe('two');
  });

  test('finishes cleanly when no payments remain', () => {
    expect(nextPendingPayment([], 'one')).toBeNull();
  });

  test('reports progress through the original queue', () => {
    expect(reconciliationProgress(10, 10)).toEqual({ current: 1, total: 10 });
    expect(reconciliationProgress(10, 9)).toEqual({ current: 2, total: 10 });
    expect(reconciliationProgress(10, 1)).toEqual({ current: 10, total: 10 });
  });
});
