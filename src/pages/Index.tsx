import { useAuth } from "@/contexts/AuthContext";
import Landing from "./Landing";
import { AppLayout } from "@/components/layout/AppLayout";
import { WelcomeHeader } from "@/components/dashboard/WelcomeHeader";
import { GlassCard } from "@/components/ui/glass-card";
import { formatCompactINR, formatFullINR } from "@/lib/currency";
import { useNavigate } from "react-router-dom";
import { useState, useEffect, useRef } from "react";
import { OnboardingModal } from "@/components/onboarding/OnboardingModal";
import { LongTermInvestmentModal } from "@/components/dashboard/LongTermInvestmentModal";
import { SavingsGoalModal } from "@/components/dashboard/SavingsGoalModal";
import { SavingsGoalProgress } from "@/components/dashboard/SavingsGoalProgress";
import { MonthlyBudgetTracker } from "@/components/dashboard/MonthlyBudgetTracker";
import { RecentActivity } from "@/components/dashboard/RecentActivity";
import { QuickActionsCard } from "@/components/dashboard/QuickActionsCard";
import { useIsMobile } from "@/hooks/use-mobile";
import { Button } from "@/components/ui/button";
import { Lightbulb, Target, TrendingUp, Eye, EyeOff } from "lucide-react";
import { useInvestmentSummary } from "@/hooks/useInvestmentSummary";
import { PWAInstallHandler } from "@/components/pwa/PWAInstallHandler";
import { TransactionFormDialog } from "@/components/transactions/TransactionFormDialog";
import { saveTransaction } from "@/integrations/indexeddb/services/dataService";
import DOMPurify from "dompurify";
import { useToast } from "@/hooks/use-toast";
import { useQueryClient } from "@tanstack/react-query";
import { motion, AnimatePresence, useSpring, useTransform } from "framer-motion";
import { useScrambleNumber } from "@/hooks/useScrambleNumber";

// ── Spring config presets ─────────────────────────────────────────────────────
const SPRING_CARD   = { type: "spring", stiffness: 280, damping: 28, mass: 0.8 } as const;
const SPRING_GENTLE = { type: "spring", stiffness: 180, damping: 24, mass: 1   } as const;

// ── Staggered card entrance ───────────────────────────────────────────────────
const CardEnter = ({
  children,
  delay = 0,
  className,
}: {
  children: React.ReactNode;
  delay?: number;
  className?: string;
}) => (
  <motion.div
    className={className}
    initial={{ opacity: 0, y: 22, scale: 0.97 }}
    animate={{ opacity: 1, y: 0,  scale: 1    }}
    transition={{ ...SPRING_CARD, delay }}
  >
    {children}
  </motion.div>
);

// ── Greeting strip ────────────────────────────────────────────────────────────
const GreetingStrip = ({ name }: { name: string }) => {
  const h     = new Date().getHours();
  const month = new Date().toLocaleString("default", { month: "long" });
  const g =
    h < 5  ? { hi: `Up late${name ? `, ${name}` : ""}?`,        sub: "Your money never sleeps either 🌙" } :
    h < 12 ? { hi: `Good morning${name ? `, ${name}` : ""} ☀️`, sub: `Let's see how ${month} is shaping up.` } :
    h < 17 ? { hi: `Hey${name ? ` ${name}` : ""} 👋`,           sub: "Here's where things stand today." } :
    h < 21 ? { hi: `Good evening${name ? `, ${name}` : ""} 🌆`, sub: "Your dashboard is ready for you." } :
             { hi: `Night owl${name ? `, ${name}` : ""}? 🦉`,    sub: "Everything's safe. Here's your overview." };

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0  }}
      transition={{ ...SPRING_GENTLE, delay: 0.05 }}
      className="flex flex-col gap-0.5"
    >
      <h1 className="text-xl font-bold text-foreground tracking-tight">{g.hi}</h1>
      <motion.p
        className="text-sm text-muted-foreground"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.22, duration: 0.4 }}
      >
        {g.sub}
      </motion.p>
    </motion.div>
  );
};

