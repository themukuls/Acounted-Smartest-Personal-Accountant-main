import { AppLayout } from "@/components/layout/AppLayout";
import { GlassCard } from "@/components/ui/glass-card";
import { useAuth } from "@/contexts/AuthContext";
import { useState, useEffect } from "react";
import { useToast } from "@/hooks/use-toast";
import { formatFullINR } from "@/lib/currency";
import { Edit3, ArrowRight, TrendingUp, Calendar, IndianRupee } from "lucide-react";
import { format, addMonths, startOfMonth, endOfMonth } from "date-fns";
import { getISTDate } from "@/lib/date-utils";
import { BudgetInsights } from "@/components/budget/BudgetInsights";
import { FixedExpensesDialog } from "@/components/budget/FixedExpensesDialog";
import { VariableBudgetDialog } from "@/components/budget/VariableBudgetDialog";
import { getIncomeDetails, getExpenseCategories, saveExpenseCategory, deleteExpenseCategory } from "@/integrations/indexeddb/services/onboardingService";
import { getVariableBudgetEntries, saveVariableBudgetEntry, deleteVariableBudgetEntry } from "@/integrations/indexeddb/services/variableBudgetService";
import { getMonthlyBudgets, saveMonthlyBudget } from "@/integrations/indexeddb/services/monthlyBudgetService";
import { getSavingsGoals } from "@/integrations/indexeddb/services/savingsGoalService";
import { getMonthlyTransactions } from "@/integrations/indexeddb/services/dataService";
import { useQueryClient } from "@tanstack/react-query";
import { cn } from "@/lib/utils";
import { motion } from "framer-motion";

interface ExpenseCategory {
  id: string; category_name: string; amount: number;
  frequency: string; category_type: string;
}
interface EditingData { category_name: string; amount: string; }
interface VariableBudgetEntry {
  id: string; category_name: string; allocated_amount: number;
  budget_month: string; notes?: string; user_id: string;
  created_at: string; updated_at: string;
}
interface EditingBudgetData { category_name: string; allocated_amount: string; notes: string; }

// ── Time-aware greeting ───────────────────────────────────────────────────────
const getGreeting = (name: string) => {
  const h     = new Date().getHours();
  const first = name.trim().split(" ")[0] || "";
  if (h < 5)  return `Up late${first ? `, ${first}` : ""}? 🌙`;
  if (h < 12) return `Good morning${first ? `, ${first}` : ""} ☀️`;
  if (h < 17) return `Hey${first ? ` ${first}` : ""} 👋`;
  if (h < 21) return `Good evening${first ? `, ${first}` : ""} 🌆`;
  return       `Night owl${first ? `, ${first}` : ""}? 🦉`;
};

