"use client";

import React, { useState, useEffect } from "react";
import { AppLayout } from "@/components/layout/AppLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  ArrowLeft, ArrowRight, Sparkles, User, Wallet, Receipt,
  TrendingUp, RotateCcw, Briefcase, Building2, Home, BarChart2,
  CheckSquare, Square,
} from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { useAuth } from "@/contexts/AuthContext";
import TaxPlanOutput from "@/components/tax/TaxPlanOutput";
import {
  getTaxPlannerInput,
  saveTaxPlannerInput,
  getTaxPlannerOutput,
} from "@/integrations/indexeddb/services/taxPlannerService";
import { formatFullINR, formatCompactINR } from "@/lib/currency";
import { Bookmark, BookmarkCheck, Trash2 } from "lucide-react";
import {
  saveSimulation, loadSimulation, listSimulations, MAX_SIMULATIONS,
} from "@/integrations/indexeddb/services/taxSimulationService";
import { SimulationListCard } from "@/components/tax/SimulationListCard";

// ─── Types ────────────────────────────────────────────────────────────────────

export type IncomeStream = "salary" | "business" | "professional" | "rental" | "capital_gains";

export interface TaxFormData {
  // Personal
  ageCategory: string;
  residentStatus: string;
  cityOfResidence: string;

  // Active streams
  activeIncomeStreams: IncomeStream[];

  // Salary / Pension
  employmentType: string;
  annualGrossIncome: number;
  annualRentPaid: number;

  // Business 44AD
  businessTurnover: number;
  businessDigitalPercent: number; // 0–100

  // Professional 44ADA
  professionalReceipts: number;
  professionType: string;

  // Rental
  rentalGrossReceipts: number;
  rentalMunicipalTaxes: number;
  rentalHomeLoanInterest: number;

  // Capital gains
  equityStcg: number;
  equityLtcg: number;
  otherLtcg: number;
  otherStcg: number;

  // Other income
  otherIncome: number;

  // Deductions
  homeLoanPrincipal: number;
  homeLoanInterest: number;
  taxSavingInvestments: string;
  healthInsurancePremiums: number;
  educationLoanInterest: number;
  donations80G: number;

  // Preferences
  riskAppetite: string;
  liquidityNeeds: string;
}

const INITIAL_FORM: TaxFormData = {
  ageCategory: "", residentStatus: "", cityOfResidence: "",
  activeIncomeStreams: ["salary"],
  employmentType: "", annualGrossIncome: 0, annualRentPaid: 0,
  businessTurnover: 0, businessDigitalPercent: 0,
  professionalReceipts: 0, professionType: "",
  rentalGrossReceipts: 0, rentalMunicipalTaxes: 0, rentalHomeLoanInterest: 0,
  equityStcg: 0, equityLtcg: 0, otherLtcg: 0, otherStcg: 0,
  otherIncome: 0,
  homeLoanPrincipal: 0, homeLoanInterest: 0, taxSavingInvestments: "",
  healthInsurancePremiums: 0, educationLoanInterest: 0, donations80G: 0,
  riskAppetite: "", liquidityNeeds: "",
};

// ─── Small reusable UI components ────────────────────────────────────────────

const PillSelect = ({
  options, value, onChange, error,
}: {
  options: { value: string; label: string }[];
  value: string;
  onChange: (v: string) => void;
  error?: string;
}) => (
  <div>
    <div className="flex flex-wrap gap-2 mt-1">
      {options.map((opt) => (
        <button
          key={opt.value}
          type="button"
          onClick={() => onChange(opt.value)}
          className={cn(
            "px-3 py-1.5 rounded-xl text-xs font-medium border transition-all duration-150 pointer-events-auto",
            value === opt.value
              ? "bg-primary text-primary-foreground border-primary shadow-sm"
              : "bg-background border-border/60 text-muted-foreground hover:border-primary/40 hover:text-foreground",
          )}
        >
          {opt.label}
        </button>
      ))}
    </div>
    {error && <p className="text-destructive text-xs mt-1.5">{error}</p>}
  </div>
);

const RupeeInput = ({
  value, onChange, error, id, placeholder = "0",
}: {
  value: number; onChange: (v: number) => void; error?: string; id: string; placeholder?: string;
}) => (
  <div>
    <div className="relative mt-1">
      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm font-medium pointer-events-none">₹</span>
      <Input
        id={id}
        type="number"
        value={value === 0 ? "" : value}
        placeholder={placeholder}
        onChange={(e) => onChange(parseFloat(e.target.value) || 0)}
        className={cn("pl-7 pointer-events-auto", error && "border-destructive")}
      />
    </div>
    {error && <p className="text-destructive text-xs mt-1.5">{error}</p>}
  </div>
);

const FrequencyRupeeInput = ({
  annualValue, onChange, error, id, frequency,
}: {
  annualValue: number; onChange: (v: number) => void;
  error?: string; id: string; frequency: "monthly" | "annual";
}) => {
  const displayValue = frequency === "monthly"
    ? (annualValue === 0 ? 0 : Math.round(annualValue / 12))
    : annualValue;
  return (
    <div>
      <div className="relative mt-1">
        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm font-medium pointer-events-none">₹</span>
        <Input
          id={id}
          type="number"
          value={displayValue === 0 ? "" : displayValue}
          placeholder="0"
          onChange={(e) => {
            const raw = parseFloat(e.target.value) || 0;
            onChange(frequency === "monthly" ? raw * 12 : raw);
          }}
          className={cn("pl-7 pointer-events-auto", error && "border-destructive")}
        />
      </div>
      {frequency === "monthly" && annualValue > 0 && (
        <p className="text-xs text-muted-foreground mt-1">
          = <span className="font-medium">{formatFullINR(annualValue)}</span> per year
        </p>
      )}
      {frequency === "annual" && annualValue > 0 && (
        <p className="text-xs text-muted-foreground mt-1">
          ≈ <span className="font-medium">{formatFullINR(Math.round(annualValue / 12))}</span> per month
        </p>
      )}
      {error && <p className="text-destructive text-xs mt-1.5">{error}</p>}
    </div>
  );
};

