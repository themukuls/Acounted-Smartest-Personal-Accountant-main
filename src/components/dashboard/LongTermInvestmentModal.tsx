import { useState, useEffect, useRef } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Pencil, Save, X, TrendingUp, PieChart, Clock, Lightbulb, Plus, Trash2, ArrowLeft } from "lucide-react";
import { formatFullINR, formatCompactINR } from "@/lib/currency";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import InvestmentDiversificationChart from "./InvestmentDiversificationChart";
import InvestmentInsightsDialog from "./InvestmentInsightsDialog";
import { useInvestmentSummary } from "@/hooks/useInvestmentSummary";
import { saveInvestmentType, deleteInvestmentType } from "@/integrations/indexeddb/services/onboardingService"; // Import deleteInvestmentType
import { v4 as uuidv4 } from 'uuid'; // Import uuid for local IDs
import { cn } from "@/lib/utils"; // Import cn for conditional class names

interface Investment {
  id: string;
  investment_name: string;
  amount: number;
  investment_type: string;
  risk_level: string;
  interest_rate: number;
}

interface InvestmentEntry {
  localId: string; // Unique ID for local state management (can be DB ID if existing)
  investment_name: string;
  investment_type: string;
  amount: string;
  risk_level: string;
  interest_rate: string; // Stored as string for input binding
  isEditingInterestRate?: boolean; // To manage local editing state
}

interface LongTermInvestmentModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onboardingCompleted: boolean;
}