const Budget = () => {
  const { user } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [fixedExpenses, setFixedExpenses]                   = useState<ExpenseCategory[]>([]);
  const [variableBudgetEntries, setVariableBudgetEntries]   = useState<VariableBudgetEntry[]>([]);
  const [loading, setLoading]                               = useState(true);
  const [monthlySpent, setMonthlySpent]                     = useState(0);
  const [budgetDateRange, setBudgetDateRange]               = useState({ startDate: new Date(), endDate: new Date() });
  const [hasSavedBudgetDates, setHasSavedBudgetDates]       = useState(false);
  const [newVariableBudgetEntry, setNewVariableBudgetEntry] = useState({ category_name: "", allocated_amount: "", notes: "" });
  const [editingCategory, setEditingCategory]               = useState<string | null>(null);
  const [editingData, setEditingData]                       = useState<EditingData>({ category_name: "", amount: "" });
  const [editingBudgetEntry, setEditingBudgetEntry]         = useState<string | null>(null);
  const [editingBudgetData, setEditingBudgetData]           = useState<EditingBudgetData>({ category_name: "", allocated_amount: "", notes: "" });
  const [allMonthlyBudgets, setAllMonthlyBudgets]           = useState<Record<string, { startDate: Date; endDate: Date }>>({});
  const [totalMonthlyIncome, setTotalMonthlyIncome]         = useState(0);
  const [totalMonthlySavingsTarget, setTotalMonthlySavingsTarget] = useState(0);
  const [showFixedExpensesDialog, setShowFixedExpensesDialog]   = useState(false);
  const [showVariableBudgetDialog, setShowVariableBudgetDialog] = useState(false);

  useEffect(() => { if (user) loadSavedBudgetDates(); }, [user]);
  useEffect(() => {
    if (user && hasSavedBudgetDates) {
      fetchCategories();
      fetchMonthlySpending();
      fetchVariableBudgetEntries();
      fetchIncomeAndSavingsGoals();
    }
  }, [user, budgetDateRange, hasSavedBudgetDates]);

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["monthlyBudgetSummary"] });
    queryClient.invalidateQueries({ queryKey: ["activeNotifications"] });
    queryClient.invalidateQueries({ queryKey: ["seenNotificationIds"] });
  };

  const loadSavedBudgetDates = async () => {
    try {
      const now = getISTDate();
      const currentMonthYYYYMM = format(now, "yyyy-MM");
      const allBudgets = await getMonthlyBudgets(user!.id);
      const budgetsMap: Record<string, { startDate: Date; endDate: Date }> = {};
      allBudgets?.forEach(b => {
        if (b.budget_start_date && b.budget_end_date)
          budgetsMap[b.budget_month] = { startDate: new Date(b.budget_start_date), endDate: new Date(b.budget_end_date) };
      });
      setAllMonthlyBudgets(budgetsMap);
      if (!budgetsMap[currentMonthYYYYMM]) {
        const s = startOfMonth(now), e = endOfMonth(now);
        await saveMonthlyBudget(user!.id, currentMonthYYYYMM, s, e);
        budgetsMap[currentMonthYYYYMM] = { startDate: s, endDate: e };
        const monthName = format(now, "MMMM");
        toast({ title: `${monthName} is all set`, description: "Let's make it a great month." });
        invalidate();
      }
      setBudgetDateRange({ startDate: startOfMonth(now), endDate: endOfMonth(now) });
      setHasSavedBudgetDates(true);
    } catch {
      const now = getISTDate();
      setBudgetDateRange({ startDate: startOfMonth(now), endDate: endOfMonth(now) });
      setHasSavedBudgetDates(true);
    }
  };

  const saveBudgetDates = async (range: typeof budgetDateRange) => {
    try {
      const key = format(range.startDate, "yyyy-MM");
      await saveMonthlyBudget(user!.id, key, range.startDate, range.endDate);
      const monthName = format(range.startDate, "MMMM");
      toast({ title: `Switched to ${monthName}`, description: "Your budget view is updated." });
      setAllMonthlyBudgets(p => ({ ...p, [key]: { startDate: range.startDate, endDate: range.endDate } }));
      invalidate();
    } catch {
      toast({ title: "Couldn't save budget period", variant: "destructive" });
    }
  };

  const fetchCategories = async () => {
    try {
      const data = await getExpenseCategories(user!.id);
      setFixedExpenses(data?.filter(c => c.category_type === "fixed") || []);
    } catch { /* silent */ }
    finally { setLoading(false); }
  };

  const fetchMonthlySpending = async () => {
    try {
      const data = await getMonthlyTransactions(user!.id, budgetDateRange.startDate.toISOString(), budgetDateRange.endDate.toISOString(), "expense");
      setMonthlySpent(data?.reduce((s, t) => s + Number(t.amount), 0) || 0);
    } catch { /* silent */ }
  };

  const fetchVariableBudgetEntries = async () => {
    try {
      const key = `${format(budgetDateRange.startDate, "yyyy-MM-dd")}_${format(budgetDateRange.endDate, "yyyy-MM-dd")}`;
      setVariableBudgetEntries(await getVariableBudgetEntries(user!.id, key) || []);
    } catch { setVariableBudgetEntries([]); }
  };

  const fetchIncomeAndSavingsGoals = async () => {
    try {
      const inc = await getIncomeDetails(user!.id);
      let income = 0;
      if (inc) {
        income += inc.monthly_salary || inc.basic_salary || 0;
        income += inc.monthly_other_income || 0;
        income += Number((inc.form_data as any)?.freelance_monthly_avg || 0);
      }
      setTotalMonthlyIncome(income);
      const goals = await getSavingsGoals(user!.id);
      setTotalMonthlySavingsTarget(goals?.reduce((s, g) => s + g.goal_amount / g.target_months, 0) || 0);
    } catch { setTotalMonthlyIncome(0); setTotalMonthlySavingsTarget(0); }
  };

  const handleAddVariableBudgetEntry = async () => {
    if (!newVariableBudgetEntry.category_name || !newVariableBudgetEntry.allocated_amount) {
      toast({ title: "Fill in the category and amount", variant: "destructive" }); return;
    }
    try {
      const key = `${format(budgetDateRange.startDate, "yyyy-MM-dd")}_${format(budgetDateRange.endDate, "yyyy-MM-dd")}`;
      await saveVariableBudgetEntry(user!.id, { budget_month: key, category_name: newVariableBudgetEntry.category_name, allocated_amount: parseFloat(newVariableBudgetEntry.allocated_amount), notes: newVariableBudgetEntry.notes || null });
      toast({ title: "Variable budget added ✓" });
      setNewVariableBudgetEntry({ category_name: "", allocated_amount: "", notes: "" });
      fetchVariableBudgetEntries(); invalidate();
    } catch (e: any) { toast({ title: e.message || "Couldn't add entry", variant: "destructive" }); }
  };

  const handleDeleteVariableBudgetEntry = async (id: string, name: string) => {
    try {
      await deleteVariableBudgetEntry(id);
      toast({ title: `${name} removed` });
      fetchVariableBudgetEntries(); invalidate();
    } catch { toast({ title: "Couldn't delete entry", variant: "destructive" }); }
  };

  const handleDeleteCategory = async (id: string, name: string) => {
    try {
      await deleteExpenseCategory(id);
      toast({ title: `${name} removed` });
      fetchCategories(); invalidate();
    } catch { toast({ title: "Couldn't delete category", variant: "destructive" }); }
  };

  const handleStartEdit = (cat: ExpenseCategory) => { setEditingCategory(cat.id); setEditingData({ category_name: cat.category_name, amount: cat.amount.toString() }); };
  const handleCancelEdit = () => { setEditingCategory(null); setEditingData({ category_name: "", amount: "" }); };
  const handleEditingDataChange = (f: keyof EditingData, v: string) => setEditingData(p => ({ ...p, [f]: v }));
  const handleStartEditBudgetEntry = (e: VariableBudgetEntry) => { setEditingBudgetEntry(e.id); setEditingBudgetData({ category_name: e.category_name, allocated_amount: e.allocated_amount.toString(), notes: e.notes || "" }); };
  const handleCancelEditBudgetEntry = () => { setEditingBudgetEntry(null); setEditingBudgetData({ category_name: "", allocated_amount: "", notes: "" }); };
  const handleEditingBudgetDataChange = (f: keyof EditingBudgetData, v: string) => setEditingBudgetData(p => ({ ...p, [f]: v }));

  const handleSaveEdit = async (id: string) => {
    if (!editingData.category_name || !editingData.amount) { toast({ title: "Fill in all fields", variant: "destructive" }); return; }
    try {
      await saveExpenseCategory(user!.id, { id, category_name: editingData.category_name, amount: parseFloat(editingData.amount), category_type: "fixed", frequency: fixedExpenses.find(e => e.id === id)?.frequency || "monthly" });
      toast({ title: "Updated ✓" });
      setEditingCategory(null); setEditingData({ category_name: "", amount: "" });
      fetchCategories(); fetchVariableBudgetEntries(); invalidate();
    } catch { toast({ title: "Couldn't update", variant: "destructive" }); }
  };

  const handleSaveEditBudgetEntry = async (id: string) => {
    if (!editingBudgetData.category_name || !editingBudgetData.allocated_amount) { toast({ title: "Fill in category and amount", variant: "destructive" }); return; }
    try {
      await saveVariableBudgetEntry(user!.id, { id, category_name: editingBudgetData.category_name, allocated_amount: parseFloat(editingBudgetData.allocated_amount), notes: editingBudgetData.notes || null, budget_month: variableBudgetEntries.find(e => e.id === id)?.budget_month || "" });
      toast({ title: "Updated ✓" });
      setEditingBudgetEntry(null); setEditingBudgetData({ category_name: "", allocated_amount: "", notes: "" });
      fetchVariableBudgetEntries(); invalidate();
    } catch { toast({ title: "Couldn't update", variant: "destructive" }); }
  };

  const getTotalFixed          = () => fixedExpenses.reduce((s, c) => s + c.amount, 0);
  const getTotalVariable       = () => variableBudgetEntries.reduce((s, e) => s + e.allocated_amount, 0);
  const totalPlannedSpending   = getTotalFixed() + getTotalVariable() + totalMonthlySavingsTarget;
  const getBudgetPeriodLabel   = () => `${format(budgetDateRange.startDate, "MMM dd")} – ${format(budgetDateRange.endDate, "MMM dd, yyyy")}`;

  // ── Month tiles — current + next only ──────────────────────────────────────
  const now = getISTDate();
  const monthTiles = [0, 1].map(i => {
    const d = addMonths(now, i);
    return { label: format(d, "MMMM yyyy"), value: format(d, "yyyy-MM"), startDate: startOfMonth(d), endDate: endOfMonth(d), tag: i === 0 ? "This month" : "Next month" };
  });
  const activeMonth = format(budgetDateRange.startDate, "yyyy-MM");

  const handleMonthTileClick = async (tile: typeof monthTiles[0]) => {
    const range = { startDate: startOfMonth(tile.startDate), endDate: endOfMonth(tile.endDate) };
    setBudgetDateRange(range);
    await saveBudgetDates(range);
  };

  if (loading) return (
    <AppLayout>
      <div className="min-h-screen flex items-center justify-center">
        <motion.div className="h-10 w-10 rounded-full border-2 border-primary border-t-transparent"
          animate={{ rotate: 360 }} transition={{ duration: 0.8, repeat: Infinity, ease: "linear" }} />
      </div>
    </AppLayout>
  );

  return (
    <AppLayout>
      <div className="space-y-4 mt-4 md:mt-0">

        {/* ── Personalised header ────────────────────────────────────────── */}
        <div>
          <h1 className="text-xl font-bold text-foreground">
            {getGreeting(user?.display_name || "")}
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            {format(budgetDateRange.startDate, "MMMM")} budget — let's see how things are shaping up.
          </p>
        </div>

        {/* ── Month selector ─────────────────────────────────────────────── */}
        <motion.div
          className="flex gap-2"
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ type: "spring", stiffness: 260, damping: 26, delay: 0.12 }}
        >
          {monthTiles.map(tile => {
            const isActive = activeMonth === tile.value;
            return (
              <motion.button
                key={tile.value}
                onClick={() => handleMonthTileClick(tile)}
                whileTap={{ scale: 0.97 }}
                className={cn(
                  "flex-1 flex flex-col items-center py-3 px-2 rounded-2xl border transition-all pointer-events-auto",
                  isActive
                    ? "bg-primary text-primary-foreground border-primary shadow-md shadow-primary/20"
                    : "bg-background/60 border-border/60 text-foreground hover:border-primary/40"
                )}
              >
                <span className={cn("text-[10px] font-semibold mb-0.5", isActive ? "text-primary-foreground/70" : "text-muted-foreground")}>
                  {tile.tag}
                </span>
                <span className="text-base font-black leading-tight">{format(tile.startDate, "MMM")}</span>
                <span className={cn("text-[10px]", isActive ? "text-primary-foreground/70" : "text-muted-foreground")}>
                  {format(tile.startDate, "yyyy")}
                </span>
              </motion.button>
            );
          })}
        </motion.div>

        {/* ── Income & allocation card ────────────────────────────────────── */}
        {totalMonthlyIncome > 0 && (
          <motion.div
            initial={{ opacity: 0, y: 16, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            transition={{ type: "spring", stiffness: 260, damping: 26, delay: 0.2 }}
          >
            <GlassCard className="p-4 space-y-3" hover={false}>
              {/* Income row */}
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2.5">
                  <div className="h-9 w-9 rounded-xl bg-emerald-100 flex items-center justify-center shrink-0">
                    <IndianRupee className="h-4.5 w-4.5 text-emerald-600" />
                  </div>
                  <div>
                    <p className="text-[10px] text-muted-foreground font-medium uppercase tracking-wide">Monthly income</p>
                    <p className="text-lg font-black text-foreground">{formatFullINR(totalMonthlyIncome)}</p>
                  </div>
                </div>
                <div className="flex items-center gap-1.5 text-right">
                  <Calendar className="h-3 w-3 text-muted-foreground" />
                  <p className="text-xs text-muted-foreground">{getBudgetPeriodLabel()}</p>
                </div>
              </div>

              {/* Animated allocation bar */}
              {(() => {
                const fixedPct = Math.min((getTotalFixed() / totalMonthlyIncome) * 100, 100);
                const varPct   = Math.min((getTotalVariable() / totalMonthlyIncome) * 100, 100 - fixedPct);
                const savePct  = Math.min((totalMonthlySavingsTarget / totalMonthlyIncome) * 100, 100 - fixedPct - varPct);
                const freePct  = Math.max(0, 100 - fixedPct - varPct - savePct);
                return (
                  <div>
                    <div className="flex h-2.5 rounded-full overflow-hidden gap-px bg-muted/50">
                      <motion.div className="bg-amber-400 h-full" initial={{ width: "0%" }} animate={{ width: `${fixedPct}%` }} transition={{ type: "spring", stiffness: 52, damping: 18, delay: 0.3 }} />
                      <motion.div className="bg-violet-400 h-full" initial={{ width: "0%" }} animate={{ width: `${varPct}%` }}   transition={{ type: "spring", stiffness: 52, damping: 18, delay: 0.4 }} />
                      <motion.div className="bg-emerald-400 h-full" initial={{ width: "0%" }} animate={{ width: `${savePct}%` }} transition={{ type: "spring", stiffness: 52, damping: 18, delay: 0.5 }} />
                      <div className="bg-muted-foreground/15 h-full flex-1" />
                    </div>
                    <div className="flex flex-wrap gap-x-3 gap-y-0.5 mt-1.5">
                      {[
                        { color: "bg-amber-400",          label: "Fixed",    pct: fixedPct },
                        { color: "bg-violet-400",          label: "Variable", pct: varPct   },
                        { color: "bg-emerald-400",         label: "Savings",  pct: savePct  },
                        { color: "bg-muted-foreground/30", label: "Free",     pct: freePct  },
                      ].map(s => (
                        <div key={s.label} className="flex items-center gap-1">
                          <div className={cn("h-1.5 w-1.5 rounded-full", s.color)} />
                          <span className="text-[10px] text-muted-foreground">{s.label} {s.pct.toFixed(0)}%</span>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })()}

              {/* Three action tiles */}
              <div className="grid grid-cols-3 gap-2 pt-1">
                <motion.button whileTap={{ scale: 0.95 }}
                  onClick={() => setShowFixedExpensesDialog(true)}
                  className="pointer-events-auto flex flex-col gap-1 p-2.5 rounded-xl bg-amber-50 border border-amber-200 text-left"
                >
                  <div className="flex items-center justify-between">
                    <Edit3 className="h-3 w-3 text-amber-500" />
                    <ArrowRight className="h-2.5 w-2.5 text-amber-400" />
                  </div>
                  <p className="text-[10px] text-amber-600 font-medium leading-tight">Fixed</p>
                  <p className="text-xs font-bold text-amber-700">{formatFullINR(getTotalFixed())}</p>
                </motion.button>

                <motion.button whileTap={{ scale: 0.95 }}
                  onClick={() => setShowVariableBudgetDialog(true)}
                  className="pointer-events-auto flex flex-col gap-1 p-2.5 rounded-xl bg-violet-50 border border-violet-200 text-left"
                >
                  <div className="flex items-center justify-between">
                    <Edit3 className="h-3 w-3 text-violet-500" />
                    <ArrowRight className="h-2.5 w-2.5 text-violet-400" />
                  </div>
                  <p className="text-[10px] text-violet-600 font-medium leading-tight">Variable</p>
                  <p className="text-xs font-bold text-violet-700">{formatFullINR(getTotalVariable())}</p>
                </motion.button>

                <div className="flex flex-col gap-1 p-2.5 rounded-xl bg-primary/8 border border-primary/20">
                  <TrendingUp className="h-3 w-3 text-primary" />
                  <p className="text-[10px] text-primary/70 font-medium leading-tight">Total plan</p>
                  <p className="text-xs font-bold text-primary">{formatFullINR(totalPlannedSpending)}</p>
                </div>
              </div>
            </GlassCard>
          </motion.div>
        )}

        {/* No income — compact tiles */}
        {totalMonthlyIncome === 0 && (
          <motion.div
            className="grid grid-cols-3 gap-2"
            initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}
            transition={{ type: "spring", stiffness: 260, damping: 26, delay: 0.2 }}
          >
            <motion.button whileTap={{ scale: 0.95 }} onClick={() => setShowFixedExpensesDialog(true)}
              className="pointer-events-auto flex flex-col gap-1.5 p-3 rounded-2xl bg-amber-50 border border-amber-200 text-left">
              <Edit3 className="h-3.5 w-3.5 text-amber-600" />
              <p className="text-[10px] text-amber-700/70 font-medium">Fixed</p>
              <p className="text-sm font-bold text-amber-700">{formatFullINR(getTotalFixed())}</p>
            </motion.button>
            <motion.button whileTap={{ scale: 0.95 }} onClick={() => setShowVariableBudgetDialog(true)}
              className="pointer-events-auto flex flex-col gap-1.5 p-3 rounded-2xl bg-violet-50 border border-violet-200 text-left">
              <Edit3 className="h-3.5 w-3.5 text-violet-600" />
              <p className="text-[10px] text-violet-700/70 font-medium">Variable</p>
              <p className="text-sm font-bold text-violet-700">{formatFullINR(getTotalVariable())}</p>
            </motion.button>
            <div className="flex flex-col gap-1.5 p-3 rounded-2xl bg-primary/8 border border-primary/20">
              <TrendingUp className="h-3.5 w-3.5 text-primary" />
              <p className="text-[10px] text-primary/70 font-medium">Total</p>
              <p className="text-sm font-bold text-primary">{formatFullINR(totalPlannedSpending)}</p>
            </div>
          </motion.div>
        )}

        {/* ── Insights ───────────────────────────────────────────────────── */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ type: "spring", stiffness: 260, damping: 26, delay: 0.3 }}
        >
          <BudgetInsights
            totalMonthlyIncome={totalMonthlyIncome}
            totalFixedExpenses={getTotalFixed()}
            totalVariableBudget={getTotalVariable()}
            totalMonthlySavingsTarget={totalMonthlySavingsTarget}
            variableBudgetEntries={variableBudgetEntries}
            onboardingCompleted={true}
          />
        </motion.div>

      </div>

      <FixedExpensesDialog
        open={showFixedExpensesDialog} onOpenChange={setShowFixedExpensesDialog}
        fixedExpenses={fixedExpenses} editingCategory={editingCategory}
        editingData={editingData} handleStartEdit={handleStartEdit}
        handleCancelEdit={handleCancelEdit} handleSaveEdit={handleSaveEdit}
        handleDeleteCategory={handleDeleteCategory} onEditingDataChange={handleEditingDataChange}
      />
      <VariableBudgetDialog
        open={showVariableBudgetDialog} onOpenChange={setShowVariableBudgetDialog}
        variableBudgetEntries={variableBudgetEntries} budgetDateRange={budgetDateRange}
        newVariableBudgetEntry={newVariableBudgetEntry} setNewVariableBudgetEntry={setNewVariableBudgetEntry}
        handleAddVariableBudgetEntry={handleAddVariableBudgetEntry}
        handleDeleteVariableBudgetEntry={handleDeleteVariableBudgetEntry}
        handleStartEditBudgetEntry={handleStartEditBudgetEntry}
        handleCancelEditBudgetEntry={handleCancelEditBudgetEntry}
        handleSaveEditBudgetEntry={handleSaveEditBudgetEntry}
        editingBudgetEntry={editingBudgetEntry} editingBudgetData={editingBudgetData}
        onEditingBudgetDataChange={handleEditingBudgetDataChange}
      />
    </AppLayout>
  );
};

export default Budget;
