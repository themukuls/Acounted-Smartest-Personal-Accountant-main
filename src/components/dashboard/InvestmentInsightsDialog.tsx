"use client";

import React from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  Lightbulb, TrendingUp, Shield, Target, IndianRupee,
  Percent, Zap, RefreshCw, Wallet, PieChart, ArrowRight,
} from "lucide-react";
import { formatFullINR, formatCompactINR } from "@/lib/currency";
import { cn } from "@/lib/utils";
import { useInvestmentRecommendations } from "@/hooks/useInvestmentRecommendations";

interface InvestmentInsightsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  totalCurrentValue: number;
  averageAnnualInterestRate: number;
  investmentsCount: number;
  diversificationCount: number;
  investments: any[];
  riskAppetite: string;
}

const REC_COLORS: Record<string, { border: string; icon: string; bg: string }> = {
  reallocation:          { border: "border-l-amber-400",  icon: "text-amber-500",  bg: "bg-amber-50"  },
  additional_investment: { border: "border-l-primary",    icon: "text-primary",    bg: "bg-primary/5" },
  diversification:       { border: "border-l-violet-400", icon: "text-violet-500", bg: "bg-violet-50" },
};

const LearnCard = ({
  icon, bg, title, stat, statLabel, body,
}: {
  icon: React.ReactNode; bg: string; title: string;
  stat: string; statLabel: string; body: string;
}) => (
  <div className={cn("rounded-xl border p-3 flex items-start gap-3", bg)}>
    <div className="mt-0.5 shrink-0">{icon}</div>
    <div className="flex-1 min-w-0">
      <div className="flex items-baseline justify-between gap-2 mb-1">
        <p className="text-xs font-bold text-foreground">{title}</p>
        <div className="text-right shrink-0">
          <p className="text-sm font-black text-foreground">{stat}</p>
          <p className="text-[10px] text-muted-foreground leading-none">{statLabel}</p>
        </div>
      </div>
      <p className="text-[11px] text-muted-foreground leading-relaxed">{body}</p>
    </div>
  </div>
);

