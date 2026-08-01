import { useNavigate } from "react-router-dom";
import { useState, useEffect } from "react";
import { AppLayout } from "@/components/layout/AppLayout";
import { GlassCard } from "@/components/ui/glass-card";
import { Button } from "@/components/ui/button";
import {
  ArrowLeft, ClipboardCheck, CheckCircle2, Circle,
  ChevronDown, ChevronRight, Info, AlertTriangle,
} from "lucide-react";
import { getCurrentFinancialYear } from "@/lib/date-utils";
import { useAuth } from "@/contexts/AuthContext";
import { cn } from "@/lib/utils";
import {
  getItrChecklist,
  upsertItrChecklistItem,
} from "@/integrations/indexeddb/services/itrChecklistService";
import { getTaxPlannerInput } from "@/integrations/indexeddb/services/taxPlannerService";
import type { IncomeStream } from "@/pages/TaxPlannerAI";

// ─── Types ────────────────────────────────────────────────────────────────────

interface ChecklistItemDef {
  key: string;
  label: string;
  hint?: string;
  // Only show when user has these income streams (empty = always show)
  streams?: IncomeStream[];
}

interface CategoryDef {
  key: string;
  label: string;
  color: string;
  bg: string;
  items: ChecklistItemDef[];
}

// ─── Checklist — Income Tax Act 2025 / FY 2026-27 ────────────────────────────
// Form name changes under Act 2025:
//   Form 16  → Form 130   (employer TDS certificate — due by 15 Jun)
//   Form 26AS → Form 168  (tax credit statement)
//   Form 12BB → Form 124  (investment declaration to employer)
//   AIS stays as AIS
const CHECKLIST: CategoryDef[] = [
  {
    key: "identity",
    label: "Identity & Registration",
    color: "text-blue-600",
    bg: "bg-blue-100",
    items: [
      { key: "pan_aadhaar_linked",  label: "PAN linked with Aadhaar",                                hint: "Mandatory — check on incometax.gov.in"          },
      { key: "itd_portal_login",    label: "IT portal login active (incometax.gov.in)"                                                                       },
      { key: "bank_prevalidated",   label: "Bank account pre-validated on IT portal for refund"                                                              },
      { key: "mobile_registered",   label: "Mobile number registered on IT portal for OTP e-verify"                                                          },
    ],
  },
  {
    key: "income_docs",
    label: "Income Documents",
    color: "text-violet-600",
    bg: "bg-violet-100",
    items: [
      {
        key: "form130_received",
        label: "Form 130 received from employer (new Form 16)",
        hint: "Employer must issue by 15 Jun. Form 130 = Form 16 under Income Tax Act 2025",
        streams: ["salary"],
      },
      {
        key: "salary_slips",
        label: "Salary slips for all 12 months",
        streams: ["salary"],
      },
      {
        key: "form168_downloaded",
        label: "Form 168 (new 26AS) downloaded & verified",
        hint: "Form 168 = Form 26AS under Act 2025. Download via incometax.gov.in",
      },
      { key: "ais_reviewed",         label: "AIS (Annual Information Statement) reviewed for discrepancies"                                                   },
      { key: "fd_interest_cert",     label: "FD / savings bank interest certificates or Form 16A collected"                                                   },
      {
        key: "business_turnover_rec",
        label: "Business turnover records / GST returns / bank statements",
        streams: ["business"],
      },
      {
        key: "professional_invoices",
        label: "Professional invoices / receipts — all clients",
        hint: "For 44ADA: declare ≥50% of gross receipts as taxable income",
        streams: ["professional"],
      },
      {
        key: "rental_agreement",
        label: "Rental agreement + rent receipts + municipal tax receipts",
        streams: ["rental"],
      },
      {
        key: "cg_broker_statement",
        label: "Capital gains statement from broker / demat account",
        hint: "Ask your broker for the annual P&L / capital gains report",
        streams: ["capital_gains"],
      },
      {
        key: "mf_pl_statement",
        label: "Mutual fund P&L statement downloaded (CAMS / KFintech)",
        streams: ["capital_gains"],
      },
    ],
  },
  {
    key: "deductions",
    label: "Deduction Proofs (Old Regime)",
    color: "text-emerald-600",
    bg: "bg-emerald-100",
    items: [
      {
        key: "sec123_proofs",
        label: "Sec 123 proofs (old 80C): ELSS, PPF, LIC, EPF, NSC, tuition fees",
        hint: "Limit ₹1.5 L. Sec 123 = 80C under Income Tax Act 2025. Old Regime only.",
      },
      {
        key: "sec126_receipts",
        label: "Sec 126 (old 80D): health insurance premium receipts",
        hint: "₹25K self+family; ₹25K parents; ₹50K if parents are senior citizens. Old Regime only.",
      },
      {
        key: "sec129_certificate",
        label: "Sec 129 (old 80E): education loan interest certificate",
        hint: "No upper limit on deduction. Old Regime only.",
      },
      {
        key: "sec132_receipts",
        label: "Sec 132 (old 80G): donation receipts with 80G certificate",
        hint: "Verify the organisation has a valid 80G approval. Old Regime only.",
      },
      {
        key: "hra_receipts",
        label: "HRA rent receipts + landlord PAN if annual rent > ₹1 L",
        hint: "From FY 2026-27: if paying rent to a relative, also declare relationship in Form 124.",
        streams: ["salary"],
      },
      {
        key: "nps_statement",
        label: "NPS statement — Sec 124 (old 80CCD(1B)) + 80CCD(2) employer",
        hint: "Sec 124 = 80CCD under Act 2025. 80CCD(2) works in BOTH regimes — up to 14% basic.",
      },
      {
        key: "home_loan_cert",
        label: "Home loan interest & principal certificate from lender",
        hint: "Sec 24(b) max ₹2 L (self-occ) in Old Regime. Let-out interest unlimited in both regimes.",
      },
    ],
  },
  {
    key: "regime_choice",
    label: "Regime & Form 10-IEA",
    color: "text-amber-600",
    bg: "bg-amber-100",
    items: [
      {
        key: "regime_decided",
        label: "Decided between Old Regime and New Regime",
        hint: "New Regime is the default from FY 2026-27. Compare your tax both ways before filing.",
      },
      {
        key: "form10iea_filed",
        label: "Form 10-IEA filed if opting for Old Regime (business/professional)",
        hint: "Business and professional taxpayers must file Form 10-IEA before their ITR due date.",
        streams: ["business", "professional"],
      },
    ],
  },
  {
    key: "tax_payments",
    label: "Tax Payments & TDS",
    color: "text-rose-600",
    bg: "bg-rose-100",
    items: [
      { key: "advance_tax_challans",  label: "Advance tax payment challans saved (if applicable)"                                                            },
      { key: "self_assessment_paid",  label: "Self-assessment tax paid on IT portal for any remaining balance"                                               },
      { key: "tds_reconciled",        label: "TDS entries reconciled with Form 168 (26AS) and AIS",
        hint: "Mismatches between Form 168 and AIS must be flagged before filing."                                                                            },
    ],
  },
  {
    key: "filing",
    label: "Filing & Verification",
    color: "text-indigo-600",
    bg: "bg-indigo-100",
    items: [
      {
        key: "itr_form_identified",
        label: "Correct ITR form identified",
        hint: "ITR-1: salary only ≤₹50L | ITR-2: capital gains / 2+ properties | ITR-3: business (audit/non-audit) | ITR-4: 44AD/44ADA non-audit ≤₹50L",
      },
      { key: "all_banks_listed",        label: "All active bank accounts listed in ITR"                                                                       },
      { key: "foreign_assets_declared", label: "Foreign assets / foreign income declared (if applicable)"                                                    },
      {
        key: "itr_filed",
        label: "ITR filed on IT portal",
        hint: "ITR-1/2 by 31 Jul | ITR-3/4 (non-audit) by 31 Aug | Audit cases by 31 Oct",
      },
      {
        key: "itr_everified",
        label: "ITR e-verified within 30 days of filing",
        hint: "e-verify via Aadhaar OTP, net banking, or DSC. Unfiled return is treated as invalid.",
      },
    ],
  },
];

