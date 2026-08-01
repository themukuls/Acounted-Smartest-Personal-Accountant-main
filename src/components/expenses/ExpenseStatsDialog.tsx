"use client";

import React, { useMemo, useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { PieChart, Pie, Cell, ResponsiveContainer } from 'recharts';
import { formatFullINR, formatCompactINR } from "@/lib/currency";
import { TrendingDown, TrendingUp, Wallet, X, Lightbulb, PieChart as PieIcon } from 'lucide-react';
import { cn } from '@/lib/utils';
import { motion } from "framer-motion";
import { useAuth } from "@/contexts/AuthContext";
import { format } from "date-fns";
import { getIncomeDetails, getExpenseCategories } from "@/integrations/indexeddb/services/onboardingService";
import { getVariableBudgetEntries } from "@/integrations/indexeddb/services/variableBudgetService";
import { getSavingsGoals } from "@/integrations/indexeddb/services/savingsGoalService";

// ── Types ─────────────────────────────────────────────────────────────────────
interface Transaction {
  id: string; type: 'income' | 'expense'; amount: number;
  category: string; account: string; description: string;
  transaction_date: string; created_at: string;
}

interface ChartData {
  name: string; value: number; percentage: number;
  color: string; type: 'logged' | 'committed' | 'savings' | 'variable' | 'free';
  detail?: string;
}

interface ExpenseStatsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  monthLabel: string;
  transactions: Transaction[];
  budgetStartDate?: Date | null;
  budgetEndDate?:   Date | null;
}

// ── Colour palette ─────────────────────────────────────────────────────────────
const EXPENSE_COLORS = [
  '#3B82F6','#8B5CF6','#10B981','#F59E0B',
  '#EF4444','#06B6D4','#F97316','#84CC16',
  '#EC4899','#6366F1','#14B8A6','#A855F7',
];

const TYPE_COLORS: Record<ChartData['type'], string> = {
  logged:    '#EF4444',
  committed: '#F97316',
  savings:   '#10B981',
  variable:  '#8B5CF6',
  free:      '#3B82F6',
};

const TYPE_LABELS: Record<ChartData['type'], string> = {
  logged:    'Logged expenses',
  committed: 'Committed bills',
  savings:   'Savings goals',
  variable:  'Variable budget',
  free:      'Free to use',
};

const CATEGORY_LABELS: Record<string, string> = {
  food: "Food", fuel: "Transport", entertainment: "Entertainment",
  health: "Health", medicine: "Medicine", clothing: "Clothing",
  household: "Household", recharge: "Bills", rent: "Rent",
  vehicle: "Vehicle", "tech-products": "Tech", "professional-fee": "Professional",
  "trips-outings": "Trips", emis: "EMIs", others: "Others", income: "Income",
};

const catLabel = (c: string) =>
  CATEGORY_LABELS[c] || c.replace(/-/g, ' ').replace(/\b\w/g, l => l.toUpperCase());