// ── Investment hero card ──────────────────────────────────────────────────────
// Revolut-style scramble reveal when eye is tapped.
// Subtle shimmer passes over the number while scrambling.
const InvestmentCard = ({
  totalCurrentValue,
  totalMonthlyGrowth,
  onboardingCompleted,
  onInsightsClick,
  mobile = false,
}: {
  totalCurrentValue: number;
  totalMonthlyGrowth: number;
  onboardingCompleted: boolean;
  onInsightsClick: () => void;
  mobile?: boolean;
}) => {
  const [revealed, setReveal] = useState(false);
  const { display, isScrambling } = useScrambleNumber(totalCurrentValue, revealed, 1100);

  const monthlyGrowthPct = totalCurrentValue > 0
    ? (totalMonthlyGrowth / totalCurrentValue * 100).toFixed(1)
    : "0.0";

  const nudge = !revealed
    ? "Tap the eye to reveal your portfolio."
    : totalCurrentValue > 0
    ? "Growing steadily — keep it going."
    : "Add your first investment to start tracking growth.";

  const nudgeColor = !revealed
    ? "text-muted-foreground"
    : totalCurrentValue > 0
    ? "text-emerald-600"
    : "text-primary";

  return (
    <GlassCard variant="success" className={mobile ? "p-4" : "p-6"} hover={false}>
      {/* Header */}
      <div className={`flex items-center justify-between gap-3 ${mobile ? "" : "mb-3"}`}>
        <div className="flex items-center gap-2">
          <TrendingUp className="h-4 w-4 text-emerald-600 shrink-0" />
          <h3 className="text-sm font-bold text-foreground">Long Term Investment</h3>
        </div>
        {onboardingCompleted && (
          <motion.div whileTap={{ scale: 0.92 }}>
            <Button
              size="sm"
              onClick={onInsightsClick}
              className="bg-gradient-primary text-primary-foreground h-7 px-2.5 text-xs pointer-events-auto"
            >
              <Lightbulb className="h-3 w-3 mr-1" />
              Insights
            </Button>
          </motion.div>
        )}
      </div>

      {/* Amount row */}
      <div className="mt-2 flex items-center justify-between gap-2">
        <div className="flex-1 min-w-0">
          {revealed ? (
            <p className={`font-black gradient-text relative inline-block ${mobile ? "text-xl" : "text-3xl"}`}>
              {isScrambling
                ? (mobile ? formatCompactINR(display) : formatFullINR(display))
                : (totalCurrentValue > 0
                    ? (mobile ? formatCompactINR(totalCurrentValue) : formatFullINR(totalCurrentValue))
                    : "₹0.00")}
              {isScrambling && (
                <motion.span
                  className="absolute inset-0 bg-gradient-to-r from-transparent via-white/60 to-transparent pointer-events-none"
                  animate={{ x: ["-100%", "200%"] }}
                  transition={{ duration: 0.6, repeat: Infinity, ease: "linear" }}
                />
              )}
            </p>
          ) : (
            <p className={`font-black text-muted-foreground/40 tracking-widest ${mobile ? "text-xl" : "text-3xl"}`}>
              ₹ ••••••
            </p>
          )}
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {revealed && totalCurrentValue > 0 && !isScrambling && (
            <motion.div
              className="flex flex-col items-end"
              initial={{ opacity: 0, x: 8 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: 0.15, ...SPRING_GENTLE }}
            >
              <span className="text-xs font-bold text-emerald-600 leading-none">
                +{monthlyGrowthPct}%
              </span>
              <span className="text-[10px] text-muted-foreground leading-none mt-0.5">
                per month
              </span>
            </motion.div>
          )}
          <motion.button
            className="pointer-events-auto p-1.5 rounded-xl hover:bg-black/5 transition-colors"
            onClick={() => setReveal(v => !v)}
            whileTap={{ scale: 0.82, rotate: revealed ? -15 : 15 }}
            transition={{ type: "spring", stiffness: 400, damping: 20 }}
          >
            {revealed
              ? <EyeOff className="h-4 w-4 text-muted-foreground" />
              : <Eye    className="h-4 w-4 text-muted-foreground" />
            }
          </motion.button>
        </div>
      </div>

      {/* Nudge */}
      <AnimatePresence mode="wait">
        <motion.p
          key={revealed ? "revealed-nudge" : "hidden-nudge"}
          className={`mt-1.5 text-xs leading-snug ${nudgeColor}`}
          initial={{ opacity: 0, y: 4 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.25, delay: revealed ? 0.7 : 0 }}
        >
          {nudge}
        </motion.p>
      </AnimatePresence>
    </GlassCard>
  );
};

