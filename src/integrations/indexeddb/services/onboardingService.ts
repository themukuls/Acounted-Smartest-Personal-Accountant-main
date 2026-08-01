import type { MyDB } from '../db';
import { getAllByIndex, get, put, remove } from '@/integrations/storage/repository';
import { v4 as uuidv4 } from 'uuid';

// --- Income Details ---
export async function getIncomeDetails(userId: string): Promise<MyDB['income_details']['value'] | null> {
  const matches = await getAllByIndex<MyDB['income_details']['value']>('income_details', 'user_id', userId);
  return matches[0] ?? null;
}

export async function saveIncomeDetails(userId: string, payload: Partial<MyDB['income_details']['value']>): Promise<MyDB['income_details']['value']> {
  const existingMatches = await getAllByIndex<MyDB['income_details']['value']>('income_details', 'user_id', userId);
  const existing = existingMatches[0];
  const now = new Date().toISOString();

  let recordToSave: MyDB['income_details']['value'];

  // Safely parse numeric fields from payload
  const safePayload = { ...payload };
  const numericFields: Array<keyof MyDB['income_details']['value']> = [
    'monthly_salary', // Removed 'basic_salary' and 'other_allowances'
    'monthly_other_income', 'hra', 'standard_deduction'
  ];
  numericFields.forEach(field => {
    const value = safePayload[field];
    if (typeof value === 'string') {
      const parsed = parseFloat(value);
      (safePayload as any)[field] = isNaN(parsed) ? null : parsed; // Type assertion
    } else if (typeof value === 'number' && isNaN(value)) {
      (safePayload as any)[field] = null; // Type assertion
    }
  });

  // Also for form_data, if it contains numeric fields
  if (safePayload.form_data && typeof safePayload.form_data === 'object') {
    const formDataNumericFields = ['freelance_monthly_avg', 'freelance_yearly_target']; // Removed 'tds'
    formDataNumericFields.forEach(field => {
      const value = (safePayload.form_data as any)[field];
      if (typeof value === 'string') {
        const parsed = parseFloat(value);
        (safePayload.form_data as any)[field] = isNaN(parsed) ? null : parsed;
      } else if (typeof value === 'number' && isNaN(value)) {
        (safePayload.form_data as any)[field] = null;
      }
    });
  }

  // Hardcode basic_salary and other_allowances to 0
  safePayload.basic_salary = 0;
  safePayload.other_allowances = 0;


  if (existing) {
    recordToSave = {
      ...existing,
      ...safePayload, // Use safePayload here
      user_id: userId, // Ensure user_id is not changed
      updated_at: now,
    };
    await put('income_details', recordToSave);
  } else {
    recordToSave = {
      id: uuidv4(),
      user_id: userId,
      created_at: now,
      updated_at: now,
      income_type: '', // Default values for required fields
      monthly_salary: null,
      basic_salary: null,
      // Removed: bonus: null,
      other_allowances: null,
      monthly_other_income: null,
      // Removed: tax_regime: null,
      form_data: null,
      full_name: null,
      pan: null,
      hra: null,
      standard_deduction: null,
      ...safePayload, // Use safePayload here
    };
    await put('income_details', recordToSave);
  }
  return recordToSave;
}

// --- Expense Categories ---
export async function getExpenseCategories(userId: string): Promise<MyDB['expense_categories']['value'][]> {
  return getAllByIndex<MyDB['expense_categories']['value']>('expense_categories', 'user_id', userId);
}

