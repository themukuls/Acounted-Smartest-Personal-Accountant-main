"use client";

import { useState, useEffect, useCallback } from "react";
import { useAuth } from "@/contexts/AuthContext";
import {
  startOfMonth,
  endOfMonth,
  startOfWeek,
  endOfWeek,
  addDays,
  differenceInDays,
  isWithinInterval,
  format,
  max, // Import max
  min, // Import min
  startOfDay, // Import startOfDay
  isSameWeek, // Import isSameWeek
} from "date-fns";
import { getISTDate, getWeeksInDateRange } from "@/lib/date-utils";
import { getIncomeDetails, getExpenseCategories } from "@/integrations/indexeddb/services/onboardingService";
import { getVariableBudgetEntries } from "@/integrations/indexeddb/services/variableBudgetService";
import { getSavingsGoals } from "@/integrations/indexeddb/services/savingsGoalService";
import { getMonthlyTransactions } from "@/integrations/indexeddb/services/dataService";
import { useQuery } from "@tanstack/react-query"; // Import useQuery

interface WeeklyProjection {
  label: string;
  amount: number;
  daysInWeek: number;
}

interface UseWeeklyBudgetProjectionsProps {
  onboardingCompleted: boolean;
  selectedWeekKey?: string | null; // New prop: key for the actively selected week (e.g., 'YYYY-MM-DD_YYYY-MM-DD')
}

interface UseWeeklyBudgetProjectionsReturn {
  loading: boolean;
  actualAllowedThisWeek: number;
  remainingOverspent: number;
  monthlyBudgetSpentPercentage: number;
  monthlyBudgetSpentAmount: number;
  upcomingProjections: WeeklyProjection[];
  daysInCurrentWeek: number;
  monthStart: Date;
  monthEnd: Date;
  currentWeekCalendarStart: Date;
  currentWeekCalendarEnd: Date;
  displayCurrentWeekStart: Date;
  displayCurrentWeekEnd: Date;
  allWeeksInMonth: Array<{ start: Date; end: Date; label: string; value: string; daysInWeek: number }>; // New return value
}

