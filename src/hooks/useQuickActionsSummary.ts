"use client";

import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthContext";
import { getISTDate, getWeeksInDateRange } from "@/lib/date-utils";
import { getMonthlyTransactions } from "@/integrations/indexeddb/services/dataService";
import { format, isSameWeek, startOfMonth, endOfMonth } from "date-fns";

interface QuickActionsSummaryData {
  incomeThisWeek: number;
  expenseThisWeek: number;
  creditCardSpendsThisWeek: number;
  displayCurrentWeekStart: Date | null;
  displayCurrentWeekEnd: Date | null;
  allWeeksInMonth: Array<{ start: Date; end: Date; label: string; value: string; daysInWeek: number }>;
}

export const useQuickActionsSummary = (onboardingCompleted: boolean, selectedMonth: string, activeWeekFilter: string | null) => {
  const { user } = useAuth();

  return useQuery<QuickActionsSummaryData, Error>({
    queryKey: ['quickActionsWeeklySummary', user?.id, selectedMonth, activeWeekFilter],
    queryFn: async () => {
      if (!user || !onboardingCompleted) {
        return {
          incomeThisWeek: 0,
          expenseThisWeek: 0,
          creditCardSpendsThisWeek: 0,
          displayCurrentWeekStart: null,
          displayCurrentWeekEnd: null,
          allWeeksInMonth: [],
        };
      }

      const [year, month] = selectedMonth.split('-').map(Number);
      const monthStart = startOfMonth(new Date(year, month - 1, 1));
      const monthEnd = endOfMonth(new Date(year, month - 1, 1));

      const allWeeks = getWeeksInDateRange(monthStart, monthEnd).map(week => ({
        ...week,
        value: `${format(week.start, 'yyyy-MM-dd')}_${format(week.end, 'yyyy-MM-dd')}`
      }));

      let currentWeekStart: Date | null = null;
      let currentWeekEnd: Date | null = null;
      let targetWeekSummary = null;

      if (activeWeekFilter) {
        targetWeekSummary = allWeeks.find(week => week.value === activeWeekFilter);
        if (targetWeekSummary) {
          currentWeekStart = targetWeekSummary.start;
          currentWeekEnd = targetWeekSummary.end;
        }
      } 
      
      if (!targetWeekSummary && allWeeks.length > 0) {
        const today = getISTDate();
        const currentCalendarWeek = allWeeks.find(week => 
          isSameWeek(today, week.start, { weekStartsOn: 1 })
        );
        if (currentCalendarWeek) {
          currentWeekStart = currentCalendarWeek.start;
          currentWeekEnd = currentCalendarWeek.end;
        } else {
          currentWeekStart = allWeeks[0].start;
          currentWeekEnd = allWeeks[0].end;
        }
      }

      if (!currentWeekStart || !currentWeekEnd) {
        return {
          incomeThisWeek: 0,
          expenseThisWeek: 0,
          creditCardSpendsThisWeek: 0,
          displayCurrentWeekStart: null,
          displayCurrentWeekEnd: null,
          allWeeksInMonth: allWeeks,
        };
      }

      const transactionsData = await getMonthlyTransactions(
        user.id,
        currentWeekStart.toISOString(),
        currentWeekEnd.toISOString(),
        undefined, 
        false 
      );

      let incomeThisWeek = 0;
      let expenseThisWeek = 0;
      let creditCardSpendsThisWeek = 0;

      transactionsData.forEach(transaction => {
        if (transaction.type === 'income') {
          incomeThisWeek += transaction.amount;
        } else if (transaction.type === 'expense') {
          if (transaction.account === 'credit-card') {
            creditCardSpendsThisWeek += transaction.amount;
          } else {
            expenseThisWeek += transaction.amount;
          }
        }
      });

      return {
        incomeThisWeek,
        expenseThisWeek,
        creditCardSpendsThisWeek,
        displayCurrentWeekStart: currentWeekStart,
        displayCurrentWeekEnd: currentWeekEnd,
        allWeeksInMonth: allWeeks,
      };
    },
    enabled: !!user && onboardingCompleted,
    staleTime: 1000 * 60 * 2,
    refetchOnWindowFocus: true,
  });
};