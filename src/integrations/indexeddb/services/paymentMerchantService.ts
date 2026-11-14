import type { MyDB } from '../db';
import { get, put } from '@/integrations/storage/repository';
import { notifyDatabaseChanged } from '@/utils/dbSync';
import type { PendingPayment } from '@/lib/paymentCapture/native';

export type PaymentMerchantMapping = MyDB['payment_merchant_mappings']['value'];

export function normalisePaymentMerchant(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9@._-]+/g, ' ').replace(/\s+/g, ' ').trim();
}

export function paymentMerchantKey(payment: Pick<PendingPayment, 'merchant' | 'sourcePackage'>): string | null {
  const merchant = normalisePaymentMerchant(payment.merchant || '');
  return merchant ? `${payment.sourcePackage || 'payment-app'}::${merchant}` : null;
}

const mappingId = (userId: string, key: string) => `${userId}::${key}`;

export async function findPaymentMerchantMapping(userId: string, payment: PendingPayment): Promise<PaymentMerchantMapping | null> {
  const key = paymentMerchantKey(payment);
  if (!key) return null;
  return (await get<PaymentMerchantMapping>('payment_merchant_mappings', mappingId(userId, key))) ?? null;
}

export async function rememberPaymentMerchantMapping(
  userId: string,
  payment: PendingPayment,
  defaults: { category: string; account: string; note: string },
): Promise<void> {
  const key = paymentMerchantKey(payment);
  if (!key) return;
  const id = mappingId(userId, key);
  const existing = await get<PaymentMerchantMapping>('payment_merchant_mappings', id);
  const now = new Date().toISOString();
  await put('payment_merchant_mappings', {
    id,
    user_id: userId,
    merchant_key: key,
    display_name: payment.merchant || payment.appName,
    source_package: payment.sourcePackage,
    category: defaults.category,
    account: defaults.account,
    note: defaults.note,
    confirmations: (existing?.confirmations ?? 0) + 1,
    last_amount: Number(payment.amount),
    created_at: existing?.created_at ?? now,
    updated_at: now,
  });
  notifyDatabaseChanged();
}