export const useWeeklyBudgetProjections = ({ onboardingCompleted, selectedWeekKey }: UseWeeklyBudgetProjectionsProps): UseWeeklyBudgetProjectionsReturn => {
  const { user } = useAuth();

  const { data, isLoading, isError } = useQuery<Omit<UseWeeklyBudgetProjectionsReturn, 'loading'>, Error>({
    queryKey: ['weeklyBudgetProjections', user?.id, onboardingCompleted, selectedWeekKey],
    queryFn: async () => {
      if (!user || !onboardingCompleted) {
        const now = new Date();
        return {
          actualAllowedThisWeek: 0,
          remainingOverspent: 0,
          monthlyBudgetSpentPercentage: 0,
          monthlyBudgetSpentAmount: 0,
          upcomingProjections: [],
          daysInCurrentWeek: 0,
          monthStart: now,
          monthEnd: now,
          currentWeekCalendarStart: now,
          currentWeekCalendarEnd: now,
          displayCurrentWeekStart: now,
          displayCurrentWeekEnd: now,
          allWeeksInMonth: [],
        };
      }

      const today = getISTDate();
      const calculatedMonthStart = startOfMonth(today);
      const calculatedMonthEnd = endOfMonth(today);

      const totalDaysInMonth = differenceInDays(calculatedMonthEnd, calculatedMonthStart) + 1;

      // 1. Fetch Income Details (Planned Monthly Income) from IndexedDB
      const incomeDetails = await getIncomeDetails(user.id);

      let plannedMonthlyIncome = 0;
      if (incomeDetails) {
        plannedMonthlyIncome += (incomeDetails.monthly_salary || incomeDetails.basic_salary || 0);
        plannedMonthlyIncome += (incomeDetails.monthly_other_income || 0);
        // ADDED: Include freelance monthly average
        plannedMonthlyIncome += Number((incomeDetails.form_data as any)?.freelance_monthly_avg || 0);
      }

      // 2. Fetch Fixed Expenses from IndexedDB
      const fixedExpensesData = await getExpenseCategories(user.id);

      let totalFixedExpenses = 0;
      fixedExpensesData?.forEach(expense => {
        if (expense.frequency === 'monthly') {
          totalFixedExpenses += expense.amount;
        } else if (expense.frequency === 'annually') {
          totalFixedExpenses += expense.amount / 12;
        } else if (expense.frequency === 'quarterly') {
          totalFixedExpenses += expense.amount / 3;
        }
      });

      // 3. Fetch Variable Budget Allocations for the current month from IndexedDB
      const budgetPeriodKeyForVariableEntries = `${format(calculatedMonthStart, 'yyyy-MM-dd')}_${format(calculatedMonthEnd, 'yyyy-MM-dd')}`;
      const variableBudgetData = await getVariableBudgetEntries(user.id, budgetPeriodKeyForVariableEntries);

      const totalVariableBudgetAllocated = variableBudgetData?.reduce((sum, entry) => sum + Number(entry.allocated_amount), 0) || 0;

      // 4. Fetch Savings Goals from IndexedDB
      const savingsGoalsData = await getSavingsGoals(user.id);

      const totalMonthlySavingsTarget = savingsGoalsData?.reduce((sum, goal) => sum + (goal.goal_amount / goal.target_months), 0) || 0;

      // 5. Calculate Discretionary Monthly Budget (Planned flexible spending limit)
      // MODIFIED: Removed Math.max(0, ...) to allow negative DMB
      const discretionaryMonthlyBudget = plannedMonthlyIncome - totalFixedExpenses - totalVariableBudgetAllocated - totalMonthlySavingsTarget;
      
      // Get all weeks in the current month
      const allWeeks = getWeeksInDateRange(calculatedMonthStart, calculatedMonthEnd).map(week => ({
        ...week,
        value: `${format(week.start, 'yyyy-MM-dd')}_${format(week.end, 'yyyy-MM-dd')}`
      }));

      // Determine the target week based on selectedWeekKey or default to current calendar week
      let targetWeekSummary = allWeeks.find(week => week.value === selectedWeekKey);
      if (!targetWeekSummary) {
        // If no selectedWeekKey or it's invalid, find the week containing 'today'
        targetWeekSummary = allWeeks.find(week => isSameWeek(today, week.start, { weekStartsOn: 1 }));
      }

      // If still no target week (e.g., month has no weeks, or today is outside all defined weeks), use a fallback
      if (!targetWeekSummary && allWeeks.length > 0) {
        targetWeekSummary = allWeeks[0]; // Fallback to the first week of the month
      } else if (!targetWeekSummary) {
        // If no weeks at all, set to default values
        return {
          actualAllowedThisWeek: 0,
          remainingOverspent: 0,
          monthlyBudgetSpentPercentage: 0,
          monthlyBudgetSpentAmount: 0,
          upcomingProjections: [],
          daysInCurrentWeek: 0,
          monthStart: calculatedMonthStart,
          monthEnd: calculatedMonthEnd,
          currentWeekCalendarStart: calculatedMonthStart,
          currentWeekCalendarEnd: calculatedMonthEnd,
          displayCurrentWeekStart: calculatedMonthStart,
          displayCurrentWeekEnd: calculatedMonthEnd,
          allWeeksInMonth: allWeeks,
        };
      }

      const currentWeekStart = targetWeekSummary.start;
      const currentWeekEnd = targetWeekSummary.end;

      const calculatedDisplayCurrentWeekStart = max([currentWeekStart, calculatedMonthStart]);
      const calculatedDisplayCurrentWeekEnd = min([currentWeekEnd, calculatedMonthEnd]);

      const daysOfCurrentWeekInCurrentMonth = differenceInDays(
        calculatedDisplayCurrentWeekEnd,
        calculatedDisplayCurrentWeekStart
      ) + 1;
      const actualDaysOfCurrentWeekInCurrentMonth = Math.max(0, daysOfCurrentWeekInCurrentMonth);

      // 8. Fetch ALL transactions for the current month (income and expense) from IndexedDB
      // IMPORTANT: Exclude credit card transactions from these calculations
      const allMonthTransactions = await getMonthlyTransactions(
        user.id,
        calculatedMonthStart.toISOString(),
        calculatedMonthEnd.toISOString(),
        undefined, // No type filter
        true // EXCLUDE CREDIT CARD TRANSACTIONS
      );

      const transactions = allMonthTransactions || [];

      // Calculate actual income and expenses *before* the current selected week
      const actualIncomeBeforeCurrentWeek = transactions
        .filter(tx => tx.type === 'income' && new Date(tx.transaction_date) < currentWeekStart)
        .reduce((sum, tx) => sum + tx.amount, 0);

      const actualExpensesBeforeCurrentWeek = transactions
        .filter(tx => tx.type === 'expense' && new Date(tx.transaction_date) < currentWeekStart)
        .reduce((sum, tx) => sum + tx.amount, 0);

      const netBalanceBeforeCurrentWeek = actualIncomeBeforeCurrentWeek - actualExpensesBeforeCurrentWeek;

      // 9. Calculate Budget Remaining for Current Selected & Future Weeks (DMB adjusted by net balance from previous weeks)
      const budgetRemainingForCurrentAndFutureWeeks = discretionaryMonthlyBudget + netBalanceBeforeCurrentWeek;

      // 10. Calculate days remaining from current selected week start to month end (inclusive)
      const daysRemainingFromCWStartToEndOfMonth = differenceInDays(calculatedMonthEnd, calculatedDisplayCurrentWeekStart) + 1;

      // 11. Calculate Fixed Allowance for the Current Selected Week (`actualAllowedThisWeek`)
      let calculatedActualAllowedThisWeek = 0;
      if (daysRemainingFromCWStartToEndOfMonth > 0) {
        const dailyRateForRemainingMonth = budgetRemainingForCurrentAndFutureWeeks / daysRemainingFromCWStartToEndOfMonth;
        calculatedActualAllowedThisWeek = dailyRateForRemainingMonth * actualDaysOfCurrentWeekInCurrentMonth;
      }

      // 12. Calculate actual income and expenses *in* the current selected week (so far)
      const incomeInCurrentWeek = transactions
        .filter(tx => tx.type === 'income' && isWithinInterval(new Date(tx.transaction_date), { start: currentWeekStart, end: currentWeekEnd }))
        .reduce((sum, tx) => sum + tx.amount, 0);

      const expensesInCurrentWeek = transactions
        .filter(tx => tx.type === 'expense' && isWithinInterval(new Date(tx.transaction_date), { start: currentWeekStart, end: currentWeekEnd }))
        .reduce((sum, tx) => sum + tx.amount, 0);

      // 13. Calculate Remaining / Overspent for the current selected week (against its fixed allowance)
      const calculatedRemainingOverspent = calculatedActualAllowedThisWeek - expensesInCurrentWeek + incomeInCurrentWeek;

      // 14. Calculate total actual income and expenses up to the end of the current selected week
      const totalActualIncomeUpToCurrentWeekEnd = transactions
        .filter(tx => tx.type === 'income' && new Date(tx.transaction_date) <= currentWeekEnd)
        .reduce((sum, tx) => sum + tx.amount, 0);

      const totalActualExpensesUpToCurrentWeekEnd = transactions
        .filter(tx => tx.type === 'expense' && new Date(tx.transaction_date) <= currentWeekEnd)
        .reduce((sum, tx) => sum + tx.amount, 0);

      // 15. Set monthly budget spent amount and percentage (based on DMB and actual expenses)
      const monthlyBudgetSpentAmount = totalActualExpensesUpToCurrentWeekEnd;
      const monthlyBudgetSpentPercentage = discretionaryMonthlyBudget > 0 ? (totalActualExpensesUpToCurrentWeekEnd / discretionaryMonthlyBudget) * 100 : 0;

      // 16. Generate upcoming projections (dynamic for future weeks, factoring in actual net balance)
      const calculatedUpcomingProjections: WeeklyProjection[] = [];
      
      const futureWeeks = allWeeks.filter(week => week.start > currentWeekEnd);
      const totalDaysInFutureWeeks = futureWeeks.reduce((sum, week) => week.daysInWeek > 0 ? sum + week.daysInWeek : sum, 0);

      const remainingBudgetForFuture = discretionaryMonthlyBudget + (totalActualIncomeUpToCurrentWeekEnd - totalActualExpensesUpToCurrentWeekEnd);

      const dynamicDailyAllowedForFuture = totalDaysInFutureWeeks > 0 ? remainingBudgetForFuture / totalDaysInFutureWeeks : 0;

      futureWeeks.forEach(week => {
        const daysOfFutureWeekInBudgetPeriod = differenceInDays(
          min([week.end.getTime(), calculatedMonthEnd.getTime()]),
          max([week.start.getTime(), calculatedMonthStart.getTime()])
        ) + 1;
        const actualDaysForFutureProjection = Math.max(0, daysOfFutureWeekInBudgetPeriod);

        const projectedAmount = dynamicDailyAllowedForFuture * actualDaysForFutureProjection;
        if (actualDaysForFutureProjection > 0) {
          calculatedUpcomingProjections.push({ label: week.label, amount: projectedAmount, daysInWeek: actualDaysForFutureProjection });
        }
      });

      return {
        actualAllowedThisWeek: calculatedActualAllowedThisWeek,
        remainingOverspent: calculatedRemainingOverspent,
        monthlyBudgetSpentPercentage,
        monthlyBudgetSpentAmount,
        upcomingProjections: calculatedUpcomingProjections,
        daysInCurrentWeek: actualDaysOfCurrentWeekInCurrentMonth,
        monthStart: calculatedMonthStart,
        monthEnd: calculatedMonthEnd,
        currentWeekCalendarStart: currentWeekStart,
        currentWeekCalendarEnd: currentWeekEnd,
        displayCurrentWeekStart: calculatedDisplayCurrentWeekStart,
        displayCurrentWeekEnd: calculatedDisplayCurrentWeekEnd,
        allWeeksInMonth: allWeeks,
      };
    },
    enabled: !!user && onboardingCompleted,
    staleTime: 1000 * 60 * 2, // Data considered fresh for 2 minutes
    refetchOnWindowFocus: true,
  });

  // Return the data, isLoading, and isError from useQuery
  return {
    loading: isLoading,
    actualAllowedThisWeek: data?.actualAllowedThisWeek || 0,
    remainingOverspent: data?.remainingOverspent || 0,
    monthlyBudgetSpentPercentage: data?.monthlyBudgetSpentPercentage || 0,
    monthlyBudgetSpentAmount: data?.monthlyBudgetSpentAmount || 0,
    upcomingProjections: data?.upcomingProjections || [],
    daysInCurrentWeek: data?.daysInCurrentWeek || 0,
    monthStart: data?.monthStart || new Date(),
    monthEnd: data?.monthEnd || new Date(),
    currentWeekCalendarStart: data?.currentWeekCalendarStart || new Date(),
    currentWeekCalendarEnd: data?.currentWeekCalendarEnd || new Date(),
    displayCurrentWeekStart: data?.displayCurrentWeekStart || new Date(),
    displayCurrentWeekEnd: data?.displayCurrentWeekEnd || new Date(),
    allWeeksInMonth: data?.allWeeksInMonth || [],
  };
};