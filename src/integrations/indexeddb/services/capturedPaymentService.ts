import type { MyDB } from '../db';
import { get, getAllByIndex, put } from '@/integrations/storage/repository';
import type { PendingPayment } from '@/lib/paymentCapture/native';

type Transaction = MyDB['transactions']['value'];

const SAME_PAYEE_WINDOW_MS = 10 * 60_000;
const CROSS_CHANNEL_WINDOW_MS = 5 * 60_000;

function clean(value: string | null | undefined) {
  return (value ?? '').trim().toLowerCase();
}

export function normaliseCapturedMerchant(value: string | null | undefined): string {
  const normalized = clean(value)
    .replace(/^(?:vpa|upi id)\s*[: -]?\s*/i, '')
    .replace(/[^a-z0-9@._*-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const vpa = normalized.match(/(?:^|\s)([a-z0-9._*-]{2,}@[a-z][a-z0-9.-]{1,})(?:\s|$)/i)?.[1];
  return vpa ?? normalized;
}

function normaliseReference(value: string | null | undefined) {
  return clean(value).replace(/[^a-z0-9]/g, '');
}

function isSms(source: string | null | undefined) {
  return clean(source) === 'bank_sms';
}

/**
 * Ledger-level backstop for a native duplicate that crossed the app/SMS
 * boundary. Only captured transactions participate; manual expenses are never
 * suppressed because they happen to share an amount and date.
 */
export function isSameCapturedPayment(existing: Transaction, payment: PendingPayment): boolean {
  if (!existing.capture_payment_id) return false;
  if (existing.capture_payment_id === payment.id) return true;
  if (existing.amount !== Number(payment.amount)) return false;

  const oldReference = normaliseReference(existing.capture_reference);
  const newReference = normaliseReference(payment.reference);
  if (oldReference && newReference) return oldReference === newReference;

  const distance = Math.abs(new Date(existing.transaction_date).getTime() - payment.occurredAt);
  if (!Number.isFinite(distance) || distance > SAME_PAYEE_WINDOW_MS) return false;

  const oldMerchant = normaliseCapturedMerchant(existing.capture_merchant);
  const newMerchant = normaliseCapturedMerchant(payment.merchant);
  if (oldMerchant && oldMerchant === newMerchant) return true;

  const oneReference = Boolean(oldReference) !== Boolean(newReference);
  const crossChannel = isSms(existing.capture_source) !== isSms(payment.source);
  if (oneReference && crossChannel && distance <= CROSS_CHANNEL_WINDOW_MS) return true;

  return (!oldMerchant || !newMerchant) && distance <= 120_000;
}

export function capturedTransactionId(userId: string, paymentId: string) {
  return `captured-payment::${userId}::${paymentId}`;
}

export async function saveCapturedPaymentTransaction(
  userId: string,
  payment: PendingPayment,
  details: { category: string; account: string; description: string },
): Promise<{ transaction: Transaction; created: boolean }> {
  const id = capturedTransactionId(userId, payment.id);
  const exact = await get<Transaction>('transactions', id);
  if (exact) {
    const updated: Transaction = {
      ...exact,
      category: details.category,
      account: details.account,
      description: details.description,
      updated_at: new Date().toISOString(),
    };
    await put('transactions', updated);
    return { transaction: updated, created: false };
  }

  const userTransactions = await getAllByIndex<Transaction>('transactions', 'user_id', userId);
  const duplicate = userTransactions.find(transaction => isSameCapturedPayment(transaction, payment));
  if (duplicate) return { transaction: duplicate, created: false };

  const now = new Date().toISOString();
  const transaction: Transaction = {
    id,
    user_id: userId,
    type: 'expense',
    amount: Number(payment.amount),
    category: details.category,
    account: details.account,
    description: details.description,
    transaction_date: new Date(payment.occurredAt).toISOString(),
    capture_payment_id: payment.id,
    capture_reference: payment.reference,
    capture_merchant: payment.merchant,
    capture_source: payment.source,
    created_at: now,
    updated_at: now,
  };
  // The deterministic primary key turns concurrent retries of one pending
  // payment into an upsert instead of two UUID-backed ledger rows.
  await put('transactions', transaction);
  return { transaction, created: true };
}
