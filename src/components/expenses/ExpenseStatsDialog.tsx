"use client";

import React, { useMemo, useState, useEffect, useRef } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Calendar } from '@/components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Button } from '@/components/ui/button';
import { PieChart, Pie, Cell, ResponsiveContainer } from 'recharts';
import { formatFullINR, formatCompactINR } from "@/lib/currency";
import { TrendingDown, TrendingUp, Wallet, X, Lightbulb, PieChart as PieIcon, CalendarDays, ChevronRight, ReceiptText, Clock3, CreditCard } from 'lucide-react';
import { cn } from '@/lib/utils';
import { motion } from "framer-motion";
import { useAuth } from "@/contexts/AuthContext";
import { endOfDay, format, startOfMonth, subMonths } from "date-fns";
import type { DateRange } from 'react-day-picker';
import { getIncomeDetails, getExpenseCategories } from "@/integrations/indexeddb/services/onboardingService";
import { getVariableBudgetEntries } from "@/integrations/indexeddb/services/variableBudgetService";
import { getSavingsGoals } from "@/integrations/indexeddb/services/savingsGoalService";
import { getMonthlyTransactions } from '@/integrations/indexeddb/services/dataService';
import { buildCategoryMonthlyTrend, buildCategorySummaries, transactionsForCategory, type StatsTransaction } from './expenseStatsCore';

// ── Types ─────────────────────────────────────────────────────────────────────
type Transaction = StatsTransaction;

interface ChartData {
  name: string; value: number; percentage: number;
  color: string; type: 'logged' | 'committed' | 'savings' | 'variable' | 'free';
  detail?: string;
  key?: string;
  count?: number;
  average?: number;
}

interface ExpenseStatsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  monthLabel: string;
  transactions: Transaction[];
  budgetStartDate?: Date | null;
  budgetEndDate?:   Date | null;
}

type RangePreset = 'period' | '3m' | '6m' | '12m' | 'custom';

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
  data, total, centerLabel, emptyMsg, onItemClick,
}: { data: ChartData[]; total: number; centerLabel: string; emptyMsg: string; onItemClick?: (item: ChartData) => void }) => {
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
              onClick={(_, i) => onItemClick?.(data[i])}
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
          <button type="button" key={i}
            className={cn("w-full rounded-xl p-3 text-left transition-colors", onItemClick ? "cursor-pointer" : "cursor-default", activeIdx === i ? "bg-muted/60" : "hover:bg-muted/30")}
            onMouseEnter={() => setActiveIdx(i)}
            onMouseLeave={() => setActiveIdx(null)}
            onClick={() => onItemClick?.(d)}
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
                {onItemClick && <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />}
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
          </button>
        ))}
      </div>
    </div>
  );
};