const interestRatesMap: Record<string, string> = { // Renamed to avoid conflict with local state
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

// Investment options for cards (copied from OnboardingModal)
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

// Define a set of colors for investment input boxes (copied from OnboardingModal)
const INVESTMENT_COLORS = [
  "bg-blue-500/10 border-blue-500/20",
  "bg-green-500/10 border-green-500/20",
  "bg-purple-500/10 border-purple-500/20",
  "bg-yellow-500/10 border-yellow-500/20",
  "bg-red-500/10 border-red-500/20",
];

const DIVERSIFICATION_COLORS: Record<string, string> = {
  'Savings': '#8884d8',
  'Equity': '#82ca9d',
  'Fixed Deposit': '#ffc658',
  'Debt': '#ff7300',
  'Gold': '#0088FE',
  'Real Estate': '#00C49F',
  'Other': '#FFBB28',
};

export const LongTermInvestmentModal = ({ open, onOpenChange, onboardingCompleted }: LongTermInvestmentModalProps) => {
  const { user } = useAuth();
  const { toast } = useToast();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editAmount, setEditAmount] = useState("");
  const [editInterestRate, setEditInterestRate] = useState("");
  const [projectionYears, setProjectionYears] = useState(5);
  const [showInsightsDialog, setShowInsightsDialog] = useState(false);
  const [showAddInvestmentForm, setShowAddInvestmentForm] = useState(false); // New state for add form

  // Refs for scrolling to new investment entries
  const investmentRefs = useRef<Map<string, HTMLDivElement | null>>(new Map());

  const {
    loading,
    investments: existingInvestments, // Renamed to avoid conflict with local state
    totalCurrentValue,
    totalMonthlyGrowth,
    averageAnnualInterestRate,
    diversificationData,
    diversificationCount,
    userRiskAppetite,
    refreshSummary,
  } = useInvestmentSummary(onboardingCompleted);

  useEffect(() => {
    if (open) {
      setShowInsightsDialog(false); // Explicitly ensure insights dialog is closed when main modal opens
      if (onboardingCompleted) {
        refreshSummary();
      }
      // Reset add form visibility when modal opens/closes
      setShowAddInvestmentForm(false);
    }
  }, [open, onboardingCompleted, refreshSummary]);

  // Helper to get default numeric interest rate from string range (copied from OnboardingModal)
  const getDefaultNumericInterestRate = (type: string): string => {
    const rateString = interestRatesMap[type] || interestRatesMap['other'];
    const matches = rateString.match(/(\d+(\.\d+)?)-(\d+(\.\d+)?)%/);
    if (matches && matches.length >= 5) {
      const lower = parseFloat(matches[1]);
      const upper = parseFloat(matches[3]);
      return ((lower + upper) / 2).toFixed(1); // Average of the range, formatted as string
    }
    return parseFloat(rateString).toFixed(1) || "7.0"; // Fallback to single number or default, formatted as string
  };

  const calculateMonthlyGrowth = (amount: number, interestRate: number) => {
    const monthlyRate = interestRate / 12 / 100;
    return amount * monthlyRate;
  };

  const calculateFutureValue = (initialAmount: number, annualRate: number, years: number) => {
    if (years <= 0) return initialAmount;
    const rate = annualRate / 100;
    return initialAmount * Math.pow(1 + rate, years);
  };

  const handleEdit = (investment: Investment) => {
    setEditingId(investment.id);
    setEditAmount(investment.amount.toString());
    setEditInterestRate(investment.interest_rate.toString());
  };

  const handleSave = async (investmentId: string) => {
    if (!user) {
      toast({
        title: "Error",
        description: "User not authenticated.",
        variant: "destructive",
      });
      return;
    }

    try {
      const newAmount = parseFloat(editAmount);
      const newInterestRate = parseFloat(editInterestRate);
      
      if (isNaN(newAmount) || newAmount < 0) {
        toast({
          title: "Error",
          description: "Please enter a valid amount",
          variant: "destructive",
        });
        return;
      }

      if (isNaN(newInterestRate) || newInterestRate < 0 || newInterestRate > 100) {
        toast({
          title: "Error",
          description: "Please enter a valid interest rate (0-100%)",
          variant: "destructive",
        });
        return;
      }

      // Use IndexedDB service to update investment
      await saveInvestmentType(user.id, {
        id: investmentId,
        amount: newAmount,
        interest_rate: newInterestRate,
      });

      refreshSummary();

      setEditingId(null);
      toast({
        title: "Success",
        description: "Investment updated successfully",
      });
    } catch (error) {
      console.error('Error updating investment:', error);
      toast({
        title: "Error",
        description: "Failed to update investment",
        variant: "destructive",
      });
    }
  };

  const handleCancel = () => {
    setEditingId(null);
    setEditAmount("");
    setEditInterestRate("");
  };
  
  const projectedFutureValue = calculateFutureValue(totalCurrentValue, averageAnnualInterestRate, projectionYears);
  const inflationRate = 0.06;
  const inflationAdjustedFutureValue = calculateFutureValue(totalCurrentValue, averageAnnualInterestRate - (averageAnnualInterestRate * inflationRate), projectionYears);

  // --- New Investment Form Logic (adapted from OnboardingModal) ---
  const [newInvestments, setNewInvestments] = useState<InvestmentEntry[]>([]); // Local state for new entries

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
    setNewInvestments(prev => [...prev, newInvestment]);

    // Scroll to the new item after it's rendered
    setTimeout(() => {
      const element = investmentRefs.current.get(newInvestmentId);
      if (element) {
        element.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    }, 100); // Small delay to ensure DOM update
  };

  const handleUpdateNewInvestment = (localId: string, field: keyof InvestmentEntry, value: string) => {
    setNewInvestments(prev =>
      prev.map(inv => (inv.localId === localId ? { ...inv, [field]: value } : inv))
    );
  };

  const handleDeleteNewInvestment = (localId: string) => {
    setNewInvestments(prev => prev.filter(inv => inv.localId !== localId));
  };

  const handleEditNewInterestRate = (localId: string) => {
    setNewInvestments(prev =>
      prev.map(inv => (inv.localId === localId ? { ...inv, isEditingInterestRate: true } : inv))
    );
  };

  const handleSaveNewInterestRate = (localId: string) => {
    setNewInvestments(prev =>
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

  const handleCancelNewInterestRateEdit = (localId: string) => {
    setNewInvestments(prev =>
      prev.map(inv => {
        if (inv.localId === localId) {
          const originalRate = inv.interest_rate;
          return { ...inv, interest_rate: originalRate, isEditingInterestRate: false };
        }
        return inv;
      })
    );
  };

  const handleSaveAllNewInvestments = async () => {
    if (!user) {
      toast({ title: "Error", description: "User not authenticated.", variant: "destructive" });
      return;
    }

    const validNewInvestments = newInvestments.filter(inv => inv.amount && inv.investment_name);

    if (validNewInvestments.length === 0) {
      toast({ title: "No investments to add", description: "Please add at least one investment.", variant: "default" });
      return;
    }

    try {
      const savePromises = validNewInvestments.map(inv => {
        const parsedAmount = parseFloat(inv.amount);
        const parsedInterestRate = parseFloat(inv.interest_rate);

        if (isNaN(parsedAmount) || parsedAmount < 0 || isNaN(parsedInterestRate) || parsedInterestRate < 0 || parsedInterestRate > 100) {
          console.warn(`Skipping invalid investment: ${inv.investment_name}`);
          return Promise.resolve(null); // Skip invalid entries
        }

        return saveInvestmentType(user.id, {
          investment_name: inv.investment_name,
          investment_type: inv.investment_type,
          amount: parsedAmount,
          risk_level: inv.risk_level,
          interest_rate: parsedInterestRate,
        });
      });

      await Promise.all(savePromises);
      toast({ title: "Success", description: "Investments added successfully!" });
      setNewInvestments([]); // Clear new investments form
      setShowAddInvestmentForm(false); // Go back to summary view
      refreshSummary(); // Refresh the main investment summary
    } catch (error) {
      console.error("Error saving new investments:", error);
      toast({ title: "Error", description: "Failed to add investments.", variant: "destructive" });
    }
  };

  // --- End New Investment Form Logic ---

  if (open && !onboardingCompleted) {
    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="glass-card border-glass max-w-2xl pointer-events-auto">
          <DialogHeader className="pb-3 border-b border-border/40">
            <div className="flex items-center gap-3">
              <div className="h-9 w-9 rounded-xl bg-emerald-100 flex items-center justify-center shrink-0">
                <TrendingUp className="h-4 w-4 text-emerald-600" />
              </div>
              <DialogTitle className="text-base font-bold gradient-text">Long Term Investment Portfolio</DialogTitle>
            </div>
          </DialogHeader>
          <div className="text-center py-10 space-y-3">
            <p className="text-sm font-semibold text-foreground">Complete onboarding first</p>
            <p className="text-xs text-muted-foreground">Set up your financial profile to start tracking investments.</p>
          </div>
        </DialogContent>
      </Dialog>
    );
  }

  if (loading) {
    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="glass-card border-glass max-w-2xl pointer-events-auto">
          <div className="space-y-4 py-6">
            <div className="h-20 bg-muted rounded-xl animate-pulse" />
            <div className="h-8 bg-muted rounded-xl animate-pulse" />
            <div className="h-48 bg-muted rounded-xl animate-pulse" />
            <div className="h-32 bg-muted rounded-xl animate-pulse" />
          </div>
        </DialogContent>
      </Dialog>
    );
  }

  // Portfolio weight per investment
  const getWeight = (amount: number) =>
    totalCurrentValue > 0 ? ((amount / totalCurrentValue) * 100).toFixed(1) : '0';

  const riskColors: Record<string, string> = {
    low: 'text-emerald-600 bg-emerald-50 border-emerald-200',
    medium: 'text-amber-600 bg-amber-50 border-amber-200',
    high: 'text-red-600 bg-red-50 border-red-200',
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="glass-card border-glass max-w-2xl max-h-[90vh] overflow-y-auto pointer-events-auto">

        {/* ── Header ─────────────────────────────────────────────────── */}
        <DialogHeader className="pb-3 border-b border-border/40">
          <div className="flex items-center gap-3">
            <div className="h-9 w-9 rounded-xl bg-emerald-100 flex items-center justify-center shrink-0">
              <TrendingUp className="h-4 w-4 text-emerald-600" />
            </div>
            <div>
              <DialogTitle className="text-base font-bold gradient-text leading-tight">
                Long Term Investment Portfolio
              </DialogTitle>
              <p className="text-xs text-muted-foreground mt-0.5">
                {existingInvestments.length} investment{existingInvestments.length !== 1 ? 's' : ''} tracked
              </p>
            </div>
          </div>
        </DialogHeader>

        {existingInvestments.length === 0 && !showAddInvestmentForm ? (
          <div className="text-center py-10 space-y-4">
            <div className="h-14 w-14 rounded-2xl bg-emerald-50 flex items-center justify-center mx-auto">
              <TrendingUp className="h-7 w-7 text-emerald-400" />
            </div>
            <div>
              <p className="text-sm font-semibold text-foreground">No investments yet</p>
              <p className="text-xs text-muted-foreground mt-1">Add your first investment to start tracking your portfolio</p>
            </div>
            <Button onClick={() => setShowAddInvestmentForm(true)} className="pointer-events-auto rounded-xl">
              <Plus className="h-4 w-4 mr-2" /> Add Investment
            </Button>
          </div>

        ) : showAddInvestmentForm ? (
          /* ── Add Investment Form ───────────────────────────────────── */
          <div className="space-y-6 py-4">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-bold text-foreground flex items-center gap-2">
                <Plus className="h-4 w-4 text-primary" /> Add New Investments
              </h3>
              <Button variant="outline" size="sm" onClick={() => {
                setShowAddInvestmentForm(false);
                setNewInvestments([]);
              }} className="pointer-events-auto rounded-xl text-xs h-7">
                <ArrowLeft className="h-3 w-3 mr-1" /> Back
              </Button>
            </div>

            {/* Investment type grid */}
            <div className="space-y-3">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Select type to add</p>
              <div className="grid grid-cols-3 gap-2">
                {INVESTMENT_OPTIONS.map((option) => (
                  <button
                    key={option.type}
                    onClick={() => handleAddInvestment(option.type, option.name)}
                    className="flex flex-col items-center justify-center p-3 rounded-xl border border-border/50 bg-background/60 hover:border-primary/50 hover:bg-primary/5 transition-all pointer-events-auto text-center"
                  >
                    <Plus className="h-3.5 w-3.5 text-primary mb-1" />
                    <p className="text-[10px] font-semibold text-foreground leading-tight">{option.name}</p>
                    <p className="text-[9px] text-muted-foreground mt-0.5">{interestRatesMap[option.type]}</p>
                  </button>
                ))}
              </div>
            </div>

            {/* Pending new investments */}
            {newInvestments.length > 0 && (
              <div className="space-y-3">
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">To be added</p>
                {newInvestments.map((investment, index) => (
                  <div
                    key={investment.localId}
                    ref={(el) => investmentRefs.current.set(investment.localId, el)}
                    className={cn("space-y-3 p-4 rounded-xl border", INVESTMENT_COLORS[index % INVESTMENT_COLORS.length])}
                  >
                    <div className="flex justify-between items-center">
                      <div className="flex-1 mr-2">
                        <Input
                          placeholder={`e.g., ${investment.investment_type === 'mutual_funds' ? 'HDFC Flexi Cap' : investment.investment_name}`}
                          value={investment.investment_name}
                          className="text-xs rounded-lg h-8 pointer-events-auto"
                          onChange={(e) => handleUpdateNewInvestment(investment.localId, 'investment_name', e.target.value)}
                        />
                        <p className="text-[10px] text-muted-foreground mt-1 capitalize">{investment.investment_type.replace(/_/g, ' ')}</p>
                      </div>
                      <Button variant="ghost" size="sm" onClick={() => handleDeleteNewInvestment(investment.localId)}
                        className="h-6 w-6 p-0 text-destructive pointer-events-auto">
                        <Trash2 className="h-3 w-3" />
                      </Button>
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div className="space-y-1">
                        <Label className="text-[10px] text-muted-foreground">Amount (₹)</Label>
                        <Input type="number" placeholder="Enter amount" value={investment.amount}
                          className="text-xs rounded-lg h-8 pointer-events-auto"
                          onChange={(e) => handleUpdateNewInvestment(investment.localId, 'amount', e.target.value)} />
                      </div>
                      <div className="space-y-1">
                        <Label className="text-[10px] text-muted-foreground">Risk Level</Label>
                        <Select value={investment.risk_level}
                          onValueChange={(v) => handleUpdateNewInvestment(investment.localId, 'risk_level', v)}>
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
                    <div className="space-y-1">
                      <Label className="text-[10px] text-muted-foreground">Interest Rate</Label>
                      <div className="flex items-center gap-2">
                        {investment.isEditingInterestRate ? (
                          <>
                            <Input type="number" value={investment.interest_rate} step="0.1" min="0" max="100"
                              onChange={(e) => handleUpdateNewInvestment(investment.localId, 'interest_rate', e.target.value)}
                              className="text-xs rounded-lg h-8 pointer-events-auto flex-1" />
                            <Button size="sm" onClick={() => handleSaveNewInterestRate(investment.localId)}
                              className="h-7 w-7 p-0 pointer-events-auto"><Save className="h-3.5 w-3.5" /></Button>
                            <Button size="sm" variant="outline" onClick={() => handleCancelNewInterestRateEdit(investment.localId)}
                              className="h-7 w-7 p-0 pointer-events-auto"><X className="h-3.5 w-3.5" /></Button>
                          </>
                        ) : (
                          <>
                            <div className="text-xs font-semibold text-primary bg-primary/10 px-3 py-1.5 rounded-lg flex-1 text-center">
                              {investment.interest_rate}%
                            </div>
                            <Button size="sm" variant="ghost" onClick={() => handleEditNewInterestRate(investment.localId)}
                              className="h-7 w-7 p-0 pointer-events-auto"><Pencil className="h-3.5 w-3.5" /></Button>
                          </>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
                <Button onClick={handleSaveAllNewInvestments} className="w-full pointer-events-auto rounded-xl">
                  Save All New Investments
                </Button>
              </div>
            )}
          </div>

        ) : (
          /* ── Main Portfolio View ───────────────────────────────────── */
          <div className="space-y-5 py-4">

            {/* Hero summary */}
            <div className="rounded-xl border border-border/40 bg-gradient-to-br from-emerald-50 to-background p-4 space-y-3">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-xs text-muted-foreground">Total Portfolio Value</p>
                  <p className="text-3xl font-black gradient-text mt-0.5">{formatFullINR(totalCurrentValue)}</p>
                </div>
                <div className="text-right">
                  <p className="text-xs text-muted-foreground">Monthly Growth</p>
                  <p className="text-lg font-black text-emerald-600 mt-0.5">+{formatCompactINR(totalMonthlyGrowth)}</p>
                </div>
              </div>
              <div className="flex items-center gap-3 pt-2 border-t border-border/30">
                <div className="flex-1 text-center">
                  <p className="text-[10px] text-muted-foreground">Avg. Return</p>
                  <p className="text-sm font-bold text-foreground">{averageAnnualInterestRate.toFixed(1)}% p.a.</p>
                </div>
                <div className="w-px h-6 bg-border/50" />
                <div className="flex-1 text-center">
                  <p className="text-[10px] text-muted-foreground">Risk Profile</p>
                  <p className={cn("text-sm font-bold capitalize", userRiskAppetite === 'aggressive' ? 'text-red-500' : userRiskAppetite === 'moderate' ? 'text-amber-500' : 'text-emerald-500')}>
                    {userRiskAppetite || 'Moderate'}
                  </p>
                </div>
                <div className="w-px h-6 bg-border/50" />
                <div className="flex-1 text-center">
                  <p className="text-[10px] text-muted-foreground">Investments</p>
                  <p className="text-sm font-bold text-foreground">{existingInvestments.length}</p>
                </div>
              </div>
            </div>

            {/* Action row */}
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" onClick={() => setShowAddInvestmentForm(true)}
                className="flex-1 rounded-xl pointer-events-auto text-xs h-8">
                <Plus className="h-3.5 w-3.5 mr-1.5" /> Add Investment
              </Button>
              <Button size="sm" onClick={() => setShowInsightsDialog(true)}
                className="flex-1 bg-gradient-primary text-primary-foreground rounded-xl pointer-events-auto text-xs h-8">
                <Lightbulb className="h-3.5 w-3.5 mr-1.5" /> Insights
              </Button>
            </div>

            {/* Portfolio Diversification */}
            <div className="rounded-xl border border-border/40 bg-background/60 p-4 space-y-3">
              <div className="flex items-center gap-2">
                <PieChart className="h-4 w-4 text-primary" />
                <h3 className="text-sm font-bold text-foreground">Portfolio Diversification</h3>
                <span className="ml-auto text-[10px] text-muted-foreground font-medium">
                  {diversificationCount} asset class{diversificationCount !== 1 ? 'es' : ''}
                </span>
              </div>
              <InvestmentDiversificationChart data={diversificationData} totalValue={totalCurrentValue} />
            </div>

            {/* Future Value Projection */}
            <div className="rounded-xl border border-border/40 bg-background/60 p-4 space-y-3">
              <div className="flex items-center gap-2">
                <Clock className="h-4 w-4 text-secondary" />
                <h3 className="text-sm font-bold text-foreground">Future Value Projection</h3>
              </div>

              {/* Year pill toggles */}
              <div className="flex gap-1.5 flex-wrap">
                {[1, 3, 5, 10, 20].map(yr => (
                  <button
                    key={yr}
                    onClick={() => setProjectionYears(yr)}
                    className={cn(
                      "px-3 py-1 rounded-full text-xs font-semibold border transition-all pointer-events-auto",
                      projectionYears === yr
                        ? "bg-primary text-primary-foreground border-primary"
                        : "bg-background/60 border-border/60 text-muted-foreground hover:border-primary/40"
                    )}
                  >
                    {yr}y
                  </button>
                ))}
              </div>

              {/* Two hero numbers */}
              <div className="grid grid-cols-2 gap-3">
                <div className="rounded-xl bg-primary/5 border border-primary/15 p-3">
                  <p className="text-[10px] text-muted-foreground">Projected in {projectionYears}yr{projectionYears > 1 ? 's' : ''}</p>
                  <p className="text-xl font-black text-primary mt-0.5">{formatCompactINR(projectedFutureValue)}</p>
                  <p className="text-[10px] text-muted-foreground">at {averageAnnualInterestRate.toFixed(1)}% p.a.</p>
                </div>
                <div className="rounded-xl bg-emerald-50 border border-emerald-200 p-3">
                  <p className="text-[10px] text-muted-foreground">Inflation-adjusted</p>
                  <p className="text-xl font-black text-emerald-600 mt-0.5">{formatCompactINR(inflationAdjustedFutureValue)}</p>
                  <p className="text-[10px] text-muted-foreground">real purchasing power</p>
                </div>
              </div>
              <p className="text-[10px] text-muted-foreground">Assumes {averageAnnualInterestRate.toFixed(1)}% return · 6% inflation</p>
            </div>

            {/* Investment Breakdown */}
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <TrendingUp className="h-4 w-4 text-primary" />
                <h3 className="text-sm font-bold text-foreground">Investment Breakdown</h3>
              </div>

              {existingInvestments.map((investment, index) => {
                const monthlyGrowth = calculateMonthlyGrowth(investment.amount, investment.interest_rate);
                const weight = parseFloat(getWeight(investment.amount));
                const riskStyle = riskColors[investment.risk_level] || riskColors.medium;

                return (
                  <div
                    key={investment.id}
                    className={cn("rounded-xl border p-4 space-y-3", INVESTMENT_COLORS[index % INVESTMENT_COLORS.length])}
                  >
                    {/* Top row: name + rate badge + edit */}
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <h4 className="text-sm font-bold text-foreground truncate">{investment.investment_name}</h4>
                          <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-primary/10 text-primary font-semibold shrink-0">
                            {investment.interest_rate}% p.a.
                          </span>
                        </div>
                        <div className="flex items-center gap-2 mt-0.5">
                          <p className="text-[10px] text-muted-foreground capitalize">
                            {investment.investment_type.replace(/_/g, ' ')}
                          </p>
                          <span className={cn("text-[10px] px-1.5 py-0.5 rounded-full border font-semibold capitalize", riskStyle)}>
                            {investment.risk_level} risk
                          </span>
                        </div>
                      </div>
                      {editingId !== investment.id && (
                        <Button variant="ghost" size="sm" onClick={() => handleEdit(investment)}
                          className="h-7 w-7 p-0 hover:bg-primary/10 pointer-events-auto shrink-0">
                          <Pencil className="h-3.5 w-3.5" />
                        </Button>
                      )}
                    </div>

                    {editingId === investment.id ? (
                      <div className="space-y-2">
                        <div className="grid grid-cols-2 gap-2">
                          <div className="space-y-1">
                            <Label className="text-[10px] text-muted-foreground">Amount (₹)</Label>
                            <Input type="number" value={editAmount} onChange={(e) => setEditAmount(e.target.value)}
                              className="h-8 text-xs pointer-events-auto rounded-lg" placeholder="Amount" />
                          </div>
                          <div className="space-y-1">
                            <Label className="text-[10px] text-muted-foreground">Interest %</Label>
                            <Input type="number" value={editInterestRate} onChange={(e) => setEditInterestRate(e.target.value)}
                              className="h-8 text-xs pointer-events-auto rounded-lg" placeholder="Rate" step="0.1" min="0" max="100" />
                          </div>
                        </div>
                        <div className="flex gap-2">
                          <Button size="sm" onClick={() => handleSave(investment.id)}
                            className="flex-1 h-8 pointer-events-auto rounded-xl text-xs">
                            <Save className="h-3 w-3 mr-1" /> Save
                          </Button>
                          <Button size="sm" variant="outline" onClick={handleCancel}
                            className="flex-1 h-8 pointer-events-auto rounded-xl text-xs">
                            <X className="h-3 w-3 mr-1" /> Cancel
                          </Button>
                        </div>
                      </div>
                    ) : (
                      <>
                        {/* Amount + growth */}
                        <div className="flex items-center justify-between">
                          <div>
                            <p className="text-[10px] text-muted-foreground">Current Value</p>
                            <p className="text-base font-black text-foreground">{formatFullINR(investment.amount)}</p>
                          </div>
                          <div className="text-right">
                            <p className="text-[10px] text-muted-foreground">Monthly Growth</p>
                            <p className="text-sm font-bold text-emerald-600">+{formatCompactINR(monthlyGrowth)}</p>
                          </div>
                        </div>
                        {/* Portfolio weight bar */}
                        <div className="space-y-1">
                          <div className="flex items-center justify-between text-[10px] text-muted-foreground">
                            <span>Portfolio weight</span>
                            <span className="font-semibold text-foreground">{weight}%</span>
                          </div>
                          <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                            <div
                              className="h-full rounded-full bg-primary/60 transition-all duration-500"
                              style={{ width: `${Math.min(weight, 100)}%` }}
                            />
                          </div>
                        </div>
                      </>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </DialogContent>

      <InvestmentInsightsDialog
        open={showInsightsDialog}
        onOpenChange={setShowInsightsDialog}
        totalCurrentValue={totalCurrentValue}
        averageAnnualInterestRate={averageAnnualInterestRate}
        investmentsCount={existingInvestments.length}
        diversificationCount={diversificationData.length}
        investments={existingInvestments}
        riskAppetite={userRiskAppetite}
      />
    </Dialog>
  );
};
