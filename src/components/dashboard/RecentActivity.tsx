import { GlassCard } from "@/components/ui/glass-card";
import { Activity } from "lucide-react";
import { formatCompactINR } from "@/lib/currency";
import { useAuth } from "@/contexts/AuthContext";
import { useState, useEffect } from "react";
import { format } from "date-fns";
import DOMPurify from "dompurify";
import { getRecentTransactions } from "@/integrations/indexeddb/services/dataService";
import { useQuery } from "@tanstack/react-query";
import { motion } from "framer-motion";

interface Transaction {
  id: string;
  category: string;
  amount: number;
  type: string;
  transaction_date: string;
  description?: string;
}

interface RecentActivityProps {
  onboardingCompleted: boolean; // New prop
}

export const RecentActivity = ({ onboardingCompleted }: RecentActivityProps) => {
  const { user } = useAuth();

  const { 
    data: transactions = [], 
    isLoading: loading, 
    isError: isErrorTransactions 
  } = useQuery<Transaction[], Error>({
    queryKey: ['recentTransactions', user?.id, onboardingCompleted],
    queryFn: async () => {
      if (!user || !onboardingCompleted) {
        return [];
      }
      const data = await getRecentTransactions(user.id, 2);
      return data || [];
    },
    enabled: !!user && onboardingCompleted, // Only run query if user is logged in and onboarding is complete
    staleTime: 1000 * 60 * 2, // Data considered fresh for 2 minutes
    refetchOnWindowFocus: true, // Refetch when window regains focus
  });

  const formatTransactionAmount = (amount: number, type: string) => {
    const formattedAmount = formatCompactINR(amount);
    return type === 'expense' ? `-${formattedAmount}` : `+${formattedAmount}`;
  };

  const getAmountColor = (type: string) => {
    return type === 'expense' ? 'text-destructive' : 'text-success';
  };

  if (!onboardingCompleted) {
    return (
      <GlassCard className="p-4">
        <div className="flex items-center gap-2 mb-3">
          <Activity className="h-4 w-4 text-primary" />
          <h3 className="text-sm font-bold text-foreground">Recent Activity</h3>
        </div>
        <div className="text-center py-5 space-y-1">
          <p className="text-sm font-semibold text-foreground">Your transactions will show up here</p>
          <p className="text-xs text-muted-foreground">Log your first one to get started.</p>
        </div>
      </GlassCard>
    );
  }

  if (loading) {
    return (
      <GlassCard className="p-4">
        <div className="flex items-center gap-2 mb-3">
          <Activity className="h-4 w-4 text-primary" />
          <h3 className="text-sm font-bold text-foreground">Recent Activity</h3>
        </div>
        <div className="space-y-2">
          {[1, 2].map(i => (
            <div key={i} className="h-12 bg-muted rounded-xl animate-pulse" />
          ))}
        </div>
      </GlassCard>
    );
  }

  return (
    <GlassCard className="p-4">
      <div className="flex items-center gap-2 mb-3">
        <Activity className="h-4 w-4 text-primary" />
        <h3 className="text-sm font-bold text-foreground">Recent Activity</h3>
      </div>
      <div className="space-y-2">
        {transactions.length === 0 ? (
          <div className="text-center py-5 space-y-1">
            <p className="text-sm font-medium text-foreground">Nothing logged yet</p>
            <p className="text-xs text-muted-foreground">Tap Quick Actions to add your first transaction.</p>
          </div>
        ) : (
          transactions.map((transaction, idx) => {
            const isExpense = transaction.type === "expense";
            const initial   = (transaction.category?.[0] || "?").toUpperCase();
            return (
              <motion.div
                key={transaction.id}
                initial={{ opacity: 0, x: -12 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ type: "spring", stiffness: 260, damping: 24, delay: idx * 0.07 }}
                className="flex items-center gap-3 p-2.5 rounded-xl bg-background/50 border border-border/40"
              >
                <div className={`h-8 w-8 rounded-xl flex items-center justify-center text-xs font-bold shrink-0 ${isExpense ? 'bg-destructive/10 text-destructive' : 'bg-primary/10 text-primary'}`}>
                  {initial}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-semibold text-foreground truncate capitalize">
                    {(transaction.description || transaction.category)?.replace(/-/g, ' ')}
                  </p>
                  <p className="text-[10px] text-muted-foreground">
                    {format(new Date(transaction.transaction_date), 'MMM dd, yyyy')}
                  </p>
                </div>
                <span className={`text-xs font-bold shrink-0 ${getAmountColor(transaction.type)}`}>
                  {formatTransactionAmount(transaction.amount, transaction.type)}
                </span>
              </motion.div>
            );
          })
        )}
      </div>
    </GlassCard>
  );
};
