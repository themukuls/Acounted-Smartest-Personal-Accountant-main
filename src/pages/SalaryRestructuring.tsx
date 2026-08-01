import { useNavigate } from "react-router-dom";
import { useState } from "react";
import { AppLayout } from "@/components/layout/AppLayout";
import { GlassCard } from "@/components/ui/glass-card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  ArrowLeft, Briefcase, TrendingDown, Info, Sparkles,
  ChevronDown, AlertTriangle,
} from "lucide-react";
import { formatFullINR, formatCompactINR } from "@/lib/currency";
import { cn } from "@/lib/utils";
import { computeTaxOnTaxableIncome, type AgeCategory } from "@/lib/tax";

// ─── Types ────────────────────────────────────────────────────────────────────

interface SalaryComponents {
  basic: number;
  hra: number;
  lta: number;
  food_coupons: number;
  mobile_reimbursement: number;
  nps_employer: number;
  special_allowance: number;
  other: number;
}

interface TaxInputs {
  rent_paid_annual: number;
  city: string;          // free-text city name
  regime: "old" | "new";
  age: "below60" | "60to80" | "above80";
}

// ─── Metro city list — Income Tax Rules 2026 (8 cities at 50%) ────────────────
const METRO_CITIES_50 = [
  "mumbai", "delhi", "new delhi", "kolkata", "chennai",
  "bengaluru", "bangalore", "pune", "hyderabad", "ahmedabad",
];

function isMetro(city: string): boolean {
  return METRO_CITIES_50.some((m) => city.toLowerCase().trim().includes(m));
}

function calcHRAExemption(
  basic: number, hra: number, rentAnnual: number, city: string,
): number {
  if (rentAnnual <= 0 || hra <= 0) return 0;
  const rate = isMetro(city) ? 0.5 : 0.4;
  const a = hra;
  const b = Math.max(0, rentAnnual - 0.1 * basic);
  const c = rate * basic;
  return Math.max(0, Math.min(a, b, c));
}

// ─── Tax calculation ─────────────────────────────────────────────────────────
// Slab tax, 87A rebate, surcharge and cess all come from the shared engine
// (src/lib/tax) — the single source of truth. This page only derives the
// taxable income from salary components; the engine does the tax math.

const AGE_MAP: Record<TaxInputs["age"], AgeCategory> = {
  below60: "<60",
  "60to80": "60-80",
  above80: ">80",
};

/** Total tax (incl. rebate, surcharge, cess) on an already-taxable income. */
function computeTotalTax(
  taxableIncome: number,
  regime: "old" | "new",
  age: TaxInputs["age"],
): number {
  return computeTaxOnTaxableIncome(taxableIncome, regime, AGE_MAP[age]).totalTax;
}

// ─── Deduction calculator ─────────────────────────────────────────────────────

function calcDeductions(
  comp: SalaryComponents,
  inputs: TaxInputs,
  isOptimised: boolean,
): number {
  if (inputs.regime === "new") {
    // New regime: standard deduction + employer NPS (80CCD(2)) — up to 14% basic
    const stdDed = 75000;
    const npsDed = Math.min(comp.nps_employer, comp.basic * 0.14);
    return stdDed + npsDed;
  }

  // Old regime
  const stdDed    = 50000;
  const hraExempt = calcHRAExemption(comp.basic, comp.hra, inputs.rent_paid_annual, inputs.city);
  const ltaExempt = comp.lta;                                 // simplified: full LTA exempt
  const foodExempt  = Math.min(comp.food_coupons, 26400);    // ₹2,200/month cap
  const mobileExempt = Math.min(comp.mobile_reimbursement, 24000);
  const ded80C    = 150000;                                   // assumed maxed
  const ded80D    = 25000;                                    // assumed basic
  // 80CCD(2): employer NPS up to 10% of basic in old regime
  const npsDed    = Math.min(comp.nps_employer, comp.basic * 0.10);

  return stdDed + hraExempt + ltaExempt + foodExempt + mobileExempt + ded80C + ded80D + npsDed;
}