// ── Main page ─────────────────────────────────────────────────────────────────

const Index = () => {
  const navigate    = useNavigate();
  const { user, loading: authLoading } = useAuth();
  const isMobile    = useIsMobile();
  const { toast }   = useToast();
  const queryClient = useQueryClient();

  const [showOnboarding,           setShowOnboarding]           = useState(false);
  const [showInvestmentModal,      setShowInvestmentModal]      = useState(false);
  const [showSavingsGoalModal,     setShowSavingsGoalModal]     = useState(false);
  const [onboardingCompleted,      setOnboardingCompleted]      = useState(false);
  const [showAddTransactionDialog, setShowAddTransactionDialog] = useState(false);
  const [transactionDialogInitialType, setTransactionDialogInitialType] =
    useState<"income" | "expense" | undefined>(undefined);
  const [transactionDialogWeekLabel, setTransactionDialogWeekLabel] = useState("");

  const {
    totalCurrentValue,
    totalMonthlyGrowth,
    refreshSummary,
  } = useInvestmentSummary(onboardingCompleted);

  useEffect(() => {
    if (authLoading) return;
    const completed = user?.onboarding_completed || false;
    setOnboardingCompleted(completed);
    setShowOnboarding(!completed);
  }, [user, authLoading]);

  useEffect(() => {
    if (onboardingCompleted) refreshSummary();
  }, [onboardingCompleted, refreshSummary]);

  const handleOnboardingComplete = () => {
    setShowOnboarding(false);
    setOnboardingCompleted(true);
  };

  const handleOpenAddTransactionDialogFromQuickActions = (weekLabel: string) => {
    setTransactionDialogWeekLabel(weekLabel);
    setTransactionDialogInitialType(undefined);
    setShowAddTransactionDialog(true);
  };

  const handleSaveTransactionFromDialog = async (data: {
    account: string; category: string; amount: string; note: string;
    type: "income" | "expense"; transactionId?: string; transaction_date: string;
  }) => {
    if (!user) {
      toast({ title: "Error", description: "Please log in to save transactions", variant: "destructive" });
      throw new Error("User not authenticated");
    }
    try {
      await saveTransaction(user.id, {
        type: data.type,
        amount: parseFloat(data.amount),
        category: data.type === "income" ? "income" : data.category,
        account: data.account,
        description: DOMPurify.sanitize(data.note || ""),
        transaction_date: new Date(data.transaction_date).toISOString(),
      });
      toast({ title: "Success", description: `Weekly ${data.type} saved successfully` });
      setShowAddTransactionDialog(false);
      queryClient.invalidateQueries({ queryKey: ["quickActionsWeeklySummary"] });
      queryClient.invalidateQueries({ queryKey: ["weeklyBudgetProjections"] });
      queryClient.invalidateQueries({ queryKey: ["monthlyTransactionsForSavings"] });
      queryClient.invalidateQueries({ queryKey: ["recentTransactions"] });
      queryClient.invalidateQueries({ queryKey: ["monthlyBudgetSummary"] });
      queryClient.invalidateQueries({ queryKey: ["activeNotifications"] });
      queryClient.invalidateQueries({ queryKey: ["seenNotificationIds"] });
    } catch (error) {
      toast({ title: "Error", description: "Failed to save transaction", variant: "destructive" });
      throw error;
    }
  };

  const handleInvestmentModalClose = (open: boolean) => {
    setShowInvestmentModal(open);
    if (!open) refreshSummary();
  };

  if (authLoading) {
    return (
      <AppLayout>
        <div className="min-h-screen flex items-center justify-center">
          <motion.div
            className="h-10 w-10 rounded-full border-2 border-primary border-t-transparent"
            animate={{ rotate: 360 }}
            transition={{ duration: 0.8, repeat: Infinity, ease: "linear" }}
          />
        </div>
      </AppLayout>
    );
  }

  const name = user?.display_name?.trim().split(" ")[0] || "";

  // Stagger delays for each card
  const D = [0.08, 0.16, 0.24, 0.32, 0.40];

  return (
    <AppLayout>
      <div className="space-y-3 md:space-y-5 pb-6">
        <WelcomeHeader />

        {/* Greeting */}
        <GreetingStrip name={name} />

        {/* ── Mobile ───────────────────────────────────────────────────── */}
        {isMobile ? (
          <div className="space-y-4">
            <CardEnter delay={D[0]}>
              <InvestmentCard
                totalCurrentValue={totalCurrentValue}
                totalMonthlyGrowth={totalMonthlyGrowth}
                onboardingCompleted={onboardingCompleted}
                onInsightsClick={() => setShowInvestmentModal(true)}
                mobile
              />
            </CardEnter>

            <CardEnter delay={D[1]}>
              <QuickActionsCard
                onboardingCompleted={onboardingCompleted}
                onAddTransactionClick={handleOpenAddTransactionDialogFromQuickActions}
              />
            </CardEnter>

            <CardEnter delay={D[2]}>
              <GlassCard className="p-4" hover={false}>
                <div className="flex items-center gap-2 mb-3">
                  <Target className="h-4 w-4 text-primary" />
                  <h3 className="text-sm font-bold text-foreground">Personal Savings Goal</h3>
                </div>
                <SavingsGoalProgress
                  onSetupGoal={() => setShowSavingsGoalModal(true)}
                  onboardingCompleted={onboardingCompleted}
                />
              </GlassCard>
            </CardEnter>

            <CardEnter delay={D[3]}>
              <MonthlyBudgetTracker onboardingCompleted={onboardingCompleted} />
            </CardEnter>

            <CardEnter delay={D[4]}>
              <RecentActivity onboardingCompleted={onboardingCompleted} />
            </CardEnter>
          </div>

        ) : (
          /* ── Desktop ─────────────────────────────────────────────────── */
          <div className="space-y-6">
            <div className="grid grid-cols-3 gap-6">
              <CardEnter delay={D[0]}>
                <InvestmentCard
                  totalCurrentValue={totalCurrentValue}
                  totalMonthlyGrowth={totalMonthlyGrowth}
                  onboardingCompleted={onboardingCompleted}
                  onInsightsClick={() => setShowInvestmentModal(true)}
                />
              </CardEnter>

              <CardEnter delay={D[1]}>
                <QuickActionsCard
                  onboardingCompleted={onboardingCompleted}
                  onAddTransactionClick={handleOpenAddTransactionDialogFromQuickActions}
                />
              </CardEnter>

              <CardEnter delay={D[2]}>
                <GlassCard className="p-6" hover={false}>
                  <div className="flex items-center gap-2 mb-3">
                    <Target className="h-4 w-4 text-primary" />
                    <h3 className="text-sm font-bold text-foreground">Personal Savings Goal</h3>
                  </div>
                  <SavingsGoalProgress
                    onSetupGoal={() => setShowSavingsGoalModal(true)}
                    onboardingCompleted={onboardingCompleted}
                  />
                </GlassCard>
              </CardEnter>
            </div>

            <div className="grid grid-cols-2 gap-6">
              <CardEnter delay={D[3]}>
                <MonthlyBudgetTracker onboardingCompleted={onboardingCompleted} />
              </CardEnter>
              <CardEnter delay={D[4]}>
                <RecentActivity onboardingCompleted={onboardingCompleted} />
              </CardEnter>
            </div>
          </div>
        )}
      </div>

      <PWAInstallHandler />

      <LongTermInvestmentModal
        open={showInvestmentModal}
        onOpenChange={handleInvestmentModalClose}
        onboardingCompleted={onboardingCompleted}
      />
      <SavingsGoalModal
        open={showSavingsGoalModal}
        onOpenChange={setShowSavingsGoalModal}
        onboardingCompleted={onboardingCompleted}
      />
      <OnboardingModal
        open={showOnboarding}
        onComplete={handleOnboardingComplete}
        onClose={() => setShowOnboarding(false)}
      />
      <TransactionFormDialog
        isOpen={showAddTransactionDialog}
        onClose={() => setShowAddTransactionDialog(false)}
        onSave={handleSaveTransactionFromDialog}
        initialData={undefined}
        weekLabel={transactionDialogWeekLabel}
        formType={transactionDialogInitialType}
      />
    </AppLayout>
  );
};

export default Index;
