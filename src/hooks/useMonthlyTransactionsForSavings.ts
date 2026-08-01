"use client";

import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthContext";
import { getMonthlyTransactions } from "@/integrations/indexeddb/services/dataService";
import { getCurrentISTMonth } from "@/lib/date-utils";
import { startOfMonth, endOfMonth } from "date-fns";
import { MyDB } from '@/integrations/indexeddb/db'; // Import MyDB for transaction type

// Define WeeklyTransaction to match the filtered properties and type
type FullTransaction = MyDB['transactions']['value'];
interface MonthlyTransactionForSavings extends Pick<FullTransaction, 'amount' | 'transaction_date'> {
  type: 'income' | 'expense';
}

export const useMonthlyTransactionsForSavings = (onboardingCompleted: boolean) => {
  const { user } = useAuth();

  return useQuery<MonthlyTransactionForSavings[], Error>({
    queryKey: ['monthlyTransactionsForSavings', user?.id],
    queryFn: async () => {
      if (!user || !onboardingCompleted) {
        return [];
      }

      const currentMonth = getCurrentISTMonth();
      const startOfMonthDate = startOfMonth(new Date(`${currentMonth}-01`));
      const endOfMonthDate = endOfMonth(new Date(startOfMonthDate.getFullYear(), startOfMonthDate.getMonth() + 1, 0));
      
      const transactions = await getMonthlyTransactions(
        user.id,
        startOfMonthDate.toISOString(),
        endOfMonthDate.toISOString()
      );

      return (transactions || [])
        .filter(t => t.type === 'income' || t.type === 'expense')
        .map(t => ({
          amount: t.amount,
          type: t.type as 'income' | 'expense',
          transaction_date: t.transaction_date,
        }));
    },
    enabled: !!user && onboardingCompleted,
    staleTime: 1000 * 60 * 2, // Data considered fresh for 2 minutes
    refetchOnWindowFocus: true,
  });
};