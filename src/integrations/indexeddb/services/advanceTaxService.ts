import type { MyDB } from '../db';
import { getAllByIndex, put, remove } from '@/integrations/storage/repository';
import { v4 as uuidv4 } from 'uuid';

type AdvanceTaxPayment = MyDB['advance_tax_payments']['value'];

export async function getAdvanceTaxPayments(userId: string, financialYear: string): Promise<AdvanceTaxPayment[]> {
  const all = await getAllByIndex<AdvanceTaxPayment>('advance_tax_payments', 'user_id', userId);
  return all.filter(r => r.financial_year === financialYear);
}

export async function upsertAdvanceTaxPayment(
  userId: string,
  data: Partial<AdvanceTaxPayment> & { installment: AdvanceTaxPayment['installment']; financial_year: string }
): Promise<AdvanceTaxPayment> {
  const now = new Date().toISOString();
  const all = await getAllByIndex<AdvanceTaxPayment>('advance_tax_payments', 'user_id', userId);
  const existing = all.find(r => r.financial_year === data.financial_year && r.installment === data.installment);

  let record: AdvanceTaxPayment;
  if (existing) {
    record = { ...existing, ...data, user_id: userId, updated_at: now };
  } else {
    record = {
      id: uuidv4(),
      user_id: userId,
      financial_year: data.financial_year,
      installment: data.installment,
      due_date: data.due_date || '',
      estimated_amount: data.estimated_amount ?? 0,
      paid_amount: data.paid_amount ?? 0,
      paid_date: data.paid_date ?? null,
      is_paid: data.is_paid ?? false,
      created_at: now,
      updated_at: now,
    };
  }
  await put('advance_tax_payments', record);
  return record;
}

export async function deleteAdvanceTaxPayment(id: string): Promise<void> {
  await remove('advance_tax_payments', id);
}
