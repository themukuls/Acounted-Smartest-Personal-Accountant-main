import { format } from 'date-fns';

export interface StatsTransaction {
  id: string;
  type: 'income' | 'expense';
  amount: number;
  category: string;
  account: string;
  description: string | null;
  transaction_date: string;
  created_at: string;
}

export interface CategorySummary {
  key: string;
  total: number;
  count: number;
  average: number;
  percentage: number;
}

export function buildCategorySummaries(transactions: StatsTransaction[]): CategorySummary[] {
  const expenses = transactions.filter(transaction => transaction.type === 'expense');
  const grandTotal = expenses.reduce((sum, transaction) => sum + transaction.amount, 0);
  const grouped = new Map<string, { total: number; count: number }>();

  expenses.forEach(transaction => {
    const key = transaction.category || 'others';
    const current = grouped.get(key) ?? { total: 0, count: 0 };
    current.total += transaction.amount;
    current.count += 1;
    grouped.set(key, current);
  });

  return Array.from(grouped, ([key, value]) => ({
    key,
    total: value.total,
    count: value.count,
    average: value.count ? value.total / value.count : 0,
    percentage: grandTotal ? (value.total / grandTotal) * 100 : 0,
  })).sort((a, b) => b.total - a.total);
}

export function transactionsForCategory(transactions: StatsTransaction[], category: string) {
  return transactions
    .filter(transaction => transaction.type === 'expense' && (transaction.category || 'others') === category)
    .sort((a, b) => new Date(b.transaction_date).getTime() - new Date(a.transaction_date).getTime());
}

export function buildCategoryMonthlyTrend(transactions: StatsTransaction[], category: string) {
  const grouped = new Map<string, { month: string; total: number; count: number }>();
  transactionsForCategory(transactions, category).forEach(transaction => {
    const date = new Date(transaction.transaction_date);
    if (Number.isNaN(date.getTime())) return;
    const key = format(date, 'yyyy-MM');
    const current = grouped.get(key) ?? { month: key, total: 0, count: 0 };
    current.total += transaction.amount;
    current.count += 1;
    grouped.set(key, current);
  });
  return Array.from(grouped.values()).sort((a, b) => a.month.localeCompare(b.month));
}
