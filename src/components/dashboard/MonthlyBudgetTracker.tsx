import { GlassCard } from "@/components/ui/glass-card";
import { Button } from "@/components/ui/button";
import { TrendingUp, Wallet } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { useState, useEffect } from "react";
import { formatFullINR } from "@/lib/currency";
import { useNavigate } from "react-router-dom";
import { getCurrentISTMonth } from "@/lib/date-utils";
import { getMonthlyTransactions } from "@/integrations/indexeddb/services/dataService";
import { useMonthlyBudgetSummary } from "@/hooks/useMonthlyBudgetSummary";
import { motion } from "framer-motion";

interface MonthlyBudgetTrackerProps {
  onboardingCompleted: boolean; // New prop
}

export const MonthlyBudgetTracker = ({ onboardingCompleted }: MonthlyBudgetTrackerProps) => {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [monthlySpent, setMonthlySpent] = useState(0);

  const { 
    data: budgetSummary, 
    isLoading: isLoadingBudgetSummary, 
    isError: isErrorBudgetSummary 
  } = useMonthlyBudgetSummary(onboardingCompleted);

  const {
    totalIncomeDisplayed = 0,
    fixedBudgetAmount = 0,
    variableBudgetAmount = 0,
    totalMonthlyIncome = 0,
  } = budgetSummary || {};

  useEffect(() => {
    if (user && onboardingCompleted) {
      fetchMonthlySpending();
    }
  }, [user, onboardingCompleted]);

  // Refetch data whenever component mounts to ensure fresh data
  useEffect(() => {
    const interval = setInterval(() => {
      if (user && onboardingCompleted) {
        fetchMonthlySpending();
      }
    }, 120000); // Changed from 30000 (30 seconds) to 120000 (2 minutes)

    return () => clearInterval(interval);
  }, [user, onboardingCompleted]);

  const fetchMonthlySpending = async () => {
    try {
      const now = new Date();
      const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
      const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0);

      // Fetch transactions from IndexedDB, excluding credit card expenses
      const transactionsData = await getMonthlyTransactions(
        user!.id,
        startOfMonth.toISOString(),
        endOfMonth.toISOString(),
        'expense',
        true // Exclude credit card transactions
      );

      const totalSpent = transactionsData?.reduce((sum, transaction) => sum + Number(transaction.amount), 0) || 0;
      setMonthlySpent(totalSpent); // This now only includes non-credit card expenses
    } catch (error) {
      console.error('MonthlyBudgetTracker: Error fetching monthly spending:', error);
    }
  };

  // Remaining budget is now calculated as (Total Monthly Income - Fixed Budget - Variable Budget)
  const remainingBudget = totalMonthlyIncome - fixedBudgetAmount - variableBudgetAmount;

  if (!onboardingCompleted) { // Render message if onboarding is not complete
    return (
      <GlassCard className="p-3">
        <div className="flex justify-between items-center mb-3">
          <div>
            <h3 className="text-sm font-semibold text-foreground">Monthly Budget Tracker</h3>
            <p className="text-xs text-muted-foreground">Complete onboarding to set up your budget</p>
          </div>
          <Button 
            onClick={() => navigate('/onboarding')}
            variant="outline" 
            size="sm"
            className="glass-nav text-xs h-7 px-2 pointer-events-auto"
          >
            Setup Onboarding
          </Button>
        </div>
        <div className="text-center py-4 text-muted-foreground text-sm">
          Your monthly budget will appear here after onboarding.
        </div>
      </GlassCard>
    );
  }

  if (isLoadingBudgetSummary) {
    return (
      <GlassCard className="p-4 md:p-6">
        <div className="animate-pulse">
          <div className="h-4 bg-muted rounded w-1/3 mb-4"></div>
          <div className="h-8 bg-muted rounded w-1/2 mb-2"></div>
          <div className="h-4 bg-muted rounded w-full"></div>
        </div>
      </GlassCard>
    );
  }

  const spentPercent = totalMonthlyIncome > 0
    ? Math.min(((fixedBudgetAmount + variableBudgetAmount) / totalMonthlyIncome) * 100, 100)
    : 0;

  return (
    <GlassCard className="p-4">
      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <TrendingUp className="h-4 w-4 text-primary" />
          <h3 className="text-sm font-bold text-foreground">Monthly Budget</h3>
        </div>
        <Button
          onClick={() => navigate('/budget')}
          variant="outline"
          size="sm"
          className="text-xs h-7 px-2.5 rounded-xl pointer-events-auto"
        >
          <Wallet className="h-3 w-3 mr-1" />
          Update
        </Button>
      </div>

      {/* Budget allocation bar */}
      <div className="mb-3 space-y-1.5">
        <div className="flex h-2 rounded-full overflow-hidden gap-px bg-muted">
          <motion.div
            className="bg-amber-400 h-full"
            initial={{ width: "0%" }}
            animate={{ width: `${totalMonthlyIncome > 0 ? Math.min((fixedBudgetAmount / totalMonthlyIncome) * 100, 100) : 0}%` }}
            transition={{ type: "spring", stiffness: 55, damping: 18, delay: 0.1 }}
          />
          <motion.div
            className="bg-secondary h-full"
            initial={{ width: "0%" }}
            animate={{ width: `${totalMonthlyIncome > 0 ? Math.min((variableBudgetAmount / totalMonthlyIncome) * 100, 100) : 0}%` }}
            transition={{ type: "spring", stiffness: 55, damping: 18, delay: 0.2 }}
          />
          <motion.div
            className="bg-emerald-400 h-full"
            initial={{ width: "0%" }}
            animate={{ width: `${totalMonthlyIncome > 0 ? Math.max(0, Math.min((remainingBudget / totalMonthlyIncome) * 100, 100)) : 0}%` }}
            transition={{ type: "spring", stiffness: 55, damping: 18, delay: 0.3 }}
          />
        </div>
        <div className="flex items-center gap-3 text-[10px] text-muted-foreground">
          <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-amber-400 inline-block" />Fixed</span>
          <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-secondary inline-block" />Variable</span>
          <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-emerald-400 inline-block" />Free</span>
        </div>
      </div>

      {/* 2×2 stat grid */}
      <div className="grid grid-cols-2 gap-2">
        <div className="p-2.5 rounded-xl bg-primary/5 border border-primary/15">
          <p className="text-[10px] text-muted-foreground">Income</p>
          <p className="text-sm font-bold text-primary mt-0.5">{formatFullINR(totalIncomeDisplayed)}</p>
        </div>
        <div className="p-2.5 rounded-xl bg-amber-50 border border-amber-200">
          <p className="text-[10px] text-muted-foreground">Fixed</p>
          <p className="text-sm font-bold text-amber-600 mt-0.5">{formatFullINR(fixedBudgetAmount)}</p>
        </div>
        <div className="p-2.5 rounded-xl bg-secondary/5 border border-secondary/15">
          <p className="text-[10px] text-muted-foreground">Variable</p>
          <p className="text-sm font-bold text-secondary mt-0.5">{formatFullINR(variableBudgetAmount)}</p>
        </div>
        <div className={`p-2.5 rounded-xl border ${remainingBudget >= 0 ? 'bg-emerald-50 border-emerald-200' : 'bg-red-50 border-red-200'}`}>
          <p className="text-[10px] text-muted-foreground">Remaining</p>
          <p className={`text-sm font-bold mt-0.5 ${remainingBudget >= 0 ? 'text-emerald-600' : 'text-destructive'}`}>
            {formatFullINR(remainingBudget)}
          </p>
        </div>
      </div>
    </GlassCard>
  );
};
