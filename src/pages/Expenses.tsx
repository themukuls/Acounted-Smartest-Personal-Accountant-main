import { AppLayout } from "@/components/layout/AppLayout";
import { GlassCard } from "@/components/ui/glass-card";
import { Button } from "@/components/ui/button";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { formatCompactINR, formatFullINR } from "@/lib/currency";
import { getCurrentISTMonth, getMonthsInIST, getWeeksInDateRange, getISTDate, convertToIST } from "@/lib/date-utils";
import { Plus, Trash2, BarChart3, CreditCard as CreditCardIcon, Search } from "lucide-react";
import { useSearchParams } from "react-router-dom";
import React, { useState, useEffect, useMemo, useRef } from "react";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/contexts/AuthContext";
import { TransactionFormDialog } from "@/components/transactions/TransactionFormDialog";
import { ExpenseStatsDialog } from "@/components/expenses/ExpenseStatsDialog";
import { GlobalSearchDialog } from "@/components/search/GlobalSearchDialog";
import { RecurringTeaser } from "@/components/recurring/RecurringTeaser";
import { cn } from "@/lib/utils";
import { format, isWithinInterval, startOfWeek, endOfWeek, startOfMonth, endOfMonth, isSameWeek } from "date-fns";
import DOMPurify from 'dompurify';
import { getMonthlyBudgets } from "@/integrations/indexeddb/services/monthlyBudgetService";
import { getMonthlyTransactions, saveTransaction, deleteTransaction } from "@/integrations/indexeddb/services/dataService";
import { useQueryClient } from "@tanstack/react-query";
import { useGate } from "@/components/paywall/useGate";
import {
  completePendingPayment,
  getPendingPayment,
  paymentCaptureAvailable,
  skipPendingPayment,
  snoozePendingPayment,
  type PendingPayment,
} from "@/lib/paymentCapture/native";

interface Transaction {
  id: string;
  type: 'income' | 'expense';
  amount: number;
  category: string;
  account: string;
  description: string;
  transaction_date: string;
  created_at: string;
}

