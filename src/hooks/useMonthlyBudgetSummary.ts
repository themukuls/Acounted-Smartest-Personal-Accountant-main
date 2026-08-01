"use client";

import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthContext";
import { format } from "date-fns";
import { getISTDate } from "@/lib/date-utils";
import { getIncomeDetails, getExpenseCategories } from "@/integrations/indexeddb/services/onboardingService";
import { getVariableBudgetEntries } from "@/integrations/indexeddb/services/variableBudgetService";

interface MonthlyBudgetSummaryData {
  totalIncomeDisplayed: number;
  fixedBudgetAmount: number;
  variableBudgetAmount: number;
  totalMonthlyIncome: number; // The base income for 50/30/20 rule
}

export const useMonthlyBudgetSummary = (onboardingCompleted: boolean) => {
  const { user } = useAuth();

  return useQuery<MonthlyBudgetSummaryData, Error>({
    queryKey: ['monthlyBudgetSummary', user?.id, onboardingCompleted],
    queryFn: async () => {
      if (!user || !onboardingCompleted) {
        return {
          totalIncomeDisplayed: 0,
          fixedBudgetAmount: 0,
          variableBudgetAmount: 0,
          totalMonthlyIncome: 0,
        };
      }

      const now = new Date();
      const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
      const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0);
      
      const budgetPeriodKey = `${format(startOfMonth, 'yyyy-MM-dd')}_${format(endOfMonth, 'yyyy-MM-dd')}`;

      const [
        incomeDetails,
        fixedExpensesData,
        variableBudgetData,
      ] = await Promise.all([
        getIncomeDetails(user.id),
        getExpenseCategories(user.id),
        getVariableBudgetEntries(user.id, budgetPeriodKey),
      ]);

      let monthlyIncome = 0;
      if (incomeDetails) {
        monthlyIncome += Number(incomeDetails.monthly_salary || incomeDetails.basic_salary || 0);
        monthlyIncome += Number(incomeDetails.monthly_other_income || 0);
        monthlyIncome += Number((incomeDetails.form_data as any)?.freelance_monthly_avg || 0);
      }

      let totalFixedExpenses = 0;
      fixedExpensesData?.forEach(expense => {
        if (expense.category_type === 'fixed') {
          if (expense.frequency === 'monthly') {
            totalFixedExpenses += Number(expense.amount);
          } else if (expense.frequency === 'annually') {
            totalFixedExpenses += Number(expense.amount) / 12;
          }
        }
      });

      const totalVariableBudget = variableBudgetData?.reduce((sum, entry) => sum + Number(entry.allocated_amount), 0) || 0;

      return {
        totalIncomeDisplayed: monthlyIncome,
        fixedBudgetAmount: totalFixedExpenses,
        variableBudgetAmount: totalVariableBudget,
        totalMonthlyIncome: monthlyIncome,
      };
    },
    enabled: !!user && onboardingCompleted,
    staleTime: 1000 * 60 * 2, // Data considered fresh for 2 minutes
    refetchOnWindowFocus: true,
  });
};