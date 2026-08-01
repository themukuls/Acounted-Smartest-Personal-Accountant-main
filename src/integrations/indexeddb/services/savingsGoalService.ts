import type { MyDB } from '../db';
import { getAllByIndex, get, put, remove } from '@/integrations/storage/repository';
import { v4 as uuidv4 } from 'uuid'; // Added import

/**
 * Fetches all savings goals for a specific user from IndexedDB.
 * @param userId The ID of the user.
 * @returns An array of savings goals.
 */
export async function getSavingsGoals(userId: string): Promise<MyDB['savings_goals']['value'][]> {
  return getAllByIndex<MyDB['savings_goals']['value']>('savings_goals', 'user_id', userId);
}

/**
 * Saves or updates a savings goal entry for a specific user in IndexedDB.
 * @param userId The ID of the user.
 * @param goal The savings goal object to save/update.
 * @returns The saved or updated savings goal entry.
 */
export async function saveSavingsGoal(userId: string, goal: Partial<MyDB['savings_goals']['value']> & { id?: string }): Promise<MyDB['savings_goals']['value']> {
  const now = new Date().toISOString();
  let recordToSave: MyDB['savings_goals']['value'];

  // Ensure numeric fields are valid
  const safeGoal = { ...goal };
  const numericFields: Array<keyof MyDB['savings_goals']['value']> = [
    'goal_amount', 'target_months', 'monthly_save_amount',
    'weekly_save_amount', 'monthly_spend_amount', 'weekly_spend_amount'
  ];
  numericFields.forEach(field => {
    const value = safeGoal[field];
    if (typeof value === 'string') {
      const parsed = parseFloat(value);
      (safeGoal as any)[field] = isNaN(parsed) ? null : parsed;
    } else if (typeof value === 'number' && isNaN(value)) {
      (safeGoal as any)[field] = null;
    }
  });

  if (safeGoal.id) {
    const existing = await get<MyDB['savings_goals']['value']>('savings_goals', safeGoal.id);
    if (existing) {
      recordToSave = {
        ...existing,
        ...safeGoal,
        user_id: userId,
        updated_at: now,
      };
      await put('savings_goals', recordToSave);
    } else {
      recordToSave = {
        id: uuidv4(),
        user_id: userId,
        created_at: now,
        updated_at: now,
        goal_name: safeGoal.goal_name || 'New Goal',
        goal_amount: safeGoal.goal_amount || 0,
        target_months: safeGoal.target_months || 1,
        monthly_save_amount: safeGoal.monthly_save_amount || 0,
        weekly_save_amount: safeGoal.weekly_save_amount || 0,
        monthly_spend_amount: safeGoal.monthly_spend_amount || 0,
        weekly_spend_amount: safeGoal.weekly_spend_amount || 0,
        ...(Object.fromEntries(Object.entries(safeGoal).filter(([key]) => key !== 'id')) as Partial<MyDB['savings_goals']['value']>),
      };
      await put('savings_goals', recordToSave);
    }
  } else {
    recordToSave = {
      id: uuidv4(),
      user_id: userId,
      created_at: now,
      updated_at: now,
      goal_name: safeGoal.goal_name || 'New Goal',
      goal_amount: safeGoal.goal_amount || 0,
      target_months: safeGoal.target_months || 1,
      monthly_save_amount: safeGoal.monthly_save_amount || 0,
      weekly_save_amount: safeGoal.weekly_save_amount || 0,
      monthly_spend_amount: safeGoal.monthly_spend_amount || 0,
      weekly_spend_amount: safeGoal.weekly_spend_amount || 0,
      ...(Object.fromEntries(Object.entries(safeGoal).filter(([key]) => key !== 'id')) as Partial<MyDB['savings_goals']['value']>),
    };
    await put('savings_goals', recordToSave);
  }
  return recordToSave;
}

/**
 * Deletes a savings goal entry from IndexedDB.
 * @param id The ID of the savings goal to delete.
 */
export async function deleteSavingsGoal(id: string): Promise<void> {
  await remove('savings_goals', id);
}