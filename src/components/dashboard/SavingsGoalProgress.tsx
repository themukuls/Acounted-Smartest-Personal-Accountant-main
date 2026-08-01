import { useAuth } from "@/contexts/AuthContext";
import { formatCompactINR } from "@/lib/currency";
import { Target, ChevronRight, Plus } from "lucide-react";
import { format, addMonths } from "date-fns";
import { useSavingsGoals } from "@/hooks/useSavingsGoals";
import { useMonthlyTransactionsForSavings } from "@/hooks/useMonthlyTransactionsForSavings";
import { cn } from "@/lib/utils";
import { motion } from "framer-motion";
import { useState } from "react";
import { SavingsGoalModal } from "./SavingsGoalModal";

interface SavingsGoal {
  id: string;
  goal_name: string;
  goal_amount: number;
  target_months: number;
  created_at: string;
}

interface SavingsGoalProgressProps {
  onSetupGoal: () => void;
  onboardingCompleted: boolean;
}

const GOAL_COLORS = [
  { bar: "bg-primary",     text: "text-primary"    },
  { bar: "bg-emerald-500", text: "text-emerald-600" },
  { bar: "bg-violet-500",  text: "text-violet-600"  },
  { bar: "bg-amber-400",   text: "text-amber-600"   },
];

export const SavingsGoalProgress = ({ onSetupGoal, onboardingCompleted }: SavingsGoalProgressProps) => {
  const { user }  = useAuth();
  const [modalOpen, setModalOpen] = useState(false);

  const { data: savingsGoals = [],        isLoading: isLoadingGoals }        = useSavingsGoals(onboardingCompleted);
  const { data: monthlyTransactions = [], isLoading: isLoadingTransactions } = useMonthlyTransactionsForSavings(onboardingCompleted);
  const loading = isLoadingGoals || isLoadingTransactions;

  const calculateGoalProgress = (goal: SavingsGoal) => {
    const monthlyTarget       = goal.goal_amount / goal.target_months;
    const monthlyIncome       = monthlyTransactions.filter(t => t.type === "income").reduce((s, t) => s + t.amount, 0);
    const monthlyExpenses     = monthlyTransactions.filter(t => t.type === "expense").reduce((s, t) => s + t.amount, 0);
    const actualMonthlySavings = Math.max(0, monthlyIncome - monthlyExpenses);
    const goalStartDate       = new Date(goal.created_at);
    const currentDate         = new Date();
    const monthsPassed        = (currentDate.getFullYear() - goalStartDate.getFullYear()) * 12 +
                                 (currentDate.getMonth() - goalStartDate.getMonth()) + 1;
    const totalExpectedSavings = monthlyTarget * monthsPassed;
    const totalProgress       = Math.min((totalExpectedSavings / goal.goal_amount) * 100, 100);
    const targetDate           = addMonths(goalStartDate, goal.target_months);
    const monthsRemaining      = Math.max(0, goal.target_months - monthsPassed);
    return {
      monthlyTarget, actualMonthlySavings,
      totalProgress: Math.max(0, totalProgress),
      currentAmount: Math.max(0, totalExpectedSavings),
      targetDate, monthsRemaining,
      onTrack: actualMonthlySavings >= monthlyTarget,
    };
  };

  if (!onboardingCompleted) return (
    <div className="text-center py-4 space-y-2">
      <p className="text-sm font-semibold text-foreground">Start saving towards something real</p>
      <p className="text-xs text-muted-foreground">Set a goal and we'll track it every month.</p>
      <button onClick={() => setModalOpen(true)}
        className="mt-2 inline-flex items-center gap-1.5 px-4 py-1.5 rounded-xl border border-border/60 text-xs font-medium text-foreground pointer-events-auto hover:bg-muted/40 transition-colors">
        <Target className="h-3 w-3" /> Set up a goal
      </button>
      <SavingsGoalModal open={modalOpen} onOpenChange={setModalOpen} onboardingCompleted={onboardingCompleted} />
    </div>
  );

  if (loading) return (
    <div className="space-y-3">
      {[1, 2].map(i => (
        <div key={i} className="space-y-2 animate-pulse">
          <div className="h-3 bg-muted rounded w-2/3" />
          <div className="h-2 bg-muted rounded-full w-full" />
          <div className="h-3 bg-muted rounded w-1/2" />
        </div>
      ))}
    </div>
  );

  // ── Empty state ─────────────────────────────────────────────────────────────
  if (savingsGoals.length === 0) return (
    <>
      <div className="py-4 space-y-3 text-center">
        <div className="w-12 h-12 rounded-2xl bg-primary/10 flex items-center justify-center mx-auto">
          <Target className="h-6 w-6 text-primary/60" />
        </div>
        <div>
          <p className="text-sm font-semibold text-foreground">No savings goals yet</p>
          <p className="text-xs text-muted-foreground mt-0.5">
            See your 6-month trends and set a smart goal.
          </p>
        </div>
        <motion.button
          onClick={() => setModalOpen(true)}
          whileTap={{ scale: 0.96 }}
          className="inline-flex items-center gap-1.5 px-5 py-2 rounded-xl bg-primary text-primary-foreground text-xs font-bold pointer-events-auto shadow-md shadow-primary/20"
        >
          <Plus className="h-3.5 w-3.5" /> Set up a goal
        </motion.button>
      </div>
      <SavingsGoalModal open={modalOpen} onOpenChange={setModalOpen} onboardingCompleted={onboardingCompleted} />
    </>
  );

  // ── Goals exist ─────────────────────────────────────────────────────────────
  return (
    <>
      <div className="space-y-3">
        {savingsGoals.slice(0, 3).map((goal, idx) => {
          const p     = calculateGoalProgress(goal);
          const color = GOAL_COLORS[idx % GOAL_COLORS.length];

          return (
            <div key={goal.id}
              className="relative rounded-xl border border-border/50 bg-background/50 p-3 overflow-hidden">
              <div className={cn("absolute left-0 top-0 bottom-0 w-1 rounded-l-xl", color.bar)} />
              <div className="pl-2 space-y-2">

                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-foreground truncate">{goal.goal_name}</p>
                    <p className="text-[10px] text-muted-foreground mt-0.5">
                      Target {format(p.targetDate, "MMM yyyy")}
                      {p.monthsRemaining > 0 && ` · ${p.monthsRemaining}mo left`}
                    </p>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <span className={cn(
                      "text-[10px] font-bold px-1.5 py-0.5 rounded-full",
                      p.onTrack ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-700"
                    )}>
                      {p.onTrack ? "✓ On track" : "↓ Below"}
                    </span>
                    <span className={cn("text-xs font-bold", color.text)}>
                      {p.totalProgress.toFixed(0)}%
                    </span>
                  </div>
                </div>

                <div className="h-1.5 rounded-full bg-primary/10 overflow-hidden">
                  <motion.div
                    className={cn("h-full rounded-full", color.bar)}
                    initial={{ width: "0%" }}
                    animate={{ width: `${p.totalProgress}%` }}
                    transition={{ type: "spring", stiffness: 60, damping: 18, delay: 0.15 }}
                  />
                </div>

                <p className={cn("text-[11px] font-medium leading-snug",
                  p.totalProgress >= 100 ? "text-emerald-600"
                    : p.onTrack ? "text-emerald-600" : "text-amber-600"
                )}>
                  {p.totalProgress >= 100
                    ? "Goal reached 🎉 — you did it."
                    : p.onTrack
                    ? `On track — you'll hit this by ${format(p.targetDate, "MMM yyyy")}.`
                    : `A little behind — ${formatCompactINR(Math.max(0, p.monthlyTarget - p.actualMonthlySavings))} more this month catches you up.`}
                </p>

                <div className="flex items-center justify-between text-[10px]">
                  <span className="text-muted-foreground">
                    {formatCompactINR(p.currentAmount)} of {formatCompactINR(goal.goal_amount)}
                  </span>
                  <span className={cn("font-semibold", p.onTrack ? "text-emerald-600" : "text-amber-600")}>
                    {formatCompactINR(p.actualMonthlySavings)}
                    <span className="text-muted-foreground font-normal"> / {formatCompactINR(p.monthlyTarget)}</span>
                  </span>
                </div>
              </div>
            </div>
          );
        })}

        {savingsGoals.length > 3 && (
          <p className="text-xs text-muted-foreground text-center">
            +{savingsGoals.length - 3} more goal{savingsGoals.length - 3 > 1 ? "s" : ""}
          </p>
        )}

        <button onClick={() => setModalOpen(true)}
          className="w-full flex items-center justify-center gap-1.5 text-xs py-2.5 rounded-xl border border-border/60 bg-background/50 text-foreground font-medium pointer-events-auto hover:bg-background/80 transition-colors">
          <Target className="h-3 w-3" /> Manage Goals
          <ChevronRight className="h-3 w-3 text-muted-foreground" />
        </button>
      </div>

      <SavingsGoalModal open={modalOpen} onOpenChange={setModalOpen} onboardingCompleted={onboardingCompleted} />
    </>
  );
};