const CategoryTransactionsDialog = ({
  category, transactions, rangeLabel, open, onOpenChange,
}: {
  category: string | null;
  transactions: Transaction[];
  rangeLabel: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) => {
  const rows = useMemo(
    () => category ? transactionsForCategory(transactions, category) : [],
    [category, transactions],
  );
  const trend = useMemo(
    () => category ? buildCategoryMonthlyTrend(transactions, category) : [],
    [category, transactions],
  );
  const total = rows.reduce((sum, row) => sum + row.amount, 0);
  const average = rows.length ? total / rows.length : 0;
  const largest = rows.reduce<Transaction | null>((current, row) => !current || row.amount > current.amount ? row : current, null);
  const trendMax = Math.max(...trend.map(item => item.total), 1);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md max-h-[90vh] overflow-y-auto p-0 gap-0 rounded-2xl border-border/50 pointer-events-auto [grid-template-columns:minmax(0,1fr)] [&>button:first-child]:hidden">
        <DialogHeader className="sticky top-0 z-10 border-b border-border/40 bg-background/95 px-5 pb-3 pt-5 backdrop-blur">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <DialogTitle className="truncate text-base font-bold">{category ? catLabel(category) : 'Category'} expenses</DialogTitle>
              <p className="mt-0.5 text-xs text-muted-foreground">{rangeLabel}</p>
            </div>
            <button type="button" onClick={() => onOpenChange(false)} className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-muted/50 hover:bg-muted">
              <X className="h-4 w-4 text-muted-foreground" />
            </button>
          </div>
        </DialogHeader>

        <div className="space-y-4 px-5 py-4">
          <div className="grid grid-cols-3 gap-2">
            <div className="rounded-xl border border-red-100 bg-red-50 p-3">
              <p className="text-[10px] font-semibold text-red-500">Total</p>
              <p className="mt-1 text-sm font-black text-red-600">{formatCompactINR(total)}</p>
            </div>
            <div className="rounded-xl border border-blue-100 bg-blue-50 p-3">
              <p className="text-[10px] font-semibold text-blue-600">Transactions</p>
              <p className="mt-1 text-sm font-black text-blue-700">{rows.length}</p>
            </div>
            <div className="rounded-xl border border-violet-100 bg-violet-50 p-3">
              <p className="text-[10px] font-semibold text-violet-600">Average</p>
              <p className="mt-1 text-sm font-black text-violet-700">{formatCompactINR(average)}</p>
            </div>
          </div>

          {trend.length > 1 && (
            <div className="rounded-2xl border border-border/50 bg-muted/20 p-3">
              <div className="mb-3 flex items-center justify-between">
                <p className="text-xs font-bold">Month-by-month</p>
                <p className="text-[10px] text-muted-foreground">Tap another range to compare</p>
              </div>
              <div className="space-y-2.5">
                {trend.map(item => (
                  <div key={item.month} className="grid grid-cols-[48px_1fr_auto] items-center gap-2">
                    <span className="text-[10px] font-semibold text-muted-foreground">{format(new Date(`${item.month}-01T00:00:00`), 'MMM yy')}</span>
                    <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                      <div className="h-full rounded-full bg-primary" style={{ width: `${(item.total / trendMax) * 100}%` }} />
                    </div>
                    <span className="text-[10px] font-bold">{formatCompactINR(item.total)} · {item.count}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {largest && (
            <div className="flex items-center justify-between rounded-xl border border-amber-100 bg-amber-50/60 px-3 py-2.5">
              <div>
                <p className="text-[10px] font-bold uppercase tracking-wide text-amber-700">Largest transaction</p>
                <p className="mt-0.5 text-[11px] text-muted-foreground">{format(new Date(largest.transaction_date), 'dd MMM yyyy')}</p>
              </div>
              <p className="text-sm font-black text-amber-700">{formatFullINR(largest.amount)}</p>
            </div>
          )}

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <p className="text-xs font-bold">All transactions</p>
              <p className="text-[10px] text-muted-foreground">Newest first</p>
            </div>
            {rows.map(row => (
              <div key={row.id} className="rounded-2xl border border-border/50 bg-background p-3 shadow-sm">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5 text-[10px] font-medium text-muted-foreground">
                      <Clock3 className="h-3 w-3" />
                      {format(new Date(row.transaction_date), 'dd MMM yyyy, h:mm a')}
                    </div>
                    <div className="mt-1.5 flex items-center gap-1.5 text-[10px] text-muted-foreground">
                      <CreditCard className="h-3 w-3" />
                      {catLabel(row.account || 'upi')}
                    </div>
                  </div>
                  <p className="shrink-0 text-sm font-black text-foreground">{formatFullINR(row.amount)}</p>
                </div>
                <div className="mt-2 flex items-start gap-1.5 rounded-xl bg-muted/35 px-2.5 py-2">
                  <ReceiptText className="mt-0.5 h-3 w-3 shrink-0 text-muted-foreground" />
                  <p className={cn("text-[11px] leading-relaxed", row.description ? "text-foreground/80" : "italic text-muted-foreground")}>{row.description || 'No comment added'}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};

// ── Main dialog ────────────────────────────────────────────────────────────────
export const ExpenseStatsDialog = ({
  open, onOpenChange, monthLabel, transactions, budgetStartDate, budgetEndDate,
}: ExpenseStatsDialogProps) => {
  const { user } = useAuth();
  const [tab, setTab] = useState<'full' | 'category' | 'method'>('full');
  const [rangePreset, setRangePreset] = useState<RangePreset>('period');
  const [rangeStart, setRangeStart] = useState<Date>(budgetStartDate ?? startOfMonth(new Date()));
  const [rangeEnd, setRangeEnd] = useState<Date>(budgetEndDate ?? endOfDay(new Date()));
  const [rangeTransactions, setRangeTransactions] = useState<Transaction[]>(transactions);
  const [loadingRange, setLoadingRange] = useState(false);
  const [customDraft, setCustomDraft] = useState<DateRange | undefined>();
  const [customOpen, setCustomOpen] = useState(false);
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const rangeRequestRef = useRef(0);

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
    if (!open) return;
    const start = budgetStartDate ?? startOfMonth(new Date());
    const end = budgetEndDate ?? endOfDay(new Date());
    setRangePreset('period');
    setRangeStart(start);
    setRangeEnd(end);
    setRangeTransactions(transactions);
    setCustomDraft({ from: start, to: end });
    setSelectedCategory(null);
  }, [open, budgetStartDate, budgetEndDate]);

  useEffect(() => {
    if (open && rangePreset === 'period') setRangeTransactions(transactions);
  }, [open, rangePreset, transactions]);

  const loadTransactionRange = async (preset: RangePreset, start: Date, end: Date) => {
    if (!user) return;
    const request = ++rangeRequestRef.current;
    setRangePreset(preset);
    setRangeStart(start);
    setRangeEnd(end);
    setTab('category');
    setLoadingRange(true);
    setSelectedCategory(null);
    try {
      const rows = await getMonthlyTransactions(user.id, start.toISOString(), end.toISOString());
      if (request === rangeRequestRef.current) setRangeTransactions(rows as Transaction[]);
    } catch (error) {
      console.error('ExpenseStatsDialog range load:', error);
      if (request === rangeRequestRef.current) setRangeTransactions([]);
    } finally {
      if (request === rangeRequestRef.current) setLoadingRange(false);
    }
  };

  const choosePreset = (preset: Exclude<RangePreset, 'custom'>) => {
    if (preset === 'period') {
      rangeRequestRef.current += 1;
      setRangePreset('period');
      setRangeStart(budgetStartDate ?? startOfMonth(new Date()));
      setRangeEnd(budgetEndDate ?? endOfDay(new Date()));
      setRangeTransactions(transactions);
      setLoadingRange(false);
      setSelectedCategory(null);
      return;
    }
    const months = preset === '3m' ? 3 : preset === '6m' ? 6 : 12;
    const end = endOfDay(new Date());
    const start = startOfMonth(subMonths(end, months - 1));
    void loadTransactionRange(preset, start, end);
  };

  const applyCustomRange = () => {
    if (!customDraft?.from || !customDraft.to) return;
    setCustomOpen(false);
    void loadTransactionRange('custom', customDraft.from, endOfDay(customDraft.to));
  };

  const rangeLabel = useMemo(() => {
    if (rangePreset === 'period') return monthLabel;
    return `${format(rangeStart, 'dd MMM yyyy')} – ${format(rangeEnd, 'dd MMM yyyy')}`;
  }, [rangePreset, rangeStart, rangeEnd, monthLabel]);

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
  const totalIncome  = useMemo(() => rangeTransactions.filter(t => t.type === 'income').reduce((s, t) => s + t.amount, 0), [rangeTransactions]);
  const totalExpense = useMemo(() => rangeTransactions.filter(t => t.type === 'expense').reduce((s, t) => s + t.amount, 0), [rangeTransactions]);
  const net = totalIncome - totalExpense;

  // ── Full picture chart data ──────────────────────────────────────────────────
  // Uses the higher of logged income vs declared income
  const effectiveIncome = rangePreset === 'period' ? Math.max(totalIncome, monthlyIncome) : totalIncome;

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
    return buildCategorySummaries(rangeTransactions)
      .map((summary, i) => ({
        key:        summary.key,
        name:       catLabel(summary.key),
        value:      summary.total,
        count:      summary.count,
        average:    summary.average,
        percentage: summary.percentage,
        color:      EXPENSE_COLORS[i % EXPENSE_COLORS.length],
        type:       'logged' as const,
        detail:     `${summary.count} transaction${summary.count === 1 ? '' : 's'}`,
      }))
      .sort((a, b) => b.value - a.value);
  }, [rangeTransactions]);

  // ── Method breakdown ─────────────────────────────────────────────────────────
  const methodData: ChartData[] = useMemo(() => {
    const map: Record<string, number> = {};
    rangeTransactions.filter(t => t.type === 'expense').forEach(t => {
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
  }, [rangeTransactions, totalExpense]);

  // ── Insights ─────────────────────────────────────────────────────────────────
  const freeSegment = fullData.find(d => d.type === 'free');
  const freeAmount  = freeSegment?.value || 0;
  const insights: string[] = [];
  if (rangePreset === 'period' && effectiveIncome > 0) {
    if (freeAmount > 1000)
      insights.push(`₹${formatCompactINR(freeAmount)} is genuinely unallocated this month — consider moving it to savings.`);
    if (fixedBills / effectiveIncome > 0.55)
      insights.push("Fixed bills are above 55% of income — review recurring subscriptions.");
    if (savingsTarget === 0 && effectiveIncome > 0)
      insights.push("No savings goal set — even ₹500/month invested now compounds significantly.");
  }
  const topCat = categoryData[0];
  if (topCat && topCat.percentage > 30)
    insights.push(`${topCat.name} is ${topCat.percentage.toFixed(0)}% of your logged expenses in this range.`);

  const tabs = [
    { id: 'full'     as const, label: 'Full picture',  },
    { id: 'category' as const, label: 'By category',   },
    { id: 'method'   as const, label: 'By method',     },
  ];

  return (
    <>
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md max-h-[92vh] overflow-y-auto p-0 gap-0 rounded-2xl border-border/50 pointer-events-auto [grid-template-columns:minmax(0,1fr)] [&>button:first-child]:hidden">

        {/* Header */}
        <DialogHeader className="px-5 pt-5 pb-3 border-b border-border/40">
          <div className="flex items-center justify-between">
            <div>
              <DialogTitle className="text-base font-bold gradient-text">Spending Stats</DialogTitle>
              <p className="text-xs text-muted-foreground mt-0.5">{rangeLabel}</p>
            </div>
            <button onClick={() => onOpenChange(false)}
              className="h-8 w-8 rounded-xl flex items-center justify-center bg-muted/50 hover:bg-muted transition-colors pointer-events-auto">
              <X className="h-4 w-4 text-muted-foreground" />
            </button>
          </div>
        </DialogHeader>

        <div className="px-5 py-4 space-y-4">

          {/* Time range — category and method views can span multiple months. */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Time range</p>
              {loadingRange && <span className="text-[10px] font-semibold text-primary">Loading…</span>}
            </div>
            <div className="flex gap-1.5 overflow-x-auto pb-1 scrollbar-hide">
              {([
                ['period', 'Selected period'], ['3m', '3 months'], ['6m', '6 months'], ['12m', '12 months'],
              ] as const).map(([id, label]) => (
                <button key={id} type="button" onClick={() => choosePreset(id)}
                  className={cn(
                    'shrink-0 rounded-xl border px-2.5 py-1.5 text-[10px] font-semibold transition-colors',
                    rangePreset === id ? 'border-primary bg-primary text-primary-foreground' : 'border-border/60 bg-background text-muted-foreground hover:border-primary/40',
                  )}>
                  {label}
                </button>
              ))}
              <Popover open={customOpen} onOpenChange={setCustomOpen}>
                <PopoverTrigger asChild>
                  <button type="button" className={cn(
                    'flex shrink-0 items-center gap-1 rounded-xl border px-2.5 py-1.5 text-[10px] font-semibold transition-colors',
                    rangePreset === 'custom' ? 'border-primary bg-primary text-primary-foreground' : 'border-border/60 bg-background text-muted-foreground hover:border-primary/40',
                  )}>
                    <CalendarDays className="h-3 w-3" /> Custom
                  </button>
                </PopoverTrigger>
                <PopoverContent className="w-auto max-w-[calc(100vw-2rem)] p-3" align="end">
                  <p className="mb-2 text-xs font-bold">Choose start and end dates</p>
                  <Calendar
                    mode="range"
                    selected={customDraft}
                    onSelect={setCustomDraft}
                    disabled={{ after: new Date() }}
                    initialFocus
                  />
                  <Button className="mt-2 w-full" size="sm" disabled={!customDraft?.from || !customDraft.to} onClick={applyCustomRange}>
                    Apply range
                  </Button>
                </PopoverContent>
              </Popover>
            </div>
          </div>

          {/* Summary strip */}
          <div className="grid grid-cols-3 gap-2">
            <div className="rounded-xl bg-emerald-50 border border-emerald-200 p-3">
              <div className="flex items-center gap-1 mb-1">
                <TrendingUp className="h-3 w-3 text-emerald-600" />
                <p className="text-[10px] font-semibold text-emerald-600">Income</p>
              </div>
              <p className="text-sm font-black text-emerald-700">{formatCompactINR(totalIncome)}</p>
              {rangePreset === 'period' && monthlyIncome > 0 && monthlyIncome !== totalIncome && (
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
              {rangePreset !== 'period' ? (
                <div className="rounded-2xl border border-border/50 bg-muted/20 px-4 py-8 text-center">
                  <PieIcon className="mx-auto h-9 w-9 text-muted-foreground/30" />
                  <p className="mt-2 text-sm font-semibold">Full picture follows one budget period</p>
                  <p className="mt-1 text-xs text-muted-foreground">Use By category or By method for multi-month analysis, or return to the selected period.</p>
                  <Button variant="outline" size="sm" className="mt-3" onClick={() => choosePreset('period')}>Use selected period</Button>
                </div>
              ) : loadingExtra ? (
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
            loadingRange ? (
              <div className="space-y-3 animate-pulse"><div className="h-44 rounded-2xl bg-muted" />{[1,2,3].map(i => <div key={i} className="h-12 rounded-xl bg-muted" />)}</div>
            ) : (
              <DonutView
                data={categoryData}
                total={totalExpense}
                centerLabel="Total spent"
                emptyMsg="No expenses in this range."
                onItemClick={item => item.key && setSelectedCategory(item.key)}
              />
            )
          )}

          {/* Method tab */}
          {tab === 'method' && (
            loadingRange ? (
              <div className="space-y-3 animate-pulse"><div className="h-44 rounded-2xl bg-muted" />{[1,2,3].map(i => <div key={i} className="h-12 rounded-xl bg-muted" />)}</div>
            ) : (
              <DonutView data={methodData} total={totalExpense} centerLabel="Total spent" emptyMsg="No expenses in this range." />
            )
          )}

        </div>
      </DialogContent>
    </Dialog>
    <CategoryTransactionsDialog
      category={selectedCategory}
      transactions={rangeTransactions}
      rangeLabel={rangeLabel}
      open={selectedCategory !== null}
      onOpenChange={next => { if (!next) setSelectedCategory(null); }}
    />
    </>
  );
};
