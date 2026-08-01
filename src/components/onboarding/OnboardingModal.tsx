"use client";

import React, { useState, useEffect, useRef } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Info, Trash2, Wallet, CreditCard, TrendingUp, Sparkles, Plus, Pencil, Save, X, CheckCircle2, Briefcase, Laptop, ChevronRight, SkipForward } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { auth } from "@/integrations/indexeddb/auth"; // Import local auth service
import { v4 as uuidv4 } from 'uuid';
import {
  getIncomeDetails,
  saveIncomeDetails,
  getExpenseCategories,
  saveExpenseCategory,
  deleteExpenseCategory,
  getInvestmentTypes,
  saveInvestmentType,
  deleteInvestmentType, // Corrected import: now exported from service
} from "@/integrations/indexeddb/services/onboardingService"; // Import new IndexedDB services
import { useQueryClient } from "@tanstack/react-query"; // NEW: Import useQueryClient

interface OnboardingModalProps {
  open: boolean;
  onComplete: () => void;
  onClose?: () => void;
  forceStartStepZero?: boolean; // New prop
}

const STEPS = [
  { id: "income", label: "Income", icon: Wallet, title: "Your Financial Foundation", description: "Let's start by understanding your income sources. This is key to smart planning!" },
  { id: "expenses", label: "Expenses", icon: CreditCard, title: "Smart Spending Habits", description: "Categorize your regular expenses to unlock personalized budgeting insights." },
  { id: "investments", label: "Investments", icon: TrendingUp, title: "Grow Your Wealth", description: "Tell us about your investment preferences for tailored advice and tax optimization." },
];

// Pre-filled interest rates for Indian investments
const interestRates: Record<string, string> = {
  'savings_account': "3-4%",
  'mutual_funds': "10-12%",
  'stock_market': "12-15%",
  'fixed_deposit': "6-7%",
  'recurring_deposit': "5.5-6.5%",
  'ppf': "7.1%",
  'elss': "12-15%",
  'gold': "8-10%",
  'other': "7-9%" // Default for 'Other'
};

// Investment options for cards
const INVESTMENT_OPTIONS = [
  { name: "Savings Account", type: "savings_account" },
  { name: "Mutual Funds", type: "mutual_funds" },
  { name: "Stock Market", type: "stock_market" },
  { name: "Fixed Deposit", type: "fixed_deposit" },
  { name: "Recurring Deposit", type: "recurring_deposit" },
  { name: "PPF", type: "ppf" },
  { name: "ELSS", type: "elss" },
  { name: "Gold", type: "gold" },
  { name: "Other Investment", type: "other" },
];

// Define a set of colors for investment input boxes
const INVESTMENT_COLORS = [
  "bg-blue-500/10 border-blue-500/20",
  "bg-green-500/10 border-green-500/20",
  "bg-purple-500/10 border-purple-500/20",
  "bg-yellow-500/10 border-yellow-500/20",
  "bg-red-500/10 border-red-500/20",
];

interface InvestmentEntry {
  localId: string; // Unique ID for local state management (can be DB ID if existing)
  investment_name: string;
  investment_type: string;
  amount: string;
  risk_level: string;
  interest_rate: string; // Stored as string for input binding
  isEditingInterestRate?: boolean; // To manage local editing state
}

interface ExpenseCategory {
  id?: string; // Optional ID for existing categories
  category_name: string;
  amount: string;
  frequency: string;
  fullName: string; // Used for predefined categories
}

interface CustomExpense {
  id?: string; // Optional ID for existing custom categories
  category_name: string;
  amount: string;
  frequency: string;
}

// Predefined fixed categories for the OnboardingModal
const predefinedFixedCategories = [
  { category_name: "Rent", fullName: "Rent", frequency: "monthly" },
  { category_name: "Home Loan EMI", fullName: "Home Loan EMI", frequency: "monthly" },
  { category_name: "Vehicle Loan EMI", fullName: "Vehicle Loan EMI", frequency: "monthly" },
];

