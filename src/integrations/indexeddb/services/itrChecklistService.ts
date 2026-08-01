import type { MyDB } from '../db';
import { getAllByIndex, put, remove } from '@/integrations/storage/repository';
import { v4 as uuidv4 } from 'uuid';

type ItrChecklistItem = MyDB['itr_checklist']['value'];

export async function getItrChecklist(userId: string, financialYear: string): Promise<ItrChecklistItem[]> {
  const all = await getAllByIndex<ItrChecklistItem>('itr_checklist', 'user_id', userId);
  return all.filter(r => r.financial_year === financialYear);
}

export async function upsertItrChecklistItem(
  userId: string,
  financialYear: string,
  itemKey: string,
  category: string,
  isCompleted: boolean,
  notes: string | null = null
): Promise<ItrChecklistItem> {
  const all = await getAllByIndex<ItrChecklistItem>('itr_checklist', 'user_id', userId);
  const existing = all.find(r => r.financial_year === financialYear && r.item_key === itemKey);

  const now = new Date().toISOString();
  let record: ItrChecklistItem;

  if (existing) {
    record = { ...existing, is_completed: isCompleted, notes, updated_at: now };
  } else {
    record = {
      id: uuidv4(),
      user_id: userId,
      financial_year: financialYear,
      item_key: itemKey,
      category,
      is_completed: isCompleted,
      notes,
      updated_at: now,
    };
  }
  await put('itr_checklist', record);
  return record;
}

export async function clearItrChecklist(userId: string, financialYear: string): Promise<void> {
  const all = await getAllByIndex<ItrChecklistItem>('itr_checklist', 'user_id', userId);
  for (const item of all) {
    if (item.financial_year === financialYear) {
      await remove('itr_checklist', item.id);
    }
  }
}
