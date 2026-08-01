import type { MyDB } from '../db';
import { getAllByIndex, put } from '@/integrations/storage/repository';
import { v4 as uuidv4 } from 'uuid';

/**
 * Fetches all monthly budget entries for a specific user from IndexedDB.
 * @param userId The ID of the user.
 * @returns An array of monthly budget entries.
 */
export async function getMonthlyBudgets(userId: string): Promise<MyDB['monthly_budgets']['value'][]> {
  return getAllByIndex<MyDB['monthly_budgets']['value']>('monthly_budgets', 'user_id', userId);
}

/**
 * Saves or updates a monthly budget entry for a specific user in IndexedDB.
 * @param userId The ID of the user.
 * @param budgetMonth The budget month in 'YYYY-MM' format (e.g., "2025-09").
 * @param startDate The start date of the budget period (Date object).
 * @param endDate The end date of the budget period (Date object).
 * @returns The saved or updated monthly budget entry.
 */
export async function saveMonthlyBudget(
  userId: string,
  budgetMonth: string,
  startDate: Date,
  endDate: Date
): Promise<MyDB['monthly_budgets']['value']> {
  const now = new Date().toISOString();
  const formattedStartDate = startDate.toISOString();
  const formattedEndDate = endDate.toISOString();

  // Try to find an existing budget for the user and month
  const existingBudgets = await getAllByIndex<MyDB['monthly_budgets']['value']>('monthly_budgets', 'user_id', userId);
  const existing = existingBudgets.find(b => b.budget_month === budgetMonth);

  let recordToSave: MyDB['monthly_budgets']['value'];

  if (existing) {
    recordToSave = {
      ...existing,
      budget_start_date: formattedStartDate,
      budget_end_date: formattedEndDate,
      updated_at: now,
    };
    await put('monthly_budgets', recordToSave);
  } else {
    recordToSave = {
      id: uuidv4(),
      user_id: userId,
      budget_month: budgetMonth,
      budget_start_date: formattedStartDate,
      budget_end_date: formattedEndDate,
      fixed_budget: 0, // Default, will be calculated by component
      variable_budget: 0, // Default, will be calculated by component
      total_budget: 0, // Default, will be calculated by component
      created_at: now,
      updated_at: now,
    };
    await put('monthly_budgets', recordToSave);
  }
  return recordToSave;
}