export async function saveExpenseCategory(userId: string, category: Partial<MyDB['expense_categories']['value']> & { id?: string }): Promise<MyDB['expense_categories']['value']> {
  const now = new Date().toISOString();
  let recordToSave: MyDB['expense_categories']['value'];

  // Ensure amount is a valid number, default to 0 if not
  const safeAmount = typeof category.amount === 'number' && !isNaN(category.amount) ? category.amount : 0;
  const safeFrequency = category.frequency || 'monthly'; // Default frequency
  const safeCategoryType = category.category_type || 'variable'; // Default to 'variable' for new/managed categories

  if (category.id) {
    const existing = await get<MyDB['expense_categories']['value']>('expense_categories', category.id);
    if (existing) {
      recordToSave = {
        ...existing,
        ...category,
        amount: safeAmount, // Explicitly set safeAmount
        frequency: safeFrequency, // Explicitly set safeFrequency
        category_type: safeCategoryType, // Explicitly set safeCategoryType
        user_id: userId,
        updated_at: now,
      };
      await put('expense_categories', recordToSave);
      console.log('IndexedDB: Updated expense category:', recordToSave); // Added log
    } else {
      // If ID is provided but not found, treat as new
      recordToSave = {
        id: uuidv4(), // NEW ID HERE
        user_id: userId,
        created_at: now,
        updated_at: now,
        category_name: category.category_name || 'Unknown',
        amount: safeAmount, // Explicitly set safeAmount
        frequency: safeFrequency, // Explicitly set safeFrequency
        category_type: safeCategoryType, // Explicitly set safeCategoryType
        // Filter out 'id' from the spread to ensure uuidv4() is used
        ...(Object.fromEntries(Object.entries(category).filter(([key]) => key !== 'id')) as Partial<MyDB['expense_categories']['value']>),
      };
      await put('expense_categories', recordToSave);
      console.log('IndexedDB: Added new expense category (ID provided but not found):', recordToSave); // Added log
    }
  } else {
    const existingByName = (await getAllByIndex<MyDB['expense_categories']['value']>('expense_categories', 'user_id', userId)).find(
      (e) => e.category_name === category.category_name
    );

    if (existingByName) {
      recordToSave = {
        ...existingByName,
        ...category,
        amount: safeAmount, // Explicitly set safeAmount
        frequency: safeFrequency, // Explicitly set safeFrequency
        category_type: safeCategoryType, // Explicitly set safeCategoryType
        user_id: userId,
        updated_at: now,
      };
      await put('expense_categories', recordToSave);
      console.log('IndexedDB: Updated expense category (by name):', recordToSave); // Added log
    } else {
      recordToSave = {
        id: uuidv4(), // NEW ID HERE
        user_id: userId,
        created_at: now,
        updated_at: now,
        category_name: category.category_name || 'Unknown',
        amount: safeAmount, // Explicitly set safeAmount
        frequency: safeFrequency, // Explicitly set safeFrequency
        category_type: safeCategoryType, // Explicitly set safeCategoryType
        // Filter out 'id' from the spread to ensure uuidv4() is used
        ...(Object.fromEntries(Object.entries(category).filter(([key]) => key !== 'id')) as Partial<MyDB['expense_categories']['value']>),
      };
      await put('expense_categories', recordToSave);
      console.log('IndexedDB: Added new expense category:', recordToSave); // Added log
    }
  }
  return recordToSave;
}

export async function deleteExpenseCategory(id: string): Promise<void> {
  await remove('expense_categories', id);
}

// --- Investment Types ---
export async function getInvestmentTypes(userId: string): Promise<MyDB['investment_types']['value'][]> {
  return getAllByIndex<MyDB['investment_types']['value']>('investment_types', 'user_id', userId);
}

export async function saveInvestmentType(userId: string, investment: Partial<MyDB['investment_types']['value']> & { id?: string }): Promise<MyDB['investment_types']['value']> {
  const now = new Date().toISOString();
  let recordToSave: MyDB['investment_types']['value'];

  // Ensure amount and interest_rate are valid numbers, default to 0/null if not
  const safeAmount = typeof investment.amount === 'number' && !isNaN(investment.amount) ? investment.amount : 0;
  const safeInterestRate = typeof investment.interest_rate === 'number' && !isNaN(investment.interest_rate) ? investment.interest_rate : null; // Can be null

  if (investment.id) {
    const existing = await get<MyDB['investment_types']['value']>('investment_types', investment.id);
    if (existing) {
      recordToSave = {
        ...existing,
        ...investment,
        amount: safeAmount,
        interest_rate: safeInterestRate,
        user_id: userId,
        updated_at: now,
      };
      await put('investment_types', recordToSave);
    } else {
      recordToSave = {
        id: uuidv4(),
        user_id: userId,
        created_at: now,
        updated_at: now,
        investment_name: investment.investment_name || 'Unknown',
        amount: safeAmount,
        investment_type: investment.investment_type || 'other',
        risk_level: investment.risk_level || 'medium',
        interest_rate: safeInterestRate,
        // Filter out 'id' from the spread to ensure uuidv4() is used
        ...(Object.fromEntries(Object.entries(investment).filter(([key]) => key !== 'id')) as Partial<MyDB['investment_types']['value']>),
      };
      await put('investment_types', recordToSave);
    }
  } else {
    const existingByName = (await getAllByIndex<MyDB['investment_types']['value']>('investment_types', 'user_id', userId)).find(
      (e) => e.investment_name === investment.investment_name
    );

    if (existingByName) {
      recordToSave = {
        ...existingByName,
        ...investment,
        amount: safeAmount,
        interest_rate: safeInterestRate,
        user_id: userId,
        updated_at: now,
      };
      await put('investment_types', recordToSave);
    } else {
      recordToSave = {
        id: uuidv4(),
        user_id: userId,
        created_at: now,
        updated_at: now,
        investment_name: investment.investment_name || 'Unknown',
        amount: safeAmount,
        investment_type: investment.investment_type || 'other',
        risk_level: investment.risk_level || 'medium',
        interest_rate: safeInterestRate,
        // Filter out 'id' from the spread to ensure uuidv4() is used
        ...(Object.fromEntries(Object.entries(investment).filter(([key]) => key !== 'id')) as Partial<MyDB['investment_types']['value']>),
      };
      await put('investment_types', recordToSave);
    }
  }
  console.log('IndexedDB: Investment saved/updated:', recordToSave); // Added log
  return recordToSave;
}

export async function deleteInvestmentType(id: string): Promise<void> {
  await remove('investment_types', id);
}