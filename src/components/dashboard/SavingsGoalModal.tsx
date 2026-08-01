import { useState, useEffect } from "react";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { motion, AnimatePresence } from "framer-motion";
import {
  TrendingUp, TrendingDown, Target, Lightbulb,
  ChevronRight, Trash2, Plus, Check, AlertCircle
} from "lucide-react";
import { formatCompactINR, formatFullINR } from "@/lib/currency";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { useQueryClient } from "@tanstack/react-query";
import { cn } from "@/lib/utils";
import { format, subMonths, startOfMonth, endOfMonth } from "date-fns";
import {
  getSavingsGoals,
  saveSavingsGoal,
  deleteSavingsGoal,
} from "@/integrations/indexeddb/services/savingsGoalService";
import { getMonthlyTransactions } from "@/integrations/indexeddb/services/dataService";
import { getIncomeDetails } from "@/integrations/indexeddb/services/onboardingService";

// ── Types ─────────────────────────────────────────────────────────────────────
interface SavingsGoal {
  id: string;
  goal_name: string;
  goal_amount: number;
  target_months: number;
  created_at: string;
}

interface MonthSummary {
  month: string;      // "Jan", "Feb" etc
  income: number;
  expenses: number;
  surplus: number;
}

interface CategorySpend {
  category: string;
  label: string;
  avg: number;
  pct: number;        // % of total avg expenses
}

interface SpendInsight {
  emoji: string;
  text: string;
  saving: number;
}

interface SavingsGoalModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onboardingCompleted: boolean;
}

// ── Helpers ───────────────────────────────────────────────────────────────────
const CATEGORY_LABELS: Record<string, string> = {
  food: "Food & Dining", fuel: "Transport", entertainment: "Entertainment",
  health: "Health", medicine: "Medicine", clothing: "Clothing",
  household: "Household", recharge: "Bills", rent: "Rent",
  vehicle: "Vehicle", "tech-products": "Tech", "professional-fee": "Professional",
  "trips-outings": "Trips", emis: "EMIs", others: "Others",
  "credit-card": "Credit Card", investment: "Investment",
};

const GOAL_PRESETS = [
  { emoji: "🛡️", name: "Emergency Fund" },
  { emoji: "✈️", name: "Trip" },
  { emoji: "💻", name: "Gadget" },
  { emoji: "🏠", name: "Down Payment" },
  { emoji: "💒", name: "Wedding" },
  { emoji: "🎓", name: "Education" },
  { emoji: "🚗", name: "Car" },
  { emoji: "🏋️", name: "Fitness" },
];

const TIMELINE_OPTIONS = [
  { label: "3 months",  months: 3  },
  { label: "6 months",  months: 6  },
  { label: "1 year",    months: 12 },
  { label: "2 years",   months: 24 },
  { label: "3 years",   months: 36 },
];

// ── Mini bar chart for 6-month trend ─────────────────────────────────────────
const TrendBar = ({
  months, maxVal,
}: { months: MonthSummary[]; maxVal: number }) => (
  <div className="flex items-end gap-1.5 h-16">
    {months.map((m, i) => {
      const incH  = maxVal > 0 ? (m.income   / maxVal) * 100 : 0;
      const expH  = maxVal > 0 ? (m.expenses / maxVal) * 100 : 0;
      return (
        <div key={i} className="flex-1 flex flex-col items-center gap-0.5">
          <div className="w-full flex items-end gap-px justify-center" style={{ height: 48 }}>
            <motion.div
              className="flex-1 rounded-t-sm bg-emerald-400/70"
              initial={{ height: 0 }}
              animate={{ height: `${incH}%` }}
              transition={{ type: "spring", stiffness: 80, damping: 18, delay: i * 0.06 }}
              style={{ alignSelf: "flex-end" }}
            />
            <motion.div
              className="flex-1 rounded-t-sm bg-red-400/60"
              initial={{ height: 0 }}
              animate={{ height: `${expH}%` }}
              transition={{ type: "spring", stiffness: 80, damping: 18, delay: i * 0.06 + 0.05 }}
              style={{ alignSelf: "flex-end" }}
            />
          </div>
          <span className="text-[9px] text-muted-foreground">{m.month}</span>
        </div>
      );
    })}
  </div>
);

