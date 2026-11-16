import type { PendingPayment } from './native';

export function nextPendingPayment(
  payments: PendingPayment[],
  resolvedPaymentId: string,
): PendingPayment | null {
  return payments.find(payment => payment.id !== resolvedPaymentId) ?? null;
}

export function reconciliationProgress(total: number, pendingCount: number) {
  if (total <= 0) return undefined;
  return {
    current: Math.min(total, Math.max(1, total - pendingCount + 1)),
    total,
  };
}
