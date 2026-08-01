import type { MyDB } from '../db';
import { getAllByIndex, get, put, remove } from '@/integrations/storage/repository';
import { v4 as uuidv4 } from 'uuid';

/**
 * Fetches variable budget entries for a specific user and budget month from IndexedDB.
 * @param userId The ID of the user.
 * @param budgetMonth The budget month in 'YYYY-MM-DD_YYYY-MM-DD' format.
 * @returns An array of variable budget entries.
 */
export async function getVariableBudgetEntries(userId: string, budgetMonth: string): Promise<MyDB['variable_budget_entries']['value'][]> {
  const entries = await getAllByIndex<MyDB['variable_budget_entries']['value']>('variable_budget_entries', 'user_id', userId);
  return entries.filter(entry => entry.budget_month === budgetMonth);
}

/**
 * Saves or updates a variable budget entry for a specific user in IndexedDB.
 * @param userId The ID of the user.
 * @param entry The variable budget entry object to save/update.
 * @returns The saved or updated variable budget entry.
 */
export async function saveVariableBudgetEntry(userId: string, entry: Partial<MyDB['variable_budget_entries']['value']> & { id?: string }): Promise<MyDB['variable_budget_entries']['value']> {
  const now = new Date().toISOString();
  let recordToSave: MyDB['variable_budget_entries']['value'];

  // Ensure allocated_amount is a valid number, default to 0 if not
  const safeAllocatedAmount = typeof entry.allocated_amount === 'number' && !isNaN(entry.allocated_amount) ? entry.allocated_amount : 0;

  if (entry.id) {
    const existing = await get<MyDB['variable_budget_entries']['value']>('variable_budget_entries', entry.id);
    if (existing) {
      recordToSave = {
        ...existing,
        ...entry,
        allocated_amount: safeAllocatedAmount,
        user_id: userId,
        updated_at: now,
      };
      await put('variable_budget_entries', recordToSave);
      console.log('IndexedDB: Updated variable budget entry:', recordToSave); // Added log
    } else {
      recordToSave = {
        id: uuidv4(),
        user_id: userId,
        created_at: now,
        updated_at: now,
        budget_month: entry.budget_month || '',
        category_name: entry.category_name || 'Unknown',
        allocated_amount: safeAllocatedAmount,
        notes: entry.notes || null,
        ...(Object.fromEntries(Object.entries(entry).filter(([key]) => key !== 'id')) as Partial<MyDB['variable_budget_entries']['value']>),
      };
      await put('variable_budget_entries', recordToSave);
      console.log('IndexedDB: Added new variable budget entry (ID provided but not found):', recordToSave); // Added log
    }
  } else {
    recordToSave = {
      id: uuidv4(),
      user_id: userId,
      created_at: now,
      updated_at: now,
      budget_month: entry.budget_month || '',
      category_name: entry.category_name || 'Unknown',
      allocated_amount: safeAllocatedAmount,
      notes: entry.notes || null,
      ...(Object.fromEntries(Object.entries(entry).filter(([key]) => key !== 'id')) as Partial<MyDB['variable_budget_entries']['value']>),
    };
    await put('variable_budget_entries', recordToSave);
    console.log('IndexedDB: Added new variable budget entry:', recordToSave); // Added log
  }
  return recordToSave;
}

/**
 * Deletes a variable budget entry from IndexedDB.
 * @param id The ID of the variable budget entry to delete.
 */
export async function deleteVariableBudgetEntry(id: string): Promise<void> {
  await remove('variable_budget_entries', id);
}