const PercentInput = ({
  value, onChange, error, id,
}: {
  value: number; onChange: (v: number) => void; error?: string; id: string;
}) => (
  <div>
    <div className="relative mt-1">
      <Input
        id={id}
        type="number"
        min={0} max={100}
        value={value === 0 ? "" : value}
        placeholder="0"
        onChange={(e) => onChange(Math.min(100, Math.max(0, parseFloat(e.target.value) || 0)))}
        className={cn("pr-8 pointer-events-auto", error && "border-destructive")}
      />
      <span className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm pointer-events-none">%</span>
    </div>
    {error && <p className="text-destructive text-xs mt-1.5">{error}</p>}
  </div>
);

const StepProgress = ({ current, total }: { current: number; total: number }) => (
  <div className="flex items-center gap-1.5">
    {Array.from({ length: total }).map((_, i) => (
      <div
        key={i}
        className={cn(
          "h-1 rounded-full flex-1 transition-all duration-300",
          i < current ? "bg-primary" : i === current ? "bg-primary/50" : "bg-muted/50",
        )}
      />
    ))}
  </div>
);

// ─── Income stream meta ───────────────────────────────────────────────────────

const INCOME_STREAM_OPTIONS: {
  id: IncomeStream;
  label: string;
  sublabel: string;
  icon: React.ElementType;
}[] = [
  { id: "salary",        label: "Salary / Pension",          sublabel: "Employment or retirement income",           icon: Briefcase   },
  { id: "business",      label: "Business (Sec 44AD)",        sublabel: "Small business, turnover up to ₹3 Cr",      icon: Building2   },
  { id: "professional",  label: "Professional (Sec 44ADA)",   sublabel: "Doctor, lawyer, CA, consultant etc.",       icon: User        },
  { id: "rental",        label: "Rental Income",              sublabel: "Income from let-out property",              icon: Home        },
  { id: "capital_gains", label: "Capital Gains / Investments",sublabel: "Stocks, mutual funds, property sale etc.",  icon: BarChart2   },
];

// ─── Step definitions ─────────────────────────────────────────────────────────

// Step 0 — About You
// Step 1 — Income Sources (stream picker)
// Step 2 — Income Details (dynamic, based on selected streams)
// Step 3 — Deductions
// Step 4 — Investments & Risk

const STEP_META = [
  { title: "About You",         description: "Personal details",                        icon: User       },
  { title: "Income Sources",    description: "Select all that apply to you",             icon: Wallet     },
  { title: "Income Details",    description: "Fill amounts for your income streams",     icon: Wallet     },
  { title: "Deductions",        description: "Expenses that reduce your taxable income", icon: Receipt    },
  { title: "Investments & Risk","description": "For personalised recommendations",       icon: TrendingUp },
] as const;

// ─── Main component ───────────────────────────────────────────────────────────