// ── Main modal ────────────────────────────────────────────────────────────────
export const SavingsGoalModal = ({
  open, onOpenChange, onboardingCompleted,
}: SavingsGoalModalProps) => {
  const { user }        = useAuth();
  const { toast }       = useToast();
  const queryClient     = useQueryClient();

  // Data
  const [goals,        setGoals]        = useState<SavingsGoal[]>([]);
  const [months,       setMonths]       = useState<MonthSummary[]>([]);
  const [catSpend,     setCatSpend]     = useState<CategorySpend[]>([]);
  const [insights,     setInsights]     = useState<SpendInsight[]>([]);
  const [avgSurplus,   setAvgSurplus]   = useState(0);
  const [avgIncome,    setAvgIncome]    = useState(0);
  const [avgExpenses,  setAvgExpenses]  = useState(0);
  const [loading,      setLoading]      = useState(true);

  // Form
  const [isAdding,     setIsAdding]     = useState(false);
  const [goalName,     setGoalName]     = useState("");
  const [goalAmount,   setGoalAmount]   = useState("");
  const [goalMonths,   setGoalMonths]   = useState(12);
  const [saving,       setSaving]       = useState(false);
  const [selectedPreset, setSelectedPreset] = useState<number | null>(null);

  // ── Fetch 6-month data ─────────────────────────────────────────────────────
  useEffect(() => {
    if (!open || !user) return;
    setLoading(true);
    loadData();
  }, [open, user]);

  const loadData = async () => {
    if (!user) return;
    try {
      // Load goals
      const g = await getSavingsGoals(user.id);
      setGoals(g);

      // Load 6 months of transactions
      const now = new Date();
      const monthSummaries: MonthSummary[] = [];
      const catTotals: Record<string, number> = {};
      let totalMonths = 0;

      for (let i = 5; i >= 0; i--) {
        const d     = subMonths(now, i);
        const start = startOfMonth(d).toISOString();
        const end   = endOfMonth(d).toISOString();
        const txns  = await getMonthlyTransactions(user.id, start, end);

        const income   = txns.filter(t => t.type === "income").reduce((s, t) => s + t.amount, 0);
        const expenses = txns.filter(t => t.type === "expense").reduce((s, t) => s + t.amount, 0);

        // Accumulate category totals
        txns.filter(t => t.type === "expense").forEach(t => {
          catTotals[t.category] = (catTotals[t.category] || 0) + t.amount;
        });

        if (income > 0 || expenses > 0) totalMonths++;

        monthSummaries.push({
          month:    format(d, "MMM"),
          income,
          expenses,
          surplus:  income - expenses,
        });
      }

      setMonths(monthSummaries);

      // Compute averages (only over months with data)
      const dataMonths = Math.max(totalMonths, 1);
      const totalInc   = monthSummaries.reduce((s, m) => s + m.income,   0);
      const totalExp   = monthSummaries.reduce((s, m) => s + m.expenses, 0);
      const aInc  = totalInc  / dataMonths;
      const aExp  = totalExp  / dataMonths;
      const aSurp = aInc - aExp;
      setAvgIncome(aInc);
      setAvgExpenses(aExp);
      setAvgSurplus(aSurp);

      // Top categories by avg monthly spend
      const cats: CategorySpend[] = Object.entries(catTotals)
        .map(([cat, total]) => ({
          category: cat,
          label:    CATEGORY_LABELS[cat] || cat.replace(/-/g, " ").replace(/\b\w/g, c => c.toUpperCase()),
          avg:      total / dataMonths,
          pct:      aExp > 0 ? (total / dataMonths / aExp) * 100 : 0,
        }))
        .filter(c => c.avg > 0)
        .sort((a, b) => b.avg - a.avg)
        .slice(0, 5);
      setCatSpend(cats);

      // Generate smart insights
      const ins: SpendInsight[] = [];
      cats.slice(0, 3).forEach(cat => {
        // Suggest 20% reduction on top categories
        const potential = Math.round(cat.avg * 0.2 / 100) * 100;
        if (potential > 500) {
          ins.push({
            emoji: "💡",
            text:  `Trim ${cat.label} by 20% and save ${formatCompactINR(potential)}/month`,
            saving: potential,
          });
        }
      });
      if (aSurp > 0) {
        ins.push({
          emoji: "🚀",
          text:  `You already have ${formatCompactINR(aSurp)}/month surplus — ready to be put to work`,
          saving: aSurp,
        });
      }
      if (aSurp < 0) {
        ins.push({
          emoji: "⚠️",
          text:  `Expenses exceed income by ${formatCompactINR(Math.abs(aSurp))}/month — worth reviewing`,
          saving: 0,
        });
      }
      setInsights(ins.slice(0, 3));

    } catch (e) {
      console.error("SavingsGoalModal loadData:", e);
    } finally {
      setLoading(false);
    }
  };

  // ── Form handlers ──────────────────────────────────────────────────────────
  const resetForm = () => {
    setGoalName(""); setGoalAmount(""); setGoalMonths(12);
    setSelectedPreset(null); setIsAdding(false);
  };

  const handlePreset = (idx: number) => {
    const p = GOAL_PRESETS[idx];
    setSelectedPreset(idx);
    setGoalName(`${p.emoji} ${p.name}`);
  };

  const handleSave = async () => {
    if (!user) return;
    const amt = parseFloat(goalAmount.replace(/,/g, ""));
    if (!goalName.trim()) { toast({ title: "Give your goal a name", variant: "destructive" }); return; }
    if (!amt || amt < 100) { toast({ title: "Enter a valid amount (min ₹100)", variant: "destructive" }); return; }

    setSaving(true);
    try {
      const monthly = amt / goalMonths;
      await saveSavingsGoal(user.id, {
        goal_name:            goalName.trim(),
        goal_amount:          amt,
        target_months:        goalMonths,
        monthly_save_amount:  monthly,
        weekly_save_amount:   monthly / 4.33,
        monthly_spend_amount: Math.max(0, avgSurplus - monthly),
        weekly_spend_amount:  Math.max(0, avgSurplus - monthly) / 4.33,
      });
      queryClient.invalidateQueries({ queryKey: ["savingsGoals"] });
      toast({ title: `${goalName.trim()} goal created ✓` });
      resetForm();
      loadData();
    } catch (e: any) {
      toast({ title: "Couldn't save goal", description: e.message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string, name: string) => {
    try {
      await deleteSavingsGoal(id);
      queryClient.invalidateQueries({ queryKey: ["savingsGoals"] });
      toast({ title: `${name} removed` });
      loadData();
    } catch { toast({ title: "Couldn't delete goal", variant: "destructive" }); }
  };

  // Live calculation
  const parsedAmt   = parseFloat(goalAmount.replace(/,/g, "")) || 0;
  const monthlyNeed = parsedAmt > 0 && goalMonths > 0 ? parsedAmt / goalMonths : 0;
  const canAfford   = avgSurplus > 0 && monthlyNeed > 0;
  const autoMonths  = avgSurplus > 0 && parsedAmt > 0 ? Math.ceil(parsedAmt / avgSurplus) : 0;
  const maxVal      = Math.max(...months.map(m => Math.max(m.income, m.expenses)), 1);
  const hasData     = months.some(m => m.income > 0 || m.expenses > 0);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md w-[calc(100%-2rem)] max-h-[92vh] overflow-y-auto p-0 [grid-template-columns:minmax(0,1fr)] [&>button]:hidden border-0 shadow-2xl">

        {/* ── Header ─────────────────────────────────────────────────── */}
        <div className="bg-gradient-to-br from-primary to-violet-600 px-5 pt-5 pb-6">
          <div className="flex items-center justify-between mb-4">
            <div>
              <p className="text-xs font-semibold text-white/60 uppercase tracking-wider mb-0.5">Savings Goals</p>
              <h2 className="text-lg font-black text-white">Your financial runway</h2>
            </div>
            <button onClick={() => onOpenChange(false)}
              className="pointer-events-auto text-white/50 hover:text-white transition-colors p-1">
              ✕
            </button>
          </div>

          {/* 6-month trend bars */}
          {loading ? (
            <div className="h-16 bg-white/10 rounded-xl animate-pulse" />
          ) : hasData ? (
            <div className="space-y-2">
              <TrendBar months={months} maxVal={maxVal} />
              <div className="flex gap-3">
                <div className="flex items-center gap-1">
                  <div className="w-2 h-2 rounded-full bg-emerald-400/80" />
                  <span className="text-[10px] text-white/60">Income</span>
                </div>
                <div className="flex items-center gap-1">
                  <div className="w-2 h-2 rounded-full bg-red-400/70" />
                  <span className="text-[10px] text-white/60">Expenses</span>
                </div>
              </div>
            </div>
          ) : (
            <div className="text-center py-3 text-white/50 text-xs">
              No transactions logged yet — add some to see your trend.
            </div>
          )}
        </div>

        <div className="p-4 space-y-5">

          {/* ── Avg summary pills ──────────────────────────────────────── */}
          {hasData && !loading && (
            <div className="grid grid-cols-3 gap-2">
              {[
                { label: "Avg income",   val: avgIncome,   color: "text-emerald-600", bg: "bg-emerald-50"  },
                { label: "Avg expenses", val: avgExpenses, color: "text-red-500",     bg: "bg-red-50"      },
                { label: "Avg surplus",  val: avgSurplus,  color: avgSurplus >= 0 ? "text-primary" : "text-destructive",
                  bg: avgSurplus >= 0 ? "bg-primary/8" : "bg-destructive/8" },
              ].map(({ label, val, color, bg }) => (
                <div key={label} className={cn("rounded-xl p-2.5 text-center", bg)}>
                  <p className={cn("text-sm font-black leading-none", color)}>{formatCompactINR(Math.abs(val))}</p>
                  <p className="text-[10px] text-muted-foreground mt-1 leading-tight">{label}</p>
                </div>
              ))}
            </div>
          )}

          {/* ── Smart insights ─────────────────────────────────────────── */}
          {insights.length > 0 && !loading && (
            <div className="space-y-2">
              <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Smart insights</p>
              {insights.map((ins, i) => (
                <motion.div key={i}
                  className="flex items-start gap-2.5 rounded-xl bg-muted/40 border border-border/40 p-3"
                  initial={{ opacity: 0, x: -8 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: i * 0.08 }}
                >
                  <span className="text-base shrink-0 mt-0.5">{ins.emoji}</span>
                  <p className="text-xs text-foreground/80 leading-relaxed">{ins.text}</p>
                  {ins.saving > 0 && (
                    <span className="ml-auto shrink-0 text-[10px] font-bold text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded-full">
                      +{formatCompactINR(ins.saving)}
                    </span>
                  )}
                </motion.div>
              ))}
            </div>
          )}

          {/* ── Top spending categories ────────────────────────────────── */}
          {catSpend.length > 0 && !loading && (
            <div className="space-y-2">
              <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Where your money goes (avg/month)</p>
              {catSpend.map((cat, i) => (
                <div key={cat.category} className="space-y-1">
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-foreground font-medium">{cat.label}</span>
                    <span className="text-xs text-muted-foreground">{formatCompactINR(cat.avg)}</span>
                  </div>
                  <div className="h-1.5 bg-muted rounded-full overflow-hidden">
                    <motion.div
                      className="h-full bg-gradient-to-r from-primary/60 to-primary rounded-full"
                      initial={{ width: "0%" }}
                      animate={{ width: `${cat.pct}%` }}
                      transition={{ type: "spring", stiffness: 60, damping: 18, delay: i * 0.07 }}
                    />
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* ── Existing goals ────────────────────────────────────────── */}
          {goals.length > 0 && (
            <div className="space-y-2">
              <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Your goals</p>
              {goals.map(g => {
                const monthly = g.goal_amount / g.target_months;
                return (
                  <div key={g.id}
                    className="flex items-center gap-3 rounded-xl border border-border/50 bg-background/60 p-3">
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-foreground truncate">{g.goal_name}</p>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        {formatCompactINR(g.goal_amount)} · {g.target_months}mo · {formatCompactINR(monthly)}/mo
                      </p>
                    </div>
                    <button onClick={() => handleDelete(g.id, g.goal_name)}
                      className="pointer-events-auto text-muted-foreground hover:text-destructive transition-colors p-1 shrink-0">
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                );
              })}
            </div>
          )}

          {/* ── Add goal form ─────────────────────────────────────────── */}
          {!isAdding ? (
            <motion.button
              onClick={() => setIsAdding(true)}
              whileTap={{ scale: 0.97 }}
              className="w-full flex items-center justify-center gap-2 py-3 rounded-2xl border-2 border-dashed border-primary/30 text-primary text-sm font-semibold pointer-events-auto hover:border-primary/50 hover:bg-primary/5 transition-all"
            >
              <Plus className="h-4 w-4" /> Add a new goal
            </motion.button>
          ) : (
            <AnimatePresence>
              <motion.div
                className="space-y-4 rounded-2xl border border-border/60 bg-muted/20 p-4"
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ type: "spring", stiffness: 260, damping: 24 }}
              >
                <p className="text-sm font-bold text-foreground">New goal</p>

                {/* Preset chips */}
                <div>
                  <p className="text-[10px] text-muted-foreground mb-2 font-medium">Quick pick</p>
                  <div className="flex flex-wrap gap-2">
                    {GOAL_PRESETS.map((p, i) => (
                      <motion.button key={i} whileTap={{ scale: 0.94 }}
                        onClick={() => handlePreset(i)}
                        className={cn(
                          "px-3 py-1.5 rounded-full border text-xs font-medium transition-all pointer-events-auto",
                          selectedPreset === i
                            ? "bg-primary text-primary-foreground border-primary"
                            : "bg-background border-border/60 text-foreground hover:border-primary/40"
                        )}>
                        {p.emoji} {p.name}
                      </motion.button>
                    ))}
                  </div>
                </div>

                {/* Goal name */}
                <div className="space-y-1.5">
                  <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Goal name</p>
                  <Input
                    placeholder="e.g. Emergency Fund"
                    value={goalName}
                    onChange={e => setGoalName(e.target.value)}
                    className="h-10 rounded-xl pointer-events-auto text-sm"
                  />
                </div>

                {/* Amount */}
                <div className="space-y-1.5">
                  <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Target amount</p>
                  <div className="relative">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground font-semibold text-sm">₹</span>
                    <Input
                      type="number"
                      placeholder="50000"
                      value={goalAmount}
                      onChange={e => setGoalAmount(e.target.value)}
                      className="h-10 rounded-xl pl-7 pointer-events-auto text-sm [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                    />
                  </div>
                  {/* Auto-calculate hint */}
                  {parsedAmt > 0 && avgSurplus > 0 && (
                    <p className="text-[11px] text-emerald-600 font-medium">
                      At your current surplus, this takes ~{autoMonths} month{autoMonths !== 1 ? "s" : ""} automatically
                    </p>
                  )}
                </div>

                {/* Timeline */}
                <div className="space-y-1.5">
                  <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Timeline</p>
                  <div className="flex flex-wrap gap-2">
                    {TIMELINE_OPTIONS.map(t => (
                      <button key={t.months} onClick={() => setGoalMonths(t.months)}
                        className={cn(
                          "px-3 py-1.5 rounded-full border text-xs font-medium transition-all pointer-events-auto",
                          goalMonths === t.months
                            ? "bg-primary text-primary-foreground border-primary"
                            : "bg-background border-border/60 text-foreground hover:border-primary/40"
                        )}>
                        {t.label}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Live calculation */}
                {parsedAmt > 0 && goalMonths > 0 && (
                  <div className={cn(
                    "rounded-xl p-3 space-y-1",
                    canAfford ? "bg-emerald-50 border border-emerald-100" : "bg-amber-50 border border-amber-100"
                  )}>
                    <div className="flex items-center gap-1.5">
                      {canAfford
                        ? <Check className="h-3.5 w-3.5 text-emerald-600 shrink-0" />
                        : <AlertCircle className="h-3.5 w-3.5 text-amber-600 shrink-0" />
                      }
                      <p className={cn("text-xs font-bold", canAfford ? "text-emerald-700" : "text-amber-700")}>
                        {formatCompactINR(monthlyNeed)}/month needed
                      </p>
                    </div>
                    <p className={cn("text-[11px] leading-relaxed", canAfford ? "text-emerald-600" : "text-amber-600")}>
                      {canAfford
                        ? `Your surplus covers this — you'll have ${formatCompactINR(avgSurplus - monthlyNeed)}/month left over.`
                        : avgSurplus <= 0
                        ? "No surplus tracked yet. Add income transactions to see if this is achievable."
                        : `Needs ${formatCompactINR(monthlyNeed - avgSurplus)} more than your avg surplus. Consider a longer timeline.`}
                    </p>
                  </div>
                )}

                {/* Actions */}
                <div className="flex gap-2 pt-1">
                  <button onClick={resetForm}
                    className="flex-1 py-2.5 rounded-xl border border-border/60 text-sm text-muted-foreground pointer-events-auto hover:bg-muted/40 transition-colors">
                    Cancel
                  </button>
                  <motion.button onClick={handleSave} disabled={saving} whileTap={{ scale: 0.97 }}
                    className="flex-1 py-2.5 rounded-xl bg-primary text-primary-foreground text-sm font-bold pointer-events-auto disabled:opacity-50 shadow-md shadow-primary/20">
                    {saving ? (
                      <span className="flex items-center justify-center gap-1.5">
                        <span className="h-3.5 w-3.5 rounded-full border-2 border-white border-t-transparent animate-spin" />
                        Saving…
                      </span>
                    ) : "Create goal"}
                  </motion.button>
                </div>
              </motion.div>
            </AnimatePresence>
          )}

        </div>
      </DialogContent>
    </Dialog>
  );
};
