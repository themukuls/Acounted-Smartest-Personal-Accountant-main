"use client";

import { GlassCard } from "@/components/ui/glass-card";
import { Button } from "@/components/ui/button";
import { Plus, Zap, ChevronDown } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { formatCompactINR, formatFullINR } from "@/lib/currency";
import { format, isSameWeek } from "date-fns";
import { cn } from "@/lib/utils";
import { motion } from "framer-motion";
import { useNavigate } from "react-router-dom";
import { useState, useEffect } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { getISTDate, getCurrentISTMonth } from "@/lib/date-utils";
import { useWeeklyBudgetProjections } from "@/hooks/useWeeklyBudgetProjections";
import { useQuickActionsSummary } from "@/hooks/useQuickActionsSummary"; // Import the new hook

interface QuickActionsCardProps {
  onboardingCompleted: boolean;
  onAddTransactionClick: (weekLabel: string) => void;
}

export const QuickActionsCard = ({ onboardingCompleted, onAddTransactionClick }: QuickActionsCardProps) => {
  const navigate = useNavigate();
  const { user } = useAuth();
  
  const [selectedMonth, setSelectedMonth] = useState(getCurrentISTMonth()); // State for month filter
  const [viewFilter, setViewFilter] = useState<'per-week' | 'per-day'>('per-week');
  const [activeWeekFilter, setActiveWeekFilter] = useState<string | null>(null);

  // Use the new hook for transaction summary data
  const { 
    data: quickActionsData, 
    isLoading: isLoadingTransactions, 
    isError: isErrorTransactions 
  } = useQuickActionsSummary(onboardingCompleted, selectedMonth, activeWeekFilter);

  const incomeThisWeek = quickActionsData?.incomeThisWeek || 0;
  const expenseThisWeek = quickActionsData?.expenseThisWeek || 0;
  const creditCardSpendsThisWeek = quickActionsData?.creditCardSpendsThisWeek || 0;
  const allWeeksInMonth = quickActionsData?.allWeeksInMonth || [];
  const displayCurrentWeekStart = quickActionsData?.displayCurrentWeekStart;
  const displayCurrentWeekEnd = quickActionsData?.displayCurrentWeekEnd;

  const {
    loading: isLoadingProjections, // Renamed from 'loading' to 'isLoadingProjections'
    actualAllowedThisWeek,
    remainingOverspent,
    daysInCurrentWeek,
    upcomingProjections,
  } = useWeeklyBudgetProjections({ onboardingCompleted, selectedWeekKey: activeWeekFilter });
  
  // Initialize activeWeekFilter on component mount or when onboarding status changes
  useEffect(() => {
    if (onboardingCompleted && allWeeksInMonth.length > 0 && !activeWeekFilter) {
      const today = getISTDate();
      const currentCalendarWeek = allWeeksInMonth.find(week => 
        isSameWeek(today, week.start, { weekStartsOn: 1 })
      );
      if (currentCalendarWeek) {
        setActiveWeekFilter(currentCalendarWeek.value);
      } else {
        setActiveWeekFilter(allWeeksInMonth[0].value);
      }
    } else if (!onboardingCompleted) {
      setActiveWeekFilter(null);
    }
  }, [onboardingCompleted, allWeeksInMonth, activeWeekFilter]);

  if (!onboardingCompleted) {
    return (
      <GlassCard className="p-4">
        <div className="flex items-center gap-2 mb-3">
          <Zap className="h-4 w-4 text-primary" />
          <h3 className="text-sm font-bold text-foreground">Quick Actions</h3>
        </div>
        <div className="text-center py-5 space-y-3">
          <div className="h-10 w-10 rounded-2xl bg-primary/10 flex items-center justify-center mx-auto">
            <Zap className="h-5 w-5 text-primary/60" />
          </div>
          <div>
            <p className="text-sm font-semibold text-foreground">See where your money goes</p>
            <p className="text-xs text-muted-foreground mt-0.5">Set up in 2 min — weekly spend, budget & more.</p>
          </div>
        </div>
      </GlassCard>
    );
  }

  const isLoading = isLoadingTransactions || isLoadingProjections;

  const displayActualAllowedThisWeek = viewFilter === 'per-day' && daysInCurrentWeek > 0
    ? actualAllowedThisWeek / daysInCurrentWeek
    : actualAllowedThisWeek;

  const displayRemainingOverspent = viewFilter === 'per-day' && daysInCurrentWeek > 0
    ? remainingOverspent / daysInCurrentWeek
    : remainingOverspent;

  const handleAddTransaction = () => {
    if (displayCurrentWeekStart && displayCurrentWeekEnd) {
      const weekLabel = `${format(displayCurrentWeekStart, 'MMM dd')} - ${format(displayCurrentWeekEnd, 'MMM dd, yyyy')}`;
      onAddTransactionClick(weekLabel);
    } else {
      onAddTransactionClick("Current Week");
    }
  };

  const currentWeekLabel = allWeeksInMonth.find(week => week.value === activeWeekFilter)?.label || "This week";
  const totalSpentThisWeek = expenseThisWeek + creditCardSpendsThisWeek;
  const denominatorForSpentPercentage = actualAllowedThisWeek + incomeThisWeek;
  const weeklyBudgetSpentPercentage = denominatorForSpentPercentage > 0
    ? Math.min((totalSpentThisWeek / denominatorForSpentPercentage) * 100, 100)
    : (totalSpentThisWeek > 0 ? 100 : 0);

  const isOverspent = displayRemainingOverspent < 0;

  return (
    <GlassCard className="p-4 space-y-4">

      {/* ── Header: title/week (left col) + Add Transaction (right) ────────── */}
      <div className="flex items-center justify-between gap-2">
        {/* Left: title on top, week range below */}
        <div className="flex items-start gap-2 min-w-0">
          <Zap className="h-4 w-4 text-primary shrink-0 mt-0.5" />
          <div className="flex flex-col min-w-0">
            <h3 className="text-sm font-bold text-foreground leading-tight">Quick Actions</h3>
            {allWeeksInMonth.length > 0 && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button
                    className="flex items-center gap-0.5 text-[11px] text-muted-foreground hover:text-foreground transition-colors pointer-events-auto w-fit"
                    disabled={isLoading || allWeeksInMonth.length === 0}
                  >
                    <span>
                      {displayCurrentWeekStart && displayCurrentWeekEnd
                        ? `${format(displayCurrentWeekStart, 'MMM dd')}–${format(displayCurrentWeekEnd, 'MMM dd')}`
                        : currentWeekLabel}
                    </span>
                    <ChevronDown className="h-3 w-3 ml-0.5 shrink-0" />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent className="w-44 bg-white/95 backdrop-blur-md border border-white/20 shadow-xl z-50 pointer-events-auto">
                  {allWeeksInMonth.map(week => (
                    <DropdownMenuItem
                      key={week.value}
                      onClick={() => setActiveWeekFilter(week.value)}
                      className={cn(
                        "text-xs cursor-pointer",
                        activeWeekFilter === week.value
                          ? "bg-primary/10 text-primary font-semibold"
                          : "text-foreground hover:bg-primary/5"
                      )}
                    >
                      {week.label}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          </div>
        </div>
        {/* Right: Add Transaction button */}
        <Button
          size="sm"
          className="h-8 px-3 text-xs rounded-xl pointer-events-auto shrink-0"
          onClick={handleAddTransaction}
          disabled={daysInCurrentWeek === 0 || isLoading}
        >
          <Plus className="h-3.5 w-3.5 mr-1" /> Add Transaction
        </Button>
      </div>

      {daysInCurrentWeek === 0 ? (
        <div className="text-center py-4 text-sm text-muted-foreground">
          No active budget period for the current week.
        </div>
      ) : (
        <>
          {/* ── 3 stat pills ──────────────────────────────────────────────── */}
          <div className="flex gap-2">
            <div className="flex-1 rounded-xl bg-primary/5 border border-primary/15 px-2.5 py-2">
              <p className="text-[10px] text-muted-foreground">Income</p>
              {isLoading
                ? <div className="h-4 w-12 bg-muted rounded animate-pulse mt-1" />
                : <p className="text-xs font-bold text-primary mt-0.5">{formatCompactINR(incomeThisWeek)}</p>
              }
            </div>
            <div className="flex-1 rounded-xl bg-destructive/5 border border-destructive/15 px-2.5 py-2">
              <p className="text-[10px] text-muted-foreground">Expenses</p>
              {isLoading
                ? <div className="h-4 w-12 bg-muted rounded animate-pulse mt-1" />
                : <p className="text-xs font-bold text-destructive mt-0.5">{formatCompactINR(expenseThisWeek)}</p>
              }
            </div>
            <div className="flex-1 rounded-xl bg-amber-50 border border-amber-200 px-2.5 py-2">
              <p className="text-[10px] text-muted-foreground">Credit Card</p>
              {isLoading
                ? <div className="h-4 w-12 bg-muted rounded animate-pulse mt-1" />
                : <p className="text-xs font-bold text-amber-600 mt-0.5">{formatCompactINR(creditCardSpendsThisWeek)}</p>
              }
            </div>
          </div>

          {/* ── Budget progress bar + remaining ───────────────────────────── */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-1.5">
                <p className="text-xs font-semibold text-foreground">
                  {isOverspent ? "Overspent" : "Remaining"}
                </p>
                {/* Per week / per day toggle */}
                <div className="flex rounded-lg border border-border/60 overflow-hidden">
                  {(['per-week', 'per-day'] as const).map(v => (
                    <button
                      key={v}
                      onClick={() => setViewFilter(v)}
                      className={cn(
                        "px-2 py-0.5 text-[10px] font-semibold transition-colors pointer-events-auto",
                        viewFilter === v
                          ? "bg-primary text-primary-foreground"
                          : "text-muted-foreground hover:text-foreground"
                      )}
                    >
                      {v === 'per-week' ? 'Week' : 'Day'}
                    </button>
                  ))}
                </div>
              </div>
              {isLoading
                ? <div className="h-5 w-16 bg-muted rounded animate-pulse" />
                : <p className={cn("text-base font-black", isOverspent ? "text-destructive" : "text-emerald-600")}>
                    {isOverspent ? "-" : "+"}{formatCompactINR(Math.abs(displayRemainingOverspent))}
                  </p>
              }
            </div>

            {/* Progress bar */}
            <div className="h-2 rounded-full bg-muted overflow-hidden">
              <motion.div
                className={cn("h-full rounded-full", isOverspent ? "bg-destructive" : "bg-emerald-500")}
                initial={{ width: "0%" }}
                animate={{ width: `${Math.min(weeklyBudgetSpentPercentage, 100)}%` }}
                transition={{ type: "spring", stiffness: 55, damping: 16, delay: 0.2 }}
              />
            </div>

            <div className="flex items-center justify-between text-[10px] text-muted-foreground">
              <span>Allowance: {formatCompactINR(displayActualAllowedThisWeek)}{viewFilter === 'per-day' ? '/day' : '/wk'}</span>
              <span>{weeklyBudgetSpentPercentage.toFixed(0)}% used</span>
            </div>
            {/* Emotional status line */}
            <p className={`text-xs font-medium mt-0.5 ${
              isOverspent
                ? "text-destructive"
                : weeklyBudgetSpentPercentage >= 90
                ? "text-destructive"
                : weeklyBudgetSpentPercentage >= 65
                ? "text-amber-600"
                : "text-emerald-600"
            }`}>
              {isOverspent
                ? "Tight week. Hold the line."
                : weeklyBudgetSpentPercentage >= 90
                ? "Almost there — careful with the last few days."
                : weeklyBudgetSpentPercentage >= 65
                ? "Getting close — watch the pace."
                : "You're pacing well this week ✓"}
            </p>
          </div>

          {/* ── Upcoming projections ──────────────────────────────────────── */}
          {upcomingProjections.length > 0 && (
            <div className="space-y-1.5">
              <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">Upcoming weeks</p>
              {isLoading ? (
                <div className="space-y-1.5">
                  <div className="h-3 w-full bg-muted rounded animate-pulse" />
                  <div className="h-3 w-3/4 bg-muted rounded animate-pulse" />
                </div>
              ) : (
                upcomingProjections.map((projection, index) => {
                  const displayAmount = viewFilter === 'per-day' && projection.daysInWeek > 0
                    ? projection.amount / projection.daysInWeek
                    : projection.amount;
                  const unit = viewFilter === 'per-day' ? '/day' : '/wk';
                  const positive = displayAmount >= 0;
                  return (
                    <div key={index} className="flex justify-between items-center">
                      <span className="text-xs text-muted-foreground">{projection.label}</span>
                      <span className={cn("text-xs font-semibold", positive ? "text-emerald-600" : "text-destructive")}>
                        {positive ? "+" : ""}{formatCompactINR(displayAmount)}{unit}
                      </span>
                    </div>
                  );
                })
              )}
            </div>
          )}

          {/* ── Navigate to full tracker ──────────────────────────────────── */}
          <button
            onClick={() => navigate('/expenses')}
            className="w-full flex items-center justify-center gap-1.5 text-xs py-2 rounded-xl border border-border/60 bg-background/50 text-muted-foreground font-medium pointer-events-auto hover:text-foreground hover:border-border transition-colors"
          >
            View full expense tracker →
          </button>
        </>
      )}
    </GlassCard>
  );
};
