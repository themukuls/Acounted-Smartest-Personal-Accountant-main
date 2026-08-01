"use client";

import React, { useState } from "react";
import { GlassCard } from "@/components/ui/glass-card";
import { formatFullINR } from "@/lib/currency";
import {
  Lightbulb, TrendingUp, Target, Wallet,
  Home, ShoppingBag, PiggyBank, DollarSign,
  AlertTriangle, Sparkles, CheckCircle2,
  BadgePercent, CreditCard, ChevronDown, ChevronUp,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { BudgetCategoryProgress } from "./BudgetCategoryProgress";
import { motion } from "framer-motion";

interface VariableBudgetEntry {
  id: string; category_name: string; allocated_amount: number;
  budget_month: string; notes?: string; user_id: string;
  created_at: string; updated_at: string;
}

interface BudgetInsightsProps {
  totalMonthlyIncome: number;
  totalFixedExpenses: number;
  totalVariableBudget: number;
  totalMonthlySavingsTarget: number;
  variableBudgetEntries: VariableBudgetEntry[];
  onboardingCompleted: boolean;
}

// ── Budget Health Score ─────────────────────────────────────────────────────
// 0–100 score computed from three signals:
// • Savings rate (0–40 pts): 20%+ = 40, <5% = 0
// • Allocation coverage (0–40 pts): fully allocated = 40, nothing set = 0
// • Over-budget penalties (-20 pts each category over target)
function calcHealthScore(
  income: number, fixed: number, variable: number, savings: number
): { score: number; verdict: string; color: string; emoji: string } {
  if (income === 0) return { score: 0, verdict: "Add your income to see your score", color: "text-muted-foreground", emoji: "📊" };

  const savingsPct  = (savings  / income) * 100;
  const fixedPct    = (fixed    / income) * 100;
  const variablePct = (variable / income) * 100;
  const totalAlloc  = fixed + variable + savings;

  // Savings score 0–40
  const savingsScore = Math.min(40, Math.max(0, (savingsPct / 20) * 40));
  // Allocation coverage 0–40 — rewarded for setting a full plan
  const coveragePct   = Math.min(1, totalAlloc / income);
  const coverageScore = coveragePct * 40;
  // Penalty for over-target categories
  const needsOver    = fixedPct    > 55 ? 15 : fixedPct > 50    ? 8 : 0;
  const wantsOver    = variablePct > 35 ? 12 : variablePct > 30 ? 5 : 0;
  const savingsUnder = savingsPct  < 10 ? 10 : savingsPct < 15  ? 5 : 0;

  const raw   = savingsScore + coverageScore - needsOver - wantsOver - savingsUnder;
  const score = Math.round(Math.max(0, Math.min(100, raw)));

  if (score >= 80) return { score, verdict: "You're crushing it this month 🎉",  color: "text-emerald-600", emoji: "🟢" };
  if (score >= 60) return { score, verdict: "Looking solid — keep it going",      color: "text-primary",     emoji: "🔵" };
  if (score >= 40) return { score, verdict: "A few things need attention",        color: "text-amber-600",   emoji: "🟡" };
  return              { score, verdict: "Worth a closer look this month",         color: "text-destructive",  emoji: "🔴" };
}

// ── Best Practices ──────────────────────────────────────────────────────────
const BestPractices = ({
  needsOver, wantsOver, savingsUnder, unallocatedIncome,
  netMonthlySurplus, totalMonthlyIncome,
}: {
  needsOver: boolean; wantsOver: boolean; savingsUnder: boolean;
  unallocatedIncome: number; netMonthlySurplus: number; totalMonthlyIncome: number;
}) => {
  const tips = [
    {
      show: savingsUnder,
      emoji: "🐷", color: "text-emerald-700", bg: "bg-emerald-50", border: "border-emerald-200",
      title: "Every extra ₹500 in savings compounds beautifully",
      body: "Even a small SIP in ELSS can grow to ₹1L+ over 10 years. Start with whatever you can.",
    },
    {
      show: unallocatedIncome > 1000,
      emoji: "🚀", color: "text-violet-700", bg: "bg-violet-50", border: "border-violet-200",
      title: `${formatFullINR(unallocatedIncome)} is yours to deploy`,
      body: "Move it to a liquid fund or SIP — idle money quietly loses value to inflation every month.",
    },
    {
      show: wantsOver,
      emoji: "🛍️", color: "text-amber-700", bg: "bg-amber-50", border: "border-amber-200",
      title: "Discretionary spending is running a little hot",
      body: "Try the 48-hour rule: wait 2 days before any non-essential purchase above ₹1,000.",
    },
    {
      show: needsOver,
      emoji: "🏠", color: "text-red-700", bg: "bg-red-50", border: "border-red-200",
      title: "Your fixed costs are a bit high",
      body: "Check if any subscriptions went unnoticed. One unused OTT + one forgotten gym = ₹1,500/month gone.",
    },
    {
      show: netMonthlySurplus > 5000,
      emoji: "📈", color: "text-primary", bg: "bg-primary/5", border: "border-primary/20",
      title: "Great surplus — put it to work",
      body: "Your surplus can fund an emergency reserve (3–6 months expenses), then index funds or NPS.",
    },
    {
      show: totalMonthlyIncome > 0,
      emoji: "⚡", color: "text-indigo-700", bg: "bg-indigo-50", border: "border-indigo-200",
      title: "Automate before you spend",
      body: "Set up auto-debit for SIPs on salary day. You can't spend what you don't see.",
    },
    {
      show: totalMonthlyIncome > 0,
      emoji: "📆", color: "text-teal-700", bg: "bg-teal-50", border: "border-teal-200",
      title: "A 15-min monthly review pays dividends",
      body: "Life changes — so should your budget. Catching overspend early stops it compounding.",
    },
  ].filter(t => t.show).slice(0, 4); // max 4 tips — no wall of text

  if (tips.length === 0) return (
    <div className="text-center py-8 space-y-2">
      <div className="text-3xl">🎉</div>
      <p className="text-sm font-semibold text-foreground">Your budget looks really healthy!</p>
      <p className="text-xs text-muted-foreground">Keep doing what you're doing.</p>
    </div>
  );

  return (
    <div className="space-y-2.5">
      <p className="text-xs text-muted-foreground mb-1">Based on your numbers this month</p>
      {tips.map((tip, i) => (
        <motion.div
          key={i}
          initial={{ opacity: 0, x: -10 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ delay: i * 0.08, type: "spring", stiffness: 260, damping: 24 }}
          className={cn("rounded-xl border p-3 flex items-start gap-3", tip.bg, tip.border)}
        >
          <span className="text-base shrink-0 mt-0.5">{tip.emoji}</span>
          <div>
            <p className={cn("text-xs font-bold leading-snug", tip.color)}>{tip.title}</p>
            <p className="text-xs text-foreground/70 mt-0.5 leading-relaxed">{tip.body}</p>
          </div>
        </motion.div>
      ))}
    </div>
  );
};

// ── Main export ─────────────────────────────────────────────────────────────
export const BudgetInsights = ({
  totalMonthlyIncome, totalFixedExpenses, totalVariableBudget,
  totalMonthlySavingsTarget, variableBudgetEntries, onboardingCompleted,
}: BudgetInsightsProps) => {
  const [activeTab, setActiveTab]         = useState<"overview" | "tips">("overview");
  const [showProjection, setShowProjection] = useState(false);

  if (!onboardingCompleted || totalMonthlyIncome === 0) return (
    <GlassCard className="p-5 text-center space-y-2" hover={false}>
      <Lightbulb className="h-7 w-7 mx-auto text-primary/60" />
      <p className="text-sm text-muted-foreground">
        Set up your income to unlock your personalised budget score and insights.
      </p>
    </GlassCard>
  );

  // ── Numbers ──────────────────────────────────────────────────────────────
  const actualNeeds       = totalFixedExpenses;
  const actualWants       = totalVariableBudget;
  const actualSavings     = totalMonthlySavingsTarget;
  const totalAllocated    = actualNeeds + actualWants + actualSavings;
  const unallocatedIncome = Math.max(0, totalMonthlyIncome - totalAllocated);

  const needsPct       = (actualNeeds       / totalMonthlyIncome) * 100;
  const wantsPct       = (actualWants       / totalMonthlyIncome) * 100;
  const savingsPct     = (actualSavings     / totalMonthlyIncome) * 100;
  const unallocatedPct = (unallocatedIncome / totalMonthlyIncome) * 100;

  const needsOver    = needsPct   > 55;
  const wantsOver    = wantsPct   > 35;
  const savingsUnder = savingsPct < 15;
  const hasWarnings  = needsOver || wantsOver || savingsUnder;

  const netMonthlySurplus = totalMonthlyIncome - totalFixedExpenses - totalVariableBudget - totalMonthlySavingsTarget;
  const futureValue = netMonthlySurplus > 0
    ? netMonthlySurplus * ((Math.pow(1 + 0.07 / 12, 60) - 1) / (0.07 / 12))
    : 0;

  const health = calcHealthScore(totalMonthlyIncome, actualNeeds, actualWants, actualSavings);

  const tabs = [
    { id: "overview" as const, label: "Your money map", icon: Wallet },
    { id: "tips"     as const, label: "For you",        icon: Lightbulb },
  ];

  return (
    <div className="space-y-3">

      {/* ── Budget health score ────────────────────────────────────────── */}
      <motion.div
        initial={{ opacity: 0, scale: 0.96 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ type: "spring", stiffness: 260, damping: 26, delay: 0.1 }}
        className="rounded-2xl border border-border/50 bg-background/60 p-4 flex items-center justify-between"
      >
        <div>
          <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-0.5">Budget health</p>
          <p className={cn("text-sm font-semibold leading-snug", health.color)}>{health.verdict}</p>
        </div>
        <div className="flex flex-col items-center gap-0.5">
          <motion.span
            className={cn("text-4xl font-black leading-none", health.color)}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.2, type: "spring", stiffness: 260, damping: 24 }}
          >
            {health.score}
          </motion.span>
          <span className="text-[10px] text-muted-foreground">/100</span>
        </div>
      </motion.div>

      {/* ── Tab bar ────────────────────────────────────────────────────── */}
      <div className="flex gap-1 p-1 rounded-xl bg-muted/40 border border-border/40">
        {tabs.map(tab => (
          <button key={tab.id} onClick={() => setActiveTab(tab.id)}
            className={cn(
              "flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg text-xs font-semibold transition-all pointer-events-auto",
              activeTab === tab.id
                ? "bg-white shadow-sm text-primary border border-border/40"
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            <tab.icon className="h-3 w-3 shrink-0" />
            {tab.label}
          </button>
        ))}
      </div>

      {/* ── Tab: Your Money Map (50/30/20) ─────────────────────────────── */}
      {activeTab === "overview" && (
        <GlassCard className="p-4 space-y-4" hover={false}>
          <div className="flex items-start justify-between gap-2">
            <div>
              <p className="text-sm font-bold text-foreground">50 / 30 / 20 rule</p>
              <p className="text-xs text-muted-foreground">Needs · Wants · Savings</p>
            </div>
            {!hasWarnings
              ? <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700 shrink-0">On track ✓</span>
              : <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 shrink-0 flex items-center gap-1">
                  <AlertTriangle className="h-2.5 w-2.5" /> Review
                </span>
            }
          </div>

          {/* Stacked bar */}
          <div className="flex h-3 rounded-full overflow-hidden gap-px bg-muted">
            {[
              { pct: needsPct,       color: "bg-blue-500"   },
              { pct: wantsPct,       color: "bg-violet-500" },
              { pct: savingsPct,     color: "bg-emerald-500"},
              { pct: unallocatedPct, color: "bg-muted-foreground/20" },
            ].map((seg, i) => (
              <motion.div key={i} className={cn("h-full", seg.color)}
                initial={{ width: "0%" }}
                animate={{ width: `${seg.pct}%` }}
                transition={{ type: "spring", stiffness: 52, damping: 18, delay: 0.15 + i * 0.08 }}
              />
            ))}
          </div>

          {/* Legend */}
          <div className="flex flex-wrap gap-x-3 gap-y-1">
            {[
              { color: "bg-blue-500",             label: "Needs",    pct: needsPct       },
              { color: "bg-violet-500",            label: "Wants",    pct: wantsPct       },
              { color: "bg-emerald-500",           label: "Savings",  pct: savingsPct     },
              { color: "bg-muted-foreground/30",   label: "Free",     pct: unallocatedPct },
            ].map(s => (
              <div key={s.label} className="flex items-center gap-1">
                <div className={cn("h-2 w-2 rounded-full", s.color)} />
                <span className="text-[10px] text-muted-foreground">{s.label} {s.pct.toFixed(0)}%</span>
              </div>
            ))}
          </div>

          {/* Category cards */}
          <div className="grid grid-cols-2 gap-2">
            <BudgetCategoryProgress label="Needs"       value={actualNeeds}       percentage={needsPct}       colorClass="bg-blue-500"   icon={Home}        targetPercentage={50} />
            <BudgetCategoryProgress label="Wants"       value={actualWants}       percentage={wantsPct}       colorClass="bg-violet-500" icon={ShoppingBag} targetPercentage={30} />
            <BudgetCategoryProgress label="Savings"     value={actualSavings}     percentage={savingsPct}     colorClass="bg-emerald-500" icon={PiggyBank}  targetPercentage={20} />
            <BudgetCategoryProgress label="Unallocated" value={unallocatedIncome} percentage={unallocatedPct} colorClass="bg-gray-400"   icon={DollarSign} />
          </div>

          {/* Emotional feedback — inline alerts with warm copy */}
          {(hasWarnings || unallocatedIncome > 500) && (
            <div className="space-y-2 pt-1 border-t border-border/40">
              {needsOver    && <div className="flex items-start gap-2 text-xs text-red-700 bg-red-50 rounded-xl px-3 py-2.5"><AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" />Your fixed costs are a bit high. Check if any subscriptions went unnoticed.</div>}
              {wantsOver    && <div className="flex items-start gap-2 text-xs text-amber-700 bg-amber-50 rounded-xl px-3 py-2.5"><AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" />Discretionary spending is running a little hot this month.</div>}
              {savingsUnder && <div className="flex items-start gap-2 text-xs text-amber-700 bg-amber-50 rounded-xl px-3 py-2.5"><AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" />Savings at {savingsPct.toFixed(0)}% — every extra ₹500 here compounds beautifully.</div>}
              {unallocatedIncome > 500 && (
                <motion.div
                  className="flex items-start gap-2 text-xs text-teal-700 bg-teal-50 rounded-xl px-3 py-2.5 border border-teal-200"
                  initial={{ opacity: 0, scale: 0.97 }}
                  animate={{ opacity: 1, scale: 1 }}
                  transition={{ delay: 0.3 }}
                >
                  <Sparkles className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                  <span><strong>{formatFullINR(unallocatedIncome)}</strong> is yours to deploy 🚀 — add it to savings or start a SIP.</span>
                </motion.div>
              )}
            </div>
          )}

          {/* 5-year projection */}
          <div className="border-t border-border/40 pt-3">
            <button onClick={() => setShowProjection(p => !p)}
              className="w-full flex items-center justify-between pointer-events-auto">
              <div className="flex items-center gap-2">
                <TrendingUp className="h-3.5 w-3.5 text-emerald-600" />
                <span className="text-xs font-bold text-foreground">5-year projection</span>
              </div>
              {showProjection
                ? <ChevronUp className="h-3.5 w-3.5 text-muted-foreground" />
                : <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />}
            </button>
            {showProjection && (
              <motion.div
                className="mt-3"
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: "auto" }}
                transition={{ duration: 0.25 }}
              >
                {netMonthlySurplus > 0 ? (
                  <div className="rounded-xl bg-emerald-50 border border-emerald-200 p-3.5">
                    <p className="text-xs text-emerald-700">
                      From {formatFullINR(netMonthlySurplus)}/mo surplus invested @ 7% p.a.
                    </p>
                    <p className="text-2xl font-black text-emerald-600 mt-1">{formatFullINR(futureValue)}</p>
                    <p className="text-xs text-emerald-600 mt-0.5">potential in 5 years 🌱</p>
                  </div>
                ) : (
                  <div className="flex items-start gap-2 text-xs text-amber-700 bg-amber-50 rounded-xl px-3 py-2.5">
                    <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                    No surplus yet. Trimming even one expense can start building wealth.
                  </div>
                )}
              </motion.div>
            )}
          </div>
        </GlassCard>
      )}

      {/* ── Tab: For you (Best Practices) ──────────────────────────────── */}
      {activeTab === "tips" && (
        <GlassCard className="p-4" hover={false}>
          <BestPractices
            needsOver={needsOver} wantsOver={wantsOver} savingsUnder={savingsUnder}
            unallocatedIncome={unallocatedIncome} netMonthlySurplus={netMonthlySurplus}
            totalMonthlyIncome={totalMonthlyIncome}
          />
        </GlassCard>
      )}
    </div>
  );
};