const Expenses = () => {
  const { toast } = useToast();
  const { user } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const queryClient = useQueryClient();
  // Every paid action on this page goes through `guard()` inside its handler.
  // The controls stay visible on purpose — a lapsed user pressing + gets an
  // explanation and a way to resubscribe, not a page that has quietly lost its
  // buttons. Reading the ledger below is never gated.
  const { guard } = useGate();

  const [allTransactions, setAllTransactions] = useState<Transaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedMonth, setSelectedMonth] = useState(getCurrentISTMonth());
  
  const [selectedWeekForDialog, setSelectedWeekForDialog] = useState(""); 
  
  const [activeWeekFilter, setActiveWeekFilter] = useState<string | null>(null);

  const [budgetStartDate, setBudgetStartDate] = useState<Date | null>(null);
  const [budgetEndDate, setBudgetEndDate] = useState<Date | null>(null);

  const [showTransactionFormDialog, setShowTransactionFormDialog] = useState(false);
  const [editingTransaction, setEditingTransaction] = useState<Transaction | null>(null);
  const [formDialogType, setFormDialogType] = useState<'income' | 'expense' | undefined>(undefined);
  const [detectedPayment, setDetectedPayment] = useState<PendingPayment | null>(null);

  const [showStatsDialog, setShowStatsDialog] = useState(false);
  const [showSearchDialog, setShowSearchDialog] = useState(false);

  const clearCapturePaymentParam = () => {
    const next = new URLSearchParams(searchParams);
    next.delete('capturePayment');
    setSearchParams(next, { replace: true });
  };

  useEffect(() => {
    const paymentId = searchParams.get('capturePayment');
    if (!user || !paymentId || !paymentCaptureAvailable()) return;
    let cancelled = false;

    void getPendingPayment(paymentId).then(payment => {
      if (cancelled) return;
      if (!payment) {
        clearCapturePaymentParam();
        return;
      }
      setDetectedPayment(payment);
      setEditingTransaction(null);
      setFormDialogType('expense');
      setSelectedWeekForDialog('');
      setShowTransactionFormDialog(true);
    }).catch(error => {
      console.warn('[PaymentCapture] Could not open detected payment', error);
    });

    return () => { cancelled = true; };
  }, [user, searchParams]);

  // ✅ FIX: removed `selectedMonth` from deps array.
  // Previously, having selectedMonth in deps caused the effect to re-run after
  // month selection, but at that point the state hadn't updated yet — so it
  // always fetched the OLD month's data. Now we derive monthToLoad locally
  // and pass it directly to the fetch function, bypassing the stale state issue.
  useEffect(() => {
    if (user) {
      const weekStartParam = searchParams.get('weekStart');
      const weekEndParam = searchParams.get('weekEnd');
      let initialActiveWeek: string | null = null;
      let monthToLoad = getCurrentISTMonth();

      if (weekStartParam && weekEndParam) {
        monthToLoad = format(new Date(weekStartParam), 'yyyy-MM');
        setSelectedMonth(monthToLoad);
        initialActiveWeek = `${weekStartParam}_${weekEndParam}`;
      } else {
        setSelectedMonth(monthToLoad);
      }

      fetchTransactionsAndBudgetDates(initialActiveWeek, monthToLoad);
    }
  }, [user, searchParams]); // ✅ selectedMonth removed — Select's onValueChange handles month changes directly

  const fetchTransactionsAndBudgetDates = async (initialActiveWeek: string | null, monthToFetch: string) => {
    setLoading(true);
    try {
      const [year, month] = monthToFetch.split('-').map(Number);
      const defaultStartOfMonth = new Date(year, month - 1, 1);
      // new Date(year, month, 0) = last day at midnight — must be end of day so full day is included
      const defaultEndOfMonth = new Date(year, month, 0, 23, 59, 59, 999);

      const monthlyBudgets = await getMonthlyBudgets(user!.id);
      const budgetData = monthlyBudgets.find(b => b.budget_month === monthToFetch);

      let actualBudgetStartDate: Date;
      let actualBudgetEndDate: Date;

      if (budgetData && budgetData.budget_start_date && budgetData.budget_end_date) {
        actualBudgetStartDate = new Date(budgetData.budget_start_date);
        // Force end-of-day so transactions on the last day are included
        actualBudgetEndDate = new Date(new Date(budgetData.budget_end_date).setHours(23, 59, 59, 999));
      } else {
        actualBudgetStartDate = defaultStartOfMonth;
        actualBudgetEndDate = defaultEndOfMonth;
      }

      setBudgetStartDate(actualBudgetStartDate);
      setBudgetEndDate(actualBudgetEndDate);
      console.log("[Expenses.tsx] Budget Period: Start:", format(actualBudgetStartDate, 'yyyy-MM-dd HH:mm:ss'), "End:", format(actualBudgetEndDate, 'yyyy-MM-dd HH:mm:ss'));

      const weeksInMonth = getWeeksInDateRange(actualBudgetStartDate, actualBudgetEndDate);
      console.log("[Expenses.tsx] Weeks in month from getWeeksInDateRange:", weeksInMonth.map(w => w.label + " (" + format(w.start, 'yyyy-MM-dd HH:mm:ss') + " - " + format(w.end, 'yyyy-MM-dd HH:mm:ss') + ")"));

      if (weeksInMonth.length > 0) {
        if (initialActiveWeek && weeksInMonth.some(week => `${format(week.start, 'yyyy-MM-dd')}_${format(week.end, 'yyyy-MM-dd')}` === initialActiveWeek)) {
          setActiveWeekFilter(initialActiveWeek);
          console.log("[Expenses.tsx] Active week filter set from URL param:", initialActiveWeek);
        } else {
          const today = getISTDate();
          const currentWeekContainingToday = weeksInMonth.find(week =>
            isSameWeek(today, week.start, { weekStartsOn: 1 })
          );

          if (currentWeekContainingToday) {
            const newActiveWeekFilter = `${format(currentWeekContainingToday.start, 'yyyy-MM-dd')}_${format(currentWeekContainingToday.end, 'yyyy-MM-dd')}`;
            setActiveWeekFilter(newActiveWeekFilter);
            console.log("[Expenses.tsx] Active week filter defaulted to current calendar week:", newActiveWeekFilter);
          } else {
            // For past months, default to first week since today won't be in them
            const firstWeekKey = `${format(weeksInMonth[0].start, 'yyyy-MM-dd')}_${format(weeksInMonth[0].end, 'yyyy-MM-dd')}`;
            setActiveWeekFilter(firstWeekKey);
            console.log("[Expenses.tsx] Active week filter defaulted to first week of month:", firstWeekKey);
          }
        }
      } else {
        setActiveWeekFilter(null);
        console.log("[Expenses.tsx] No weeks in month. Active week filter set to null.");
      }

      const transactionsData = await getMonthlyTransactions(
        user!.id,
        actualBudgetStartDate.toISOString(),
        actualBudgetEndDate.toISOString(),
        undefined,
        false
      );

      setAllTransactions((transactionsData || []) as any);
      console.log("[Expenses.tsx] All transactions fetched:", transactionsData);

    } catch (error) {
      console.error('Error fetching data:', error);
      toast({
        title: "Error",
        description: "Failed to load data",
        variant: "destructive"
      });
    } finally {
      setLoading(false);
    }
  };

  const handleSaveTransaction = async (data: { account: string; category: string; amount: string; note: string; type: 'income' | 'expense'; transactionId?: string; transaction_date: string }) => {
    // The write gate, at the top of the write path itself. This function is
    // also the `onSave` the dialog calls, so guarding here covers the dialog,
    // the FAB and any future caller — not just the button we can see.
    if (!guard('canWrite')) throw new Error("Subscription required");

    try {
      if (!user) {
        toast({
          title: "Error",
          description: "Please log in to save transactions",
          variant: "destructive",
        });
        throw new Error("User not authenticated");
      }

      const dateToUse = new Date(data.transaction_date);

      await saveTransaction(user.id, {
        id: data.transactionId,
        type: data.type,
        amount: parseFloat(data.amount),
        category: data.type === 'income' ? 'income' : data.category,
        account: data.account,
        description: DOMPurify.sanitize(data.note || ''),
        transaction_date: dateToUse.toISOString()
      });
      if (detectedPayment && !data.transactionId) {
        try {
          await completePendingPayment(detectedPayment.id);
          setDetectedPayment(null);
          clearCapturePaymentParam();
        } catch (captureError) {
          // The ledger write already succeeded. Do not tell the user it failed
          // merely because Android could not clear the reminder queue.
          console.warn('[PaymentCapture] Transaction saved, but pending reminder could not be cleared', captureError);
        }
      }
      toast({
        title: "Success",
        description: `Transaction ${data.transactionId ? 'updated' : 'saved'} successfully`,
      });
      setEditingTransaction(null);
      setShowTransactionFormDialog(false);
      setSelectedWeekForDialog('');
      await fetchTransactionsAndBudgetDates(activeWeekFilter, selectedMonth);
      
      queryClient.invalidateQueries({ queryKey: ['quickActionsWeeklySummary'] });
      queryClient.invalidateQueries({ queryKey: ['weeklyBudgetProjections'] });
      queryClient.invalidateQueries({ queryKey: ['monthlyTransactionsForSavings'] });
      // The ledger changed, so the recurring detection and the search corpus
      // are both stale — they read every transaction, not just this month's.
      queryClient.invalidateQueries({ queryKey: ['recurringTransactions'] });
      queryClient.invalidateQueries({ queryKey: ['globalSearchCorpus'] });
    } catch (error) {
      console.error('Error saving transaction:', error);
      toast({
        title: "Error",
        description: "Failed to save transaction",
        variant: "destructive",
      });
      throw error;
    }
  };

  const handleDeleteTransaction = async (transactionId: string, categoryName: string) => {
    // Deleting is a write. The confirm dialog can be reached whatever the
    // status; the deletion itself cannot.
    if (!guard('canWrite')) return;

    try {
      await deleteTransaction(transactionId);

      await fetchTransactionsAndBudgetDates(activeWeekFilter, selectedMonth);
      toast({
        title: "Success",
        description: `${categoryName} transaction deleted successfully`,
      });

      queryClient.invalidateQueries({ queryKey: ['quickActionsWeeklySummary'] });
      queryClient.invalidateQueries({ queryKey: ['weeklyBudgetProjections'] });
      queryClient.invalidateQueries({ queryKey: ['monthlyTransactionsForSavings'] });
      // The ledger changed, so the recurring detection and the search corpus
      // are both stale — they read every transaction, not just this month's.
      queryClient.invalidateQueries({ queryKey: ['recurringTransactions'] });
      queryClient.invalidateQueries({ queryKey: ['globalSearchCorpus'] });
    } catch (error) {
      console.error('Error deleting transaction:', error);
      toast({
        title: "Error",
        description: "Failed to delete transaction",
        variant: "destructive",
      });
    }
  };

  const handleEditTransactionClick = (transaction: Transaction, weekLabel: string) => {
    // Opening the EDIT form is a write intent. The row itself already shows the
    // amount, date, account and note, so nothing readable is lost by refusing.
    if (!guard('canWrite')) return;

    setEditingTransaction({
      ...transaction,
      transaction_date: transaction.transaction_date
    });
    setSelectedWeekForDialog(weekLabel);
    setFormDialogType(transaction.type);
    setShowTransactionFormDialog(true);
  };

  const handleOpenAddTransactionDialog = () => {
    if (!guard('canWrite')) return;

    setEditingTransaction(null);
    setDetectedPayment(null);
    setFormDialogType(undefined);
    setShowTransactionFormDialog(true);
    if (activeWeekFilter) {
      setSelectedWeekForDialog(activeWeekFilter);
    } else if (budgetStartDate && budgetEndDate) {
      const weeksInMonth = getWeeksInDateRange(budgetStartDate, budgetEndDate);
      if (weeksInMonth.length > 0) {
        setSelectedWeekForDialog(`${format(weeksInMonth[0].start, 'yyyy-MM-dd')}_${format(weeksInMonth[0].end, 'yyyy-MM-dd')}`);
      }
    }
  };

  const handleDetectedLater = async () => {
    if (!detectedPayment) return;
    try {
      await snoozePendingPayment(detectedPayment.id);
    } catch (error) {
      console.warn('[PaymentCapture] Could not schedule reminder', error);
    }
    setDetectedPayment(null);
    setShowTransactionFormDialog(false);
    clearCapturePaymentParam();
  };

  const handleDetectedSkip = async () => {
    if (!detectedPayment) return;
    try {
      await skipPendingPayment(detectedPayment.id);
    } catch (error) {
      console.warn('[PaymentCapture] Could not dismiss payment', error);
    }
    setDetectedPayment(null);
    setShowTransactionFormDialog(false);
    clearCapturePaymentParam();
  };

  const processedData = useMemo(() => {
    if (!budgetStartDate || !budgetEndDate) {
      console.log("[Expenses.tsx] processedData: budgetStartDate or budgetEndDate is null. Returning empty.");
      return {};
    }

    const weeksInMonth = getWeeksInDateRange(budgetStartDate, budgetEndDate);
    const grouped: Record<string, any> = {};

    weeksInMonth.forEach(week => {
      const weekValue = `${format(week.start, 'yyyy-MM-dd')}_${format(week.end, 'yyyy-MM-dd')}`;
      grouped[weekValue] = {
        weekStart: week.start,
        weekEnd: week.end,
        label: week.label,
        income: 0,
        expenses: 0,
        creditCardSpends: 0,
        transactions: []
      };
    });

    const filteredTransactions = allTransactions.filter(transaction => {
      const transactionDateIST = convertToIST(transaction.transaction_date);
      return isWithinInterval(transactionDateIST, { start: budgetStartDate!, end: budgetEndDate! });
    });
    console.log("[Expenses.tsx] processedData: Filtered transactions for month (IST-adjusted):", filteredTransactions.map(t => `${t.id} - ${format(convertToIST(t.transaction_date), 'yyyy-MM-dd HH:mm:ss')} IST`));

    filteredTransactions.forEach(transaction => {
      const transactionDateIST = convertToIST(transaction.transaction_date);
      
      const targetWeek = weeksInMonth.find(week => 
        isWithinInterval(transactionDateIST, { start: week.start, end: week.end })
      );

      if (targetWeek) {
        const weekKey = `${format(targetWeek.start, 'yyyy-MM-dd')}_${format(targetWeek.end, 'yyyy-MM-dd')}`;
        if (!grouped[weekKey]) {
          grouped[weekKey] = {
            weekStart: targetWeek.start,
            weekEnd: targetWeek.end,
            label: targetWeek.label,
            income: 0,
            expenses: 0,
            creditCardSpends: 0,
            transactions: []
          };
        }
        
        if (transaction.type === 'income') {
          grouped[weekKey].income += transaction.amount;
        } else {
          if (transaction.account === 'credit-card') {
            grouped[weekKey].creditCardSpends += transaction.amount;
          } else {
            grouped[weekKey].expenses += transaction.amount;
          }
        }
        
        grouped[weekKey].transactions.push(transaction);
      } else {
        console.warn(`[Expenses.tsx] Transaction ${transaction.id} (${format(transactionDateIST, 'yyyy-MM-dd HH:mm:ss')} IST) not found in any week for month ${format(budgetStartDate!, 'yyyy-MM')}.`);
      }
    });

    Object.keys(grouped).forEach(weekKey => {
      grouped[weekKey].transactions.sort((a: Transaction, b: Transaction) => 
        new Date(b.transaction_date).getTime() - new Date(a.transaction_date).getTime()
      );
    });
    console.log("[Expenses.tsx] processedData: Grouped data (final):", grouped);
    return grouped;
  }, [allTransactions, budgetStartDate, budgetEndDate]);

  const currentWeekData = activeWeekFilter ? processedData[activeWeekFilter] : null;
  console.log("[Expenses.tsx] Active Week Filter:", activeWeekFilter, "Current Week Data (for display):", currentWeekData);

  const totals = useMemo(() => {
    if (!budgetStartDate || !budgetEndDate) return { income: 0, expenses: 0, creditCardSpends: 0, total: 0 };

    const filteredTransactions = allTransactions.filter(transaction => {
      const transactionDateIST = convertToIST(transaction.transaction_date);
      return isWithinInterval(transactionDateIST, { start: budgetStartDate!, end: budgetEndDate! });
    });

    return filteredTransactions.reduce((acc, transaction) => {
      if (transaction.type === 'income') {
        acc.income += transaction.amount;
      } else {
        if (transaction.account === 'credit-card') {
          acc.creditCardSpends += transaction.amount;
        } else {
          acc.expenses += transaction.amount;
        }
      }
      acc.total = acc.income - acc.expenses - acc.creditCardSpends;
      return acc;
    }, { income: 0, expenses: 0, creditCardSpends: 0, total: 0 });
  }, [allTransactions, budgetStartDate, budgetEndDate]);

  const currentMonthTransactions = useMemo(() => {
    if (!budgetStartDate || !budgetEndDate) return [];
    return allTransactions.filter(transaction => {
      const transactionDateIST = convertToIST(transaction.transaction_date);
      return isWithinInterval(transactionDateIST, { start: budgetStartDate!, end: budgetEndDate! });
    });
  }, [allTransactions, budgetStartDate, budgetEndDate]);

  // Derived: months list for selector
  const monthsList = getMonthsInIST(12);
  const selectedMonthLabel = monthsList.find(m => m.value === selectedMonth)?.label || '';

  // Auto-scroll active month into view
  const monthScrollRef = useRef<HTMLDivElement>(null);
  const monthItemRefs  = useRef<Record<string, HTMLButtonElement | null>>({});

  useEffect(() => {
    const timer = setTimeout(() => {
      const activeEl = monthItemRefs.current[selectedMonth];
      const scroller  = monthScrollRef.current;
      if (!activeEl || !scroller) return;
      const elLeft    = activeEl.offsetLeft;
      const elWidth   = activeEl.offsetWidth;
      const scrollerW = scroller.offsetWidth;
      scroller.scrollTo({ left: elLeft - scrollerW / 2 + elWidth / 2, behavior: 'smooth' });
    }, 80);
    return () => clearTimeout(timer);
  }, [selectedMonth]);

  // Auto-scroll active week into view
  const weekScrollRef = useRef<HTMLDivElement>(null);
  const weekItemRefs  = useRef<Record<string, HTMLButtonElement | null>>({});

  useEffect(() => {
    if (!activeWeekFilter) return;
    // Delay so React finishes rendering the week buttons before we try to scroll
    const timer = setTimeout(() => {
      const activeEl = weekItemRefs.current[activeWeekFilter];
      const scroller  = weekScrollRef.current;
      if (!activeEl || !scroller) return;
      const elLeft    = activeEl.offsetLeft;
      const elWidth   = activeEl.offsetWidth;
      const scrollerW = scroller.offsetWidth;
      scroller.scrollTo({ left: elLeft - scrollerW / 2 + elWidth / 2, behavior: 'smooth' });
    }, 80);
    return () => clearTimeout(timer);
  }, [activeWeekFilter]);

  return (
    <AppLayout>
      <div className="space-y-4 pb-24">

        {/* ── Header ───────────────────────────────────────────────────── */}
        <div className="flex items-center justify-between gap-3 mt-4 md:mt-0">
          <h1 className="text-xl font-bold text-foreground tracking-tight">
            {(() => {
              const h = new Date().getHours();
              const name = user?.display_name?.trim().split(" ")[0] || "";
              if (h < 5)  return `Up late${name ? `, ${name}` : ""}? 🌙`;
              if (h < 12) return `Good morning${name ? `, ${name}` : ""} ☀️`;
              if (h < 17) return `Hey${name ? ` ${name}` : ""} 👋`;
              if (h < 21) return `Good evening${name ? `, ${name}` : ""} 🌆`;
              return `Night owl${name ? `, ${name}` : ""}? 🦉`;
            })()}
          </h1>
          <div className="flex items-center gap-2 shrink-0">
            {/* Search sits before Stats: it's the more frequent intent, and on a
                narrow phone the leftmost of the two is the easier reach. */}
            <Button
              variant="outline"
              size="sm"
              className="h-9 w-9 p-0 rounded-xl border-border/60 pointer-events-auto"
              onClick={() => { if (guard('canUseInsights')) setShowSearchDialog(true); }}
              aria-label="Search transactions"
            >
              <Search className="h-4 w-4" />
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="h-9 gap-1.5 rounded-xl border-border/60 pointer-events-auto"
              onClick={() => setShowStatsDialog(true)}
            >
              <BarChart3 className="h-4 w-4" />
              <span className="text-xs">Stats</span>
            </Button>
          </div>
        </div>

        {/* ── Recurring charges ─────────────────────────────────────────── */}
        {/* Above the month selector on purpose: it is the one card on this page
            that is NOT scoped to the selected month, so putting it below the
            month/week pickers would read as "recurring charges in August". */}
        <RecurringTeaser />

        {/* ── Month Selector ────────────────────────────────────────────── */}
        <div ref={monthScrollRef} className="flex gap-2 overflow-x-auto pb-1 scrollbar-hide">
          {monthsList.map((month) => {
            const isActive = selectedMonth === month.value;
            return (
              <button
                key={month.value}
                ref={el => { monthItemRefs.current[month.value] = el; }}
                onClick={() => {
                  setSelectedMonth(month.value);
                  setActiveWeekFilter(null);
                  fetchTransactionsAndBudgetDates(null, month.value);
                }}
                className={cn(
                  "flex-shrink-0 px-3 py-1.5 rounded-xl border text-xs font-semibold transition-all pointer-events-auto",
                  isActive
                    ? "bg-primary text-primary-foreground border-primary shadow-sm"
                    : "bg-background/60 border-border/60 text-muted-foreground hover:border-primary/40 hover:text-foreground"
                )}
              >
                {month.label}
              </button>
            );
          })}
        </div>

        {/* ── Summary ───────────────────────────────────────────────────── */}
        <GlassCard className="p-4 space-y-3" hover={false}>
          {/* Net balance — hero number */}
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs text-muted-foreground font-medium">Net Balance</p>
              <p className={cn(
                "text-2xl font-black mt-0.5 tracking-tight",
                totals.total >= 0 ? "text-emerald-600" : "text-destructive"
              )}>
                {totals.total >= 0 ? "+" : ""}{formatFullINR(totals.total)}
              </p>
            </div>
            <div className={cn(
              "h-12 w-12 rounded-2xl flex items-center justify-center text-xl",
              totals.total >= 0 ? "bg-emerald-50" : "bg-red-50"
            )}>
              {totals.total >= 0 ? "📈" : "📉"}
            </div>
          </div>

          {/* 3 supporting pills */}
          <div className="flex gap-2">
            <div className="flex-1 rounded-xl bg-primary/5 border border-primary/15 px-3 py-2 text-center">
              <p className="text-[10px] text-muted-foreground font-medium">Income</p>
              <p className="text-xs font-bold text-primary mt-0.5">{formatFullINR(totals.income)}</p>
            </div>
            <div className="flex-1 rounded-xl bg-destructive/5 border border-destructive/15 px-3 py-2 text-center">
              <p className="text-[10px] text-muted-foreground font-medium">Expenses</p>
              <p className="text-xs font-bold text-destructive mt-0.5">{formatFullINR(totals.expenses)}</p>
            </div>
            <div className="flex-1 rounded-xl bg-amber-50 border border-amber-200 px-3 py-2 text-center">
              <p className="text-[10px] text-muted-foreground font-medium">Credit Card</p>
              <p className="text-xs font-bold text-amber-600 mt-0.5">{formatFullINR(totals.creditCardSpends)}</p>
            </div>
          </div>
        </GlassCard>

        {/* ── Week Tiles ────────────────────────────────────────────────── */}
        {loading || !budgetStartDate || !budgetEndDate ? (
          <div className="flex gap-2">
            {[...Array(4)].map((_, i) => (
              <div key={i} className="h-16 flex-1 bg-muted rounded-2xl animate-pulse" />
            ))}
          </div>
        ) : (
          <div ref={weekScrollRef} className="flex gap-2 overflow-x-auto pb-1 scrollbar-hide">
            {(() => {
              const weeks = Object.values(processedData);
              // Compute total spend per week (expenses + CC) for comparison
              const weekSpends = weeks.map(w => (w.expenses || 0) + (w.creditCardSpends || 0));
              const maxSpend   = Math.max(...weekSpends);
              const minSpend   = Math.min(...weekSpends.filter(s => s > 0)); // only non-zero weeks
              const hasVariance = maxSpend > 0 && weeks.length > 1;

              return weeks.map((weekData, idx) => {
                const weekValue = `${format(weekData.weekStart, 'yyyy-MM-dd')}_${format(weekData.weekEnd, 'yyyy-MM-dd')}`;
                const isActive  = activeWeekFilter === weekValue;
                const weekSpend = (weekData.expenses || 0) + (weekData.creditCardSpends || 0);
                const isEmpty   = (weekData.transactions || []).length === 0;
                const isHeaviest = hasVariance && weekSpend === maxSpend && weekSpend > 0;
                const isLightest = hasVariance && weekSpend === minSpend && weekSpend > 0 && weekSpend !== maxSpend;

                return (
                  <button
                    key={weekValue}
                    ref={el => { weekItemRefs.current[weekValue] = el; }}
                    onClick={() => setActiveWeekFilter(weekValue)}
                    className={cn(
                      "flex-shrink-0 flex flex-col items-center px-3 py-2.5 rounded-2xl border transition-all pointer-events-auto min-w-[76px]",
                      isActive
                        ? "bg-primary text-primary-foreground border-primary shadow-md"
                        : "bg-background/60 border-border/60 hover:border-primary/40"
                    )}
                  >
                    <span className={cn("text-xs font-bold leading-tight", isActive ? "text-primary-foreground" : "text-foreground")}>
                      {weekData.label}
                    </span>
                    <span className={cn("text-xs font-semibold mt-0.5", isActive ? "text-primary-foreground" : "text-foreground")}>
                      {isEmpty ? "—" : formatCompactINR(weekSpend)}
                    </span>
                    <span className={cn("text-[9px] mt-0.5 font-medium leading-tight",
                      isActive ? "text-primary-foreground/70"
                        : isHeaviest ? "text-destructive/70"
                        : isLightest ? "text-emerald-600"
                        : "text-muted-foreground"
                    )}>
                      {isEmpty        ? "nothing spent 🎉"
                        : isHeaviest  ? "heaviest 🔴"
                        : isLightest  ? "lightest 🟢"
                        : `${(weekData.transactions || []).length} entries`}
                    </span>
                  </button>
                );
              });
            })()}
          </div>
        )}

        {/* ── Transaction List ──────────────────────────────────────────── */}
        {loading || !budgetStartDate || !budgetEndDate ? (
          <div className="text-center py-12">
            <div className="inline-block h-8 w-8 animate-spin rounded-full border-4 border-solid border-primary border-r-transparent" />
            <p className="mt-3 text-sm text-muted-foreground">Loading transactions…</p>
          </div>
        ) : currentWeekData ? (
          <div className="space-y-3">
            {/* Week mini-header */}
            <div className="flex items-center justify-between px-1">
              <div className="flex items-center gap-2">
                <p className="text-xs font-semibold text-foreground">{currentWeekData.label}</p>
                {(() => {
                  const weeks = Object.values(processedData);
                  const activeSpend = (currentWeekData.expenses || 0) + (currentWeekData.creditCardSpends || 0);
                  const allSpends   = weeks.map(w => (w.expenses || 0) + (w.creditCardSpends || 0)).filter(s => s > 0);
                  if (allSpends.length < 2 || activeSpend === 0) return null;
                  const isHeaviest  = activeSpend === Math.max(...allSpends);
                  const isLightest  = activeSpend === Math.min(...allSpends) && activeSpend !== Math.max(...allSpends);
                  if (!isHeaviest && !isLightest) return null;
                  return (
                    <span className={cn(
                      "text-[10px] font-semibold px-2 py-0.5 rounded-full",
                      isHeaviest ? "bg-red-50 text-red-600" : "bg-emerald-50 text-emerald-600"
                    )}>
                      {isHeaviest ? "Heaviest week" : "Lightest week"}
                    </span>
                  );
                })()}
              </div>
              <div className="flex items-center gap-3 text-xs text-muted-foreground">
                {(currentWeekData.income || 0) > 0 && (
                  <span className="text-primary font-semibold">+{formatCompactINR(currentWeekData.income || 0)}</span>
                )}
                <span className="text-destructive font-semibold">-{formatCompactINR(currentWeekData.expenses || 0)}</span>
                {currentWeekData.creditCardSpends > 0 && (
                  <span className="text-amber-600 font-semibold">CC -{formatCompactINR(currentWeekData.creditCardSpends)}</span>
                )}
              </div>
            </div>

            {/* Transactions */}
            {(currentWeekData.transactions || []).length > 0 ? (
              <div className="space-y-2">
                {(currentWeekData.transactions as Transaction[]).map((transaction) => {
                  const isIncome = transaction.type === 'income';
                  const isCC = transaction.account === 'credit-card';
                  const accentColor = isIncome
                    ? "bg-primary"
                    : isCC ? "bg-amber-400" : "bg-destructive";
                  const bgColor = isIncome
                    ? "bg-primary/4 border-primary/15"
                    : isCC ? "bg-amber-50/60 border-amber-200/60" : "bg-destructive/4 border-destructive/15";
                  const amountColor = isIncome ? "text-primary" : isCC ? "text-amber-600" : "text-destructive";
                  const initial = (transaction.category?.[0] || "?").toUpperCase();

                  return (
                    <div
                      key={transaction.id}
                      className={cn("flex items-center gap-3 rounded-2xl border p-3 relative overflow-hidden", bgColor)}
                    >
                      {/* Left accent bar */}
                      <div className={cn("absolute left-0 top-0 bottom-0 w-1 rounded-l-2xl", accentColor)} />

                      {/* Avatar */}
                      <button
                        className={cn(
                          "h-9 w-9 rounded-xl flex items-center justify-center text-sm font-bold shrink-0 pointer-events-auto ml-1",
                          isIncome ? "bg-primary/15 text-primary" : isCC ? "bg-amber-100 text-amber-700" : "bg-destructive/15 text-destructive"
                        )}
                        onClick={() => handleEditTransactionClick(transaction, currentWeekData.label)}
                        title="Tap to edit"
                      >
                        {initial}
                      </button>

                      {/* Details */}
                      <button
                        className="flex-1 text-left pointer-events-auto min-w-0"
                        onClick={() => handleEditTransactionClick(transaction, currentWeekData.label)}
                      >
                        <p className="text-sm font-semibold text-foreground leading-tight truncate capitalize">
                          {transaction.category?.replace(/-/g, ' ')}
                        </p>
                        <p className="text-[10px] text-muted-foreground mt-0.5">
                          {format(new Date(transaction.transaction_date), 'MMM dd · hh:mm a')}
                          {" · "}{transaction.account?.replace(/-/g, ' ')}
                          {isCC && " 💳"}
                        </p>
                        {transaction.description && (
                          <p
                            className="text-[10px] text-muted-foreground mt-0.5 truncate"
                            dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(transaction.description) }}
                          />
                        )}
                      </button>

                      {/* Amount + delete */}
                      <div className="flex items-center gap-2 shrink-0">
                        <p className={cn("text-sm font-bold", amountColor)}>
                          {isIncome ? "+" : "-"}{formatCompactINR(transaction.amount)}
                        </p>
                        <AlertDialog>
                          <AlertDialogTrigger asChild>
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-7 w-7 p-0 text-muted-foreground hover:text-destructive pointer-events-auto"
                              onClick={(e) => e.stopPropagation()}
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                          </AlertDialogTrigger>
                          <AlertDialogContent className="pointer-events-auto">
                            <AlertDialogHeader>
                              <AlertDialogTitle>Delete transaction?</AlertDialogTitle>
                              <AlertDialogDescription>
                                This will permanently delete the {transaction.type} entry for {transaction.category}. This cannot be undone.
                              </AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                              <AlertDialogCancel className="pointer-events-auto">Cancel</AlertDialogCancel>
                              <AlertDialogAction
                                onClick={() => handleDeleteTransaction(transaction.id, transaction.category)}
                                className="bg-destructive text-destructive-foreground hover:bg-destructive/90 pointer-events-auto"
                              >
                                Delete
                              </AlertDialogAction>
                            </AlertDialogFooter>
                          </AlertDialogContent>
                        </AlertDialog>
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              /* Empty week — celebrate it */
              <GlassCard className="p-8 text-center space-y-2" hover={false}>
                <p className="text-3xl">🎉</p>
                <p className="text-sm font-semibold text-foreground">Nothing spent this week!</p>
                <p className="text-xs text-muted-foreground">That's actually great. Tap + if you do have something to log.</p>
              </GlassCard>
            )}
          </div>
        ) : (
          <div className="text-center py-12">
            <p className="text-sm text-muted-foreground">Select a week above to view transactions.</p>
          </div>
        )}
      </div>

      {/* ── FAB ──────────────────────────────────────────────────────────────
          Left-aligned, not right. The AI assistant's mic FAB is fixed at
          right-4 with the same bottom offset and is mounted later (in
          AppLayout), so it rendered directly on top of this one and made
          "Add transaction" untappable on this page.

          Desktop clears the 18rem sidebar rather than sitting under it, and the
          offsets add env(safe-area-inset-*) so the button stays above Android's
          gesture bar under the enforced edge-to-edge layout. Same --fab-bottom
          custom-property trick as AssistantFab: an inline `bottom`/`left` would
          beat the md: breakpoint, so the responsive part stays in Tailwind and
          the inset is added on top in calc(). */}
      <button
        onClick={handleOpenAddTransactionDialog}
        className="pointer-events-auto fixed [--fab-left:1rem] md:[--fab-left:19rem] [--fab-bottom:6rem] md:[--fab-bottom:1.5rem] h-14 w-14 rounded-full z-40 flex items-center justify-center transition-all duration-200 hover:scale-105 active:scale-95"
        style={{
          bottom: "calc(var(--fab-bottom, 6rem) + env(safe-area-inset-bottom, 0px))",
          left: "calc(var(--fab-left, 1rem) + env(safe-area-inset-left, 0px))",
          background: "linear-gradient(135deg, #1E3A8A, #2563EB)",
          boxShadow: "0 4px 16px rgba(37,99,235,0.45), 0 2px 6px rgba(0,0,0,0.15)",
        }}
        aria-label="Add transaction"
      >
        <Plus className="h-6 w-6 text-white" strokeWidth={2.5} />
      </button>

      {/* ── Transaction Form Dialog ───────────────────────────────────────── */}
      <TransactionFormDialog
        isOpen={showTransactionFormDialog}
        onClose={() => detectedPayment ? void handleDetectedLater() : setShowTransactionFormDialog(false)}
        onSave={handleSaveTransaction}
        initialData={editingTransaction ? {
          id: editingTransaction.id,
          type: editingTransaction.type,
          account: editingTransaction.account,
          category: editingTransaction.category,
          amount: editingTransaction.amount.toString(),
          description: editingTransaction.description || '',
          transaction_date: editingTransaction.transaction_date,
        } : undefined}
        weekLabel={selectedWeekForDialog ? (processedData[selectedWeekForDialog]?.label || "") : ""}
        formType={formDialogType}
        detectedPayment={detectedPayment ? {
          amount: detectedPayment.amount,
          merchant: detectedPayment.merchant,
          occurredAt: detectedPayment.occurredAt,
          appName: detectedPayment.appName,
        } : undefined}
        onDetectedLater={() => void handleDetectedLater()}
        onDetectedSkip={() => void handleDetectedSkip()}
      />

      {/* ── Global Search ─────────────────────────────────────────────────── */}
      <GlobalSearchDialog open={showSearchDialog} onOpenChange={setShowSearchDialog} />

      {/* ── Stats Dialog ──────────────────────────────────────────────────── */}
      <ExpenseStatsDialog
        open={showStatsDialog}
        onOpenChange={setShowStatsDialog}
        monthLabel={monthsList.find(m => m.value === selectedMonth)?.label || "Current Month"}
        transactions={currentMonthTransactions}
        budgetStartDate={budgetStartDate}
        budgetEndDate={budgetEndDate}
      />
    </AppLayout>
  );
};

export default Expenses;