// ─── Component ────────────────────────────────────────────────────────────────

const ITRReadiness = () => {
  const navigate = useNavigate();
  const { user } = useAuth();
  const fy = getCurrentFinancialYear();
  const fyEndYear = parseInt(fy.split("-")[0]) + 1;

  const [checked,  setChecked]  = useState<Set<string>>(new Set());
  const [expanded, setExpanded] = useState<Set<string>>(new Set(CHECKLIST.map((c) => c.key)));
  const [loading,  setLoading]  = useState(true);
  const [streams,  setStreams]  = useState<IncomeStream[]>([]);

  useEffect(() => {
    if (!user) return;
    const load = async () => {
      // Load income streams to filter checklist items
      const inputData = await getTaxPlannerInput(user.id);
      if (inputData?.active_income_streams) {
        try { setStreams(JSON.parse(inputData.active_income_streams)); } catch {}
      }
      // Load persisted checklist state
      const items = await getItrChecklist(user.id, fy);
      setChecked(new Set(items.filter((i) => i.is_completed).map((i) => i.item_key)));
      setLoading(false);
    };
    load();
  }, [user, fy]);

  // Filter items based on user's income streams
  const filteredChecklist: CategoryDef[] = CHECKLIST.map((cat) => ({
    ...cat,
    items: cat.items.filter((item) => {
      if (!item.streams || item.streams.length === 0) return true;
      if (streams.length === 0) return true; // no planner data — show all
      return item.streams.some((s) => streams.includes(s));
    }),
  })).filter((cat) => cat.items.length > 0);

  const toggle = async (categoryKey: string, itemKey: string) => {
    if (!user) return;
    const newVal = !checked.has(itemKey);
    setChecked((prev) => {
      const next = new Set(prev);
      newVal ? next.add(itemKey) : next.delete(itemKey);
      return next;
    });
    await upsertItrChecklistItem(user.id, fy, itemKey, categoryKey, newVal);
  };

  const toggleCategory = (key: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });
  };

  const totalItems     = filteredChecklist.reduce((s, c) => s + c.items.length, 0);
  const completedItems = checked.size;
  const pct = totalItems > 0 ? Math.round((completedItems / totalItems) * 100) : 0;

  const readinessLabel = pct >= 90 ? "Ready to file! 🎉" : pct >= 60 ? "Almost there" : pct >= 30 ? "In progress" : "Not started";
  const readinessColor = pct >= 90 ? "text-emerald-600" : pct >= 60 ? "text-amber-600" : pct >= 30 ? "text-blue-600" : "text-muted-foreground";

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
            <ClipboardCheck className="h-5 w-5 text-indigo-600" />
          </div>
          <div>
            <h1 className="text-xl font-bold tracking-tight gradient-text">ITR Readiness</h1>
            <p className="text-xs text-muted-foreground">FY {fy} filing checklist · Income Tax Act 2025</p>
          </div>
        </div>

        {/* Progress ring */}
        <GlassCard className="p-4">
          <div className="flex items-center gap-4">
            <div className="relative h-16 w-16 shrink-0">
              <svg viewBox="0 0 56 56" className="rotate-[-90deg]">
                <circle cx="28" cy="28" r="22" fill="none" stroke="currentColor" strokeWidth="5" className="text-muted/20" />
                <circle
                  cx="28" cy="28" r="22" fill="none" stroke="currentColor" strokeWidth="5"
                  strokeDasharray={`${(pct / 100) * 138.2} 138.2`}
                  className={cn("transition-all duration-700",
                    pct >= 90 ? "text-emerald-500" : pct >= 60 ? "text-amber-500" : "text-primary")}
                  strokeLinecap="round"
                />
              </svg>
              <span className="absolute inset-0 flex items-center justify-center text-sm font-bold text-foreground">{pct}%</span>
            </div>
            <div>
              <p className={cn("text-lg font-bold", readinessColor)}>{readinessLabel}</p>
              <p className="text-xs text-muted-foreground">{completedItems} of {totalItems} items completed</p>
              {streams.length > 0 && (
                <p className="text-[10px] text-primary/70 mt-0.5">Checklist filtered for your income streams</p>
              )}
            </div>
          </div>
        </GlassCard>

        {/* Checklist */}
        {loading ? (
          <div className="space-y-3">
            {[1, 2, 3].map((i) => <div key={i} className="h-16 bg-muted/30 rounded-2xl animate-pulse" />)}
          </div>
        ) : (
          <div className="space-y-3">
            {filteredChecklist.map((category) => {
              const catCompleted = category.items.filter((i) => checked.has(i.key)).length;
              const isExpanded   = expanded.has(category.key);

              return (
                <GlassCard key={category.key} className="overflow-hidden">
                  <button
                    className="w-full p-4 flex items-center gap-3 pointer-events-auto"
                    onClick={() => toggleCategory(category.key)}
                  >
                    <div className={cn("h-8 w-8 rounded-lg flex items-center justify-center shrink-0", category.bg)}>
                      <ClipboardCheck className={cn("h-4 w-4", category.color)} />
                    </div>
                    <div className="flex-1 text-left">
                      <p className="text-sm font-semibold text-foreground">{category.label}</p>
                      <p className="text-xs text-muted-foreground">{catCompleted}/{category.items.length} done</p>
                    </div>
                    <div className="flex items-center gap-2">
                      {catCompleted === category.items.length && (
                        <CheckCircle2 className="h-4 w-4 text-emerald-500" />
                      )}
                      {isExpanded
                        ? <ChevronDown className="h-4 w-4 text-muted-foreground" />
                        : <ChevronRight className="h-4 w-4 text-muted-foreground" />}
                    </div>
                  </button>

                  {isExpanded && (
                    <div className="px-4 pb-4 space-y-2 border-t border-muted/20 pt-3">
                      {category.items.map((item) => {
                        const isDone = checked.has(item.key);
                        return (
                          <button
                            key={item.key}
                            className="w-full flex items-start gap-3 py-1.5 pointer-events-auto text-left group"
                            onClick={() => toggle(category.key, item.key)}
                          >
                            {isDone
                              ? <CheckCircle2 className="h-5 w-5 text-emerald-500 shrink-0 mt-0.5" />
                              : <Circle className="h-5 w-5 text-muted-foreground/40 shrink-0 mt-0.5 group-hover:text-muted-foreground transition-colors" />}
                            <div>
                              <p className={cn("text-sm leading-snug", isDone ? "line-through text-muted-foreground" : "text-foreground")}>
                                {item.label}
                              </p>
                              {item.hint && (
                                <p className="text-[11px] text-muted-foreground mt-0.5">{item.hint}</p>
                              )}
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  )}
                </GlassCard>
              );
            })}
          </div>
        )}

        {/* Deadline card — split by ITR type */}
        <GlassCard className="p-4 bg-amber-50/40 border-amber-200/40">
          <div className="flex items-start gap-2.5">
            <AlertTriangle className="h-4 w-4 text-amber-600 mt-0.5 shrink-0" />
            <div>
              <p className="text-xs font-semibold text-amber-800 mb-1.5">Filing Deadlines — FY {fy}</p>
              <div className="space-y-1 text-xs text-amber-700">
                <div className="flex justify-between gap-4">
                  <span>ITR-1 / ITR-2 (salaried, capital gains)</span>
                  <span className="font-semibold shrink-0">31 Jul {fyEndYear}</span>
                </div>
                <div className="flex justify-between gap-4">
                  <span>ITR-3 / ITR-4 (business, professional — non-audit)</span>
                  <span className="font-semibold shrink-0">31 Aug {fyEndYear}</span>
                </div>
                <div className="flex justify-between gap-4">
                  <span>ITR — audit cases</span>
                  <span className="font-semibold shrink-0">31 Oct {fyEndYear}</span>
                </div>
                <div className="flex justify-between gap-4">
                  <span>Belated / Revised ITR (fee applies)</span>
                  <span className="font-semibold shrink-0">31 Mar {fyEndYear + 1}</span>
                </div>
              </div>
              <p className="text-[10px] text-amber-600 mt-2">
                Late filing penalty: ₹5,000 (₹1,000 if total income ≤ ₹5 L). E-verify within 30 days.
                ITR-3/4 deadline extended from 31 Jul to 31 Aug under Income Tax Act 2025.
              </p>
            </div>
          </div>
        </GlassCard>

        {/* Act 2025 form name reference */}
        <GlassCard className="p-4 bg-blue-50/40 border-blue-200/40">
          <div className="flex items-start gap-2.5">
            <Info className="h-4 w-4 text-blue-600 mt-0.5 shrink-0" />
            <div>
              <p className="text-xs font-semibold text-blue-800 mb-1.5">Form Name Changes — Income Tax Act 2025</p>
              <div className="grid grid-cols-2 gap-x-4 gap-y-0.5 text-xs text-blue-700">
                {[
                  ["Form 16",  "→ Form 130"],
                  ["Form 12BB","→ Form 124"],
                  ["Form 26AS","→ Form 168"],
                  ["Form 16A", "→ Form 16A (unchanged)"],
                  ["AIS",      "→ AIS (unchanged)"],
                  ["Sec 80C",  "→ Sec 123"],
                  ["Sec 80D",  "→ Sec 126"],
                  ["Sec 80E",  "→ Sec 129"],
                  ["Sec 80CCD","→ Sec 124"],
                  ["Sec 80G",  "→ Sec 132"],
                ].map(([old, newName]) => (
                  <div key={old} className="flex gap-1">
                    <span className="text-blue-500">{old}</span>
                    <span className="font-medium">{newName}</span>
                  </div>
                ))}
              </div>
              <p className="text-[10px] text-blue-600 mt-1.5">Benefits are identical — only the section/form numbers changed.</p>
            </div>
          </div>
        </GlassCard>

      </div>
    </AppLayout>
  );
};

export default ITRReadiness;