export const OnboardingModal = ({ open, onComplete, onClose, forceStartStepZero = false }: OnboardingModalProps) => {
  const [currentStep, setCurrentStep] = useState(0);
  const [loading, setLoading] = useState(false);
  const [dataLoading, setDataLoading] = useState(true);
  const [flashingTooltip, setFlashingTooltip] = useState<string | null>(null);
  const { user, refreshUser } = useAuth(); // Use refreshUser from AuthContext
  const { toast } = useToast();
  const queryClient = useQueryClient(); // NEW: Initialize useQueryClient
  const [showCelebration, setShowCelebration] = useState(false); // New state for celebration

  // Refs for scrolling to new investment entries
  const investmentRefs = useRef<Map<string, HTMLDivElement | null>>(new Map());

  // Income form state
  const [incomeData, setIncomeData] = useState({
    income_type: [] as string[], // Explicitly type as string array
    monthly_salary: "",
    basic_salary: "",
    other_allowances: "",
    city_residence_type: "",
    freelance_monthly_avg: "",
    freelance_yearly_target: "",
    monthly_other_income: ""
  });

  // Expense categories state
  const [expenseCategories, setExpenseCategories] = useState<ExpenseCategory[]>([]);
  const [customExpenses, setCustomExpenses] = useState<CustomExpense[]>([]);

  // Investment preferences state
  const [investments, setInvestments] = useState<InvestmentEntry[]>([]);

  // Helper to get default numeric interest rate from string range
  const getDefaultNumericInterestRate = (type: string): string => {
    const rateString = interestRates[type] || interestRates['other'];
    const matches = rateString.match(/(\d+(\.\d+)?)-(\d+(\.\d+)?)%/);
    if (matches && matches.length >= 5) {
      const lower = parseFloat(matches[1]);
      const upper = parseFloat(matches[3]);
      return ((lower + upper) / 2).toFixed(1); // Average of the range, formatted as string
    }
    return parseFloat(rateString).toFixed(1) || "7.0"; // Fallback to single number or default, formatted as string
  };

  // Load existing data when modal opens
  useEffect(() => {
    if (open && user) {
      const fetchDataAndSetState = async () => {
        setDataLoading(true);
        try {
          // Fetch income details
          const incomeDetails = await getIncomeDetails(user.id);
          console.log("Fetched income details from DB:", incomeDetails); // Debug log

          // Fetch all expense categories
          const allDbExpenses = await getExpenseCategories(user.id);
          // Filter for only fixed expense categories
          const fixedDbExpenses = allDbExpenses.filter(exp => exp.category_type === 'fixed');

          // Fetch investment data
          const investmentTypes = await getInvestmentTypes(user.id);

          // --- Set Income Data ---
          if (incomeDetails) {
            const incomeTypeString = incomeDetails.income_type || '';
            const parsedIncomeType = incomeTypeString.split(',').map(s => s.trim()).filter(s => s !== '');

            setIncomeData({
              income_type: parsedIncomeType,
              monthly_salary: incomeDetails.monthly_salary?.toString() || "",
              basic_salary: incomeDetails.basic_salary?.toString() || "",
              other_allowances: incomeDetails.other_allowances?.toString() || "",
              city_residence_type: (incomeDetails.form_data as any)?.city_residence_type || "",
              freelance_monthly_avg: (incomeDetails.form_data as any)?.freelance_monthly_avg?.toString() || "",
              freelance_yearly_target: (incomeDetails.form_data as any)?.freelance_yearly_target?.toString() || "",
              monthly_other_income: incomeDetails.monthly_other_income?.toString() || ""
            });
          } else {
            // Reset to default if no data
            setIncomeData({
              income_type: [], monthly_salary: "", basic_salary: "",
              other_allowances: "",
              city_residence_type: "",
              freelance_monthly_avg: "", freelance_yearly_target: "", monthly_other_income: ""
            });
          }

          // --- Set Expense Data (only fixed categories) ---
          let updatedExpenseCategories: ExpenseCategory[] = [];
          let customFixedExpensesFromDB: CustomExpense[] = [];
          const existingFixedCategoryNames = new Set(fixedDbExpenses.map(exp => exp.category_name));

          // Populate predefined fixed categories
          predefinedFixedCategories.forEach(predefined => {
            const savedCategory = fixedDbExpenses.find(exp => exp.category_name === predefined.category_name);
            updatedExpenseCategories.push(savedCategory ? {
              ...predefined,
              id: savedCategory.id,
              amount: savedCategory.amount?.toString() || "",
              frequency: savedCategory.frequency || predefined.frequency
            } : {
              ...predefined,
              id: undefined, // Ensure no ID if not saved
              amount: "",
              frequency: predefined.frequency
            });
          });

          // Populate custom fixed expenses (those in DB but not in predefined list)
          customFixedExpensesFromDB = fixedDbExpenses.filter(exp =>
            !predefinedFixedCategories.some(predefined => predefined.category_name === exp.category_name)
          ).map(exp => ({
            id: exp.id,
            category_name: exp.category_name,
            amount: exp.amount?.toString() || "",
            frequency: exp.frequency
          }));
          
          setExpenseCategories(updatedExpenseCategories);
          setCustomExpenses(customFixedExpensesFromDB);


          // --- Set Investment Data ---
          if (investmentTypes && investmentTypes.length > 0) {
            const loadedInvestments: InvestmentEntry[] = investmentTypes.map(inv => ({
              localId: inv.id, // Use DB ID as localId for existing entries
              investment_name: inv.investment_name,
              investment_type: inv.investment_type,
              amount: inv.amount?.toString() || "",
              risk_level: inv.risk_level,
              interest_rate: inv.interest_rate?.toFixed(1) || getDefaultNumericInterestRate(inv.investment_type), // Load and format
              isEditingInterestRate: false,
            }));
            setInvestments(loadedInvestments);
          } else {
            setInvestments([]); // Reset if no data
          }

          // Determine starting step based on the *fetched* data, or forceStartStepZero
          if (forceStartStepZero) {
            setCurrentStep(0);
          } else {
            const hasIncomeData = incomeDetails && (
              (incomeDetails.income_type && incomeDetails.income_type.length > 0) ||
              incomeDetails.monthly_salary ||
              incomeDetails.basic_salary ||
              (incomeDetails.form_data as any)?.freelance_monthly_avg ||
              incomeDetails.monthly_other_income
            );
            
            const hasFixedExpenseData = fixedDbExpenses && fixedDbExpenses.length > 0 && fixedDbExpenses.some(exp => exp.amount > 0);
            const hasInvestmentData = investmentTypes && investmentTypes.length > 0 && investmentTypes.some(inv => inv.amount > 0);

            if (hasInvestmentData) {
              setCurrentStep(2);
            } else if (hasFixedExpenseData) {
              setCurrentStep(1); // If income is filled, move to expenses
            } else if (hasIncomeData) {
              setCurrentStep(1); // If income is filled, move to expenses
            } else {
              setCurrentStep(0);
            }
          }

        } catch (error) {
          console.error('Error loading existing data:', error);
          toast({
            title: "Error",
            description: "Failed to load financial details.",
            variant: "destructive",
          });
        } finally {
          setDataLoading(false);
        }
      };

      fetchDataAndSetState();
    }
  }, [open, user, forceStartStepZero]); // Dependencies for this useEffect

  const progress = ((currentStep + 1) / STEPS.length) * 100;

  const flashTooltip = (tooltipId: string) => {
    setFlashingTooltip(tooltipId);
    setTimeout(() => setFlashingTooltip(null), 3000);
  };

  const handleFieldFocus = (tooltipId: string) => {
    flashTooltip(tooltipId);
  };

  const InfoTooltip = ({ id, content, children }: { id: string; content: string; children: React.ReactNode }) => (
    <TooltipProvider>
      <Tooltip open={flashingTooltip === id}>
        <div className="flex items-center gap-2">
          {children}
          <TooltipTrigger asChild>
            <button
              type="button"
              onClick={() => flashTooltip(id)}
              className={`p-1 rounded-full hover:bg-muted/50 transition-all duration-200 ${
                flashingTooltip === id ? 'animate-pulse bg-primary/20' : ''
              } pointer-events-auto`}
            >
              <Info className="h-3 w-3 text-muted-foreground" />
            </button>
          </TooltipTrigger>
        </div>
        <TooltipContent side="top" className="max-w-xs text-xs">
          <p>{content}</p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );

  const saveIncomeDataToIndexedDB = async () => {
    if (!user) return false;

    try {
      const incomePayload = {
        user_id: user.id,
        income_type: incomeData.income_type.join(','),
        monthly_salary: incomeData.monthly_salary ? parseFloat(incomeData.monthly_salary) : null,
        basic_salary: 0, // Hardcoded to 0
        other_allowances: 0, // Hardcoded to 0
        monthly_other_income: incomeData.monthly_other_income ? parseFloat(incomeData.monthly_other_income) : null,
        form_data: { // This is where form_data is constructed
          city_residence_type: incomeData.city_residence_type,
          freelance_monthly_avg: incomeData.freelance_monthly_avg ? parseFloat(incomeData.freelance_monthly_avg) : null,
          freelance_yearly_target: incomeData.freelance_yearly_target ? parseFloat(incomeData.freelance_yearly_target) : null,
        }
      };

      console.log('Income payload being sent to IndexedDB:', incomePayload); // Debug log
      await saveIncomeDetails(user.id, incomePayload);
      console.log('Income save successful to IndexedDB'); // Debug log
      queryClient.invalidateQueries({ queryKey: ['monthlyBudgetSummary'] }); // Invalidate for homepage
      queryClient.invalidateQueries({ queryKey: ['activeNotifications'] }); // NEW: Invalidate notifications
      queryClient.invalidateQueries({ queryKey: ['seenNotificationIds'] }); // NEW: Invalidate seen notifications
      return true;
    } catch (error) {
      console.error('Error saving income data to IndexedDB:', error);
      toast({
        title: "Error",
        description: "Failed to save income details. Please try again.",
        variant: "destructive",
      });
      return false;
    }
  };

  const saveExpenseCategoriesToIndexedDB = async () => {
    if (!user) return false;

    try {
      const allFixedExpenses = [
        ...expenseCategories.filter(cat => cat.category_name.trim()), // Filter out empty names
        ...customExpenses.filter(cat => cat.category_name.trim())
      ];

      // Fetch existing categories to determine what to update/delete
      const existingExpenses = await getExpenseCategories(user.id);
      // Only consider existing fixed expenses for comparison
      const existingFixedExpenses = existingExpenses.filter(exp => exp.category_type === 'fixed');
      
      const categoriesToKeepIds = new Set<string>();

      // Process each expense category from the form
      for (const cat of allFixedExpenses) {
        let parsedAmount = parseFloat(cat.amount);
        if (isNaN(parsedAmount) || parsedAmount < 0) {
          parsedAmount = 0; // Default to 0 if invalid or negative
          console.warn(`Adjusting invalid or negative amount for category ${cat.category_name} to 0.`);
        }

        let expenseId = cat.id;
        // If it's a predefined category without an ID, or a custom one without an ID,
        // try to find it by name among existing ones to update instead of creating new.
        if (!expenseId) {
          const existingByName = existingFixedExpenses.find(e => e.category_name === cat.category_name);
          if (existingByName) {
            expenseId = existingByName.id;
          }
        }

        const expensePayload = {
          id: expenseId, // Use found ID or undefined for new
          user_id: user.id,
          category_name: cat.category_name,
          amount: parsedAmount,
          frequency: cat.frequency,
          category_type: "fixed" // Ensure it's saved as fixed
        };

        const savedRecord = await saveExpenseCategory(user.id, expensePayload);
        categoriesToKeepIds.add(savedRecord.id); // Add the ID of the saved/updated record
      }

      // Delete fixed categories that are no longer in the form
      const fixedCategoriesToDelete = existingFixedExpenses.filter(exp => !categoriesToKeepIds.has(exp.id));

      for (const categoryToDelete of fixedCategoriesToDelete) {
        await deleteExpenseCategory(categoryToDelete.id);
      }
      queryClient.invalidateQueries({ queryKey: ['monthlyBudgetSummary'] }); // Invalidate for homepage
      queryClient.invalidateQueries({ queryKey: ['activeNotifications'] }); // NEW: Invalidate notifications
      queryClient.invalidateQueries({ queryKey: ['seenNotificationIds'] }); // NEW: Invalidate seen notifications
      return true;
    } catch (error) {
      console.error('Error saving expense categories to IndexedDB:', error);
      toast({
        title: "Error",
        description: "Failed to save expense categories. Please try again.",
        variant: "destructive",
      });
      return false;
    }
  };

  const saveInvestmentsToIndexedDB = async () => {
    if (!user) return false;

    try {
      const validInvestments = investments.filter(inv => inv.amount && inv.investment_name);

      // Fetch existing investments from IndexedDB
      const existingInvestments = await getInvestmentTypes(user.id);
      
      const investmentsToKeepIds = new Set<string>();

      // Process each investment
      for (const inv of validInvestments) {
        const parsedAmount = parseFloat(inv.amount);
        if (isNaN(parsedAmount) || parsedAmount < 0) {
          console.warn(`Invalid or negative amount for investment ${inv.investment_name}: ${inv.amount}. Skipping.`);
          continue;
        }
        const parsedInterestRate = parseFloat(inv.interest_rate);
        if (isNaN(parsedInterestRate) || parsedInterestRate < 0 || parsedInterestRate > 100) {
          console.warn(`Invalid interest rate for investment ${inv.investment_name}: ${inv.interest_rate}. Skipping.`);
          continue;
        }

        let investmentId = inv.localId;
        // If it's a new investment (localId is a generated UUID), check if an investment with the same name already exists
        if (!existingInvestments.some(e => e.id === investmentId)) { // Check if localId is an existing DB ID
          const existingByName = existingInvestments.find(e => e.investment_name === inv.investment_name);
          if (existingByName) {
            investmentId = existingByName.id;
          }
        }

        const investmentPayload = {
          id: investmentId, // Use found ID or localId for new
          user_id: user.id,
          investment_name: inv.investment_name,
          investment_type: inv.investment_type,
          amount: parsedAmount,
          risk_level: inv.risk_level,
          interest_rate: parsedInterestRate
        };
        const savedRecord = await saveInvestmentType(user.id, investmentPayload);
        investmentsToKeepIds.add(savedRecord.id);
      }

      // Delete investments that are no longer in the form
      const investmentsToDelete = existingInvestments.filter(exp => !investmentsToKeepIds.has(exp.id));

      for (const investmentToDelete of investmentsToDelete) {
        await deleteInvestmentType(investmentToDelete.id);
      }
      queryClient.invalidateQueries({ queryKey: ['monthlyBudgetSummary'] }); // Invalidate for homepage
      queryClient.invalidateQueries({ queryKey: ['activeNotifications'] }); // NEW: Invalidate notifications
      queryClient.invalidateQueries({ queryKey: ['seenNotificationIds'] }); // NEW: Invalidate seen notifications
      return true;
    } catch (error) {
      console.error('Error saving investments to IndexedDB:', error);
      toast({
        title: "Error",
        description: "Failed to save investment preferences. Please try again.",
        variant: "destructive",
      });
      return false;
    }
  };

  const markOnboardingCompleteInIndexedDB = async () => {
    if (!user) return false;

    try {
      const { error } = await auth.markOnboardingCompletedLocal(user.id);
      if (error) throw new Error(error);
      await refreshUser(); // Refresh user context to update onboarding_completed status
      queryClient.invalidateQueries({ queryKey: ['monthlyBudgetSummary'] }); // Invalidate for homepage
      queryClient.invalidateQueries({ queryKey: ['activeNotifications'] }); // NEW: Invalidate notifications
      queryClient.invalidateQueries({ queryKey: ['seenNotificationIds'] }); // NEW: Invalidate seen notifications
      return true;
    } catch (error) {
      console.error('Error marking onboarding complete in IndexedDB:', error);
      return false;
    }
  };

  const handleNext = async () => {
    setLoading(true);

    let success = false;
    
    if (currentStep === 0) {
      success = await saveIncomeDataToIndexedDB();
    } else if (currentStep === 1) {
      success = await saveExpenseCategoriesToIndexedDB();
    } else if (currentStep === 2) {
      success = await saveInvestmentsToIndexedDB();
      if (success) {
        success = await markOnboardingCompleteInIndexedDB();
        if (success) {
          setShowCelebration(true); // Show celebration before calling onComplete
          setTimeout(() => {
            setShowCelebration(false);
            toast({
              title: "Welcome aboard!",
              description: "Your financial profile has been set up successfully.",
            });
            onComplete();
          }, 2000); // Show celebration for 2 seconds
        }
      }
    }

    if (success && currentStep < STEPS.length - 1) {
      setCurrentStep(currentStep + 1);
    }

    setLoading(false);
  };

  const handleDeleteExpenseCategory = async (index: number, isCustom: boolean, id?: string) => {
    if (id) {
      try {
        await deleteExpenseCategory(id);
        toast({ title: "Success", description: "Expense category deleted." });
        queryClient.invalidateQueries({ queryKey: ['monthlyBudgetSummary'] }); // Invalidate for homepage
        queryClient.invalidateQueries({ queryKey: ['activeNotifications'] }); // NEW: Invalidate notifications
        queryClient.invalidateQueries({ queryKey: ['seenNotificationIds'] }); // NEW: Invalidate seen notifications
      } catch (error) {
        console.error("Error deleting expense category from IndexedDB:", error);
        toast({ title: "Error", description: "Failed to delete expense category.", variant: "destructive" });
      }
    }

    if (isCustom) {
      setCustomExpenses(prev => prev.filter((_, i) => i !== index));
    } else {
      setExpenseCategories(prev => prev.filter((_, i) => i !== index));
    }
  };

  const handleAddInvestment = (type: string, name: string) => {
    const newInvestmentId = uuidv4(); // Generate a new UUID for local state
    const newInvestment: InvestmentEntry = {
      localId: newInvestmentId,
      investment_name: `New ${name}`,
      investment_type: type,
      amount: "",
      risk_level: type === "savings_account" || type === "fixed_deposit" || type === "recurring_deposit" || type === "ppf" ? "low" :
                  type === "mutual_funds" || type === "elss" ? "medium" : "high",
      interest_rate: getDefaultNumericInterestRate(type), // Set default numeric rate as string
      isEditingInterestRate: false,
    };
    setInvestments(prev => [...prev, newInvestment]);

    // Scroll to the new item after it's rendered
    setTimeout(() => {
      const element = investmentRefs.current.get(newInvestmentId);
      if (element) {
        element.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    }, 100); // Small delay to ensure DOM update
  };

  const handleUpdateInvestment = (localId: string, field: keyof InvestmentEntry, value: string) => {
    setInvestments(prev =>
      prev.map(inv => (inv.localId === localId ? { ...inv, [field]: value } : inv))
    );
  };

  const handleDeleteInvestment = async (localId: string) => {
    try {
      await deleteInvestmentType(localId); // localId is the IndexedDB ID
      toast({ title: "Success", description: "Investment deleted." });
      queryClient.invalidateQueries({ queryKey: ['monthlyBudgetSummary'] }); // Invalidate for homepage
      queryClient.invalidateQueries({ queryKey: ['activeNotifications'] }); // NEW: Invalidate notifications
      queryClient.invalidateQueries({ queryKey: ['seenNotificationIds'] }); // NEW: Invalidate seen notifications
    } catch (error) {
      console.error("Error deleting investment from IndexedDB:", error);
      toast({ title: "Error", description: "Failed to delete investment.", variant: "destructive" });
    }
    setInvestments(prev => prev.filter(inv => inv.localId !== localId));
  };

  const handleEditInterestRate = (localId: string) => {
    setInvestments(prev =>
      prev.map(inv => (inv.localId === localId ? { ...inv, isEditingInterestRate: true } : inv))
    );
  };

  const handleSaveInterestRate = (localId: string) => {
    setInvestments(prev =>
      prev.map(inv => {
        if (inv.localId === localId) {
          const newRate = parseFloat(inv.interest_rate);
          if (isNaN(newRate) || newRate < 0 || newRate > 100) {
            toast({
              title: "Error",
              description: "Please enter a valid interest rate (0-100%)",
              variant: "destructive",
            });
            return inv; // Don't save invalid rate
          }
          return { ...inv, interest_rate: newRate.toFixed(1), isEditingInterestRate: false };
        }
        return inv;
      })
    );
  };

  const handleCancelInterestRateEdit = (localId: string) => {
    setInvestments(prev =>
      prev.map(inv => {
        if (inv.localId === localId) {
          // Revert to the default/last saved value if the user cancels
          const originalRate = inv.interest_rate; // Keep current value if not reverting to a specific old one
          return { ...inv, interest_rate: originalRate, isEditingInterestRate: false };
        }
        return inv;
      })
    );
  };

  const currentStepData = STEPS[currentStep];

  const renderStepContent = () => {
    if (showCelebration) {
      const incomeAmt = incomeData.monthly_salary || incomeData.freelance_monthly_avg || '0';
      const expenseCount = expenseCategories.filter(c => c.amount && parseFloat(c.amount) > 0).length + customExpenses.filter(c => c.amount).length;
      const investCount = investments.filter(i => i.amount).length;
      return (
        <div className="flex flex-col items-center justify-center py-8 text-center space-y-5">
          <div className="h-20 w-20 rounded-full bg-emerald-100 flex items-center justify-center">
            <CheckCircle2 className="h-10 w-10 text-emerald-600" />
          </div>
          <div>
            <h3 className="text-2xl font-black gradient-text mb-1">You're all set!</h3>
            <p className="text-sm text-muted-foreground">Your financial profile is ready</p>
          </div>
          <div className="w-full space-y-2">
            {parseFloat(incomeAmt) > 0 && (
              <div className="flex items-center gap-3 p-3 rounded-xl bg-primary/5 border border-primary/15">
                <Wallet className="h-4 w-4 text-primary shrink-0" />
                <span className="text-xs font-semibold text-foreground">Income set up</span>
                <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500 ml-auto" />
              </div>
            )}
            {expenseCount > 0 && (
              <div className="flex items-center gap-3 p-3 rounded-xl bg-amber-50 border border-amber-200">
                <CreditCard className="h-4 w-4 text-amber-600 shrink-0" />
                <span className="text-xs font-semibold text-foreground">{expenseCount} expense categor{expenseCount === 1 ? 'y' : 'ies'} tracked</span>
                <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500 ml-auto" />
              </div>
            )}
            {investCount > 0 && (
              <div className="flex items-center gap-3 p-3 rounded-xl bg-emerald-50 border border-emerald-200">
                <TrendingUp className="h-4 w-4 text-emerald-600 shrink-0" />
                <span className="text-xs font-semibold text-foreground">{investCount} investment{investCount === 1 ? '' : 's'} added</span>
                <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500 ml-auto" />
              </div>
            )}
          </div>
        </div>
      );
    }

    switch (currentStep) {
      case 0:
        return (
          <div className="space-y-5">
            {/* Income type selector */}
            <div className="space-y-3">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Income source</p>
              <div className="grid grid-cols-2 gap-3">
                {[
                  { type: "salaried", label: "Salaried", sub: "Regular monthly income", Icon: Briefcase },
                  { type: "freelance", label: "Freelancer", sub: "Project-based earnings", Icon: Laptop },
                ].map(({ type, label, sub, Icon }) => {
                  const selected = incomeData.income_type.includes(type);
                  return (
                    <button
                      key={type}
                      onClick={() => {
                        const newTypes = selected
                          ? incomeData.income_type.filter(t => t !== type)
                          : [...incomeData.income_type, type];
                        setIncomeData({ ...incomeData, income_type: newTypes });
                      }}
                      className={cn(
                        "relative flex items-center gap-3 p-3 rounded-xl border-2 text-left transition-all pointer-events-auto",
                        selected
                          ? "border-primary bg-primary/8 shadow-sm"
                          : "border-border/50 bg-background/60 hover:border-primary/40"
                      )}
                    >
                      <Icon className={cn("h-5 w-5 shrink-0", selected ? "text-primary" : "text-muted-foreground")} />
                      <div className="min-w-0">
                        <p className={cn("text-sm font-bold", selected ? "text-primary" : "text-foreground")}>{label}</p>
                        <p className="text-[10px] text-muted-foreground">{sub}</p>
                      </div>
                      {selected && (
                        <CheckCircle2 className="h-4 w-4 text-primary ml-auto shrink-0" />
                      )}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Salaried fields */}
            {incomeData.income_type.includes("salaried") && (
              <div className="space-y-2 p-3 rounded-xl border border-blue-200 bg-blue-50/50">
                <p className="text-[10px] font-bold text-blue-600 uppercase tracking-wider">Salaried Details</p>
                <div className="grid grid-cols-2 gap-2">
                  <div className="space-y-1">
                    <Label className="text-[10px] font-medium text-foreground">Monthly Salary</Label>
                    <Input type="number" placeholder="e.g. 80000" value={incomeData.monthly_salary}
                      onChange={(e) => setIncomeData({ ...incomeData, monthly_salary: e.target.value })}
                      onFocus={() => handleFieldFocus("monthly_salary")}
                      className="text-xs rounded-lg h-8 pointer-events-auto" />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-[10px] font-medium text-foreground">City Type</Label>
                    <Select value={incomeData.city_residence_type} onValueChange={(v) => setIncomeData({ ...incomeData, city_residence_type: v })}>
                      <SelectTrigger className="text-xs rounded-lg h-8 pointer-events-auto">
                        <SelectValue placeholder="Select" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="metro">Metro</SelectItem>
                        <SelectItem value="non-metro">Non-Metro</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              </div>
            )}

            {/* Freelance fields */}
            {incomeData.income_type.includes("freelance") && (
              <div className="space-y-2 p-3 rounded-xl border border-emerald-200 bg-emerald-50/50">
                <p className="text-[10px] font-bold text-emerald-600 uppercase tracking-wider">Freelance Details</p>
                <div className="grid grid-cols-2 gap-2">
                  <div className="space-y-1">
                    <Label className="text-[10px] font-medium text-foreground">Monthly Avg</Label>
                    <Input type="number" placeholder="e.g. 60000" value={incomeData.freelance_monthly_avg}
                      onChange={(e) => setIncomeData({ ...incomeData, freelance_monthly_avg: e.target.value })}
                      onFocus={() => handleFieldFocus("freelance_monthly_avg")}
                      className="text-xs rounded-lg h-8 pointer-events-auto" />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-[10px] font-medium text-foreground">Yearly Target</Label>
                    <Input type="number" placeholder="e.g. 720000" value={incomeData.freelance_yearly_target}
                      onChange={(e) => setIncomeData({ ...incomeData, freelance_yearly_target: e.target.value })}
                      onFocus={() => handleFieldFocus("freelance_yearly_target")}
                      className="text-xs rounded-lg h-8 pointer-events-auto" />
                  </div>
                </div>
              </div>
            )}

            {/* Other income */}
            {(incomeData.income_type.includes("salaried") || incomeData.income_type.includes("freelance")) && (
              <div className="flex items-center gap-3 p-3 rounded-xl border border-violet-200 bg-violet-50/50">
                <div className="min-w-0 flex-1">
                  <p className="text-[10px] font-bold text-violet-600 uppercase tracking-wider mb-1">Other Income (optional)</p>
                  <Input type="number" placeholder="Rentals, dividends..." value={incomeData.monthly_other_income}
                    onChange={(e) => setIncomeData({ ...incomeData, monthly_other_income: e.target.value })}
                    onFocus={() => handleFieldFocus("monthly_other_income")}
                    className="text-xs rounded-lg h-8 pointer-events-auto" />
                </div>
              </div>
            )}
          </div>
        );

      case 1:
        return (
          <div className="space-y-4">
            <p className="text-xs text-muted-foreground">Enter your regular fixed expenses. Leave blank if not applicable.</p>

            {/* Predefined fixed categories */}
            {expenseCategories.map((category, index) => (
              <div key={category.id || `predefined-${index}`} className="p-3 rounded-xl border border-border/40 bg-background/60 space-y-2">
                {/* Row 1: name + frequency toggles */}
                <div className="flex items-center justify-between gap-2">
                  <p className="text-xs font-bold text-foreground">{category.category_name}</p>
                  <div className="flex gap-1 shrink-0">
                    {[["monthly","Mo"],["quarterly","Qtr"],["annually","Yr"]].map(([freq, label]) => (
                      <button
                        key={freq}
                        onClick={() => {
                          const updated = [...expenseCategories];
                          updated[index].frequency = freq;
                          setExpenseCategories(updated);
                        }}
                        className={cn(
                          "text-[10px] font-bold px-2.5 py-1 rounded-lg border transition-colors pointer-events-auto",
                          category.frequency === freq
                            ? "bg-primary text-primary-foreground border-primary"
                            : "bg-background/80 text-muted-foreground border-border/60 hover:border-primary/40"
                        )}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                </div>
                {/* Row 2: amount input full width */}
                <Input
                  type="number"
                  placeholder="Amount (₹)"
                  value={category.amount}
                  className="text-xs rounded-lg h-8 pointer-events-auto"
                  onChange={(e) => {
                    const updated = [...expenseCategories];
                    updated[index].amount = e.target.value;
                    setExpenseCategories(updated);
                  }}
                />
              </div>
            ))}

            {/* Custom expenses */}
            {customExpenses.map((expense, index) => (
              <div key={expense.id || `custom-${index}`} className="p-3 rounded-xl border border-border/40 bg-background/60 space-y-2">
                <div className="flex items-center gap-2">
                  <Input
                    placeholder="Category name"
                    value={expense.category_name}
                    className="text-xs rounded-lg h-8 pointer-events-auto flex-1"
                    onChange={(e) => {
                      const updated = [...customExpenses];
                      updated[index].category_name = e.target.value;
                      setCustomExpenses(updated);
                    }}
                  />
                  <button
                    onClick={() => handleDeleteExpenseCategory(index, true, expense.id)}
                    className="h-8 w-8 flex items-center justify-center rounded-lg text-destructive hover:bg-destructive/10 transition-colors pointer-events-auto shrink-0"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
                <div className="flex items-center gap-2">
                  <Input
                    type="number"
                    placeholder="Amount (₹)"
                    value={expense.amount}
                    className="text-xs rounded-lg h-8 pointer-events-auto flex-1"
                    onChange={(e) => {
                      const updated = [...customExpenses];
                      updated[index].amount = e.target.value;
                      setCustomExpenses(updated);
                    }}
                  />
                  <div className="flex gap-1 shrink-0">
                    {[["monthly","Mo"],["quarterly","Qtr"],["annually","Yr"]].map(([freq, label]) => (
                      <button
                        key={freq}
                        onClick={() => {
                          const updated = [...customExpenses];
                          updated[index].frequency = freq;
                          setCustomExpenses(updated);
                        }}
                        className={cn(
                          "text-[10px] font-bold px-2 py-1 rounded-lg border transition-colors pointer-events-auto",
                          expense.frequency === freq
                            ? "bg-primary text-primary-foreground border-primary"
                            : "bg-background/80 text-muted-foreground border-border/60 hover:border-primary/40"
                        )}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            ))}

            <button
              onClick={() => setCustomExpenses([...customExpenses, { category_name: "", amount: "", frequency: "monthly" }])}
              className="w-full flex items-center justify-center gap-2 h-9 rounded-xl border-2 border-dashed border-border/50 text-xs font-semibold text-muted-foreground hover:border-primary/40 hover:text-primary transition-colors pointer-events-auto"
            >
              <Plus className="h-3.5 w-3.5" /> Add Custom Expense
            </button>
          </div>
        );

      case 2:
        return (
          <div className="space-y-5">
            {/* Investment type grid — 3 columns, fits within modal */}
            <div className="space-y-2">
              <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">Tap to add</p>
              <div className="grid grid-cols-3 gap-1.5">
                {INVESTMENT_OPTIONS.map((option) => (
                  <button
                    key={option.type}
                    onClick={() => handleAddInvestment(option.type, option.name)}
                    className="flex flex-col items-center justify-center gap-0.5 p-2 rounded-xl border border-border/50 bg-background/60 hover:border-primary/50 hover:bg-primary/5 transition-all pointer-events-auto text-center"
                  >
                    <Plus className="h-3 w-3 text-primary" />
                    <span className="text-[10px] font-semibold text-foreground leading-tight">{option.name}</span>
                    <span className="text-[9px] text-muted-foreground">{interestRates[option.type]}</span>
                  </button>
                ))}
              </div>
            </div>

            {/* Added investments */}
            {investments.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-8 rounded-xl border-2 border-dashed border-border/40 text-center">
                <TrendingUp className="h-8 w-8 text-muted-foreground/40 mb-2" />
                <p className="text-xs font-semibold text-muted-foreground">No investments added yet</p>
                <p className="text-[10px] text-muted-foreground/70 mt-0.5">Tap a type above to add</p>
              </div>
            ) : (
              <div className="space-y-3">
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Your investments ({investments.length})</p>
                {investments.map((investment, index) => (
                  <div
                    key={investment.localId}
                    ref={(el) => investmentRefs.current.set(investment.localId, el)}
                    className={cn("p-4 rounded-xl border space-y-3", INVESTMENT_COLORS[index % INVESTMENT_COLORS.length])}
                  >
                    {/* Row 1: name + type + delete */}
                    <div className="flex items-start gap-2">
                      <div className="flex-1 min-w-0">
                        <Input
                          placeholder={`e.g., ${investment.investment_type === 'mutual_funds' ? 'HDFC Flexi Cap' : investment.investment_name}`}
                          value={investment.investment_name}
                          className="text-xs rounded-lg h-8 pointer-events-auto"
                          onChange={(e) => handleUpdateInvestment(investment.localId, 'investment_name', e.target.value)}
                        />
                        <p className="text-[10px] text-muted-foreground mt-1 capitalize">{investment.investment_type.replace(/_/g, ' ')}</p>
                      </div>
                      <button
                        onClick={() => handleDeleteInvestment(investment.localId)}
                        className="h-8 w-8 flex items-center justify-center rounded-lg text-destructive hover:bg-destructive/10 transition-colors pointer-events-auto shrink-0"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>

                    {/* Row 2: amount + risk */}
                    <div className="grid grid-cols-2 gap-2">
                      <div className="space-y-1">
                        <Label className="text-[10px] text-muted-foreground font-semibold">Amount (₹)</Label>
                        <Input
                          type="number"
                          placeholder="0"
                          value={investment.amount}
                          className="text-xs rounded-lg h-8 pointer-events-auto"
                          onChange={(e) => handleUpdateInvestment(investment.localId, 'amount', e.target.value)}
                        />
                      </div>
                      <div className="space-y-1">
                        <Label className="text-[10px] text-muted-foreground font-semibold">Risk Level</Label>
                        <Select value={investment.risk_level} onValueChange={(v) => handleUpdateInvestment(investment.localId, 'risk_level', v)}>
                          <SelectTrigger className="text-xs rounded-lg h-8 pointer-events-auto">
                            <SelectValue placeholder="Risk" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="low">Low</SelectItem>
                            <SelectItem value="medium">Medium</SelectItem>
                            <SelectItem value="high">High</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                    </div>

                    {/* Row 3: interest rate inline */}
                    <div className="flex items-center gap-2">
                      <Label className="text-[10px] text-muted-foreground font-semibold shrink-0">Interest Rate</Label>
                      {investment.isEditingInterestRate ? (
                        <>
                          <Input
                            type="number"
                            value={investment.interest_rate}
                            onChange={(e) => handleUpdateInvestment(investment.localId, 'interest_rate', e.target.value)}
                            className="text-xs rounded-lg h-7 pointer-events-auto w-20"
                            step="0.1" min="0" max="100"
                          />
                          <button onClick={() => handleSaveInterestRate(investment.localId)}
                            className="h-7 w-7 flex items-center justify-center rounded-lg bg-primary text-white pointer-events-auto">
                            <Save className="h-3 w-3" />
                          </button>
                          <button onClick={() => handleCancelInterestRateEdit(investment.localId)}
                            className="h-7 w-7 flex items-center justify-center rounded-lg border border-border pointer-events-auto">
                            <X className="h-3 w-3" />
                          </button>
                        </>
                      ) : (
                        <>
                          <span className="text-xs font-bold text-primary bg-primary/10 px-2.5 py-1 rounded-lg">
                            {investment.interest_rate}%
                          </span>
                          <button onClick={() => handleEditInterestRate(investment.localId)}
                            className="h-6 w-6 flex items-center justify-center rounded-md hover:bg-primary/10 transition-colors pointer-events-auto">
                            <Pencil className="h-3 w-3 text-muted-foreground" />
                          </button>
                          <span className="text-[10px] text-muted-foreground">avg. annual</span>
                        </>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        );

      default:
        return null;
    }
  };

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent
        className="max-w-lg max-h-[88vh] overflow-y-auto rounded-2xl border-0 shadow-2xl bg-gradient-to-br from-background to-muted/20 pointer-events-auto"
        onInteractOutside={(e) => e.preventDefault()}
      >
        {/* ── Header ─────────────────────────────────────────────────── */}
        {!showCelebration && (
          <DialogHeader className="space-y-4 pb-2">
            {/* Step counter only — X button handles close, back goes below stepper */}
            <div className="flex items-center">
              <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">
                Step {currentStep + 1} of {STEPS.length}
              </span>
            </div>

            <DialogTitle className="text-xl font-black gradient-text leading-tight">
              {currentStepData.title}
            </DialogTitle>
            <p className="text-xs text-muted-foreground -mt-2">{currentStepData.description}</p>

            {/* Connected stepper */}
            <div className="flex items-center w-full mt-2">
              {STEPS.map((step, index) => {
                const Icon = step.icon;
                const isCompleted = index < currentStep;
                const isActive = index === currentStep;
                return (
                  <React.Fragment key={step.id}>
                    <div className="flex flex-col items-center">
                      <div className={cn(
                        "h-9 w-9 rounded-full flex items-center justify-center transition-all duration-300 border-2",
                        isCompleted
                          ? "bg-primary border-primary text-primary-foreground"
                          : isActive
                          ? "bg-primary/10 border-primary text-primary scale-110 shadow-md"
                          : "bg-muted/50 border-border/40 text-muted-foreground"
                      )}>
                        {isCompleted
                          ? <CheckCircle2 className="h-4 w-4" />
                          : <Icon className="h-4 w-4" />
                        }
                      </div>
                      <span className={cn(
                        "text-[10px] mt-1 font-semibold transition-colors",
                        isActive ? "text-primary" : isCompleted ? "text-foreground" : "text-muted-foreground"
                      )}>
                        {step.label}
                      </span>
                    </div>
                    {index < STEPS.length - 1 && (
                      <div className={cn(
                        "flex-1 h-0.5 mx-2 mb-4 rounded-full transition-all duration-500",
                        index < currentStep ? "bg-primary" : "bg-border/40"
                      )} />
                    )}
                  </React.Fragment>
                );
              })}
            </div>

            {/* Back link — below stepper, left aligned, clear of X button */}
            {currentStep > 0 && (
              <button
                onClick={() => setCurrentStep(Math.max(0, currentStep - 1))}
                className="flex items-center gap-1 text-[11px] text-muted-foreground hover:text-primary transition-colors pointer-events-auto w-fit"
              >
                <ChevronRight className="h-3 w-3 rotate-180" />
                Back to {STEPS[currentStep - 1].label}
              </button>
            )}
          </DialogHeader>
        )}

        {/* ── Content ─────────────────────────────────────────────────── */}
        <div className="py-4 px-1">
          {dataLoading ? (
            <div className="space-y-3 py-4">
              <div className="h-16 bg-muted rounded-xl animate-pulse" />
              <div className="h-12 bg-muted rounded-xl animate-pulse" />
              <div className="h-12 bg-muted rounded-xl animate-pulse" />
            </div>
          ) : (
            renderStepContent()
          )}
        </div>

        {/* ── Footer ─────────────────────────────────────────────────── */}
        {!showCelebration && (
          <div className="flex items-center justify-between pt-4 border-t border-border/40 gap-3">
            {/* Skip option for steps 2 & 3 */}
            {currentStep > 0 ? (
              <button
                onClick={() => {
                  if (currentStep < STEPS.length - 1) {
                    setCurrentStep(currentStep + 1);
                  } else {
                    onComplete();
                  }
                }}
                className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1 transition-colors pointer-events-auto"
              >
                <SkipForward className="h-3 w-3" />
                Skip for now
              </button>
            ) : (
              <div /> /* spacer */
            )}

            <Button
              onClick={handleNext}
              disabled={loading}
              className="rounded-xl px-6 h-10 bg-gradient-to-r from-primary to-primary/90 hover:opacity-90 transition-all shadow-md pointer-events-auto font-semibold"
            >
              {loading
                ? "Saving..."
                : currentStep === STEPS.length - 1
                ? "Save & Finish"
                : "Save & Continue"}
              {!loading && <ChevronRight className="h-4 w-4 ml-1" />}
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
};
