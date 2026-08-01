import { GlassCard } from "@/components/ui/glass-card";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { TrendingUp, Wallet, Plus } from "lucide-react"; // Import Wallet icon and Plus
import { useAuth } from "@/contexts/AuthContext";
import { useState, useEffect } from "react";
import { formatFullINR } from "@/lib/currency";
import { useNavigate } from "react-router-dom";
import { getCurrentISTMonth, getWeeksInDateRange } from "@/lib/date-utils"; // Import getWeeksInDateRange
import { format, startOfDay, isSameWeek } from "date-fns"; // Import startOfDay, isSameWeek
import { getIncomeDetails, getExpenseCategories } from "@/integrations/indexeddb/services/onboardingService"; // Import from IndexedDB onboarding service
import { getVariableBudgetEntries } from "@/integrations/indexeddb/services/variableBudgetService"; // Corrected import path
import { getMonthlyTransactions } from "@/integrations/indexeddb/services/dataService"; // Import from new IndexedDB data service
import { startOfWeek, endOfWeek, addDays, isWithinInterval, startOfMonth, endOfMonth, differenceInDays, max, min } from "date-fns"; // Added max, min
import { getMonthlyBudgets } from "@/integrations/indexeddb/services/monthlyBudgetService"; // Import getMonthlyBudgets
import { getSavingsGoals } from "@/integrations/indexeddb/services/savingsGoalService"; // Import getSavingsGoals
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"; // Import Select components
import { cn } from "@/lib/utils"; // Import cn

interface WeeklyExpenseData {
  weeklySpent: number;
  weeklyIncome: number;
  weekDates: string;
  averageAllowedForCurrentWeek: number;
  projectedAllowedForCurrentWeek: number;
  effectiveAllowedForCurrentWeek: number;
  rollover: number;
  remainingBudget: number;
  daysInCurrentWeek: number;
}

interface WeeklyBudgetSummary {
  start: Date;
  end: Date;
  label: string;
  baseAllowed: number;
  effectiveAllowed: number;
  projectedAllowed: number;
  spent: number;
  income: number;
  rollover: number;
  remaining: number;
  daysInWeek: number;
}

interface SavingsGoal {
  id: string;
  goal_name: string;
  goal_amount: number;
  target_months: number;
  created_at: string;
  weekly_spend_amount: number | null;
}

interface WeeklyExpenseTrackerProps {
  onboardingCompleted: boolean;
  refreshTrigger: number;
}

