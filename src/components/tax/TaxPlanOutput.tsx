"use client";

import React, { useMemo, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { formatFullINR } from "@/lib/currency";
import {
  XCircle, Shield, GraduationCap, HeartPulse, Gift, Home,
  PiggyBank, Building2, Banknote, HandCoins, Percent, Hourglass,
  Zap, AlertTriangle, TrendingUp, Briefcase, BarChart2, Info,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { saveTaxPlannerOutput } from "@/integrations/indexeddb/services/taxPlannerService";
import type { TaxFormData, IncomeStream } from "@/pages/TaxPlannerAI";
import { computeTaxOnTaxableIncome, type AgeCategory, type CapitalGains } from "@/lib/tax";

// ─── Props ────────────────────────────────────────────────────────────────────

interface TaxPlanOutputProps {
  formData?: TaxFormData;
  calculatedData?: any;
  onGoBack: () => void;
  isLoadedFromDb?: boolean;
}

// ─── Tax constants — Income Tax Act 2025 / FY 2026-27 ────────────────────────

// Slab rates, senior exemptions, 87A rebate, surcharge and cess now live in
// the shared engine (src/lib/tax). Only the constants still used directly by
// this component's presentation/derivation logic remain here.
const STD_DED_OLD = 50000;
const STD_DED_NEW = 75000;
const CESS = 0.04;

// Metro cities eligible for 50% HRA exemption (Income Tax Rules 2026)
const METRO_CITIES_50 = [
  "mumbai", "delhi", "new delhi", "kolkata", "chennai",
  "bengaluru", "bangalore", "pune", "hyderabad", "ahmedabad",
];

// Capital-gains flat rates
const EQUITY_STCG_RATE  = 0.20;   // Sec 111A
const EQUITY_LTCG_RATE  = 0.125;  // Sec 112A (above ₹1.25L)
const EQUITY_LTCG_EXEMPT = 125000;
const OTHER_LTCG_RATE   = 0.125;  // Sec 112 (post Jul 23 2024)
// other STCG → added to slab income

// Investment return midpoints (for 5-yr projection)
const RETURN_MIDPOINTS: Record<string, number> = {
  "PPF":            0.071,
  "NSC":            0.068,
  "ELSS":           0.135,
  "NPS Tier-I":     0.09,
  "NPS Tier-II":    0.09,
  "Health Insurance": 0,
  "Home Loan Repayment": 0,
};

// ─── Deduction section metadata ───────────────────────────────────────────────

const DEDUCTION_SECTIONS = [
  {
    key: "stdDeduction", section: "Std. Deduction", newSection: "Sec 22",
    max: Infinity, regime: "BOTH",
    notes: "Auto-applied — ₹50,000 Old / ₹75,000 New",
    icon: Shield,
  },
  {
    key: "hra", section: "HRA", newSection: "Sec 10(13A)",
    max: Infinity, regime: "OLD only",
    notes: "50% of salary in 8 metro cities, else 40% — Old Regime only from FY 2026-27",
    icon: Building2,
  },
  {
    key: "section24b", section: "24(b)", newSection: "Sec 24(b)",
    max: 200000, regime: "OLD only (self-occ)",
    notes: "Home-loan interest on self-occupied house (max ₹2 L in Old Regime). Let-out interest is unlimited in BOTH regimes.",
    icon: Home,
  },
  {
    key: "section80C", section: "Sec 123", newSection: "Sec 123",
    max: 150000, regime: "OLD only",
    notes: "PPF, ELSS, EPF, NSC, life-insurance, home-loan principal (was 80C)",
    icon: PiggyBank,
  },
  {
    key: "section80CCD1B", section: "Sec 124 (NPS)", newSection: "Sec 124",
    max: 50000, regime: "OLD only",
    notes: "Extra NPS Tier-I over and above Sec 123 (was 80CCD(1B))",
    icon: Building2,
  },
  {
    key: "section80D", section: "Sec 126 (Health Ins.)", newSection: "Sec 126",
    max: 50000, regime: "OLD only",
    notes: "Health-insurance premium — Old Regime only (was 80D)",
    icon: HeartPulse,
  },
  {
    key: "section80E", section: "Sec 129 (Edu. Loan)", newSection: "Sec 129",
    max: Infinity, regime: "OLD only",
    notes: "Education-loan interest — no upper limit (was 80E)",
    icon: GraduationCap,
  },
  {
    key: "section80G", section: "80G / Sec 132", newSection: "Sec 132",
    max: Infinity, regime: "OLD only",
    notes: "Approved charity donations — 50%–100% deductible",
    icon: Gift,
  },
  {
    key: "section80TTB", section: "80TTB / Sec 135", newSection: "Sec 135",
    max: 100000, regime: "OLD only (senior)",
    notes: "Savings & FD interest for senior citizens — limit raised to ₹1 L from FY 2026-27",
    icon: Banknote,
  },
  {
    key: "section80TTA", section: "80TTA / Sec 135", newSection: "Sec 135",
    max: 10000, regime: "OLD only (non-senior)",
    notes: "Savings-account interest for non-senior citizens",
    icon: Banknote,
  },
];

// Investment instruments by section × risk
const INVESTMENT_INSTRUMENTS: Record<string, Record<string, { name: string; return: string; liquidity: string; lockin: string }[]>> = {
  "Sec 123": {
    conservative: [{ name: "PPF",  return: "7.1%",   liquidity: "Long-term (15 yrs)", lockin: "15 years" }, { name: "NSC", return: "6.8%", liquidity: "Mid-term (5 yrs)", lockin: "5 years" }],
    moderate:     [{ name: "ELSS", return: "12-15%",  liquidity: "Mid-term (3 yrs)",   lockin: "3 years"  }, { name: "PPF", return: "7.1%", liquidity: "Long-term (15 yrs)", lockin: "15 years" }],
    aggressive:   [{ name: "ELSS", return: "15-18%",  liquidity: "Mid-term (3 yrs)",   lockin: "3 years"  }],
  },
  "Sec 124 (NPS)": {
    conservative: [{ name: "NPS Tier-I", return: "8-10%", liquidity: "Long-term (till retirement)", lockin: "Till retirement" }],
    moderate:     [{ name: "NPS Tier-I", return: "8-10%", liquidity: "Long-term (till retirement)", lockin: "Till retirement" }],
    aggressive:   [{ name: "NPS Tier-I", return: "8-10%", liquidity: "Long-term (till retirement)", lockin: "Till retirement" }],
  },
  "Sec 126 (Health Ins.)": {
    conservative: [{ name: "Health Insurance", return: "N/A (protection)", liquidity: "Immediate", lockin: "1 year" }],
    moderate:     [{ name: "Health Insurance", return: "N/A (protection)", liquidity: "Immediate", lockin: "1 year" }],
    aggressive:   [{ name: "Health Insurance", return: "N/A (protection)", liquidity: "Immediate", lockin: "1 year" }],
  },
};

// ─── Pure calculation helpers ─────────────────────────────────────────────────
// Slab tax, 87A rebate, surcharge and cess are computed by the shared engine
// (computeTaxOnTaxableIncome). The helpers below only handle this component's
// own derivations (HRA, investment parsing, projections).

function calcHRA(rentPaid: number, grossSalary: number, city: string): number {
  if (rentPaid === 0 || grossSalary === 0) return 0;
  const cityLower = city.toLowerCase().trim();
  const isMetro = METRO_CITIES_50.some((m) => cityLower.includes(m));
  const assumedHRA = grossSalary * 0.4;
  const rentMinus10 = Math.max(0, rentPaid - grossSalary * 0.1);
  const pctSalary = isMetro ? grossSalary * 0.5 : grossSalary * 0.4;
  return Math.min(assumedHRA, rentMinus10, pctSalary);
}

function parseInvestments(str: string): Record<string, number> {
  const out: Record<string, number> = {};
  if (!str || str.toLowerCase() === "none") return out;
  str.split(",").forEach((item) => {
    const [k, v] = item.split(":").map((s) => s.trim());
    if (k && v) {
      const amt = parseFloat(v);
      if (!isNaN(amt) && amt > 0) out[k.toUpperCase()] = (out[k.toUpperCase()] || 0) + amt;
    }
  });
  return out;
}

function fiveYearFV(principal: number, instrumentName: string): number {
  const r = RETURN_MIDPOINTS[instrumentName] ?? 0.08;
  if (r === 0) return principal;
  return Math.round(principal * Math.pow(1 + r, 5));
}

// ─── Main calculation engine ──────────────────────────────────────────────────

function runCalculations(form: TaxFormData) {
  const {
    ageCategory, cityOfResidence, activeIncomeStreams,
    annualGrossIncome, annualRentPaid,
    businessTurnover, businessDigitalPercent,
    professionalReceipts,
    rentalGrossReceipts, rentalMunicipalTaxes, rentalHomeLoanInterest,
    equityStcg, equityLtcg, otherLtcg, otherStcg, otherIncome,
    homeLoanPrincipal, homeLoanInterest, taxSavingInvestments,
    healthInsurancePremiums, educationLoanInterest, donations80G,
    riskAppetite, liquidityNeeds,
  } = form;

  const has = (s: IncomeStream) => activeIncomeStreams.includes(s);
  const isSenior = ageCategory === "60-80" || ageCategory === ">80";

  // ── 1. Income stream breakdowns ──────────────────────────────────────────

  const salaryIncome      = has("salary")        ? annualGrossIncome : 0;
  const businessProfit    = has("business")       ? businessTurnover * (businessDigitalPercent >= 95 ? 0.06 : 0.08) : 0;
  const professionalProfit= has("professional")   ? professionalReceipts * 0.5 : 0;

  // Rental: NAV → minus 30% std deduction → minus loan interest
  const rentalNAV         = Math.max(0, rentalGrossReceipts - rentalMunicipalTaxes);
  const rentalStdDed      = rentalNAV * 0.30;
  // Let-out loan interest unlimited in BOTH regimes
  const rentalNetIncome   = Math.max(0, rentalNAV - rentalStdDed - rentalHomeLoanInterest);

  // Other STCG is slab income; capital gains with flat rates are separate
  const slabIncome        = salaryIncome + businessProfit + professionalProfit
                            + (has("rental") ? rentalNetIncome : 0)
                            + (has("capital_gains") ? otherStcg : 0)
                            + otherIncome;

  // Capital gains (flat rate, outside slab)
  const taxableEquityStcg = has("capital_gains") ? equityStcg : 0;
  const taxableEquityLtcg = has("capital_gains") ? Math.max(0, equityLtcg - EQUITY_LTCG_EXEMPT) : 0;
  const taxableOtherLtcg  = has("capital_gains") ? otherLtcg : 0;

  const cgTax = (taxableEquityStcg * EQUITY_STCG_RATE
              + taxableEquityLtcg  * EQUITY_LTCG_RATE
              + taxableOtherLtcg   * OTHER_LTCG_RATE) * (1 + CESS);

  // Capital gains handed to the engine use RAW equity LTCG — the engine applies
  // the ₹1.25 L exemption itself. otherStcg is already folded into slabIncome.
  const cgForEngine: CapitalGains = {
    equityStcg: taxableEquityStcg,
    equityLtcg: has("capital_gains") ? equityLtcg : 0,
    otherLtcg: taxableOtherLtcg,
    otherStcg: 0,
  };

  // ── 2. OLD REGIME ────────────────────────────────────────────────────────

  const existingInv = parseInvestments(taxSavingInvestments);

  const ded80C = Math.min(
    (existingInv["PPF"] || 0) + (existingInv["ELSS"] || 0) + (existingInv["EPF"] || 0)
    + (existingInv["NSC"] || 0) + (existingInv["LIFE-INSURANCE"] || 0)
    + (existingInv["CHILDREN'S TUITION"] || 0) + homeLoanPrincipal,
    150000,
  );
  const ded80CCD1B  = Math.min(existingInv["NPS"] || 0, 50000);
  const ded80D      = Math.min(healthInsurancePremiums, isSenior ? 50000 : Math.min(healthInsurancePremiums, 50000));
  const ded80E      = educationLoanInterest;
  const ded80G      = donations80G * 0.5;
  const ded80TTA    = isSenior ? 0 : Math.min(otherIncome, 10000);
  const ded80TTB    = isSenior ? Math.min(otherIncome, 100000) : 0; // raised to ₹1L FY 2026-27
  const dedHRA      = has("salary") ? calcHRA(annualRentPaid, salaryIncome, cityOfResidence) : 0;
  const ded24b      = Math.min(homeLoanInterest, 200000); // self-occ cap in old regime
  const dedStdOld   = has("salary") || form.employmentType === "pensioner" ? STD_DED_OLD : 0;

  const deductionsOld = {
    stdDeduction: dedStdOld,
    hra: dedHRA,
    section24b: ded24b,
    section80C: ded80C,
    section80CCD1B: ded80CCD1B,
    section80D: ded80D,
    section80E: ded80E,
    section80G: ded80G,
    section80TTB: ded80TTB,
    section80TTA: ded80TTA,
  };

  const totalDeductionsOld = Object.values(deductionsOld).reduce((a, b) => a + b, 0);
  const taxableIncomeOld   = Math.max(0, slabIncome - totalDeductionsOld);
  const taxLiabilityOld    = computeTaxOnTaxableIncome(
    taxableIncomeOld, "old", ageCategory as AgeCategory, cgForEngine,
  ).totalTax;

  // ── 3. NEW REGIME ────────────────────────────────────────────────────────

  const dedStdNew = has("salary") || form.employmentType === "pensioner" ? STD_DED_NEW : 0;
  // Let-out rental loan interest deductible in New Regime too (no cap)
  // Self-occ home loan interest NOT deductible in New Regime
  // HRA NOT available in New Regime

  const deductionsNew = {
    stdDeduction: dedStdNew,
    // Let-out loan interest already deducted from rentalNetIncome above — no separate entry
  };

  const totalDeductionsNew  = dedStdNew;
  const taxableIncomeNew    = Math.max(0, slabIncome - totalDeductionsNew);
  const taxLiabilityNew     = computeTaxOnTaxableIncome(
    taxableIncomeNew, "new", ageCategory as AgeCategory, cgForEngine,
  ).totalTax;

  // ── 4. Regime recommendation ─────────────────────────────────────────────

  const recommendedRegime = taxLiabilityOld <= taxLiabilityNew ? "Old Regime" : "New Regime";
  const potentialSavings  = Math.abs(taxLiabilityOld - taxLiabilityNew);

  // Break-even deduction threshold (how much Old-Regime deduction needed to beat New)
  // Solve: slabTaxOld(slab - D) = slabTaxNew(slab - stdNew)
  // Approximate: extra deduction needed = (taxLiabilityNew - taxLiabilityOld) / marginal_rate
  const marginalRate = taxableIncomeOld > 1000000 ? 0.30 : taxableIncomeOld > 500000 ? 0.20 : 0.05;
  const breakEvenExtraDeductions = recommendedRegime === "New Regime"
    ? Math.round(potentialSavings / (marginalRate * (1 + CESS)))
    : 0;

  // ── 5. Investment recommendations ────────────────────────────────────────

  const investmentRecommendations: {
    sectionKey: string; sectionLabel: string; instrument: string;
    amount: number; taxSaving: number; details: any;
    regimeNote: string; appliesTo: "OLD only" | "BOTH";
  }[] = [];

  let additionalInvestmentNeeded = 0;

  const sectionsToFill = ["Sec 123", "Sec 124 (NPS)", "Sec 126 (Health Ins.)"];

  for (const sKey of sectionsToFill) {
    const meta = DEDUCTION_SECTIONS.find((d) => d.section === sKey || d.key === sKey
      || d.section.startsWith(sKey.split(" ")[0]));
    // Find by section label
    const secMeta = DEDUCTION_SECTIONS.find((d) => d.section === sKey);
    if (!secMeta) continue;

    let currentDed = 0;
    if (sKey === "Sec 123")              currentDed = ded80C;
    else if (sKey === "Sec 124 (NPS)")   currentDed = ded80CCD1B;
    else if (sKey === "Sec 126 (Health Ins.)") currentDed = ded80D;

    const maxDed = secMeta.max === Infinity ? 50000 : secMeta.max;
    const remaining = maxDed - currentDed;
    if (remaining <= 0) continue;

    const instruments = INVESTMENT_INSTRUMENTS[sKey]?.[riskAppetite.toLowerCase()];
    if (!instruments?.length) continue;

    const instrument = instruments[0];
    additionalInvestmentNeeded += remaining;

    // Marginal tax saving = tax saved by claiming `remaining` more deduction in
    // the Old Regime. Slab-only (capital gains are unaffected, so they cancel).
    const taxWith = computeTaxOnTaxableIncome(
      taxableIncomeOld, "old", ageCategory as AgeCategory,
    ).totalTax;
    const taxWithout = computeTaxOnTaxableIncome(
      taxableIncomeOld + remaining, "old", ageCategory as AgeCategory,
    ).totalTax;
    const taxSaving = Math.max(0, taxWithout - taxWith);

    investmentRecommendations.push({
      sectionKey: sKey,
      sectionLabel: secMeta.section,
      instrument: instrument.name,
      amount: remaining,
      taxSaving,
      details: instrument,
      regimeNote: "Reduces tax in Old Regime only. No impact on New Regime.",
      appliesTo: "OLD only",
    });
  }

  // ── 6. 5-year projection ─────────────────────────────────────────────────

  let totalInvested = 0;
  let totalCorpus   = 0;
  investmentRecommendations.forEach((rec) => {
    const annual = rec.amount;
    // Approximate 5-year SIP corpus: sum of yearly FV
    let corpus = 0;
    const r = RETURN_MIDPOINTS[rec.instrument] ?? 0.08;
    for (let yr = 1; yr <= 5; yr++) corpus += annual * Math.pow(1 + r, yr);
    totalInvested += annual * 5;
    totalCorpus   += corpus;
  });
  const projectedGrowthPct = totalInvested > 0
    ? Math.round(((totalCorpus - totalInvested) / totalInvested) * 100)
    : 0;

  // ── 7. ITR form recommendation ───────────────────────────────────────────

  let itrForm = "ITR-1";
  const totalSources = activeIncomeStreams.length;
  if (has("business") || has("professional")) {
    itrForm = "ITR-4 (Sugam)";
    // If total income > ₹50L, must use ITR-3
    if (slabIncome > 5000000) itrForm = "ITR-3";
  } else if (has("capital_gains") || (has("rental") && activeIncomeStreams.length > 2)) {
    itrForm = "ITR-2";
  }

  return {
    // Income breakdown
    salaryIncome, businessProfit, professionalProfit,
    rentalNAV, rentalStdDed, rentalNetIncome,
    slabIncome, cgTax,
    taxableEquityStcg, taxableEquityLtcg, taxableOtherLtcg,

    // Old regime
    deductionsOld, totalDeductionsOld, taxableIncomeOld, taxLiabilityOld,

    // New regime
    deductionsNew, totalDeductionsNew, taxableIncomeNew, taxLiabilityNew,

    // Summary
    recommendedRegime, potentialSavings, breakEvenExtraDeductions,

    // Investments
    additionalInvestmentNeeded, investmentRecommendations,

    // Projection
    totalInvested, totalCorpus, projectedGrowthPct,

    // Meta
    itrForm, riskAppetite, liquidityNeeds,
    activeIncomeStreams,
  };
}

// ─── Regime badge ─────────────────────────────────────────────────────────────

const RegimeBadge = ({ applies }: { applies: "OLD only" | "BOTH" | "NEW only" }) => (
  <span className={cn(
    "text-[10px] font-semibold px-2 py-0.5 rounded-full border",
    applies === "OLD only"
      ? "bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20"
      : applies === "NEW only"
      ? "bg-green-500/10 text-green-600 dark:text-green-400 border-green-500/20"
      : "bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-500/20",
  )}>
    {applies === "OLD only" ? "Old Regime only" : applies === "NEW only" ? "New Regime only" : "Both Regimes"}
  </span>
);

// ─── Component ────────────────────────────────────────────────────────────────

const TaxPlanOutput: React.FC<TaxPlanOutputProps> = ({
  formData, calculatedData, onGoBack, isLoadedFromDb,
}) => {
  const { user } = useAuth();
  const { toast } = useToast();

  const [calcError, setCalcError] = React.useState<string | null>(null);

  const calc = useMemo(() => {
    if (calculatedData) return calculatedData;
    if (!formData) return null;
    try {
      return runCalculations(formData);
    } catch (err: any) {
      console.error("[TaxPlanOutput] Calculation error:", err);
      setCalcError(err?.message || "Calculation failed");
      return null;
    }
  }, [formData, calculatedData]);

  useEffect(() => {
    if (!user || isLoadedFromDb || !calc) return;
    saveTaxPlannerOutput(user.id, calc).catch(() =>
      toast({ title: "Error", description: "Failed to save tax recommendations.", variant: "destructive" }),
    );
  }, [user, calc, isLoadedFromDb]);

  if (!calc) return (
    <div className="glass-card p-6 text-center space-y-3">
      <div className="h-12 w-12 rounded-2xl bg-destructive/10 flex items-center justify-center mx-auto">
        <AlertTriangle className="h-6 w-6 text-destructive" />
      </div>
      <div>
        <p className="text-sm font-bold text-foreground">Couldn't calculate results</p>
        <p className="text-xs text-muted-foreground mt-1">
          {calcError || "Please go back and check your inputs."}
        </p>
      </div>
      <Button variant="outline" size="sm" onClick={onGoBack} className="pointer-events-auto rounded-xl">
        Go back and edit
      </Button>
    </div>
  );

  const {
    salaryIncome, businessProfit, professionalProfit, rentalNetIncome,
    slabIncome, cgTax,
    taxableEquityStcg, taxableEquityLtcg, taxableOtherLtcg,
    deductionsOld, totalDeductionsOld, taxableIncomeOld, taxLiabilityOld,
    totalDeductionsNew, taxableIncomeNew, taxLiabilityNew,
    recommendedRegime, potentialSavings, breakEvenExtraDeductions,
    additionalInvestmentNeeded, investmentRecommendations,
    totalInvested, totalCorpus, projectedGrowthPct,
    itrForm, riskAppetite, liquidityNeeds, activeIncomeStreams,
  } = calc;

  const has = (s: IncomeStream) => activeIncomeStreams?.includes(s);
  const totalTax = recommendedRegime === "Old Regime" ? taxLiabilityOld : taxLiabilityNew;

  // ── RENDER ────────────────────────────────────────────────────────────────
  return (
    <div className="space-y-6">

      {/* ── BLOCK 1: Quick Summary ─────────────────────────────────────────── */}
      <Card className="glass-card p-4 sm:p-6 bg-gradient-to-br from-primary/10 to-primary-glow/10 border-primary/20">
        <CardHeader className="p-0 mb-4">
          <CardTitle className="text-xl sm:text-2xl font-bold gradient-text">Tax Summary · FY 2026-27</CardTitle>
          <p className="text-xs text-muted-foreground mt-1">As per Income Tax Act 2025 — effective 1 April 2026</p>
        </CardHeader>
        <CardContent className="p-0 space-y-4">
          <div className="grid grid-cols-2 gap-3">
            {[
              { label: "Recommended Regime", value: recommendedRegime, highlight: true },
              { label: "Total Tax (recommended)", value: formatFullINR(totalTax), highlight: false },
              { label: "Old Regime Tax",  value: formatFullINR(taxLiabilityOld),  highlight: false },
              { label: "New Regime Tax",  value: formatFullINR(taxLiabilityNew),  highlight: false },
            ].map(({ label, value, highlight }) => (
              <div key={label} className={cn("rounded-xl p-3 border", highlight ? "bg-primary/10 border-primary/20" : "bg-background/50 border-border/40")}>
                <p className="text-xs text-muted-foreground">{label}</p>
                <p className={cn("text-base font-bold mt-0.5", highlight ? "text-primary" : "text-foreground")}>{value}</p>
              </div>
            ))}
          </div>

          {potentialSavings > 0 && (
            <div className="rounded-xl bg-green-500/10 border border-green-500/20 p-3 flex items-center gap-2">
              <TrendingUp className="h-4 w-4 text-green-600 dark:text-green-400 shrink-0" />
              <p className="text-sm text-green-700 dark:text-green-300">
                You save <span className="font-bold">{formatFullINR(potentialSavings)}</span> by choosing the {recommendedRegime}.
                {breakEvenExtraDeductions > 0 && (
                  <span className="text-muted-foreground"> You'd need <strong>{formatFullINR(breakEvenExtraDeductions)}</strong> more in Old-Regime deductions to make it worth switching.</span>
                )}
              </p>
            </div>
          )}

          {/* ITR form + default-regime reminder */}
          <div className="flex flex-wrap gap-2">
            <span className="text-xs bg-muted/50 border border-border/40 rounded-lg px-2 py-1">
              📄 File: <strong>{itrForm}</strong>
            </span>
            <span className="text-xs bg-amber-500/10 border border-amber-500/20 text-amber-700 dark:text-amber-400 rounded-lg px-2 py-1">
              ⚠️ New Regime is the default — opt for Old via Form 10-IEA before filing
            </span>
          </div>
        </CardContent>
      </Card>

      {/* ── BLOCK 2: Income Breakdown ─────────────────────────────────────── */}
      <Card className="glass-card p-4 sm:p-6">
        <CardHeader className="p-0 mb-4">
          <CardTitle className="text-lg font-semibold">Income Breakdown</CardTitle>
          <p className="text-xs text-muted-foreground">How your total income is composed</p>
        </CardHeader>
        <CardContent className="p-0 space-y-2">
          {has("salary") && salaryIncome > 0 && (
            <div className="flex items-center justify-between py-2 border-b border-border/30">
              <div className="flex items-center gap-2"><Briefcase className="h-4 w-4 text-muted-foreground" /><span className="text-sm">Salary / Pension</span></div>
              <span className="text-sm font-medium">{formatFullINR(salaryIncome)}</span>
            </div>
          )}
          {has("business") && businessProfit > 0 && (
            <div className="flex items-center justify-between py-2 border-b border-border/30">
              <div className="flex items-center gap-2"><Building2 className="h-4 w-4 text-muted-foreground" /><span className="text-sm">Business Profit (44AD — {calc.businessDigitalPercent >= 95 ? "6%" : "8%"} of turnover)</span></div>
              <span className="text-sm font-medium">{formatFullINR(businessProfit)}</span>
            </div>
          )}
          {has("professional") && professionalProfit > 0 && (
            <div className="flex items-center justify-between py-2 border-b border-border/30">
              <div className="flex items-center gap-2"><Briefcase className="h-4 w-4 text-muted-foreground" /><span className="text-sm">Professional Profit (44ADA — 50% of receipts)</span></div>
              <span className="text-sm font-medium">{formatFullINR(professionalProfit)}</span>
            </div>
          )}
          {has("rental") && rentalNetIncome > 0 && (
            <div className="flex items-center justify-between py-2 border-b border-border/30">
              <div className="flex items-center gap-2"><Home className="h-4 w-4 text-muted-foreground" /><span className="text-sm">Rental Income (after 30% std ded. + loan interest)</span></div>
              <span className="text-sm font-medium">{formatFullINR(rentalNetIncome)}</span>
            </div>
          )}
          {(calc.otherIncome > 0 || calc.otherStcg > 0) && (
            <div className="flex items-center justify-between py-2 border-b border-border/30">
              <div className="flex items-center gap-2"><Banknote className="h-4 w-4 text-muted-foreground" /><span className="text-sm">Other Income (interest, other STCG etc.)</span></div>
              <span className="text-sm font-medium">{formatFullINR((calc.otherIncome || 0) + (calc.otherStcg || 0))}</span>
            </div>
          )}
          <div className="flex items-center justify-between py-2 font-semibold border-b border-border/50">
            <span className="text-sm">Slab Income (GTI)</span>
            <span className="text-sm">{formatFullINR(slabIncome)}</span>
          </div>

          {/* Capital gains — separate section */}
          {has("capital_gains") && cgTax > 0 && (
            <div className="mt-3 rounded-xl bg-amber-500/10 border border-amber-500/20 p-3 space-y-2">
              <div className="flex items-center gap-2">
                <BarChart2 className="h-4 w-4 text-amber-600 dark:text-amber-400" />
                <p className="text-sm font-semibold text-amber-700 dark:text-amber-300">Capital Gains (flat rates — outside slab)</p>
              </div>
              {taxableEquityStcg > 0 && (
                <div className="flex justify-between text-xs text-muted-foreground">
                  <span>Equity STCG × 20%</span>
                  <span>{formatFullINR(Math.round(taxableEquityStcg * EQUITY_STCG_RATE * (1 + CESS)))}</span>
                </div>
              )}
              {taxableEquityLtcg > 0 && (
                <div className="flex justify-between text-xs text-muted-foreground">
                  <span>Equity LTCG (above ₹1.25 L) × 12.5%</span>
                  <span>{formatFullINR(Math.round(taxableEquityLtcg * EQUITY_LTCG_RATE * (1 + CESS)))}</span>
                </div>
              )}
              {taxableOtherLtcg > 0 && (
                <div className="flex justify-between text-xs text-muted-foreground">
                  <span>Other LTCG × 12.5%</span>
                  <span>{formatFullINR(Math.round(taxableOtherLtcg * OTHER_LTCG_RATE * (1 + CESS)))}</span>
                </div>
              )}
              <div className="flex justify-between text-xs font-semibold border-t border-amber-500/20 pt-2">
                <span>Total CG Tax (incl. 4% cess)</span>
                <span>{formatFullINR(Math.round(cgTax))}</span>
              </div>
              <p className="text-[10px] text-amber-600 dark:text-amber-400">87A rebate does NOT apply to capital gains. Changing tax regime does not affect this amount.</p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* ── BLOCK 3: Regime Comparison ────────────────────────────────────── */}
      <Card className="glass-card p-4 sm:p-6">
        <CardHeader className="p-0 mb-4">
          <CardTitle className="text-lg font-semibold">Regime Comparison</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {/* Desktop */}
          <div className="hidden sm:block overflow-x-auto">
            <table className="w-full text-sm text-left border-collapse">
              <thead>
                <tr className="border-b border-border/50">
                  <th className="py-2 px-3 text-muted-foreground font-medium">Particulars</th>
                  <th className="py-2 px-3 text-foreground font-medium">Old Regime (₹)</th>
                  <th className="py-2 px-3 text-foreground font-medium">New Regime (₹)</th>
                </tr>
              </thead>
              <tbody>
                {[
                  { label: "Slab Income (GTI)", old: slabIncome, new: slabIncome },
                  { label: "Total Deductions", old: -totalDeductionsOld, new: -totalDeductionsNew, neg: true },
                  { label: "Taxable Slab Income", old: taxableIncomeOld, new: taxableIncomeNew, bold: true },
                  { label: "Slab Tax", old: (taxLiabilityOld - cgTax) / (1 + CESS), new: (taxLiabilityNew - cgTax) / (1 + CESS) },
                  { label: "Capital Gains Tax (flat)", old: cgTax / (1 + CESS), new: cgTax / (1 + CESS) },
                  { label: "Health & Education Cess (4%)", old: (taxLiabilityOld) - (taxLiabilityOld / (1 + CESS)), new: (taxLiabilityNew) - (taxLiabilityNew / (1 + CESS)) },
                  { label: "Total Tax Liability", old: taxLiabilityOld, new: taxLiabilityNew, bold: true, primary: true },
                ].map(({ label, old: o, new: n, neg, bold, primary }) => (
                  <tr key={label} className={cn("border-b border-border/30", primary && "bg-primary/10 font-bold text-primary")}>
                    <td className="py-2 px-3">{label}</td>
                    <td className={cn("py-2 px-3", neg && "text-destructive", bold && "font-semibold")}>{neg ? `-${formatFullINR(Math.abs(o))}` : formatFullINR(Math.round(o))}</td>
                    <td className={cn("py-2 px-3", neg && "text-destructive", bold && "font-semibold")}>{neg ? `-${formatFullINR(Math.abs(n))}` : formatFullINR(Math.round(n))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {/* Mobile */}
          <div className="block sm:hidden space-y-2">
            {[
              { label: "Slab Income (GTI)", old: slabIncome, new: slabIncome },
              { label: "Deductions", old: -totalDeductionsOld, new: -totalDeductionsNew, neg: true },
              { label: "Taxable Slab Income", old: taxableIncomeOld, new: taxableIncomeNew },
              { label: "Capital Gains Tax", old: cgTax, new: cgTax },
              { label: "Total Tax", old: taxLiabilityOld, new: taxLiabilityNew, primary: true },
            ].map(({ label, old: o, new: n, neg, primary }) => (
              <div key={label} className={cn("rounded-lg border p-3", primary ? "bg-primary/10 border-primary/20" : "bg-background/50 border-border/40")}>
                <p className={cn("text-xs font-semibold mb-1", primary ? "text-primary" : "text-foreground")}>{label}</p>
                <div className="flex justify-between text-xs">
                  <span className="text-muted-foreground">Old:</span>
                  <span className={cn("font-medium", neg && "text-destructive", primary && "text-primary")}>{neg ? `-${formatFullINR(Math.abs(o))}` : formatFullINR(Math.round(o))}</span>
                </div>
                <div className="flex justify-between text-xs">
                  <span className="text-muted-foreground">New:</span>
                  <span className={cn("font-medium", neg && "text-destructive", primary && "text-primary")}>{neg ? `-${formatFullINR(Math.abs(n))}` : formatFullINR(Math.round(n))}</span>
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* ── BLOCK 4: Section-wise Deductions ─────────────────────────────── */}
      <Card className="glass-card p-4 sm:p-6">
        <CardHeader className="p-0 mb-4">
          <CardTitle className="text-lg font-semibold">Section-wise Deductions</CardTitle>
          <p className="text-xs text-muted-foreground">Section numbers updated as per Income Tax Act 2025 (effective 1 Apr 2026)</p>
        </CardHeader>
        <CardContent className="p-0 space-y-2">
          {DEDUCTION_SECTIONS
            .filter((d) => {
              // Hide 80TTB for non-seniors, 80TTA for seniors
              if (d.key === "section80TTB" && !(formData?.ageCategory === "60-80" || formData?.ageCategory === ">80")) return false;
              if (d.key === "section80TTA" &&  (formData?.ageCategory === "60-80" || formData?.ageCategory === ">80")) return false;
              return true;
            })
            .map((d) => {
              const oldAmt = (deductionsOld as any)[d.key] ?? 0;
              const isOldOnly = d.regime.includes("OLD only");
              const Icon = d.icon;
              return (
                <div key={d.key} className="flex flex-col sm:flex-row sm:items-center gap-2 py-2 border-b border-border/30 last:border-0">
                  <div className="flex items-center gap-2 flex-1 min-w-0">
                    <Icon className="h-4 w-4 text-muted-foreground shrink-0" />
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm font-medium">{d.section}</span>
                        <RegimeBadge applies={isOldOnly ? "OLD only" : "BOTH"} />
                      </div>
                      <p className="text-xs text-muted-foreground truncate">{d.notes}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-4 shrink-0 text-sm">
                    <div className="text-right">
                      <p className="text-[10px] text-muted-foreground">Old Regime</p>
                      <p className="font-semibold">{formatFullINR(oldAmt)}</p>
                    </div>
                    <div className="text-right">
                      <p className="text-[10px] text-muted-foreground">New Regime</p>
                      {isOldOnly
                        ? <XCircle className="h-4 w-4 text-destructive ml-auto" />
                        : <p className="font-semibold">{formatFullINR(d.key === "stdDeduction" ? (calc.deductionsNew?.stdDeduction ?? 0) : oldAmt)}</p>}
                    </div>
                    {d.max !== Infinity && (
                      <div className="text-right">
                        <p className="text-[10px] text-muted-foreground">Max</p>
                        <p className="text-xs text-muted-foreground">{formatFullINR(d.max)}</p>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
        </CardContent>
      </Card>

      {/* ── BLOCK 5: Investment Schedule ─────────────────────────────────── */}
      <Card className="glass-card p-4 sm:p-6">
        <CardHeader className="p-0 mb-4">
          <CardTitle className="text-lg font-semibold">Investment Schedule</CardTitle>
          <p className="text-sm text-muted-foreground">
            Based on your <strong>{riskAppetite}</strong> risk appetite and <strong>{liquidityNeeds}</strong> liquidity needs.
          </p>
        </CardHeader>
        <CardContent className="p-0 space-y-4">
          {investmentRecommendations.length > 0 ? investmentRecommendations.map((rec, i) => (
            <div key={i} className="border border-border/50 rounded-xl p-4 bg-background/50 space-y-3">
              {/* Header row — instrument name + badge, regime note below */}
              <div className="flex items-center justify-between gap-2">
                <div>
                  <h4 className="font-semibold text-foreground whitespace-nowrap">{rec.instrument.replace("Tier-I", "Tier I").replace("Tier-II", "Tier II")}</h4>
                  <p className="text-xs text-muted-foreground">{rec.sectionLabel}</p>
                </div>
                <RegimeBadge applies="OLD only" />
              </div>
              <p className="text-xs text-muted-foreground -mt-1">{rec.regimeNote}</p>
              {/* Stats grid — always 2 cols on mobile, tight spacing */}
              <div className="grid grid-cols-2 gap-2 text-sm">
                <div>
                  <p className="flex items-center gap-1 text-muted-foreground text-[10px]"><HandCoins className="h-3 w-3" />Invest</p>
                  <p className="font-semibold text-sm">{formatFullINR(rec.amount)}</p>
                </div>
                <div>
                  <p className="flex items-center gap-1 text-muted-foreground text-[10px]"><TrendingUp className="h-3 w-3" />Tax Saved</p>
                  <p className="font-semibold text-sm text-green-600 dark:text-green-400">{formatFullINR(Math.round(rec.taxSaving))}</p>
                </div>
                <div>
                  <p className="flex items-center gap-1 text-muted-foreground text-[10px]"><Percent className="h-3 w-3" />Expected Return</p>
                  <p className="font-semibold text-sm">{rec.details.return}</p>
                </div>
                <div>
                  <p className="flex items-center gap-1 text-muted-foreground text-[10px]"><Hourglass className="h-3 w-3" />Lock-in</p>
                  <p className="font-semibold text-sm">{rec.details.lockin}</p>
                </div>
              </div>
              <p className="text-[10px] text-muted-foreground border-t border-border/30 pt-2">
                Deadline: 31 Mar 2027 · Consult a SEBI-registered advisor for platform selection.
              </p>
            </div>
          )) : (
            <p className="text-muted-foreground text-center py-6 text-sm">
              All deduction limits are already fully utilised. No additional investments needed. 🎉
            </p>
          )}
        </CardContent>
      </Card>

      {/* ── BLOCK 6: Cash-Flow & 5-Year Projection ───────────────────────── */}
      <Card className="glass-card p-4 sm:p-6">
        <CardHeader className="p-0 mb-4">
          <CardTitle className="text-lg font-semibold">Cash-Flow & 5-Year Projection</CardTitle>
        </CardHeader>
        <CardContent className="p-0 space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="rounded-xl bg-background/50 border border-border/40 p-3 text-center">
              <p className="text-xs text-muted-foreground">Tax Saved (regime switch)</p>
              <p className="text-xl font-bold text-green-600 dark:text-green-400 mt-1">{formatFullINR(Math.round(potentialSavings))}</p>
            </div>
            <div className="rounded-xl bg-background/50 border border-border/40 p-3 text-center">
              <p className="text-xs text-muted-foreground">Additional Investment Needed</p>
              <p className="text-xl font-bold text-amber-600 dark:text-amber-400 mt-1">{formatFullINR(additionalInvestmentNeeded)}</p>
            </div>
            <div className="rounded-xl bg-primary/10 border border-primary/20 p-3 text-center">
              <p className="text-xs text-muted-foreground">Projected 5-yr Growth</p>
              <p className="text-xl font-bold text-primary mt-1">
                {totalInvested > 0 ? `~${projectedGrowthPct}%` : "N/A"}
              </p>
            </div>
          </div>
          {totalInvested > 0 && (
            <div className="rounded-xl bg-muted/30 border border-border/40 p-3 space-y-1 text-sm text-muted-foreground">
              <p>Total invested over 5 years: <strong className="text-foreground">{formatFullINR(totalInvested)}</strong></p>
              <p>Estimated corpus after 5 years: <strong className="text-foreground">{formatFullINR(Math.round(totalCorpus))}</strong></p>
              <p className="text-xs">Returns calculated using annual SIP FV model at each instrument's midpoint return. Actual returns vary with market conditions.</p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* ── BLOCK 7: Compliance & Checklist ──────────────────────────────── */}
      <Card className="glass-card p-4 sm:p-6">
        <CardHeader className="p-0 mb-4">
          <CardTitle className="text-lg font-semibold">Compliance & Document Checklist</CardTitle>
        </CardHeader>
        <CardContent className="p-0 space-y-4">
          <div>
            <h4 className="text-sm font-semibold mb-2">Compliance Notes</h4>
            <ul className="space-y-1.5 text-sm text-muted-foreground">
              <li className="flex gap-2"><Info className="h-4 w-4 shrink-0 mt-0.5" /><span>Calculations are based on the <strong>Income Tax Act 2025</strong>, effective 1 April 2026 (replaces Income Tax Act 1961).</span></li>
              <li className="flex gap-2"><Info className="h-4 w-4 shrink-0 mt-0.5" /><span>Final tax filing must reconcile with your <strong>Form 130</strong> (new Form 16), Form 168 (26AS) and AIS.</span></li>
              <li className="flex gap-2"><Info className="h-4 w-4 shrink-0 mt-0.5" /><span>For capital gains, business audits, or foreign income, consult a Chartered Accountant.</span></li>
              <li className="flex gap-2"><Info className="h-4 w-4 shrink-0 mt-0.5" /><span>Revised ITR deadline: ITR-3 / ITR-4 extended to <strong>31 August 2026</strong>. ITR-1 / ITR-2 due by 31 July 2026.</span></li>
              <li className="flex gap-2"><AlertTriangle className="h-4 w-4 shrink-0 mt-0.5 text-amber-500" /><span>New Regime is the <strong>default</strong>. To use Old Regime, file <strong>Form 10-IEA</strong> before ITR submission deadline.</span></li>
            </ul>
          </div>
          <Separator />
          <div>
            <h4 className="text-sm font-semibold mb-2">Documents to Gather</h4>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1 text-sm text-muted-foreground">
              {[
                "PAN Card + Aadhaar",
                "Form 130 (new Form 16) from employer",
                "Form 168 (26AS) + AIS from IT portal",
                has("salary") && "Rent receipts (for HRA under Sec 10(13A))",
                (calc.homeLoanPrincipal > 0 || calc.homeLoanInterest > 0) && "Home loan principal & interest certificates",
                has("business") && "Business turnover records / bank statements",
                has("professional") && "Professional receipts / invoices",
                has("rental") && "Rental agreements + municipal tax receipts",
                has("capital_gains") && "Broker contract notes / capital gains statement",
                "Investment proofs (PPF passbook, ELSS / NPS statements)",
                "Health insurance premium receipts",
                calc.educationLoanInterest > 0 && "Education loan interest certificate",
                calc.donations80G > 0 && "Donation receipts (80G / Sec 132)",
              ].filter(Boolean).map((doc, i) => (
                <div key={i} className="flex items-center gap-1.5">
                  <span className="h-1.5 w-1.5 rounded-full bg-primary shrink-0" />
                  <span>{doc as string}</span>
                </div>
              ))}
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="flex justify-center pb-4">
        <Button onClick={onGoBack} className="pointer-events-auto px-8">
          ← Back to Planner
        </Button>
      </div>
    </div>
  );
};

export default TaxPlanOutput;