// ─── Component ────────────────────────────────────────────────────────────────

const SalaryRestructuring = () => {
  const navigate = useNavigate();

  const [comp, setComp] = useState<SalaryComponents>({
    basic: 600000,
    hra: 300000,
    lta: 50000,
    food_coupons: 28800,
    mobile_reimbursement: 24000,
    nps_employer: 0,
    special_allowance: 300000,
    other: 0,
  });

  const [taxInputs, setTaxInputs] = useState<TaxInputs>({
    rent_paid_annual: 180000,
    city: "Mumbai",
    regime: "old",
    age: "below60",
  });

  const setC = (k: keyof SalaryComponents, v: string) =>
    setComp((prev) => ({ ...prev, [k]: parseFloat(v) || 0 }));
  const setT = <K extends keyof TaxInputs>(k: K, v: TaxInputs[K]) =>
    setTaxInputs((prev) => ({ ...prev, [k]: v }));

  // ── Current structure ──────────────────────────────────────────────────
  const grossCurrent  = Object.values(comp).reduce((s, v) => s + v, 0);
  const dedCurrent    = calcDeductions(comp, taxInputs, false);
  const taxableCurrent = Math.max(0, grossCurrent - dedCurrent);
  const totalTaxCurrent = computeTotalTax(taxableCurrent, taxInputs.regime, taxInputs.age);

  // ── Optimised structure — shift special allowance into tax-free components ──
  const npsBump = comp.nps_employer > 0
    ? 0
    : Math.round(comp.basic * (taxInputs.regime === "new" ? 0.14 : 0.10));
  const foodBump   = Math.max(0, 28800  - comp.food_coupons);
  const mobileBump = Math.max(0, 24000  - comp.mobile_reimbursement);
  const ltaBump    = Math.max(0, 50000  - comp.lta);
  const totalBump  = npsBump + foodBump + mobileBump + ltaBump;

  const optComp: SalaryComponents = {
    ...comp,
    food_coupons:          comp.food_coupons + foodBump,
    mobile_reimbursement:  comp.mobile_reimbursement + mobileBump,
    nps_employer:          comp.nps_employer + npsBump,
    lta:                   comp.lta + ltaBump,
    special_allowance:     Math.max(0, comp.special_allowance - totalBump),
  };

  const grossOpt    = Object.values(optComp).reduce((s, v) => s + v, 0);
  const dedOpt      = calcDeductions(optComp, taxInputs, true);
  const taxableOpt  = Math.max(0, grossOpt - dedOpt);
  const totalTaxOpt = computeTotalTax(taxableOpt, taxInputs.regime, taxInputs.age);

  const saving = Math.max(0, totalTaxCurrent - totalTaxOpt);

  // Metro detection for HRA hint
  const metro = isMetro(taxInputs.city);
  const hraRate = metro ? "50%" : "40%";

  // NPS employer cap depends on regime
  const npsCap = taxInputs.regime === "new" ? "14%" : "10%";
  const npsCapAmt = Math.round(comp.basic * (taxInputs.regime === "new" ? 0.14 : 0.10));

  const COMP_FIELDS: { key: keyof SalaryComponents; label: string; note?: string }[] = [
    { key: "basic",                label: "Basic Salary" },
    { key: "hra",                  label: "HRA",                                note: `${hraRate} of basic exempt (${metro ? "metro city" : "non-metro city"})` },
    { key: "lta",                  label: "LTA",                                note: "Exempt on actual travel twice in 4-yr block" },
    { key: "food_coupons",         label: "Food Coupons / Sodexo",              note: "Max ₹2,200/month (₹26,400/yr) exempt" },
    { key: "mobile_reimbursement", label: "Mobile Reimbursement",               note: "Up to ₹2,000/month on bills" },
    { key: "nps_employer",         label: "NPS Employer Contribution",          note: `80CCD(2): up to ${npsCap} of basic = ${formatCompactINR(npsCapAmt)} — works in BOTH regimes` },
    { key: "special_allowance",    label: "Special Allowance",                  note: "Fully taxable — ideal to shift into exempt components" },
    { key: "other",                label: "Other Allowances" },
  ];

  // NOTE: input persistence is intentionally omitted here. The previous
  // load/save effects referenced an undefined `React`/`user`/service and a
  // salary_restructuring store shape that no longer matches this page's state
  // model (food_coupons, mobile_reimbursement, age, free-text city). That code
  // threw at render — the page was blank. Persistence should be rebuilt against
  // the current SalaryComponents/TaxInputs model (tracked as a follow-up); for
  // now the page works as a live calculator.

  return (
    <AppLayout>
      <div className="space-y-5 mt-4 md:mt-0">

        {/* Header */}
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="sm" className="h-9 w-9 p-0 rounded-xl pointer-events-auto"
            onClick={() => navigate("/tax-copilot")}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div className="h-10 w-10 rounded-2xl bg-indigo-100 flex items-center justify-center shrink-0">
            <Briefcase className="h-5 w-5 text-indigo-600" />
          </div>
          <div>
            <h1 className="text-xl font-bold tracking-tight gradient-text">Salary Restructuring</h1>
            <p className="text-xs text-muted-foreground">Optimise CTC components · FY 2026-27</p>
          </div>
        </div>

        {/* Saving highlight */}
        {saving > 0 && (
          <GlassCard className="p-4 bg-gradient-to-br from-emerald-50/80 to-green-50/60 border-emerald-200/50">
            <div className="flex items-center gap-3">
              <div className="h-9 w-9 rounded-xl bg-emerald-100 flex items-center justify-center shrink-0">
                <TrendingDown className="h-4.5 w-4.5 text-emerald-600" />
              </div>
              <div className="flex-1">
                <p className="text-xs text-muted-foreground">Potential Tax Saving</p>
                <p className="text-2xl font-bold text-emerald-600">{formatFullINR(saving)}</p>
                <p className="text-xs text-muted-foreground">by restructuring your salary components</p>
              </div>
            </div>
            <div className="mt-3 pt-3 border-t border-emerald-200/50 grid grid-cols-3 gap-3">
              <div>
                <p className="text-xs text-muted-foreground">Current Tax</p>
                <p className="text-sm font-bold text-foreground">{formatFullINR(totalTaxCurrent)}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">After Restructure</p>
                <p className="text-sm font-bold text-emerald-600">{formatFullINR(totalTaxOpt)}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Taxable Income ↓</p>
                <p className="text-sm font-bold text-foreground">{formatFullINR(Math.max(0, taxableCurrent - taxableOpt))}</p>
              </div>
            </div>
          </GlassCard>
        )}

        {/* Settings */}
        <GlassCard className="p-4">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">Settings</p>
          <div className="grid grid-cols-2 gap-3">

            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1 block">Tax Regime</label>
              <div className="relative">
                <select value={taxInputs.regime} onChange={(e) => setT("regime", e.target.value as "old" | "new")}
                  className="w-full h-9 rounded-lg border border-input bg-background px-3 text-sm appearance-none pr-8 pointer-events-auto">
                  <option value="new">New Regime (default)</option>
                  <option value="old">Old Regime</option>
                </select>
                <ChevronDown className="absolute right-2.5 top-2.5 h-4 w-4 text-muted-foreground pointer-events-none" />
              </div>
            </div>

            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1 block">Age</label>
              <div className="relative">
                <select value={taxInputs.age} onChange={(e) => setT("age", e.target.value as TaxInputs["age"])}
                  className="w-full h-9 rounded-lg border border-input bg-background px-3 text-sm appearance-none pr-8 pointer-events-auto">
                  <option value="below60">Below 60</option>
                  <option value="60to80">60 – 80 yrs</option>
                  <option value="above80">Above 80 yrs</option>
                </select>
                <ChevronDown className="absolute right-2.5 top-2.5 h-4 w-4 text-muted-foreground pointer-events-none" />
              </div>
            </div>

            <div className="col-span-2">
              <label className="text-xs font-medium text-muted-foreground mb-1 block">City of residence</label>
              <Input
                type="text"
                value={taxInputs.city}
                onChange={(e) => setT("city", e.target.value)}
                placeholder="e.g. Mumbai, Bengaluru, Pune…"
                className="h-9 text-sm pointer-events-auto"
              />
              <p className="text-[10px] text-muted-foreground mt-1">
                {metro
                  ? "✅ Metro city — 50% HRA exemption applies (Income Tax Rules 2026)"
                  : "ℹ️ Non-metro — 40% HRA exemption applies"}
              </p>
            </div>

            {taxInputs.regime === "old" && (
              <div className="col-span-2">
                <label className="text-xs font-medium text-muted-foreground mb-1 block">Annual Rent Paid (₹) — for HRA</label>
                <Input type="number" value={taxInputs.rent_paid_annual || ""}
                  onChange={(e) => setT("rent_paid_annual", parseFloat(e.target.value) || 0)}
                  placeholder="0" className="h-9 text-sm pointer-events-auto" />
              </div>
            )}
          </div>
        </GlassCard>

        {/* Salary components input */}
        <GlassCard className="p-4">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">
            Current Salary Components (Annual ₹)
          </p>
          <div className="space-y-3">
            {COMP_FIELDS.map(({ key, label, note }) => (
              <div key={key}>
                <div className="flex items-center justify-between mb-1">
                  <label className="text-xs font-medium text-foreground">{label}</label>
                  {note && <span className="text-[10px] text-muted-foreground text-right max-w-[55%]">{note}</span>}
                </div>
                <Input
                  type="number"
                  value={comp[key] || ""}
                  onChange={(e) => setC(key, e.target.value)}
                  placeholder="0"
                  className="h-9 text-sm pointer-events-auto"
                />
              </div>
            ))}
          </div>
          <div className="mt-3 pt-3 border-t border-muted/30 flex items-center justify-between">
            <p className="text-xs text-muted-foreground">Total CTC</p>
            <p className="text-sm font-bold text-foreground">{formatFullINR(grossCurrent)}</p>
          </div>
        </GlassCard>

        {/* Tax summary cards */}
        <div className="grid grid-cols-2 gap-3">
          <GlassCard className="p-3">
            <p className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1">Taxable Income</p>
            <p className="text-sm font-bold text-foreground">{formatFullINR(taxableCurrent)}</p>
            <p className="text-[10px] text-muted-foreground mt-0.5">Deductions: {formatCompactINR(dedCurrent)}</p>
          </GlassCard>
          <GlassCard className="p-3">
            <p className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1">Current Tax (incl. cess)</p>
            <p className="text-sm font-bold text-foreground">{formatFullINR(totalTaxCurrent)}</p>
            <p className="text-[10px] text-muted-foreground mt-0.5">Effective rate: {grossCurrent > 0 ? ((totalTaxCurrent / grossCurrent) * 100).toFixed(1) : 0}%</p>
          </GlassCard>
        </div>

        {/* Optimisation suggestions — Old Regime */}
        {taxInputs.regime === "old" && (
          <GlassCard className="p-4 bg-amber-50/40 border-amber-200/40">
            <div className="flex items-center gap-2 mb-3">
              <Sparkles className="h-4 w-4 text-amber-600" />
              <p className="text-sm font-bold text-foreground">Optimisation Suggestions</p>
            </div>
            <div className="space-y-2.5">
              {comp.food_coupons < 26400 && (
                <div className="flex items-start gap-2">
                  <div className="h-1.5 w-1.5 rounded-full bg-amber-500 mt-1.5 shrink-0" />
                  <p className="text-xs text-foreground">
                    <span className="font-semibold">Increase Food Coupons</span> to ₹26,400/yr (₹2,200/month max exempt).
                    Extra tax-free: {formatCompactINR(Math.min(26400, comp.food_coupons + 26400) - comp.food_coupons)}.
                  </p>
                </div>
              )}
              {comp.nps_employer === 0 && (
                <div className="flex items-start gap-2">
                  <div className="h-1.5 w-1.5 rounded-full bg-amber-500 mt-1.5 shrink-0" />
                  <p className="text-xs text-foreground">
                    <span className="font-semibold">Add NPS Employer Contribution</span> u/s 80CCD(2) — up to 10% of basic
                    ({formatCompactINR(npsCapAmt)}) is fully tax-free and separate from the 80C limit.
                    This also works in the New Regime.
                  </p>
                </div>
              )}
              {comp.mobile_reimbursement < 24000 && (
                <div className="flex items-start gap-2">
                  <div className="h-1.5 w-1.5 rounded-full bg-amber-500 mt-1.5 shrink-0" />
                  <p className="text-xs text-foreground">
                    <span className="font-semibold">Add Mobile Reimbursement</span> of ₹2,000/month (₹24,000/yr) — tax-free on submission of bills.
                  </p>
                </div>
              )}
              {comp.lta < 50000 && (
                <div className="flex items-start gap-2">
                  <div className="h-1.5 w-1.5 rounded-full bg-amber-500 mt-1.5 shrink-0" />
                  <p className="text-xs text-foreground">
                    <span className="font-semibold">Claim LTA</span> — exempt twice in a 4-year block on actual domestic travel bills.
                  </p>
                </div>
              )}
              {comp.food_coupons >= 26400 && comp.nps_employer > 0 && comp.mobile_reimbursement >= 24000 && comp.lta >= 50000 && (
                <p className="text-xs text-muted-foreground">Your structure is already well-optimised. ✅</p>
              )}
            </div>
          </GlassCard>
        )}

        {/* New Regime info */}
        {taxInputs.regime === "new" && (
          <GlassCard className="p-4 bg-blue-50/40 border-blue-200/40">
            <div className="flex items-start gap-2.5">
              <Info className="h-4 w-4 text-blue-600 mt-0.5 shrink-0" />
              <div className="space-y-1.5">
                <p className="text-xs font-semibold text-blue-800">New Regime — What Still Works</p>
                <ul className="text-xs text-blue-700 space-y-1">
                  <li>• <strong>Standard Deduction</strong> ₹75,000 — automatic, no action needed</li>
                  <li>• <strong>Employer NPS u/s 80CCD(2)</strong> — up to <strong>14% of basic</strong> ({formatCompactINR(npsCapAmt)}) tax-free. The limit increased from 10% to 14% in the New Regime — use this aggressively.</li>
                  <li>• <strong>Gratuity, Leave Encashment, commuted pension</strong> — exempt in both regimes</li>
                  <li>• <strong>HRA, 80C, 80D, LTA</strong> — NOT available in New Regime</li>
                </ul>
                <p className="text-xs text-blue-600 pt-1">
                  Tip: If your total Old-Regime deductions (HRA + 80C + 80D + home loan interest) exceed
                  ~{formatCompactINR(Math.round(dedCurrent * 1.3))} consider switching to Old Regime.
                </p>
              </div>
            </div>
          </GlassCard>
        )}

        {/* Act 2025 note */}
        <GlassCard className="p-3 bg-muted/20 border-border/30">
          <div className="flex items-start gap-2">
            <AlertTriangle className="h-3.5 w-3.5 text-muted-foreground mt-0.5 shrink-0" />
            <p className="text-[10px] text-muted-foreground leading-relaxed">
              Calculations based on Income Tax Act 2025 (FY 2026-27). Standard deduction, NPS, HRA and slab rates confirmed unchanged by Budget 2026.
              NPS employer contribution cap is 14% in New Regime and 10% in Old Regime.
              Metro cities with 50% HRA: Mumbai, Delhi, Kolkata, Chennai, Bengaluru, Pune, Hyderabad, Ahmedabad.
            </p>
          </div>
        </GlassCard>

      </div>
    </AppLayout>
  );
};

export default SalaryRestructuring;
