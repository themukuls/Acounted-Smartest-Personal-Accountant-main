import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { GlassCard } from "@/components/ui/glass-card";
import { formatFullINR } from "@/lib/currency";
import { useAuth } from "@/contexts/AuthContext";
import { useEffect, useState } from "react";
import { Separator } from "@/components/ui/separator";
import { getIncomeDetails, getExpenseCategories } from "@/integrations/indexeddb/services/onboardingService"; // Import from IndexedDB onboarding service
import { getSavingsGoals } from "@/integrations/indexeddb/services/savingsGoalService"; // Import from IndexedDB service

interface MonthlyBudgetModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

interface IncomeData {
  basic_salary: number | null;
  hra: number | null;
  // Removed: bonus: number;
  other_allowances: number | null;
  monthly_other_income: number | null;
}

interface ExpenseCategory {
  id: string;
  category_name: string;
  amount: number;
  frequency: string;
  category_type: string;
}

interface SavingsGoal {
  id: string;
  goal_name: string;
  goal_amount: number;
  target_months: number;
}

export const MonthlyBudgetModal = ({ open, onOpenChange }: MonthlyBudgetModalProps) => {
  const { user } = useAuth();
  const [incomeData, setIncomeData] = useState<IncomeData | null>(null);
  const [expenseCategories, setExpenseCategories] = useState<ExpenseCategory[]>([]);
  const [savingsGoals, setSavingsGoals] = useState<SavingsGoal[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user || !open) return;

    const fetchBudgetData = async () => {
      setLoading(true);
      try {
        // Fetch income details from IndexedDB
        const income = await getIncomeDetails(user.id);

        // Fetch expense categories from IndexedDB
        const expenses = await getExpenseCategories(user.id);

        // Fetch savings goals from IndexedDB
        const goals = await getSavingsGoals(user.id);

        setIncomeData(income);
        setExpenseCategories(expenses || []);
        setSavingsGoals(goals || []);
      } catch (error) {
        console.error('Error fetching budget data:', error);
      } finally {
        setLoading(false);
      }
    };

    fetchBudgetData();
  }, [user, open]);

  const calculateTotalIncome = () => {
    if (!incomeData) return 0;
    return (
      (incomeData.basic_salary || 0) +
      (incomeData.hra || 0) +
      // Removed: (incomeData.bonus || 0) +
      (incomeData.other_allowances || 0) +
      (incomeData.monthly_other_income || 0)
    );
  };

  const calculateMonthlySavingsTarget = () => {
    return savingsGoals.reduce((total, goal) => {
      const monthlyTarget = goal.goal_amount / goal.target_months;
      return total + monthlyTarget;
    }, 0);
  };

  const fixedExpenses = expenseCategories.filter(exp => exp.category_type === 'fixed');
  const variableExpenses = expenseCategories.filter(exp => exp.category_type === 'variable');

  if (loading) {
    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-4xl max-h-[80vh] overflow-y-auto glass-nav pointer-events-auto">
          <div className="flex items-center justify-center p-8">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
          </div>
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[80vh] overflow-y-auto glass-nav pointer-events-auto">
        <DialogHeader>
          <DialogTitle className="text-2xl font-bold gradient-text">Monthly Budget Overview</DialogTitle>
          <DialogDescription className="text-muted-foreground">
            A comprehensive overview of your monthly income, expenses, and savings goals.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6">
          {/* Monthly Income Section */}
          <GlassCard variant="success">
            <h3 className="text-lg font-semibold mb-4 text-foreground">Monthly Income</h3>
            <div className="space-y-3">
              {incomeData?.basic_salary && (
                <div className="flex justify-between items-center">
                  <span className="text-muted-foreground">Basic Salary</span>
                  <span className="font-semibold text-foreground">{formatFullINR(incomeData.basic_salary)}</span>
                </div>
              )}
              {incomeData?.hra && (
                <div className="flex justify-between items-center">
                  <span className="text-muted-foreground">HRA</span>
                  <span className="font-semibold text-foreground">{formatFullINR(incomeData.hra)}</span>
                </div>
              )}
              {/* Removed Bonus Display */}
              {incomeData?.other_allowances && (
                <div className="flex justify-between items-center">
                  <span className="text-muted-foreground">Other Allowances</span>
                  <span className="font-semibold text-foreground">{formatFullINR(incomeData.other_allowances)}</span>
                </div>
              )}
              {incomeData?.monthly_other_income && (
                <div className="flex justify-between items-center">
                  <span className="text-muted-foreground">Other Income</span>
                  <span className="font-semibold text-foreground">{formatFullINR(incomeData.monthly_other_income)}</span>
                </div>
              )}
              <Separator />
              <div className="flex justify-between items-center">
                <span className="text-lg font-semibold text-foreground">Total Income</span>
                <span className="text-xl font-bold text-success">{formatFullINR(calculateTotalIncome())}</span>
              </div>
            </div>
          </GlassCard>

          {/* Fixed Expenses Section */}
          {fixedExpenses.length > 0 && (
            <GlassCard variant="warning">
              <h3 className="text-lg font-semibold mb-4 text-foreground">Fixed Expenses</h3>
              <div className="space-y-3">
                {fixedExpenses.map((expense) => (
                  <div key={expense.id} className="flex justify-between items-center">
                    <span className="text-muted-foreground">{expense.category_name}</span>
                    <span className="font-semibold text-foreground">{formatFullINR(expense.amount)}</span>
                  </div>
                ))}
                <Separator />
                <div className="flex justify-between items-center">
                  <span className="text-lg font-semibold text-foreground">Total Fixed</span>
                  <span className="text-xl font-bold text-warning">
                    {formatFullINR(fixedExpenses.reduce((sum, exp) => sum + exp.amount, 0))}
                  </span>
                </div>
              </div>
            </GlassCard>
          )}

          {/* Variable Expenses Section */}
          {variableExpenses.length > 0 && (
            <GlassCard variant="secondary">
              <h3 className="text-lg font-semibold mb-4 text-foreground">Variable Expenses</h3>
              <div className="space-y-3">
                {variableExpenses.map((expense) => (
                  <div key={expense.id} className="flex justify-between items-center">
                    <span className="text-muted-foreground">{expense.category_name}</span>
                    <span className="font-semibold text-foreground">{formatFullINR(expense.amount)}</span>
                  </div>
                ))}
                <Separator />
                <div className="flex justify-between items-center">
                  <span className="text-lg font-semibold text-foreground">Total Variable</span>
                  <span className="text-xl font-bold text-secondary">
                    {formatFullINR(variableExpenses.reduce((sum, exp) => sum + exp.amount, 0))}
                  </span>
                </div>
              </div>
            </GlassCard>
          )}

          {/* Savings Goals Section */}
          {savingsGoals.length > 0 && (
            <GlassCard variant="primary">
              <h3 className="text-lg font-semibold mb-4 text-foreground">Savings Goals This Month</h3>
              <div className="space-y-3">
                {savingsGoals.map((goal) => (
                  <div key={goal.id} className="flex justify-between items-center">
                    <span className="text-muted-foreground">{goal.goal_name}</span>
                    <span className="font-semibold text-foreground">
                      {formatFullINR(goal.goal_amount / goal.target_months)}
                    </span>
                  </div>
                ))}
                <Separator />
                <div className="flex justify-between items-center">
                  <span className="text-lg font-semibold text-foreground">Total Savings Target</span>
                  <span className="text-xl font-bold text-primary">
                    {formatFullINR(calculateMonthlySavingsTarget())}
                  </span>
                </div>
              </div>
            </GlassCard>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
};