const InvestmentInsightsDialog = ({
  open, onOpenChange, totalCurrentValue, averageAnnualInterestRate,
  investmentsCount, diversificationCount, investments, riskAppetite,
}: InvestmentInsightsDialogProps) => {
  const { recommendations, loading: recommendationsLoading } = useInvestmentRecommendations({
    investments, riskAppetite, totalCurrentValue, averageAnnualInterestRate, diversificationCount,
  });

  const yearsToDouble = averageAnnualInterestRate > 0 ? 72 / averageAnnualInterestRate : null;
  const inflationRate = 0.06;
  const realReturn = averageAnnualInterestRate - inflationRate * 100;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="glass-card border-glass max-w-2xl max-h-[90vh] overflow-y-auto pointer-events-auto">

        {/* Header */}
        <DialogHeader className="pb-3 border-b border-border/40">
          <div className="flex items-center gap-3">
            <div className="h-9 w-9 rounded-xl bg-primary/10 flex items-center justify-center shrink-0">
              <Lightbulb className="h-4 w-4 text-primary" />
            </div>
            <div>
              <DialogTitle className="text-base font-bold gradient-text leading-tight">
                Investment Insights
              </DialogTitle>
              {totalCurrentValue > 0 && (
                <p className="text-xs text-muted-foreground mt-0.5">
                  Based on your {formatCompactINR(totalCurrentValue)} portfolio
                </p>
              )}
            </div>
          </div>
        </DialogHeader>

        <div className="space-y-6 py-4">

          {/* ── FOR YOU ─────────────────────────────────────────────────── */}
          <div className="space-y-3">
            <div className="flex items-center gap-1.5">
              <Zap className="h-3.5 w-3.5 text-primary" />
              <p className="text-[11px] font-bold text-foreground uppercase tracking-wider">For You</p>
            </div>

            {recommendationsLoading ? (
              <div className="space-y-3">
                {[1, 2].map(i => (
                  <div key={i} className="rounded-xl border border-border/40 p-4 space-y-2 animate-pulse">
                    <div className="h-3 bg-muted rounded w-1/2" />
                    <div className="h-3 bg-muted rounded w-3/4" />
                    <div className="h-3 bg-muted rounded w-2/3" />
                  </div>
                ))}
              </div>
            ) : recommendations.length > 0 ? (
              <div className="space-y-3">
                {recommendations.map((rec) => {
                  const colors = REC_COLORS[rec.type] || REC_COLORS.additional_investment;
                  return (
                    <div
                      key={rec.id}
                      className={cn(
                        "rounded-xl border border-l-4 border-border/40 p-4 space-y-2",
                        colors.border, colors.bg
                      )}
                    >
                      <p className="text-sm font-bold text-foreground">{rec.title}</p>
                      <p className="text-xs text-muted-foreground leading-relaxed">{rec.description}</p>
                      <div className="space-y-1.5 pt-1 border-t border-border/30">
                        <div className="flex items-start gap-1.5">
                          <ArrowRight className={cn("h-3 w-3 mt-0.5 shrink-0", colors.icon)} />
                          <p className="text-xs font-semibold text-foreground">{rec.action}</p>
                        </div>
                        <div className="flex items-start gap-1.5">
                          <TrendingUp className="h-3 w-3 mt-0.5 shrink-0 text-emerald-500" />
                          <p className="text-xs text-emerald-700 font-medium">{rec.impact}</p>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-center">
                <p className="text-sm font-semibold text-emerald-700">Your portfolio looks healthy! 🎉</p>
                <p className="text-xs text-emerald-600 mt-0.5">No specific actions needed right now.</p>
              </div>
            )}
          </div>

          {/* ── KEY NUMBERS ─────────────────────────────────────────────── */}
          <div className="space-y-3">
            <div className="flex items-center gap-1.5">
              <IndianRupee className="h-3.5 w-3.5 text-muted-foreground" />
              <p className="text-[11px] font-bold text-foreground uppercase tracking-wider">Key Numbers</p>
            </div>

            {/* Double your money hero */}
            <div className="rounded-xl border border-border/40 bg-background/60 p-4">
              <div className="flex items-center justify-between gap-4">
                <div>
                  <p className="text-xs font-semibold text-foreground">Time to double your money</p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    at your current {averageAnnualInterestRate.toFixed(1)}% avg. return
                  </p>
                </div>
                <p className={cn(
                  "text-3xl font-black shrink-0",
                  yearsToDouble && yearsToDouble <= 7 ? "text-emerald-600" : "text-amber-500"
                )}>
                  {yearsToDouble ? `${yearsToDouble.toFixed(1)}y` : "—"}
                </p>
              </div>
              {/* Scenario grid */}
              <div className="grid grid-cols-3 gap-2 mt-3 pt-3 border-t border-border/40">
                {[{ label: "In 2 yrs", rate: 72 / 2 }, { label: "In 3 yrs", rate: 72 / 3 }, { label: "In 5 yrs", rate: 72 / 5 }].map(s => (
                  <div key={s.label} className="text-center rounded-lg bg-muted/50 py-2 px-1">
                    <p className="text-[10px] text-muted-foreground">{s.label}</p>
                    <p className="text-sm font-black text-foreground">{s.rate.toFixed(0)}%</p>
                    <p className="text-[10px] text-muted-foreground">needed</p>
                  </div>
                ))}
              </div>
              <p className="text-[10px] text-muted-foreground mt-2">Based on the Rule of 72</p>
            </div>

            {/* Return vs inflation */}
            <div className="grid grid-cols-2 gap-3">
              <div className="rounded-xl border border-border/40 bg-background/60 p-3">
                <p className="text-[10px] text-muted-foreground">Avg. annual return</p>
                <p className="text-2xl font-black text-primary mt-0.5">{averageAnnualInterestRate.toFixed(1)}%</p>
                <p className="text-[10px] text-muted-foreground">on your portfolio</p>
              </div>
              <div className={cn(
                "rounded-xl border p-3",
                realReturn > 0 ? "border-emerald-200 bg-emerald-50" : "border-red-200 bg-red-50"
              )}>
                <p className="text-[10px] text-muted-foreground">Real return</p>
                <p className={cn("text-2xl font-black mt-0.5", realReturn > 0 ? "text-emerald-600" : "text-destructive")}>
                  {realReturn > 0 ? "+" : ""}{realReturn.toFixed(1)}%
                </p>
                <p className="text-[10px] text-muted-foreground">after 6% inflation</p>
              </div>
            </div>
          </div>

          {/* ── LEARN ───────────────────────────────────────────────────── */}
          <div className="space-y-3">
            <div className="flex items-center gap-1.5">
              <Target className="h-3.5 w-3.5 text-muted-foreground" />
              <p className="text-[11px] font-bold text-foreground uppercase tracking-wider">Learn</p>
            </div>
            <div className="space-y-2">
              <LearnCard
                icon={<TrendingUp className="h-4 w-4 text-emerald-600" />}
                bg="bg-emerald-50 border-emerald-200"
                title="Power of Compounding"
                stat="₹50L+"
                statLabel="₹5K/mo at 12% × 20yrs"
                body="Starting early means your returns earn returns — exponential, not linear growth."
              />
              <LearnCard
                icon={<PieChart className="h-4 w-4 text-violet-600" />}
                bg="bg-violet-50 border-violet-200"
                title="Diversification"
                stat={`${diversificationCount} types`}
                statLabel="in your portfolio"
                body="Spreading across equity, debt, and gold reduces risk. Aim for at least 3–4 asset classes."
              />
              <LearnCard
                icon={<Percent className="h-4 w-4 text-red-500" />}
                bg="bg-red-50 border-red-200"
                title="Guard Against Inflation"
                stat="6%"
                statLabel="avg. India inflation"
                body="Investments must beat inflation to actually grow your wealth in real terms."
              />
              <LearnCard
                icon={<Wallet className="h-4 w-4 text-amber-600" />}
                bg="bg-amber-50 border-amber-200"
                title="Emergency Fund First"
                stat="3–6×"
                statLabel="monthly expenses"
                body="Keep 3–6 months of expenses in a liquid account before investing aggressively."
              />
              <LearnCard
                icon={<Shield className="h-4 w-4 text-primary" />}
                bg="bg-primary/5 border-primary/20"
                title="Keep Costs Low"
                stat="1%"
                statLabel="fee worth checking"
                body="Small annual fees compound over time. Compare expense ratios and charges before investing."
              />
              <LearnCard
                icon={<RefreshCw className="h-4 w-4 text-orange-500" />}
                bg="bg-orange-50 border-orange-200"
                title="Rebalance Annually"
                stat="1×/yr"
                statLabel="recommended review"
                body="Market moves shift your asset mix. An annual rebalance keeps risk aligned with your goals."
              />
            </div>
          </div>

        </div>
      </DialogContent>
    </Dialog>
  );
};

export default InvestmentInsightsDialog;
