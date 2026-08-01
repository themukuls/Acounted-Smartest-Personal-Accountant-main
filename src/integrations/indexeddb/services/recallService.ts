import type { MyDB } from '../db';
import { getAllByIndex, get, put, remove } from '@/integrations/storage/repository';
import { v4 as uuidv4 } from 'uuid';

export type RecallProduct = MyDB['recall_products']['value'];
export type ServiceEntry  = RecallProduct['service_history'][0];

export const CATEGORIES = [
  { value: 'electronics', label: 'Electronics',  emoji: '💻' },
  { value: 'appliance',   label: 'Appliance',    emoji: '❄️' },
  { value: 'vehicle',     label: 'Vehicle',      emoji: '🛵' },
  { value: 'furniture',   label: 'Furniture',    emoji: '🪑' },
  { value: 'other',       label: 'Other',        emoji: '📦' },
] as const;

export const WARRANTY_OPTIONS = [
  { label: 'No warranty',   months: 0   },
  { label: '6 months',      months: 6   },
  { label: '1 year',        months: 12  },
  { label: '2 years',       months: 24  },
  { label: '3 years',       months: 36  },
  { label: '5 years',       months: 60  },
  { label: 'Custom',        months: -1  },
] as const;

export const SERVICE_INTERVALS = [
  { label: 'No service tracking', months: 0  },
  { label: 'Every 3 months',      months: 3  },
  { label: 'Every 6 months',      months: 6  },
  { label: 'Every year',          months: 12 },
  { label: 'Every 2 years',       months: 24 },
] as const;

// ─── Warranty status ──────────────────────────────────────────────────────────
export type WarrantyStatus = 'active' | 'expiring_soon' | 'expired' | 'none';