const calculateWeeklyBudgets = (
  allTransactions: any[],
  budgetStartDate: Date,
  budgetEndDate: Date,
  totalMonthlyIncome: number,
  totalFixedExpenses: number,
  totalVariableBudgetForPeriod: number,
  totalMonthlySavingsTarget: number
): WeeklyBudgetSummary[] => {
  const allWeeksInPeriod = getWeeksInDateRange(budgetStartDate, budgetEndDate);
  const weeklySummaries: WeeklyBudgetSummary[] = [];
  const today = startOfDay(new Date());
  const tomorrow = addDays(today, 1);

  // MODIFIED: Removed Math.max(0, ...) to allow negative totalMonthlyDiscretionaryBudget
  const totalMonthlyDiscretionaryBudget = totalMonthlyIncome - totalFixedExpenses - totalVariableBudgetForPeriod - totalMonthlySavingsTarget;

  // Calculate net spending up to TODAY (inclusive)
  const netSpentUpToToday = allTransactions
    .filter(t => {
      const transactionDate = startOfDay(new Date(t.transaction_date));
      return transactionDate >= budgetStartDate && transactionDate <= today;
    })
    .reduce((sum, t) => (t.type === 'expense' ? sum + t.amount : sum - t.amount), 0);

  // Remaining monthly budget after accounting for all spending up to TODAY
  // MODIFIED: Removed Math.max(0, ...) to allow negative remainingMonthlyBudget
  const remainingMonthlyBudget = totalMonthlyDiscretionaryBudget - netSpentUpToToday;

  // Days remaining in the month *from tomorrow* (inclusive)
  let remainingDaysFromTomorrowCount = 0;
  if (tomorrow <= budgetEndDate) {
    remainingDaysFromTomorrowCount = differenceInDays(budgetEndDate, tomorrow) + 1;
  }

  // Daily allowance for future days (from tomorrow onwards)
  const dailyAllowanceForFutureDays = remainingDaysFromTomorrowCount > 0
    ? remainingMonthlyBudget / remainingDaysFromTomorrowCount
    : 0;

  // Calculate the "average daily discretionary budget" for the entire period (for comparison/display)
  const totalDaysInPeriod = differenceInDays(budgetEndDate, budgetStartDate) + 1;
  const averageDailyDiscretionaryBudget = totalDaysInPeriod > 0 ? totalMonthlyDiscretionaryBudget / totalDaysInPeriod : 0;

  for (const week of allWeeksInPeriod) {
    const weekStartDay = startOfDay(week.start);
    const weekEndDay = startOfDay(week.end);

    const weekTransactions = allTransactions.filter(t => {
      const transactionDate = startOfDay(new Date(t.transaction_date));
      return transactionDate >= weekStartDay && transactionDate <= weekEndDay;
    });

    const weekExpenses = weekTransactions.filter(t => t.type === 'expense').reduce((sum, t) => sum + t.amount, 0);
    const weekIncome = weekTransactions.filter(t => t.type === 'income').reduce((sum, t) => sum + t.amount, 0);

    let effectiveAllowed = 0;
    let baseAllowedForWeek = 0;
    let projectedAllowedForWeek = 0;
    let rolloverForDisplay = 0;

    // Calculate how many days of this specific week fall within the overall budget period (budgetStartDate to budgetEndDate)
    const daysOfThisWeekInBudgetPeriod = differenceInDays(
      Math.min(weekEndDay.getTime(), budgetEndDate.getTime()),
      Math.max(weekStartDay.getTime(), budgetStartDate.getTime())
    ) + 1;
    const actualDaysForBase = Math.max(0, daysOfThisWeekInBudgetPeriod);

    baseAllowedForWeek = averageDailyDiscretionaryBudget * actualDaysForBase;

    // Calculate how many days of this specific week fall within the budget period AND are after 'today' (or 'tomorrow' for future allowance)
    const startOfFutureConsideration = addDays(today, 1); // From tomorrow onwards
    const daysOfThisWeekInBudgetPeriodAfterToday = differenceInDays(
      Math.min(weekEndDay.getTime(), budgetEndDate.getTime()),
      Math.max(weekStartDay.getTime(), startOfFutureConsideration.getTime())
    ) + 1;
    const actualDaysForProjected = Math.max(0, daysOfThisWeekInBudgetPeriodAfterToday);

    projectedAllowedForWeek = dailyAllowanceForFutureDays * actualDaysForProjected;

    if (weekEndDay < today) { // Past week (ends before today)
      effectiveAllowed = weekIncome - weekExpenses; // Actual net cash flow for the past week
    } else if (weekStartDay <= today && today <= weekEndDay) { // Current week (includes today)
      const actualNetForPassedDaysInWeekBeforeToday = weekTransactions.filter(t => {
        const transactionDate = startOfDay(new Date(t.transaction_date));
        return transactionDate >= weekStartDay && transactionDate < today; // Transactions before today in this week
      }).reduce((sum, t) => (t.type === 'income' ? sum + t.amount : sum - t.amount), 0);

      // Days remaining in current week from tomorrow, capped by budgetEndDate
      const daysRemainingInCurrentWeekFromTomorrowInBudgetPeriod = differenceInDays(
        Math.min(weekEndDay.getTime(), budgetEndDate.getTime()),
        Math.max(tomorrow.getTime(), weekStartDay.getTime())
      ) + 1;
      const actualDaysForEffectiveAllowedFuture = Math.max(0, daysRemainingInCurrentWeekFromTomorrowInBudgetPeriod);
      
      effectiveAllowed = actualNetForPassedDaysInWeekBeforeToday + (dailyAllowanceForFutureDays * actualDaysForEffectiveAllowedFuture);
      
      const calculatedRollover = effectiveAllowed - baseAllowedForWeek;
      // MODIFIED: Removed Math.max(0, ...) to allow negative rollover
      rolloverForDisplay = calculatedRollover;

    } else { // Future week (starts after today)
      effectiveAllowed = projectedAllowedForWeek;
      const calculatedRollover = effectiveAllowed - baseAllowedForWeek;
      // MODIFIED: Removed Math.max(0, ...) to allow negative rollover
      rolloverForDisplay = calculatedRollover;
    }

    weeklySummaries.push({
      start: week.start,
      end: week.end,
      label: week.label,
      baseAllowed: baseAllowedForWeek,
      effectiveAllowed: effectiveAllowed,
      projectedAllowed: projectedAllowedForWeek,
      spent: weekExpenses,
      income: weekIncome,
      rollover: rolloverForDisplay,
      remaining: effectiveAllowed - weekExpenses + weekIncome,
      daysInWeek: week.daysInWeek,
    });
  }
  return weeklySummaries;
};