// ── Animated donut chart ───────────────────────────────────────────────────────
const DonutView = ({
  data, total, centerLabel, emptyMsg,
}: { data: ChartData[]; total: number; centerLabel: string; emptyMsg: string }) => {
  const [activeIdx, setActiveIdx] = useState<number | null>(null);

  if (total === 0 || data.length === 0) return (
    <div className="text-center py-10 space-y-2">
      <Wallet className="h-10 w-10 text-muted-foreground/30 mx-auto" />
      <p className="text-sm text-muted-foreground">{emptyMsg}</p>
    </div>
  );

  const active = activeIdx !== null ? data[activeIdx] : null;

  return (
    <div className="space-y-3">
      <div className="relative h-44">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie data={data} cx="50%" cy="50%"
              innerRadius={52} outerRadius={72}
              dataKey="value" paddingAngle={2}
              onMouseEnter={(_, i) => setActiveIdx(i)}
              onMouseLeave={() => setActiveIdx(null)}
            >
              {data.map((d, i) => (
                <Cell key={i} fill={d.color}
                  opacity={activeIdx === null || activeIdx === i ? 1 : 0.3}
                  stroke="none" />
              ))}
            </Pie>
          </PieChart>
        </ResponsiveContainer>
        <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
          {active ? (
            <>
              <p className="text-[10px] font-semibold text-muted-foreground max-w-[80px] text-center leading-tight">{active.name}</p>
              <p className="text-sm font-black text-foreground">{formatCompactINR(active.value)}</p>
              <p className="text-[10px] text-muted-foreground">{active.percentage.toFixed(1)}%</p>
            </>
          ) : (
            <>
              <p className="text-[10px] text-muted-foreground">{centerLabel}</p>
              <p className="text-sm font-black text-foreground">{formatCompactINR(total)}</p>
            </>
          )}
        </div>
      </div>

      <div className="space-y-2">
        {data.map((d, i) => (
          <div key={i}
            className={cn("rounded-xl p-3 transition-colors cursor-default", activeIdx === i ? "bg-muted/60" : "hover:bg-muted/30")}
            onMouseEnter={() => setActiveIdx(i)}
            onMouseLeave={() => setActiveIdx(null)}
          >
            <div className="flex items-center justify-between mb-1.5">
              <div className="flex items-center gap-2 min-w-0">
                <div className="h-2.5 w-2.5 rounded-full shrink-0" style={{ background: d.color }} />
                <span className="text-xs font-semibold text-foreground truncate">{d.name}</span>
                {d.detail && <span className="text-[10px] text-muted-foreground truncate">· {d.detail}</span>}
              </div>
              <div className="flex items-center gap-2 shrink-0 ml-2">
                <span className="text-[10px] text-muted-foreground">{d.percentage.toFixed(1)}%</span>
                <span className="text-xs font-bold text-foreground">{formatCompactINR(d.value)}</span>
              </div>
            </div>
            <div className="h-1 w-full bg-muted/50 rounded-full overflow-hidden">
              <motion.div className="h-full rounded-full"
                style={{ background: d.color }}
                initial={{ width: "0%" }}
                animate={{ width: `${d.percentage}%` }}
                transition={{ type: "spring", stiffness: 60, damping: 18, delay: i * 0.05 }}
              />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

// ── Main dialog ────────────────────────────────────────────────────────────────
export const ExpenseStatsDialog = ({
  open, onOpenChange, monthLabel, transactions, budgetStartDate, budgetEndDate,
}: ExpenseStatsDialogProps) => {
  const { user } = useAuth();
  const [tab, setTab] = useState<'full' | 'category' | 'method'>('full');

  // Full-picture data fetched from IndexedDB
  const [monthlyIncome,    setMonthlyIncome]    = useState(0);
  const [fixedBills,       setFixedBills]        = useState(0);
  const [savingsTarget,    setSavingsTarget]     = useState(0);
  const [variableBudget,   setVariableBudget]    = useState(0);
  const [fixedItems,       setFixedItems]        = useState<{ name: string; amount: number }[]>([]);
  const [savingsItems,     setSavingsItems]      = useState<{ name: string; amount: number }[]>([]);
  const [variableItems,    setVariableItems]     = useState<{ name: string; amount: number }[]>([]);
  const [loadingExtra,     setLoadingExtra]      = useState(false);

  useEffect(() => {
    if (!open || !user) return;
    setLoadingExtra(true);
    loadExtra();
  }, [open, user, budgetStartDate, budgetEndDate]);

  const loadExtra = async () => {
    if (!user) return;
    try {
      const [income, expCats, goals] = await Promise.all([
        getIncomeDetails(user.id),
        getExpenseCategories(user.id),
        getSavingsGoals(user.id),
      ]);

      // Monthly income
      let inc = 0;
      if (income) {
        inc += income.monthly_salary || income.basic_salary || 0;
        inc += income.monthly_other_income || 0;
        inc += Number((income.form_data as any)?.freelance_monthly_avg || 0);
      }
      setMonthlyIncome(inc);

      // Fixed bills
      const fixed = expCats.filter(c => c.category_type === 'fixed');
      setFixedItems(fixed.map(c => ({ name: catLabel(c.category_name), amount: c.amount })));
      setFixedBills(fixed.reduce((s, c) => s + c.amount, 0));

      // Savings goals — monthly contribution
      const sItems = goals.map(g => ({
        name:   g.goal_name,
        amount: Math.ceil(g.goal_amount / g.target_months),
      }));
      setSavingsItems(sItems);
      setSavingsTarget(sItems.reduce((s, i) => s + i.amount, 0));

      // Variable budget entries for this month
      if (budgetStartDate && budgetEndDate) {
        const key = `${format(budgetStartDate, 'yyyy-MM-dd')}_${format(budgetEndDate, 'yyyy-MM-dd')}`;
        const varEntries = await getVariableBudgetEntries(user.id, key);
        const vItems = varEntries.map(e => ({ name: catLabel(e.category_name), amount: e.allocated_amount }));
        setVariableItems(vItems);
        setVariableBudget(vItems.reduce((s, i) => s + i.amount, 0));
      } else {
        const varAll = expCats.filter(c => c.category_type === 'variable');
        const vItems = varAll.map(c => ({ name: catLabel(c.category_name), amount: c.amount }));
        setVariableItems(vItems);
        setVariableBudget(vItems.reduce((s, i) => s + i.amount, 0));
      }
    } catch (e) {
      console.error("ExpenseStatsDialog loadExtra:", e);
    } finally {
      setLoadingExtra(false);
    }
  };

  // Transaction totals
  const totalIncome  = useMemo(() => transactions.filter(t => t.type === 'income').reduce((s, t) => s + t.amount, 0), [transactions]);
  const totalExpense = useMemo(() => transactions.filter(t => t.type === 'expense').reduce((s, t) => s + t.amount, 0), [transactions]);
  const net = totalIncome - totalExpense;

  // ── Full picture chart data ──────────────────────────────────────────────────
  // Uses the higher of logged income vs declared income
  const effectiveIncome = Math.max(totalIncome, monthlyIncome);

  const fullData: ChartData[] = useMemo(() => {
    if (effectiveIncome <= 0) return [];
    const committed  = Math.min(fixedBills,     effectiveIncome);
    const savings    = Math.min(savingsTarget,  Math.max(0, effectiveIncome - committed));
    const variable   = Math.min(variableBudget, Math.max(0, effectiveIncome - committed - savings));
    // Logged expenses that AREN'T already in fixed bills — avoid double-counting
    const loggedNet  = Math.min(totalExpense, Math.max(0, effectiveIncome - committed - savings - variable));
    const free       = Math.max(0, effectiveIncome - committed - savings - variable - loggedNet);

    const segments: { type: ChartData['type']; value: number; detail?: string }[] = [
      { type: 'committed', value: committed,  detail: `${fixedItems.length} fixed bills` },
      { type: 'savings',   value: savings,    detail: `${savingsItems.length} goal${savingsItems.length !== 1 ? 's' : ''}` },
      { type: 'variable',  value: variable,   detail: 'variable budget' },
      { type: 'logged',    value: loggedNet,  detail: 'this month' },
      { type: 'free',      value: free,       detail: 'unallocated' },
    ].filter(s => s.value > 0);

    return segments.map(s => ({
      name:       TYPE_LABELS[s.type],
      value:      s.value,
      percentage: effectiveIncome > 0 ? (s.value / effectiveIncome) * 100 : 0,
      color:      TYPE_COLORS[s.type],
      type:       s.type,
      detail:     s.detail,
    }));
  }, [effectiveIncome, fixedBills, savingsTarget, variableBudget, totalExpense]);

  // ── Category breakdown ───────────────────────────────────────────────────────
  const categoryData: ChartData[] = useMemo(() => {
    const map: Record<string, number> = {};
    transactions.filter(t => t.type === 'expense').forEach(t => {
      map[t.category] = (map[t.category] || 0) + t.amount;
    });
    return Object.entries(map)
      .map(([name, value], i) => ({
        name:       catLabel(name),
        value,
        percentage: totalExpense > 0 ? (value / totalExpense) * 100 : 0,
        color:      EXPENSE_COLORS[i % EXPENSE_COLORS.length],
        type:       'logged' as const,
      }))
      .sort((a, b) => b.value - a.value);
  }, [transactions, totalExpense]);

  // ── Method breakdown ─────────────────────────────────────────────────────────
  const methodData: ChartData[] = useMemo(() => {
    const map: Record<string, number> = {};
    transactions.filter(t => t.type === 'expense').forEach(t => {
      map[t.account] = (map[t.account] || 0) + t.amount;
    });
    return Object.entries(map)
      .map(([name, value], i) => ({
        name:       catLabel(name),
        value,
        percentage: totalExpense > 0 ? (value / totalExpense) * 100 : 0,
        color:      EXPENSE_COLORS[i % EXPENSE_COLORS.length],
        type:       'logged' as const,
      }))
      .sort((a, b) => b.value - a.value);
  }, [transactions, totalExpense]);

  // ── Insights ─────────────────────────────────────────────────────────────────
  const freeSegment = fullData.find(d => d.type === 'free');
  const freeAmount  = freeSegment?.value || 0;
  const insights: string[] = [];
  if (effectiveIncome > 0) {
    if (freeAmount > 1000)
      insights.push(`₹${formatCompactINR(freeAmount)} is genuinely unallocated this month — consider moving it to savings.`);
    if (fixedBills / effectiveIncome > 0.55)
      insights.push("Fixed bills are above 55% of income — review recurring subscriptions.");
    if (savingsTarget === 0 && effectiveIncome > 0)
      insights.push("No savings goal set — even ₹500/month invested now compounds significantly.");
    const topCat = categoryData[0];
    if (topCat && topCat.percentage > 30)
      insights.push(`${topCat.name} is ${topCat.percentage.toFixed(0)}% of your logged expenses — your biggest spend this month.`);
  }

  const tabs = [
    { id: 'full'     as const, label: 'Full picture',  },
    { id: 'category' as const, label: 'By category',   },
    { id: 'method'   as const, label: 'By method',     },
  ];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md max-h-[92vh] overflow-y-auto p-0 gap-0 rounded-2xl border-border/50 pointer-events-auto [grid-template-columns:minmax(0,1fr)] [&>button:first-child]:hidden">

        {/* Header */}
        <DialogHeader className="px-5 pt-5 pb-3 border-b border-border/40">
          <div className="flex items-center justify-between">
            <div>
              <DialogTitle className="text-base font-bold gradient-text">Spending Stats</DialogTitle>
              <p className="text-xs text-muted-foreground mt-0.5">{monthLabel}</p>
            </div>
            <button onClick={() => onOpenChange(false)}
              className="h-8 w-8 rounded-xl flex items-center justify-center bg-muted/50 hover:bg-muted transition-colors pointer-events-auto">
              <X className="h-4 w-4 text-muted-foreground" />
            </button>
          </div>
        </DialogHeader>

        <div className="px-5 py-4 space-y-4">

          {/* Summary strip */}
          <div className="grid grid-cols-3 gap-2">
            <div className="rounded-xl bg-emerald-50 border border-emerald-200 p-3">
              <div className="flex items-center gap-1 mb-1">
                <TrendingUp className="h-3 w-3 text-emerald-600" />
                <p className="text-[10px] font-semibold text-emerald-600">Income</p>
              </div>
              <p className="text-sm font-black text-emerald-700">{formatCompactINR(totalIncome)}</p>
              {monthlyIncome > 0 && monthlyIncome !== totalIncome && (
                <p className="text-[9px] text-muted-foreground mt-0.5">declared {formatCompactINR(monthlyIncome)}</p>
              )}
            </div>
            <div className="rounded-xl bg-red-50 border border-red-200 p-3">
              <div className="flex items-center gap-1 mb-1">
                <TrendingDown className="h-3 w-3 text-red-500" />
                <p className="text-[10px] font-semibold text-red-500">Spent</p>
              </div>
              <p className="text-sm font-black text-red-600">{formatCompactINR(totalExpense)}</p>
            </div>
            <div className={cn("rounded-xl border p-3",
              net >= 0 ? "bg-primary/8 border-primary/20" : "bg-amber-50 border-amber-200")}>
              <div className="flex items-center gap-1 mb-1">
                <Wallet className="h-3 w-3 text-muted-foreground" />
                <p className="text-[10px] font-semibold text-muted-foreground">Net</p>
              </div>
              <p className={cn("text-sm font-black", net >= 0 ? "text-primary" : "text-amber-600")}>
                {formatCompactINR(Math.abs(net))}
              </p>
              <p className="text-[9px] text-muted-foreground">{net >= 0 ? "surplus" : "deficit"}</p>
            </div>
          </div>

          {/* Smart insight strip */}
          {insights.length > 0 && (
            <div className="space-y-2">
              {insights.slice(0, 2).map((ins, i) => (
                <div key={i} className="flex items-start gap-2 rounded-xl bg-primary/5 border border-primary/10 px-3 py-2.5">
                  <Lightbulb className="h-3.5 w-3.5 text-primary shrink-0 mt-0.5" />
                  <p className="text-[11px] text-foreground/80 leading-relaxed">{ins}</p>
                </div>
              ))}
            </div>
          )}

          {/* Tabs */}
          <div className="flex gap-1 p-1 rounded-xl bg-muted/40 border border-border/40">
            {tabs.map(t => (
              <button key={t.id} onClick={() => setTab(t.id)}
                className={cn(
                  "flex-1 py-1.5 rounded-lg text-[11px] font-semibold transition-all pointer-events-auto",
                  tab === t.id
                    ? "bg-white shadow-sm text-primary border border-border/40"
                    : "text-muted-foreground hover:text-foreground"
                )}>
                {t.label}
              </button>
            ))}
          </div>

          {/* Full picture tab */}
          {tab === 'full' && (
            <div className="space-y-4">
              {loadingExtra ? (
                <div className="space-y-3 animate-pulse">
                  <div className="h-44 bg-muted rounded-2xl" />
                  <div className="space-y-2">
                    {[1,2,3,4].map(i => <div key={i} className="h-10 bg-muted rounded-xl" />)}
                  </div>
                </div>
              ) : effectiveIncome === 0 ? (
                <div className="text-center py-8 space-y-2">
                  <PieIcon className="h-10 w-10 text-muted-foreground/30 mx-auto" />
                  <p className="text-sm text-muted-foreground">Set up your income in onboarding to see the full picture.</p>
                </div>
              ) : (
                <>
                  <DonutView
                    data={fullData}
                    total={effectiveIncome}
                    centerLabel="Monthly income"
                    emptyMsg="No data yet."
                  />

                  {/* Drill-down: committed bills */}
                  {fixedItems.length > 0 && (
                    <div className="rounded-xl border border-orange-100 bg-orange-50/50 p-3 space-y-1.5">
                      <p className="text-[10px] font-bold text-orange-700 uppercase tracking-wider">Committed bills</p>
                      {fixedItems.map((it, i) => (
                        <div key={i} className="flex justify-between text-xs">
                          <span className="text-foreground/70">{it.name}</span>
                          <span className="font-semibold text-foreground">{formatCompactINR(it.amount)}</span>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Drill-down: savings goals */}
                  {savingsItems.length > 0 && (
                    <div className="rounded-xl border border-emerald-100 bg-emerald-50/50 p-3 space-y-1.5">
                      <p className="text-[10px] font-bold text-emerald-700 uppercase tracking-wider">Savings goals (monthly)</p>
                      {savingsItems.map((it, i) => (
                        <div key={i} className="flex justify-between text-xs">
                          <span className="text-foreground/70">{it.name}</span>
                          <span className="font-semibold text-foreground">{formatCompactINR(it.amount)}</span>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Drill-down: variable budget */}
                  {variableItems.length > 0 && (
                    <div className="rounded-xl border border-violet-100 bg-violet-50/50 p-3 space-y-1.5">
                      <p className="text-[10px] font-bold text-violet-700 uppercase tracking-wider">Variable budget</p>
                      {variableItems.map((it, i) => (
                        <div key={i} className="flex justify-between text-xs">
                          <span className="text-foreground/70">{it.name}</span>
                          <span className="font-semibold text-foreground">{formatCompactINR(it.amount)}</span>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Free money callout */}
                  {freeAmount > 0 && (
                    <div className="rounded-xl border border-primary/20 bg-primary/5 p-3 flex items-center justify-between">
                      <div>
                        <p className="text-xs font-bold text-primary">Genuinely free</p>
                        <p className="text-[11px] text-muted-foreground mt-0.5">After all commitments and goals</p>
                      </div>
                      <p className="text-lg font-black text-primary">{formatCompactINR(freeAmount)}</p>
                    </div>
                  )}
                </>
              )}
            </div>
          )}

          {/* Category tab */}
          {tab === 'category' && (
            <DonutView data={categoryData} total={totalExpense} centerLabel="Total spent" emptyMsg="No expenses this month yet." />
          )}

          {/* Method tab */}
          {tab === 'method' && (
            <DonutView data={methodData} total={totalExpense} centerLabel="Total spent" emptyMsg="No expenses this month yet." />
          )}

        </div>
      </DialogContent>
    </Dialog>
  );
};
