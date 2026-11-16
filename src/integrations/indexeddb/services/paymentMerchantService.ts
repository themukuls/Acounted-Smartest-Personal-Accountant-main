import type { MyDB } from '../db';
import { get, put } from '@/integrations/storage/repository';
import { notifyDatabaseChanged } from '@/utils/dbSync';
import type { PendingPayment } from '@/lib/paymentCapture/native';

export type PaymentMerchantMapping = MyDB['payment_merchant_mappings']['value'];

export function normalisePaymentMerchant(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9@.*_-]+/g, ' ').replace(/\s+/g, ' ').trim();
}

export function paymentMerchantKey(payment: Pick<PendingPayment, 'merchant' | 'sourcePackage'>): string | null {
  const merchant = normalisePaymentMerchant(payment.merchant || '');
  if (!merchant) return null;

  // A VPA is the counterparty's stable identity. Do not include the source
  // package: the same payment may arrive through Paytm today and a bank SMS
  // tomorrow, and both should learn from the same confirmation.
  const vpa = merchant.match(/(?:^|\s)([a-z0-9.*_-]{2,}@[a-z][a-z0-9.-]{1,})(?:\s|$)/i)?.[1];
  if (vpa) return `vpa::${vpa.toLowerCase()}`;

  // Merchant-name matches are deliberately source-scoped to avoid assigning
  // a category to an unrelated business with a similar display name.
  return `merchant::${payment.sourcePackage || 'payment-app'}::${merchant}`;
}

const mappingId = (userId: string, key: string) => `${userId}::${key}`;

export async function findPaymentMerchantMapping(userId: string, payment: PendingPayment): Promise<PaymentMerchantMapping | null> {
  const key = paymentMerchantKey(payment);
  if (!key) return null;
  const exact = await get<PaymentMerchantMapping>('payment_merchant_mappings', mappingId(userId, key));
  if (exact) return exact;

  // Read the v1 source-scoped key as a migration fallback. The next confirmed
  // save writes the new stable key automatically.
  const legacyMerchant = (payment.merchant || '')
    .toLowerCase().replace(/[^a-z0-9@._-]+/g, ' ').replace(/\s+/g, ' ').trim();
  if (!legacyMerchant) return null;
  const legacyKey = `${payment.sourcePackage || 'payment-app'}::${legacyMerchant}`;
  return (await get<PaymentMerchantMapping>('payment_merchant_mappings', mappingId(userId, legacyKey))) ?? null;
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