const TaxPlannerAI = () => {
  const navigate = useNavigate();
  const { toast } = useToast();
  const { user } = useAuth();

  const [step, setStep] = useState(0);
  const [form, setForm] = useState<TaxFormData>(INITIAL_FORM);
  const [errors, setErrors] = useState<Partial<Record<keyof TaxFormData, string>>>({});
  const [showResults, setShowResults] = useState(false);
  const [loadingData, setLoadingData] = useState(true);
  const [loadedRecommendations, setLoadedRecommendations] = useState<any | null>(null);
  const [hasSavedOutput, setHasSavedOutput] = useState(false);
  const [deductionFreq, setDeductionFreq] = useState<"monthly" | "annual">("monthly");
  const [savingSimulation,  setSavingSimulation]  = useState(false);
  const [simulationSaved,   setSimulationSaved]   = useState(false);
  const [saveDialogOpen,    setSaveDialogOpen]     = useState(false);
  const [simulationName,    setSimulationName]     = useState("");
  const [simListKey,        setSimListKey]         = useState(0);  // forces SimulationListCard refresh
  const [loadedSimId,       setLoadedSimId]        = useState<string | null>(null);
  const [showSimList,       setShowSimList]        = useState(false);

  const TOTAL_STEPS = STEP_META.length;

  // ── Load saved data ───────────────────────────────────────────────────────
  useEffect(() => {
    const loadAll = async () => {
      if (!user) { setLoadingData(false); return; }
      try {
        const input = await getTaxPlannerInput(user.id);
        if (input) {
          let streams: IncomeStream[] = ["salary"];
          try { streams = JSON.parse(input.active_income_streams || '["salary"]'); } catch {}
          setForm({
            ageCategory:              input.age_category || "",
            residentStatus:           input.resident_status || "",
            cityOfResidence:          input.city_of_residence || "",
            activeIncomeStreams:       streams,
            employmentType:           input.employment_type || "",
            annualGrossIncome:        input.annual_gross_income || 0,
            annualRentPaid:           input.annual_rent_paid || 0,
            businessTurnover:         input.business_turnover || 0,
            businessDigitalPercent:   input.business_digital_percent || 0,
            professionalReceipts:     input.professional_receipts || 0,
            professionType:           input.profession_type || "",
            rentalGrossReceipts:      input.rental_gross_receipts || 0,
            rentalMunicipalTaxes:     input.rental_municipal_taxes || 0,
            rentalHomeLoanInterest:   input.rental_home_loan_interest || 0,
            equityStcg:               input.equity_stcg || 0,
            equityLtcg:               input.equity_ltcg || 0,
            otherLtcg:                input.other_ltcg || 0,
            otherStcg:                input.other_stcg || 0,
            otherIncome:              input.other_income || 0,
            homeLoanPrincipal:        input.home_loan_principal || 0,
            homeLoanInterest:         input.home_loan_interest || 0,
            taxSavingInvestments:     input.tax_saving_investments || "",
            healthInsurancePremiums:  input.health_insurance_premiums || 0,
            educationLoanInterest:    input.education_loan_interest || 0,
            donations80G:             input.donations_80g || 0,
            riskAppetite:             input.risk_appetite || "",
            liquidityNeeds:           input.liquidity_needs || "",
          });
        }
        const output = await getTaxPlannerOutput(user.id);
        if (output?.recommendations_json) {
          setLoadedRecommendations(output.recommendations_json);
          setHasSavedOutput(true);
          setShowResults(true);
        }
      } catch (err) {
        console.error("Error loading tax planner data:", err);
        toast({ title: "Error", description: "Failed to load previous tax data.", variant: "destructive" });
      } finally {
        setLoadingData(false);
      }
    };
    loadAll();
  }, [user]);

  // ── Field helpers ─────────────────────────────────────────────────────────
  const set = <K extends keyof TaxFormData>(key: K, val: TaxFormData[K]) => {
    setForm((prev) => ({ ...prev, [key]: val }));
    setErrors((prev) => ({ ...prev, [key]: undefined }));
  };

  const toggleStream = (id: IncomeStream) => {
    setForm((prev) => {
      const has = prev.activeIncomeStreams.includes(id);
      // At least one stream must always be selected
      if (has && prev.activeIncomeStreams.length === 1) return prev;
      return {
        ...prev,
        activeIncomeStreams: has
          ? prev.activeIncomeStreams.filter((s) => s !== id)
          : [...prev.activeIncomeStreams, id],
      };
    });
  };

  const has = (id: IncomeStream) => form.activeIncomeStreams.includes(id);

  // ── Validation ────────────────────────────────────────────────────────────
  const validateStep = (): boolean => {
    const e: Partial<Record<keyof TaxFormData, string>> = {};

    if (step === 0) {
      if (!form.ageCategory)    e.ageCategory    = "Please select your age category.";
      if (!form.residentStatus) e.residentStatus = "Please select your resident status.";
      if (!form.cityOfResidence.trim()) e.cityOfResidence = "Please enter your city.";
    }

    if (step === 1) {
      if (form.activeIncomeStreams.length === 0)
        e.activeIncomeStreams = "Please select at least one income source." as any;
    }

    if (step === 2) {
      if (has("salary")) {
        if (!form.employmentType) e.employmentType = "Please select employment type.";
        if (form.annualGrossIncome < 0) e.annualGrossIncome = "Please enter a valid amount.";
      }
      if (has("business")) {
        if (form.businessTurnover <= 0) e.businessTurnover = "Please enter your annual turnover.";
      }
      if (has("professional")) {
        if (form.professionalReceipts <= 0) e.professionalReceipts = "Please enter your gross receipts.";
        if (!form.professionType) e.professionType = "Please select your profession type.";
      }
      if (has("rental")) {
        if (form.rentalGrossReceipts <= 0) e.rentalGrossReceipts = "Please enter rental income.";
      }
    }

    if (step === 3) {
      // All deduction fields optional — no required validation
    }

    if (step === 4) {
      if (!form.taxSavingInvestments.trim()) e.taxSavingInvestments = "Enter your investments or 'None'.";
      if (!form.riskAppetite)  e.riskAppetite  = "Please select your risk appetite.";
      if (!form.liquidityNeeds) e.liquidityNeeds = "Please select your liquidity needs.";
    }

    setErrors(e);
    return Object.keys(e).length === 0;
  };

  // ── Save to IndexedDB ─────────────────────────────────────────────────────
  const saveInput = async (): Promise<boolean> => {
    if (!user) return false;
    try {
      await saveTaxPlannerInput(user.id, {
        user_id:                  user.id,
        age_category:             form.ageCategory,
        resident_status:          form.residentStatus,
        city_of_residence:        form.cityOfResidence,
        active_income_streams:    JSON.stringify(form.activeIncomeStreams),
        employment_type:          form.employmentType,
        annual_gross_income:      form.annualGrossIncome,
        annual_rent_paid:         form.annualRentPaid,
        business_turnover:        form.businessTurnover,
        business_digital_percent: form.businessDigitalPercent,
        professional_receipts:    form.professionalReceipts,
        profession_type:          form.professionType,
        rental_gross_receipts:    form.rentalGrossReceipts,
        rental_municipal_taxes:   form.rentalMunicipalTaxes,
        rental_home_loan_interest:form.rentalHomeLoanInterest,
        equity_stcg:              form.equityStcg,
        equity_ltcg:              form.equityLtcg,
        other_ltcg:               form.otherLtcg,
        other_stcg:               form.otherStcg,
        other_income:             form.otherIncome,
        home_loan_principal:      form.homeLoanPrincipal,
        home_loan_interest:       form.homeLoanInterest,
        tax_saving_investments:   form.taxSavingInvestments,
        health_insurance_premiums:form.healthInsurancePremiums,
        education_loan_interest:  form.educationLoanInterest,
        donations_80g:            form.donations80G,
        risk_appetite:            form.riskAppetite,
        liquidity_needs:          form.liquidityNeeds,
      });
      return true;
    } catch (err) {
      console.error("Error saving input:", err);
      toast({ title: "Error", description: "Failed to save your details.", variant: "destructive" });
      return false;
    }
  };

  // ── Load a saved simulation ───────────────────────────────────────────────
  const handleLoadSimulation = async (simulationId: string) => {
    if (!user) return;
    const result = await loadSimulation(user.id, simulationId);
    if (!result) {
      toast({ title: "Couldn't load simulation", variant: "destructive" });
      return;
    }
    const inp = result.input;
    let streams: IncomeStream[] = ["salary"];
    try { streams = JSON.parse(inp.active_income_streams || '["salary"]'); } catch {}
    setForm({
      ageCategory:             inp.age_category || "",
      residentStatus:          inp.resident_status || "",
      cityOfResidence:         inp.city_of_residence || "",
      activeIncomeStreams:      streams,
      employmentType:          inp.employment_type || "",
      annualGrossIncome:       inp.annual_gross_income || 0,
      annualRentPaid:          inp.annual_rent_paid || 0,
      businessTurnover:        inp.business_turnover || 0,
      businessDigitalPercent:  inp.business_digital_percent || 0,
      professionalReceipts:    inp.professional_receipts || 0,
      professionType:          inp.profession_type || "",
      rentalGrossReceipts:     inp.rental_gross_receipts || 0,
      rentalMunicipalTaxes:    inp.rental_municipal_taxes || 0,
      rentalHomeLoanInterest:  inp.rental_home_loan_interest || 0,
      equityStcg:              inp.equity_stcg || 0,
      equityLtcg:              inp.equity_ltcg || 0,
      otherLtcg:               inp.other_ltcg || 0,
      otherStcg:               inp.other_stcg || 0,
      otherIncome:             inp.other_income || 0,
      homeLoanPrincipal:       inp.home_loan_principal || 0,
      homeLoanInterest:        inp.home_loan_interest || 0,
      taxSavingInvestments:    inp.tax_saving_investments || "",
      healthInsurancePremiums: inp.health_insurance_premiums || 0,
      educationLoanInterest:   inp.education_loan_interest || 0,
      donations80G:            inp.donations_80g || 0,
      riskAppetite:            inp.risk_appetite || "",
      liquidityNeeds:          inp.liquidity_needs || "",
    });
    setLoadedRecommendations(result.output);
    setLoadedSimId(simulationId);
    setSimulationSaved(true);
    setShowResults(true);
    setShowSimList(false);
  };

  // ── Save current result as a named simulation ─────────────────────────────
  const handleSaveSimulation = async () => {
    if (!user || !loadedRecommendations) return;
    const sims = listSimulations(user.id);
    if (sims.length >= MAX_SIMULATIONS) {
      toast({
        title: `${MAX_SIMULATIONS} simulation limit reached`,
        description: "Delete an old simulation to save a new one.",
        variant: "destructive",
      });
      return;
    }
    setSaveDialogOpen(true);
    setSimulationName(`Simulation ${sims.length + 1}`);
  };

  const handleConfirmSave = async () => {
    if (!user || !loadedRecommendations || !simulationName.trim()) return;
    setSavingSimulation(true);
    try {
      const inputPayload = {
        age_category:              form.ageCategory,
        resident_status:           form.residentStatus,
        city_of_residence:         form.cityOfResidence,
        active_income_streams:     JSON.stringify(form.activeIncomeStreams),
        employment_type:           form.employmentType,
        annual_gross_income:       form.annualGrossIncome,
        annual_rent_paid:          form.annualRentPaid,
        business_turnover:         form.businessTurnover,
        business_digital_percent:  form.businessDigitalPercent,
        professional_receipts:     form.professionalReceipts,
        profession_type:           form.professionType,
        rental_gross_receipts:     form.rentalGrossReceipts,
        rental_municipal_taxes:    form.rentalMunicipalTaxes,
        rental_home_loan_interest: form.rentalHomeLoanInterest,
        equity_stcg:               form.equityStcg,
        equity_ltcg:               form.equityLtcg,
        other_ltcg:                form.otherLtcg,
        other_stcg:                form.otherStcg,
        other_income:              form.otherIncome,
        home_loan_principal:       form.homeLoanPrincipal,
        home_loan_interest:        form.homeLoanInterest,
        tax_saving_investments:    form.taxSavingInvestments,
        health_insurance_premiums: form.healthInsurancePremiums,
        education_loan_interest:   form.educationLoanInterest,
        donations_80g:             form.donations80G,
        risk_appetite:             form.riskAppetite,
        liquidity_needs:           form.liquidityNeeds,
      };
      const rec      = loadedRecommendations;
      const regime   = rec?.recommendedRegime || rec?.recommended_regime || "";
      const taxSaved = rec?.potentialSavings  || rec?.tax_saved          || 0;
      const result = await saveSimulation(
        user.id, simulationName.trim(), inputPayload, loadedRecommendations,
        { regime: regime === "New Regime" ? "new" : regime === "Old Regime" ? "old" : "", gross_income: form.annualGrossIncome, tax_saved: taxSaved }
      );
      if (result.ok) {
        setSimulationSaved(true);
        setSaveDialogOpen(false);
        setSimListKey(k => k + 1);
        toast({ title: `"${simulationName.trim()}" saved ✓` });
      } else {
        toast({ title: result.error || "Couldn't save", variant: "destructive" });
      }
    } catch (e: any) {
      toast({ title: "Save failed", description: e.message, variant: "destructive" });
    } finally {
      setSavingSimulation(false);
    }
  };

  // ── Navigation ────────────────────────────────────────────────────────────
  const handleNext = async () => {
    if (!validateStep()) {
      toast({ title: "Please complete all fields", description: "Some fields need your attention.", variant: "destructive" });
      return;
    }
    if (step < TOTAL_STEPS - 1) {
      setStep(step + 1);
    } else {
      const saved = await saveInput();
      if (saved) {
        setShowResults(true);
        setLoadedRecommendations(null);
      }
    }
  };

  const handleBack = () => {
    if (step > 0) {
      setStep(step - 1);
    } else {
      hasSavedOutput ? setShowResults(true) : navigate("/tax-copilot");
    }
  };

  // ─── Render helpers ───────────────────────────────────────────────────────

  /** Step 0 — About You */
  const renderStep0 = () => (
    <div className="space-y-5">
      <div className="space-y-1">
        <Label className="text-sm font-semibold">Age category</Label>
        <PillSelect
          options={[
            { value: "<60",  label: "Below 60 yrs" },
            { value: "60-80", label: "60 – 80 yrs"  },
            { value: ">80",  label: "Above 80 yrs" },
          ]}
          value={form.ageCategory}
          onChange={(v) => set("ageCategory", v)}
          error={errors.ageCategory}
        />
      </div>

      <div className="space-y-1">
        <Label className="text-sm font-semibold">Resident status</Label>
        <PillSelect
          options={[
            { value: "resident", label: "Resident Indian" },
            { value: "nri",      label: "Non-Resident Indian (NRI)" },
          ]}
          value={form.residentStatus}
          onChange={(v) => set("residentStatus", v)}
          error={errors.residentStatus}
        />
      </div>

      <div className="space-y-1">
        <Label htmlFor="city" className="text-sm font-semibold">City of residence</Label>
        <p className="text-xs text-muted-foreground">Used for HRA exemption (50% for metro cities)</p>
        <Input
          id="city"
          value={form.cityOfResidence}
          onChange={(e) => set("cityOfResidence", e.target.value)}
          placeholder="e.g. Mumbai, Delhi, Bengaluru…"
          className={cn("pointer-events-auto mt-1", errors.cityOfResidence && "border-destructive")}
        />
        {errors.cityOfResidence && <p className="text-destructive text-xs mt-1">{errors.cityOfResidence}</p>}
      </div>
    </div>
  );

  /** Step 1 — Income Sources */
  const renderStep1 = () => (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">Select every source that applies to you this financial year.</p>
      {INCOME_STREAM_OPTIONS.map(({ id, label, sublabel, icon: Icon }) => {
        const active = has(id);
        return (
          <button
            key={id}
            type="button"
            onClick={() => toggleStream(id)}
            className={cn(
              "w-full flex items-center gap-3 p-3 rounded-xl border text-left transition-all duration-150 pointer-events-auto",
              active
                ? "bg-primary/10 border-primary/40 text-foreground"
                : "bg-background border-border/50 text-muted-foreground hover:border-primary/30 hover:text-foreground",
            )}
          >
            <div className={cn("h-9 w-9 rounded-lg flex items-center justify-center shrink-0", active ? "bg-primary/20" : "bg-muted/40")}>
              <Icon className={cn("h-4 w-4", active ? "text-primary" : "text-muted-foreground")} />
            </div>
            <div className="flex-1 min-w-0">
              <p className={cn("text-sm font-semibold", active && "text-foreground")}>{label}</p>
              <p className="text-xs text-muted-foreground truncate">{sublabel}</p>
            </div>
            {active
              ? <CheckSquare className="h-4 w-4 text-primary shrink-0" />
              : <Square className="h-4 w-4 text-muted-foreground shrink-0" />}
          </button>
        );
      })}
      {(errors as any).activeIncomeStreams && (
        <p className="text-destructive text-xs">{(errors as any).activeIncomeStreams}</p>
      )}
    </div>
  );

  /** Step 2 — Income Details (dynamic) */
  const renderStep2 = () => (
    <div className="space-y-6">

      {/* Salary */}
      {has("salary") && (
        <div className="space-y-4 pb-4 border-b border-border/40">
          <div className="flex items-center gap-2">
            <Briefcase className="h-4 w-4 text-primary" />
            <h3 className="text-sm font-bold text-foreground">Salary / Pension</h3>
          </div>

          <div className="space-y-1">
            <Label className="text-sm font-semibold">Employment type</Label>
            <PillSelect
              options={[
                { value: "salaried",  label: "Salaried" },
                { value: "pensioner", label: "Pensioner" },
              ]}
              value={form.employmentType}
              onChange={(v) => set("employmentType", v)}
              error={errors.employmentType}
            />
          </div>

          <div className="space-y-1">
            <Label htmlFor="agi" className="text-sm font-semibold">Annual gross salary / pension <span className="text-muted-foreground font-normal">(before deductions)</span></Label>
            <RupeeInput id="agi" value={form.annualGrossIncome} onChange={(v) => set("annualGrossIncome", v)} error={errors.annualGrossIncome} />
          </div>

          <div className="space-y-1">
            <Label htmlFor="rent" className="text-sm font-semibold">Annual rent paid <span className="text-muted-foreground font-normal">(for HRA — enter 0 if none)</span></Label>
            <RupeeInput id="rent" value={form.annualRentPaid} onChange={(v) => set("annualRentPaid", v)} />
          </div>
        </div>
      )}

      {/* Business 44AD */}
      {has("business") && (
        <div className="space-y-4 pb-4 border-b border-border/40">
          <div className="flex items-center gap-2">
            <Building2 className="h-4 w-4 text-primary" />
            <h3 className="text-sm font-bold text-foreground">Business Income <span className="text-xs font-normal text-muted-foreground">(Section 44AD)</span></h3>
          </div>
          <div className="rounded-lg bg-primary/5 border border-primary/15 p-3 text-xs text-muted-foreground space-y-0.5">
            <p>• Taxable income = <strong>8% of turnover</strong> (or <strong>6%</strong> if ≥95% receipts are digital)</p>
            <p>• Limit: ₹3 Cr (mostly digital) or ₹2 Cr (mixed)</p>
          </div>

          <div className="space-y-1">
            <Label htmlFor="biz-turnover" className="text-sm font-semibold">Annual business turnover</Label>
            <RupeeInput id="biz-turnover" value={form.businessTurnover} onChange={(v) => set("businessTurnover", v)} error={errors.businessTurnover} />
          </div>

          <div className="space-y-1">
            <Label htmlFor="biz-digital" className="text-sm font-semibold">% receipts via digital payments <span className="text-muted-foreground font-normal">(UPI, bank transfer etc.)</span></Label>
            <PercentInput id="biz-digital" value={form.businessDigitalPercent} onChange={(v) => set("businessDigitalPercent", v)} />
            <p className="text-xs text-muted-foreground mt-1">
              {form.businessDigitalPercent >= 95
                ? "✅ Qualifies for 6% rate (mostly digital)"
                : "ℹ️ Below 95% digital → 8% rate applies"}
            </p>
          </div>
        </div>
      )}

      {/* Professional 44ADA */}
      {has("professional") && (
        <div className="space-y-4 pb-4 border-b border-border/40">
          <div className="flex items-center gap-2">
            <User className="h-4 w-4 text-primary" />
            <h3 className="text-sm font-bold text-foreground">Professional Income <span className="text-xs font-normal text-muted-foreground">(Section 44ADA)</span></h3>
          </div>
          <div className="rounded-lg bg-primary/5 border border-primary/15 p-3 text-xs text-muted-foreground space-y-0.5">
            <p>• Taxable income = <strong>50% of gross receipts</strong></p>
            <p>• Limit: ₹75 L (≥95% digital) or ₹50 L (mixed)</p>
            <p>• You can still claim 80C / 80D deductions on top</p>
          </div>

          <div className="space-y-1">
            <Label className="text-sm font-semibold">Profession type</Label>
            <PillSelect
              options={[
                { value: "doctor",     label: "Doctor / Medical" },
                { value: "lawyer",     label: "Lawyer" },
                { value: "engineer",   label: "Engineer" },
                { value: "architect",  label: "Architect" },
                { value: "ca",         label: "CA / CMA / CS" },
                { value: "consultant", label: "Consultant / IT" },
                { value: "other",      label: "Other Specified" },
              ]}
              value={form.professionType}
              onChange={(v) => set("professionType", v)}
              error={errors.professionType}
            />
          </div>

          <div className="space-y-1">
            <Label htmlFor="prof-receipts" className="text-sm font-semibold">Annual gross receipts</Label>
            <RupeeInput id="prof-receipts" value={form.professionalReceipts} onChange={(v) => set("professionalReceipts", v)} error={errors.professionalReceipts} />
            {form.professionalReceipts > 0 && (
              <p className="text-xs text-muted-foreground mt-1">
                Taxable profit = <strong>{formatFullINR(Math.round(form.professionalReceipts * 0.5))}</strong> (50%)
              </p>
            )}
          </div>
        </div>
      )}

      {/* Rental */}
      {has("rental") && (
        <div className="space-y-4 pb-4 border-b border-border/40">
          <div className="flex items-center gap-2">
            <Home className="h-4 w-4 text-primary" />
            <h3 className="text-sm font-bold text-foreground">Rental Income</h3>
          </div>
          <div className="rounded-lg bg-primary/5 border border-primary/15 p-3 text-xs text-muted-foreground space-y-0.5">
            <p>• Net = Rent − Municipal taxes − <strong>30% standard deduction</strong> − Loan interest</p>
            <p>• Home loan interest on let-out property is <strong>fully deductible</strong> (no cap) in both regimes</p>
          </div>

          <div className="space-y-1">
            <Label htmlFor="rental-income" className="text-sm font-semibold">Gross annual rent received</Label>
            <RupeeInput id="rental-income" value={form.rentalGrossReceipts} onChange={(v) => set("rentalGrossReceipts", v)} error={errors.rentalGrossReceipts} />
          </div>

          <div className="space-y-1">
            <Label htmlFor="rental-muni" className="text-sm font-semibold">Municipal taxes paid <span className="text-muted-foreground font-normal">(enter 0 if none)</span></Label>
            <RupeeInput id="rental-muni" value={form.rentalMunicipalTaxes} onChange={(v) => set("rentalMunicipalTaxes", v)} />
          </div>

          <div className="space-y-1">
            <Label htmlFor="rental-loan" className="text-sm font-semibold">Home loan interest on this property <span className="text-muted-foreground font-normal">(enter 0 if none)</span></Label>
            <RupeeInput id="rental-loan" value={form.rentalHomeLoanInterest} onChange={(v) => set("rentalHomeLoanInterest", v)} />
          </div>
        </div>
      )}

      {/* Capital Gains */}
      {has("capital_gains") && (
        <div className="space-y-4 pb-4 border-b border-border/40">
          <div className="flex items-center gap-2">
            <BarChart2 className="h-4 w-4 text-primary" />
            <h3 className="text-sm font-bold text-foreground">Capital Gains</h3>
          </div>
          <div className="rounded-lg bg-amber-500/10 border border-amber-500/20 p-3 text-xs text-amber-700 dark:text-amber-400 space-y-0.5">
            <p>⚠️ Capital gains are taxed at <strong>special flat rates</strong>, not slab rates.</p>
            <p>The 87A rebate does <strong>not</strong> apply to capital gains.</p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-1">
              <Label htmlFor="eq-stcg" className="text-sm font-semibold">Equity STCG</Label>
              <p className="text-xs text-muted-foreground">Listed shares / equity MF held &lt;1 yr • Taxed @20%</p>
              <RupeeInput id="eq-stcg" value={form.equityStcg} onChange={(v) => set("equityStcg", v)} />
            </div>

            <div className="space-y-1">
              <Label htmlFor="eq-ltcg" className="text-sm font-semibold">Equity LTCG above ₹1.25 L</Label>
              <p className="text-xs text-muted-foreground">Listed shares / equity MF held ≥1 yr • Taxed @12.5%</p>
              <RupeeInput id="eq-ltcg" value={form.equityLtcg} onChange={(v) => set("equityLtcg", v)} />
            </div>

            <div className="space-y-1">
              <Label htmlFor="other-stcg" className="text-sm font-semibold">Other STCG</Label>
              <p className="text-xs text-muted-foreground">Property / gold / debt MF held short-term • Added to slab income</p>
              <RupeeInput id="other-stcg" value={form.otherStcg} onChange={(v) => set("otherStcg", v)} />
            </div>

            <div className="space-y-1">
              <Label htmlFor="other-ltcg" className="text-sm font-semibold">Other LTCG</Label>
              <p className="text-xs text-muted-foreground">Property (post Jul 23, 2024) / gold / debt MF • Taxed @12.5%</p>
              <RupeeInput id="other-ltcg" value={form.otherLtcg} onChange={(v) => set("otherLtcg", v)} />
            </div>
          </div>
        </div>
      )}

      {/* Other Income — always shown */}
      <div className="space-y-1">
        <Label htmlFor="other-income" className="text-sm font-semibold">Other income <span className="text-muted-foreground font-normal">(FD interest, savings interest, dividends)</span></Label>
        <p className="text-xs text-muted-foreground">Added to slab income. Enter 0 if none.</p>
        <RupeeInput id="other-income" value={form.otherIncome} onChange={(v) => set("otherIncome", v)} />
      </div>
    </div>
  );

  /** Step 3 — Deductions */
  const renderStep3 = () => (
    <div className="space-y-5">
      {/* Frequency toggle */}
      <div className="flex items-center gap-2">
        <p className="text-xs text-muted-foreground shrink-0">Enter amounts as:</p>
        <div className="flex items-center bg-muted/40 rounded-lg p-0.5 gap-0.5">
          {(["monthly", "annual"] as const).map((freq) => (
            <button
              key={freq}
              type="button"
              onClick={() => setDeductionFreq(freq)}
              className={cn(
                "px-3 py-1 rounded-md text-xs font-medium transition-all duration-150 pointer-events-auto capitalize",
                deductionFreq === freq
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {freq}
            </button>
          ))}
        </div>
      </div>

      <div className="rounded-lg bg-muted/30 border border-border/40 p-3 text-xs text-muted-foreground">
        <p>💡 All deductions below apply only to the <strong>Old Regime</strong>. Even if you end up on the New Regime, enter them — we'll tell you if switching is worth it.</p>
      </div>

      {[
        { id: "homeLoanPrincipal"       as keyof TaxFormData, label: "Home loan principal repaid",    desc: "Principal part of EMI — counts in Sec 123 (old 80C). Enter 0 if none."  },
        { id: "homeLoanInterest"        as keyof TaxFormData, label: "Home loan interest (self-occ)", desc: "Interest on self-occupied property — Sec 24(b), max ₹2 L in old regime." },
        { id: "healthInsurancePremiums" as keyof TaxFormData, label: "Health insurance premiums",     desc: "Self + family + parents — Sec 126 (old 80D). Enter 0 if none."          },
        { id: "educationLoanInterest"   as keyof TaxFormData, label: "Education loan interest",       desc: "No upper limit — Sec 129 (old 80E). Enter 0 if not applicable."         },
        { id: "donations80G"            as keyof TaxFormData, label: "Donations (80G)",               desc: "To approved charities only. Enter 0 if none."                           },
      ].map(({ id, label, desc }) => (
        <div key={id} className="space-y-1">
          <Label htmlFor={id} className="text-sm font-semibold">
            {label} <span className="ml-1 text-[10px] font-normal text-muted-foreground">({deductionFreq})</span>
          </Label>
          <p className="text-xs text-muted-foreground">{desc}</p>
          <FrequencyRupeeInput
            id={id}
            annualValue={form[id] as number}
            onChange={(v) => set(id, v as any)}
            frequency={deductionFreq}
            error={errors[id]}
          />
        </div>
      ))}
    </div>
  );

  /** Step 4 — Investments & Risk */
  const renderStep4 = () => (
    <div className="space-y-5">
      <div className="space-y-1">
        <Label htmlFor="investments" className="text-sm font-semibold">Existing tax-saving investments</Label>
        <p className="text-xs text-muted-foreground">
          Format: <code className="bg-muted px-1 rounded text-[10px]">PPF: 50000, ELSS: 20000, NPS: 10000</code>. Enter <strong>None</strong> if you have no investments yet.
        </p>
        <Textarea
          id="investments"
          value={form.taxSavingInvestments}
          onChange={(e) => set("taxSavingInvestments", e.target.value)}
          className={cn("pointer-events-auto mt-1 resize-none", errors.taxSavingInvestments && "border-destructive")}
          rows={3}
          placeholder="e.g. PPF: 50000, ELSS: 20000"
        />
        {errors.taxSavingInvestments && <p className="text-destructive text-xs mt-1">{errors.taxSavingInvestments}</p>}
      </div>

      <div className="space-y-1">
        <Label className="text-sm font-semibold">Risk appetite</Label>
        <PillSelect
          options={[
            { value: "conservative", label: "Conservative — low risk"    },
            { value: "moderate",     label: "Moderate — balanced"        },
            { value: "aggressive",   label: "Aggressive — high growth"   },
          ]}
          value={form.riskAppetite}
          onChange={(v) => set("riskAppetite", v)}
          error={errors.riskAppetite}
        />
      </div>

      <div className="space-y-1">
        <Label className="text-sm font-semibold">Liquidity needs</Label>
        <PillSelect
          options={[
            { value: "short-term", label: "Short-term (within 1 yr)" },
            { value: "mid-term",   label: "Mid-term (1 – 5 yrs)"    },
            { value: "long-term",  label: "Long-term (5+ yrs)"      },
          ]}
          value={form.liquidityNeeds}
          onChange={(v) => set("liquidityNeeds", v)}
          error={errors.liquidityNeeds}
        />
      </div>
    </div>
  );

  const renderCurrentStep = () => {
    switch (step) {
      case 0: return renderStep0();
      case 1: return renderStep1();
      case 2: return renderStep2();
      case 3: return renderStep3();
      case 4: return renderStep4();
      default: return null;
    }
  };

  // TaxPlanOutput expects the full TaxFormData shape — pass form directly.

  // ─── Loading state ────────────────────────────────────────────────────────
  if (loadingData) {
    return (
      <AppLayout>
        <div className="min-h-[60vh] flex flex-col items-center justify-center gap-4">
          <div className="h-10 w-10 rounded-2xl bg-primary/10 flex items-center justify-center animate-pulse">
            <Sparkles className="h-5 w-5 text-primary" />
          </div>
          <p className="text-sm text-muted-foreground">Loading your tax data…</p>
        </div>
      </AppLayout>
    );
  }

  const meta = STEP_META[step];
  const StepIcon = meta.icon;
  const isLastStep = step === TOTAL_STEPS - 1;

  return (
    <AppLayout>
      <div className="space-y-4 mt-4 md:mt-0">

        {/* Page header */}
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <Button
              variant="ghost" size="sm"
              onClick={() => navigate("/tax-copilot")}
              className="h-9 w-9 p-0 rounded-xl pointer-events-auto shrink-0"
            >
              <ArrowLeft className="h-4 w-4" />
            </Button>
            <div className="h-10 w-10 rounded-2xl bg-primary/10 flex items-center justify-center shrink-0">
              <Sparkles className="h-5 w-5 text-primary" />
            </div>
            <div>
              <h1 className="text-xl font-bold tracking-tight gradient-text">AI Tax Planner</h1>
              <p className="text-xs text-muted-foreground">FY 2026-27 · {listSimulations(user?.id || "").length}/{MAX_SIMULATIONS} saved</p>
            </div>
          </div>
          <Button
            variant="outline" size="sm"
            onClick={() => setShowSimList(v => !v)}
            className="pointer-events-auto h-9 gap-1.5 rounded-xl text-xs border-primary/30 text-primary"
          >
            <BookmarkCheck className="h-3.5 w-3.5" />
            {showSimList ? "Hide" : "Simulations"}
          </Button>
        </div>

        {/* Simulation list panel */}
        {showSimList && user && (
          <div className="glass-card p-4">
            <SimulationListCard
              key={simListKey}
              userId={user.id}
              onLoad={handleLoadSimulation}
              onNew={() => {
                setShowSimList(false);
                setForm(INITIAL_FORM);
                setLoadedRecommendations(null);
                setSimulationSaved(false);
                setLoadedSimId(null);
                setShowResults(false);
                setStep(0);
              }}
              onRefresh={() => setSimListKey(k => k + 1)}
            />
          </div>
        )}

        {/* Results view */}
        {showResults ? (
          <div className="space-y-4">
            {loadedRecommendations ? (
              <TaxPlanOutput
                calculatedData={loadedRecommendations}
                onGoBack={() => { setShowResults(false); setLoadedRecommendations(null); setStep(0); }}
                isLoadedFromDb={true}
              />
            ) : (
              <TaxPlanOutput
                formData={form}
                onGoBack={() => { setShowResults(false); setStep(0); }}
                isLoadedFromDb={false}
              />
            )}
            {/* Save this simulation */}
            {!simulationSaved && !loadedSimId && (
              <div className="rounded-2xl border border-primary/20 bg-primary/5 p-4 flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm font-bold text-foreground">Save this simulation</p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    You can save up to {MAX_SIMULATIONS} simulations and reload them anytime.
                  </p>
                </div>
                <Button
                  size="sm"
                  onClick={handleSaveSimulation}
                  className="pointer-events-auto shrink-0 bg-primary text-primary-foreground gap-1.5 rounded-xl"
                >
                  <Bookmark className="h-3.5 w-3.5" /> Save
                </Button>
              </div>
            )}
            {simulationSaved && (
              <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 flex items-center gap-2">
                <BookmarkCheck className="h-4 w-4 text-emerald-600 shrink-0" />
                <p className="text-sm font-medium text-emerald-700">Simulation saved ✓</p>
              </div>
            )}

            {/* Name input dialog — inline */}
            {saveDialogOpen && (
              <div className="rounded-2xl border border-border/60 bg-background p-4 space-y-3 shadow-lg">
                <p className="text-sm font-bold text-foreground">Name this simulation</p>
                <input
                  type="text"
                  value={simulationName}
                  onChange={e => setSimulationName(e.target.value)}
                  onKeyDown={e => e.key === "Enter" && handleConfirmSave()}
                  placeholder="e.g. FY26 with NPS, Salary + Freelance…"
                  className="w-full h-10 rounded-xl border border-border/60 px-3 text-sm bg-background text-foreground outline-none focus:border-primary/40 pointer-events-auto"
                  autoFocus
                />
                <div className="flex gap-2">
                  <Button variant="outline" size="sm" onClick={() => setSaveDialogOpen(false)}
                    className="flex-1 rounded-xl pointer-events-auto">Cancel</Button>
                  <Button size="sm" onClick={handleConfirmSave} disabled={savingSimulation || !simulationName.trim()}
                    className="flex-1 rounded-xl bg-primary text-primary-foreground pointer-events-auto">
                    {savingSimulation ? "Saving…" : "Save simulation"}
                  </Button>
                </div>
              </div>
            )}

            <div className="flex gap-3 pb-2">
              <Button
                variant="outline"
                className="flex-1 rounded-xl pointer-events-auto gap-2 h-10 text-sm"
                onClick={() => { setShowResults(false); setStep(0); setSimulationSaved(false); setLoadedSimId(null); }}
              >
                <ArrowLeft className="h-4 w-4" /> Edit Inputs
              </Button>
              <Button
                variant="outline"
                className="flex-1 rounded-xl pointer-events-auto gap-2 h-10 text-sm"
                onClick={() => { setForm(INITIAL_FORM); setLoadedRecommendations(null); setHasSavedOutput(false); setShowResults(false); setStep(0); setSimulationSaved(false); setLoadedSimId(null); }}
              >
                <RotateCcw className="h-4 w-4" /> Start Fresh
              </Button>
            </div>
          </div>
        ) : (

          /* Step form */
          <div className="glass-card p-5 space-y-5">

            {/* Progress */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-primary">Step {step + 1} of {TOTAL_STEPS}</span>
                <span className="text-xs text-muted-foreground">{Math.round(((step + 1) / TOTAL_STEPS) * 100)}% complete</span>
              </div>
              <StepProgress current={step + 1} total={TOTAL_STEPS} />
            </div>

            {/* Step title */}
            <div className="flex items-center gap-3 pb-1 border-b border-border/40">
              <div className="h-9 w-9 rounded-xl bg-primary/10 flex items-center justify-center shrink-0">
                <StepIcon className="h-4.5 w-4.5 text-primary" />
              </div>
              <div>
                <h2 className="text-base font-bold text-foreground">{meta.title}</h2>
                <p className="text-xs text-muted-foreground">{meta.description}</p>
              </div>
            </div>

            {/* Active step content */}
            {renderCurrentStep()}

            {/* Navigation */}
            <div className="flex gap-3 pt-2 border-t border-border/40">
              <Button
                variant="outline"
                onClick={handleBack}
                disabled={step === 0 && !hasSavedOutput}
                className="h-10 rounded-xl pointer-events-auto gap-1.5 shrink-0"
              >
                <ArrowLeft className="h-4 w-4" />
                {step === 0 && hasSavedOutput ? "Results" : "Back"}
              </Button>
              <Button
                onClick={handleNext}
                className="flex-1 h-10 rounded-xl bg-gradient-primary text-primary-foreground pointer-events-auto gap-2 font-semibold"
              >
                {isLastStep ? (
                  <><Sparkles className="h-4 w-4" /> Calculate My Tax</>
                ) : (
                  <>Next <ArrowRight className="h-4 w-4" /></>
                )}
              </Button>
            </div>
          </div>
        )}
      </div>
    </AppLayout>
  );
};

export default TaxPlannerAI;
