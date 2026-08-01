import type { MyDB } from '../db';
import { get, getAllByIndex, put, remove } from '@/integrations/storage/repository';
import { v4 as uuidv4 } from 'uuid';

type TdsEntry = MyDB['tds_entries']['value'];

export async function getTdsEntries(userId: string, financialYear: string): Promise<TdsEntry[]> {
  const all = await getAllByIndex<TdsEntry>('tds_entries', 'user_id', userId);
  return all.filter(r => r.financial_year === financialYear);
}

export async function addTdsEntry(
  userId: string,
  data: Omit<TdsEntry, 'id' | 'user_id' | 'created_at' | 'updated_at'>
): Promise<TdsEntry> {
  const now = new Date().toISOString();
  const record: TdsEntry = {
    id: uuidv4(),
    user_id: userId,
    ...data,
    created_at: now,
    updated_at: now,
  };
  await put('tds_entries', record);
  return record;
}

export async function updateTdsEntry(id: string, data: Partial<TdsEntry>): Promise<TdsEntry | null> {
  const existing = await get<TdsEntry>('tds_entries', id);
  if (!existing) return null;
  const record = { ...existing, ...data, updated_at: new Date().toISOString() };
  await put('tds_entries', record);
  return record;
}

export async function deleteTdsEntry(id: string): Promise<void> {
  await remove('tds_entries', id);
}
