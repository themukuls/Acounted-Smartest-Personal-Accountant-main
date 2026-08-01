import type { MyDB } from '../db';
import { getAllByIndex, get, put, remove } from '@/integrations/storage/repository';
import { v4 as uuidv4 } from 'uuid';
import { format } from 'date-fns'; // Import format for logging
import { convertToIST } from '@/lib/date-utils'; // Import convertToIST
import { DEFAULT_ACCOUNT } from '@/lib/categories';

/**
 * Fetches transactions for a user within a specified date range, optionally filtered by type, from IndexedDB.
 * @param userId The ID of the user.
 * @param startDate The start date of the range (ISO string).
 * @param endDate The end date of the range (ISO string).
 * @param type Optional: 'income' or 'expense' to filter transactions.
 * @param excludeCreditCard Optional: If true, excludes transactions with account 'credit-card'.
 * @returns An array of transactions.
 */
export async function getMonthlyTransactions(userId: string, startDate: string, endDate: string, type?: 'income' | 'expense', excludeCreditCard?: boolean): Promise<MyDB['transactions']['value'][]> {
  const allUserTransactions = await getAllByIndex<MyDB['transactions']['value']>('transactions', 'user_id', userId);

  // Convert input ISO strings to IST Date objects for consistent comparison
  const startIST = convertToIST(startDate);
  const endIST = convertToIST(endDate);

  console.log(`[getMonthlyTransactions] Filtering for userId: ${userId}, range: ${format(startIST, 'yyyy-MM-dd HH:mm:ss')} IST to ${format(endIST, 'yyyy-MM-dd HH:mm:ss')} IST, type: ${type || 'any'}, excludeCreditCard: ${excludeCreditCard}`);

  return allUserTransactions.filter(transaction => {
    const transactionDateIST = convertToIST(transaction.transaction_date); // Convert transaction date to IST
    const isWithinDateRange = transactionDateIST >= startIST && transactionDateIST <= endIST;
    const isMatchingType = type ? transaction.type === type : true;
    const isNotCreditCard = excludeCreditCard ? transaction.account !== 'credit-card' : true;

    console.log(`  - Transaction ID: ${transaction.id}, Date: ${format(transactionDateIST, 'yyyy-MM-dd HH:mm:ss')} IST, Type: ${transaction.type}, Account: ${transaction.account}, Amount: ${transaction.amount}`);
    console.log(`    - isWithinDateRange: ${isWithinDateRange}, isMatchingType: ${isMatchingType}, isNotCreditCard: ${isNotCreditCard}`);
    
    return isWithinDateRange && isMatchingType && isNotCreditCard;
  });
}

/**
 * Fetches the most recent transactions for a specific user from IndexedDB.
 * @param userId The ID of the user.
 * @param limit The maximum number of recent transactions to return.
 * @returns An array of recent transactions, sorted by date descending.
 */
export async function getRecentTransactions(userId: string, limit: number = 2): Promise<MyDB['transactions']['value'][]> {
  const allUserTransactions = await getAllByIndex<MyDB['transactions']['value']>('transactions', 'user_id', userId);

  // Sort transactions by date in descending order, converting to IST for consistent comparison
  const sortedTransactions = allUserTransactions.sort((a, b) => 
    convertToIST(b.transaction_date).getTime() - convertToIST(a.transaction_date).getTime()
  );

  // Return the limited number of recent transactions
  return sortedTransactions.slice(0, limit);
}

/**
 * Saves or updates a transaction entry for a specific user in IndexedDB.
 * @param userId The ID of the user.
 * @param transaction The transaction object to save/update.
 * @returns The saved or updated transaction entry.
 */
export async function saveTransaction(userId: string, transaction: Partial<MyDB['transactions']['value']> & { id?: string }): Promise<MyDB['transactions']['value']> {
  const now = new Date().toISOString();
  let recordToSave: MyDB['transactions']['value'];

  // Ensure amount is a valid number, default to 0 if not
  const safeAmount = typeof transaction.amount === 'number' && !isNaN(transaction.amount) ? transaction.amount : 0;

  if (transaction.id) {
    const existing = await get<MyDB['transactions']['value']>('transactions', transaction.id);
    if (existing) {
      recordToSave = {
        ...existing,
        ...transaction,
        amount: safeAmount,
        user_id: userId,
        updated_at: now,
      };
      await put('transactions', recordToSave);
    } else {
      // If ID is provided but not found, treat as new
      recordToSave = {
        id: uuidv4(),
        user_id: userId,
        created_at: now,
        updated_at: now,
        type: transaction.type || 'expense', // Default type
        amount: safeAmount,
        category: transaction.category || 'Other',
        // UPI, not cash — see DEFAULT_ACCOUNT in src/lib/categories.ts.
        account: transaction.account || DEFAULT_ACCOUNT,
        description: transaction.description || null,
        transaction_date: transaction.transaction_date || now,
        ...(Object.fromEntries(Object.entries(transaction).filter(([key]) => key !== 'id')) as Partial<MyDB['transactions']['value']>),
      };
      await put('transactions', recordToSave);
    }
  } else {
    recordToSave = {
      id: uuidv4(),
      user_id: userId,
      created_at: now,
      updated_at: now,
      type: transaction.type || 'expense', // Default type
      amount: safeAmount,
      category: transaction.category || 'Other',
      // UPI, not cash — see DEFAULT_ACCOUNT in src/lib/categories.ts.
      account: transaction.account || DEFAULT_ACCOUNT,
      description: transaction.description || null,
      transaction_date: transaction.transaction_date || now,
      ...(Object.fromEntries(Object.entries(transaction).filter(([key]) => key !== 'id')) as Partial<MyDB['transactions']['value']>),
    };
    await put('transactions', recordToSave);
  }
  return recordToSave;
}

/**
 * Deletes a transaction entry from IndexedDB.
 * @param id The ID of the transaction to delete.
 */
export async function deleteTransaction(id: string): Promise<void> {
  await remove('transactions', id);
}