export const WeeklyExpenseTracker = ({ onboardingCompleted, refreshTrigger }: WeeklyExpenseTrackerProps) => {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [weeklyData, setWeeklyData] = useState<WeeklyExpenseData>({
    weeklySpent: 0,
    weeklyIncome: 0,
    weekDates: "",
    averageAllowedForCurrentWeek: 0,
    projectedAllowedForCurrentWeek: 0,
    effectiveAllowedForCurrentWeek: 0,
    rollover: 0,
    remainingBudget: 0,
    daysInCurrentWeek: 7
  });
  const [allWeeksBudget, setAllWeeksBudget] = useState<WeeklyBudgetSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [budgetPeriod, setBudgetDateRange] = useState<{ startDate: Date | null; endDate: Date | null }>({
    startDate: null,
    endDate: null,
  });
  const [displayMode, setDisplayMode] = useState<'week' | 'day'>('week');

  useEffect(() => {
    if (user && onboardingCompleted) {
      fetchBudgetPeriodAndWeeklyData();
    } else if (!onboardingCompleted) {
      setLoading(false);
    }
  }, [user, onboardingCompleted, refreshTrigger]);

  useEffect(() => {
    const interval = setInterval(() => {
      if (user && onboardingCompleted) {
        fetchBudgetPeriodAndWeeklyData();
      }
    }, 120000);

    return () => clearInterval(interval);
  }, [user, onboardingCompleted]);

  const fetchBudgetPeriodAndWeeklyData = async () => {
    setLoading(true);
    try {
      const currentMonthYYYYMM = getCurrentISTMonth();
      const now = new Date();
      const defaultStartOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
      const defaultEndOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0);

      // Fetch monthly budget from IndexedDB
      const monthlyBudgets = await getMonthlyBudgets(user!.id);
      const monthlyBudgetData = monthlyBudgets.find(b => b.budget_month === currentMonthYYYYMM);

      let actualBudgetStartDate: Date;
      let actualBudgetEndDate: Date;
      
      if (monthlyBudgetData && monthlyBudgetData.budget_start_date && monthlyBudgetData.budget_end_date) {
        actualBudgetStartDate = new Date(monthlyBudgetData.budget_start_date);
        actualBudgetEndDate = new Date(monthlyBudgetData.budget_end_date);
      } else {
        actualBudgetStartDate = defaultStartOfMonth;
        actualBudgetEndDate = defaultEndOfMonth;
      }

      setBudgetDateRange({ startDate: actualBudgetStartDate, endDate: actualBudgetEndDate });

      // Fetch all transactions from IndexedDB
      const allTransactions = await getMonthlyTransactions(
        user!.id,
        actualBudgetStartDate.toISOString(),
        actualBudgetEndDate.toISOString()
      );

      // Fetch income details from IndexedDB
      const incomeDetails = await getIncomeDetails(user!.id);
      
      // Fetch fixed expenses from IndexedDB
      const fixedExpensesData = await getExpenseCategories(user!.id);
      
      // Fetch variable budget entries from IndexedDB
      const variableBudgetData = await getVariableBudgetEntries(user!.id, `${format(actualBudgetStartDate, 'yyyy-MM-dd')}_${format(actualBudgetEndDate, 'yyyy-MM-dd')}`);
      
      // Fetch savings goals from IndexedDB
      const savingsGoals = await getSavingsGoals(user!.id);

      let totalMonthlyIncome = 0;
      if (incomeDetails) {
        totalMonthlyIncome += Number(incomeDetails.monthly_salary || incomeDetails.basic_salary || 0); // Explicit Number()
        totalMonthlyIncome += Number(incomeDetails.monthly_other_income || 0); // Explicit Number()
      }

      let totalFixedExpenses = 0;
      fixedExpensesData?.forEach(expense => {
        if (expense.frequency === 'monthly') {
          totalFixedExpenses += expense.amount;
        } else if (expense.frequency === 'annually') {
          totalFixedExpenses += expense.amount / 12;
        }
      });

      const totalVariableBudgetForPeriod = variableBudgetData?.reduce((sum, entry) => sum + Number(entry.allocated_amount), 0) || 0;

      const totalMonthlySavingsTarget = savingsGoals.reduce((total, goal) => {
        return total + (goal.goal_amount / goal.target_months);
      }, 0);

      const weeklySummaries = calculateWeeklyBudgets(
        allTransactions,
        actualBudgetStartDate,
        actualBudgetEndDate,
        totalMonthlyIncome,
        totalFixedExpenses,
        totalVariableBudgetForPeriod,
        totalMonthlySavingsTarget
      );
      setAllWeeksBudget(weeklySummaries);

      const today = new Date();
      const currentWeekSummary = weeklySummaries.find(week => isSameWeek(today, week.start, { weekStartsOn: 1 }));

      if (currentWeekSummary) {
        setWeeklyData({
          weeklySpent: currentWeekSummary.spent,
          weeklyIncome: currentWeekSummary.income,
          weekDates: `(${format(currentWeekSummary.start, 'dd/MM')} - ${format(currentWeekSummary.end, 'dd/MM')})`,
          averageAllowedForCurrentWeek: currentWeekSummary.baseAllowed,
          projectedAllowedForCurrentWeek: currentWeekSummary.projectedAllowed,
          effectiveAllowedForCurrentWeek: currentWeekSummary.effectiveAllowed,
          rollover: currentWeekSummary.rollover,
          remainingBudget: currentWeekSummary.remaining,
          daysInCurrentWeek: currentWeekSummary.daysInWeek
        });
      } else {
        setWeeklyData({
          weeklySpent: 0,
          weeklyIncome: 0,
          weekDates: "",
          averageAllowedForCurrentWeek: 0,
          projectedAllowedForCurrentWeek: 0,
          effectiveAllowedForCurrentWeek: 0,
          rollover: 0,
          remainingBudget: 0,
          daysInCurrentWeek: 7
        });
      }

    } catch (error) {
      console.error('Error fetching weekly data:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleAddTransaction = () => {
    const today = new Date();
    const currentWeekStart = startOfWeek(today, { weekStartsOn: 1 });
    const currentWeekEnd = endOfWeek(today, { weekStartsOn: 1 });

    const formattedWeekStart = format(currentWeekStart, 'yyyy-MM-dd');
    const formattedWeekEnd = format(currentWeekEnd, 'yyyy-MM-dd');

    navigate(`/expenses?weekStart=${formattedWeekStart}&weekEnd=${formattedWeekEnd}`);
  };

  if (!onboardingCompleted) {
    return (
      <GlassCard variant="primary" className="p-3">
        <div className="flex justify-between items-center mb-3">
          <div>
            <h3 className="text-sm font-semibold text-foreground">Quick Actions</h3>
            <p className="text-xs text-muted-foreground">Complete onboarding to set up your budget</p>
          </div>
          <Button 
            onClick={() => navigate('/onboarding')}
            size="sm"
            className="h-7 px-2 text-xs bg-gradient-primary hover:bg-gradient-primary/90 pointer-events-auto"
          >
            Setup Onboarding
          </Button>
        </div>
        <div className="text-center py-4 text-muted-foreground text-sm">
          Your weekly expense tracker will appear here after onboarding.
        </div>
      </GlassCard>
    );
  }

  if (loading) {
    return (
      <GlassCard variant="primary" className="p-4">
        <div className="flex justify-between items-center mb-4">
          <h3 className="text-lg font-semibold text-foreground">Quick Actions</h3>
          <div className="animate-pulse">
            <div className="h-8 w-32 bg-muted rounded-lg"></div>
          </div>
        </div>
        <div className="space-y-3">
          <div className="animate-pulse">
            <div className="h-16 bg-muted rounded-lg"></div>
          </div>
          <div className="animate-pulse">
            <div className="h-16 bg-muted rounded-lg"></div>
          </div>
        </div>
      </GlassCard>
    );
  }

  const currentWeekDivisor = displayMode === 'day' ? weeklyData.daysInCurrentWeek : 1;
  const netSpentForCurrentWeek = weeklyData.weeklySpent - weeklyData.weeklyIncome;
  const overUnderProjectedBudget = weeklyData.projectedAllowedForCurrentWeek - netSpentForCurrentWeek;

  const today = new Date();
  const endOfCurrentWeek = endOfWeek(today, { weekStartsOn: 1 });

  const adjustment = weeklyData.projectedAllowedForCurrentWeek - weeklyData.averageAllowedForCurrentWeek;

  return (
    <GlassCard variant="primary" className="p-3">
      <div className="flex justify-between items-center mb-3">
        <div>
          <h3 className="text-sm font-semibold text-foreground">Quick Actions</h3>
          <p className="text-xs text-muted-foreground">{weeklyData.weekDates}</p>
        </div>
        <Button 
          onClick={handleAddTransaction}
          variant="outline"
          size="sm"
          className="glass-nav text-xs h-7 px-2 pointer-events-auto"
        >
          <Plus className="h-3 w-3 mr-1" />
          Add Transaction
        </Button>
      </div>
      
      <div className="grid grid-cols-2 gap-2">
        <div className="p-2 rounded-md bg-background/50">
          <div className="text-xs text-muted-foreground mb-1">Income this Week</div>
          <div className="text-sm font-medium text-primary">
            {formatFullINR(weeklyData.weeklyIncome)}
          </div>
        </div>

        <div className="p-2 rounded-md bg-background/50">
          <div className="text-xs text-muted-foreground mb-1">Expense this Week</div>
          <div className="text-sm font-medium text-destructive">
            {formatFullINR(weeklyData.weeklySpent)}
          </div>
        </div>
      </div>

      <div className="flex items-center gap-2 mt-3 mb-3">
        <span className="text-xs text-muted-foreground font-medium">View:</span>
        <Select value={displayMode} onValueChange={(value: 'week' | 'day') => setDisplayMode(value)}>
          <SelectTrigger className="h-7 px-2 text-xs w-24 bg-background/80 border-primary/30 focus:ring-0 focus:ring-offset-0 pointer-events-auto">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="week">Per Week</SelectItem>
            <SelectItem value="day">Per Day</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <div className="p-2 rounded-md bg-background/50">
          <div className="text-xs text-muted-foreground font-medium mb-1">Actual Allowed this {displayMode === 'week' ? 'Week' : 'Day'}</div>
          <div className="text-sm font-medium text-success">
            {formatFullINR(weeklyData.projectedAllowedForCurrentWeek / currentWeekDivisor)}
          </div>
        </div>

        <div className="p-2 rounded-md bg-background/50">
          <div className="text-xs text-muted-foreground font-medium mb-1">Average Allowed this {displayMode === 'week' ? 'Week' : 'Day'}</div>
          <div className="text-sm font-medium text-muted-foreground">
            {formatFullINR(weeklyData.averageAllowedForCurrentWeek / currentWeekDivisor)}
          </div>
          {adjustment !== 0 && (
            <div className="text-xs text-muted-foreground mt-1">
              {adjustment >= 0 ? 'Surplus from past: ' : 'Deficit from past: '}
              <span className={cn(
                "font-medium",
                adjustment >= 0 ? "text-success" : "text-destructive"
              )}>
                {formatFullINR(Math.abs(adjustment / currentWeekDivisor))}
              </span>
            </div>
          )}
        </div>

        <div className="p-2 rounded-md bg-background/50 col-span-2">
          <div className="text-xs text-muted-foreground mb-1">Remaining / Overspent</div>
          <div className={cn(
            "text-sm font-medium",
            overUnderProjectedBudget >= 0 ? "text-success" : "text-destructive"
          )}>
            {overUnderProjectedBudget >= 0 ? formatFullINR(overUnderProjectedBudget) : `-${formatFullINR(Math.abs(overUnderProjectedBudget))}`}
          </div>
          {overUnderProjectedBudget < 0 && (
            <div className="text-xs text-destructive mt-1">
              You have overspent your projected budget for this week.
            </div>
          )}
        </div>
      </div>

      {allWeeksBudget.length > 0 && (
        <div className="mt-4 space-y-2">
          <h4 className="text-sm font-semibold text-foreground">Upcoming Days/Weeks Projection</h4>
          <div className="space-y-1">
            {allWeeksBudget
              .filter(week => week.start > endOfCurrentWeek)
              .map((week, index) => (
                <div key={index} className="flex justify-between items-center text-xs p-2 rounded-md bg-background/30">
                  <span className="text-muted-foreground">{week.label}</span>
                  <span className={cn(
                    "font-medium",
                    week.projectedAllowed >= 0 ? "text-success" : "text-destructive"
                  )}>
                    {formatFullINR(week.projectedAllowed / (displayMode === 'day' ? week.daysInWeek : 1))} {displayMode === 'day' ? '/day' : '/week'}
                  </span>
                </div>
              ))}
          </div>
        </div>
      )}
    </GlassCard>
  );
};