export function getWarrantyStatus(product: RecallProduct): WarrantyStatus {
  if (!product.warranty_expiry) return 'none';
  const now     = new Date();
  const expiry  = new Date(product.warranty_expiry);
  const daysLeft = Math.ceil((expiry.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
  if (daysLeft < 0)   return 'expired';
  if (daysLeft <= 30) return 'expiring_soon';
  return 'active';
}

export function getDaysLeft(product: RecallProduct): number | null {
  if (!product.warranty_expiry) return null;
  const now    = new Date();
  const expiry = new Date(product.warranty_expiry);
  return Math.ceil((expiry.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
}

// ─── Service status ───────────────────────────────────────────────────────────
export type ServiceStatus = 'ok' | 'due_soon' | 'overdue' | 'none';

export function getServiceStatus(product: RecallProduct): ServiceStatus {
  if (!product.next_service_date || product.service_interval_months === 0) return 'none';
  const now      = new Date();
  const nextDate = new Date(product.next_service_date);
  const daysUntil = Math.ceil((nextDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
  if (daysUntil < 0)   return 'overdue';
  if (daysUntil <= 30) return 'due_soon';
  return 'ok';
}

// ─── EMI computation (auto-calculated from start date) ───────────────────────

export interface EmiStatus {
  is_emi:             boolean;
  total_emis:         number;
  emis_paid:          number;
  emis_remaining:     number;
  amount_per_emi:     number;
  total_emi_amount:   number;   // emi_amount × total_emis
  down_payment:       number;
  total_cost:         number;   // down_payment + total_emi_amount
  total_interest:     number;   // total_cost - purchase_price
  amount_paid_so_far: number;   // down_payment + (emis_paid × emi_amount)
  amount_remaining:   number;   // emis_remaining × emi_amount
  next_emi_date:      string | null;
  is_fully_paid:      boolean;
  provider:           string;
  account_last4:      string;
}

export function getEmiStatus(product: RecallProduct): EmiStatus | null {
  if (!product.emi_enabled || !product.emi_start_date || product.emi_tenure_months <= 0) {
    return null;
  }

  const start       = new Date(product.emi_start_date);
  const now         = new Date();
  const monthsElapsed = Math.floor(
    (now.getFullYear() - start.getFullYear()) * 12 +
    (now.getMonth()    - start.getMonth())
  );

  const emis_paid      = Math.min(Math.max(monthsElapsed, 0), product.emi_tenure_months);
  const emis_remaining = Math.max(product.emi_tenure_months - emis_paid, 0);
  const total_emi_amount  = product.emi_amount * product.emi_tenure_months;
  const total_cost        = product.down_payment + total_emi_amount;
  const total_interest    = Math.max(total_cost - product.purchase_price, 0);
  const amount_paid_so_far = product.down_payment + emis_paid * product.emi_amount;
  const amount_remaining   = emis_remaining * product.emi_amount;
  const is_fully_paid      = emis_remaining === 0;

  // Next EMI date — start date + emis_paid months + 1
  let next_emi_date: string | null = null;
  if (!is_fully_paid) {
    const next = new Date(start);
    next.setMonth(next.getMonth() + emis_paid);
    next_emi_date = next.toISOString();
  }

  return {
    is_emi:            true,
    total_emis:        product.emi_tenure_months,
    emis_paid,
    emis_remaining,
    amount_per_emi:    product.emi_amount,
    total_emi_amount,
    down_payment:      product.down_payment,
    total_cost,
    total_interest,
    amount_paid_so_far,
    amount_remaining,
    next_emi_date,
    is_fully_paid,
    provider:          product.emi_bank_or_provider,
    account_last4:     product.emi_account_last4,
  };
}

// ─── Insurance status ────────────────────────────────────────────────────────
export type InsuranceStatus = 'active' | 'expiring_soon' | 'expired' | 'none';

export function getInsuranceStatus(product: RecallProduct): InsuranceStatus {
  if (!product.insurance_renewal_date) return 'none';
  const now     = new Date();
  const renewal = new Date(product.insurance_renewal_date);
  const daysLeft = Math.ceil((renewal.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
  if (daysLeft < 0)   return 'expired';
  if (daysLeft <= 30) return 'expiring_soon';
  return 'active';
}

// ─── Calculate next service date ──────────────────────────────────────────────
export function calcNextServiceDate(lastDate: string, intervalMonths: number): string {
  const d = new Date(lastDate);
  d.setMonth(d.getMonth() + intervalMonths);
  return d.toISOString();
}

// ─── Calculate warranty expiry ────────────────────────────────────────────────
export function calcWarrantyExpiry(purchaseDate: string, months: number): string | null {
  if (months <= 0) return null;
  const d = new Date(purchaseDate);
  d.setMonth(d.getMonth() + months);
  return d.toISOString();
}

// ─── Category emoji helper ────────────────────────────────────────────────────
export function getCategoryEmoji(category: RecallProduct['category']): string {
  return CATEGORIES.find(c => c.value === category)?.emoji ?? '📦';
}

// ─── CRUD ─────────────────────────────────────────────────────────────────────

export async function getProducts(userId: string): Promise<RecallProduct[]> {
  const all = await getAllByIndex<RecallProduct>('recall_products', 'user_id', userId);
  return all.sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime());
}

export async function saveProduct(
  userId: string,
  data: Partial<RecallProduct> & { name: string; category: RecallProduct['category'] },
  existingId?: string,
): Promise<RecallProduct> {
  const now = new Date().toISOString();

  let record: RecallProduct;

  if (existingId) {
    const existing = await get<RecallProduct>('recall_products', existingId);
    record = { ...existing!, ...data, id: existingId, user_id: userId, updated_at: now };
  } else {
    record = {
      id:                         uuidv4(),
      user_id:                    userId,
      name:                       data.name,
      category:                   data.category,
      brand:                      data.brand                      ?? '',
      model_number:               data.model_number               ?? '',
      serial_number:              data.serial_number              ?? '',
      purchase_date:              data.purchase_date              ?? now,
      purchase_price:             data.purchase_price             ?? 0,
      purchased_from:             data.purchased_from             ?? '',
      warranty_months:            data.warranty_months            ?? 0,
      warranty_expiry:            data.warranty_expiry            ?? null,
      extended_warranty:          data.extended_warranty          ?? false,
      extended_warranty_provider: data.extended_warranty_provider ?? '',
      extended_warranty_expiry:   data.extended_warranty_expiry   ?? null,
      service_interval_months:    data.service_interval_months    ?? 0,
      last_service_date:          data.last_service_date          ?? null,
      next_service_date:          data.next_service_date          ?? null,
      service_centre_name:        data.service_centre_name        ?? '',
      service_centre_phone:       data.service_centre_phone       ?? '',
      service_history:            data.service_history            ?? [],
      service_notes:              data.service_notes              ?? '',
      notes:                      data.notes                      ?? '',
      warranty_note:              data.warranty_note              ?? '',
      extended_warranty_note:     data.extended_warranty_note     ?? '',
      additional_warranties:      data.additional_warranties      ?? [],

      // Payment & EMI
      payment_mode:               data.payment_mode               ?? 'full',
      amount_paid_upfront:        data.amount_paid_upfront        ?? 0,
      emi_enabled:                data.emi_enabled                ?? false,
      emi_amount:                 data.emi_amount                 ?? 0,
      emi_tenure_months:          data.emi_tenure_months          ?? 0,
      emi_start_date:             data.emi_start_date             ?? null,
      emi_interest_rate:          data.emi_interest_rate          ?? 0,
      emi_bank_or_provider:       data.emi_bank_or_provider       ?? '',
      emi_account_last4:          data.emi_account_last4          ?? '',
      down_payment:               data.down_payment               ?? 0,

      // Insurance
      insurance_provider:         data.insurance_provider         ?? '',
      insurance_policy_number:    data.insurance_policy_number    ?? '',
      insurance_renewal_date:     data.insurance_renewal_date     ?? null,
      insurance_premium:          data.insurance_premium          ?? 0,
      emi_budget_added:           data.emi_budget_added           ?? false,

      created_at:                 now,
      updated_at:                 now,
    };
  }

  await put('recall_products', record);
  return record;
}

export async function deleteProduct(id: string): Promise<void> {
  await remove('recall_products', id);
}

export async function logService(
  productId: string,
  entry: { date: string; description: string; cost: number },
): Promise<RecallProduct | null> {
  const product = await get<RecallProduct>('recall_products', productId);
  if (!product) { return null; }

  const serviceEntry: ServiceEntry = { id: uuidv4(), ...entry };
  product.service_history = [...(product.service_history ?? []), serviceEntry]
    .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

  // Update last + next service dates
  product.last_service_date = entry.date;
  if (product.service_interval_months > 0) {
    product.next_service_date = calcNextServiceDate(entry.date, product.service_interval_months);
  }
  product.updated_at = new Date().toISOString();

  await put('recall_products', product);
  return product;
}

export async function deleteServiceEntry(
  productId: string,
  serviceId: string,
): Promise<void> {
  const product = await get<RecallProduct>('recall_products', productId);
  if (!product) { return; }
  product.service_history = product.service_history.filter(s => s.id !== serviceId);
  product.updated_at = new Date().toISOString();
  await put('recall_products', product);
}

// ─── Mark EMI as added to budget (so prompt never shows again) ───────────────
export async function markEmiBudgetAdded(productId: string): Promise<void> {
  const product = await get<RecallProduct>('recall_products', productId);
  if (!product) { return; }
  (product as any).emi_budget_added = true;
  product.updated_at = new Date().toISOString();
  await put('recall_products', product);
}
