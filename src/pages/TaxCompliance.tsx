import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { AppLayout } from "@/components/layout/AppLayout";
import { GlassCard } from "@/components/ui/glass-card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  ArrowLeft, ClipboardCheck, CalendarDays, TrendingUp,
  CheckCircle2, Circle, ChevronDown, ChevronRight,
  AlertCircle, Clock, FileText, Wallet, Sparkles,
  Info, Pencil, Check, X, AlertTriangle, IndianRupee,
} from "lucide-react";
import { getCurrentFinancialYear } from "@/lib/date-utils";
import { formatFullINR } from "@/lib/currency";
import { useAuth } from "@/contexts/AuthContext";
import { cn } from "@/lib/utils";
import {
  upsertAdvanceTaxPayment,
  getAdvanceTaxPayments,
} from "@/integrations/indexeddb/services/advanceTaxService";
import {
  getItrChecklist,
  upsertItrChecklistItem,
} from "@/integrations/indexeddb/services/itrChecklistService";
import {
  getTaxPlannerOutput,
  getTaxPlannerInput,
} from "@/integrations/indexeddb/services/taxPlannerService";
import {
  getCalendarState,
  saveCalendarState,
} from "@/integrations/indexeddb/services/taxCalendarService";
import type { IncomeStream } from "@/pages/TaxPlannerAI";

// ═══════════════════════════════════════════════════════════════════
// TAX CALENDAR DATA
// ═══════════════════════════════════════════════════════════════════

interface TaxEvent {
  id: string;
  date: Date;
  title: string;
  description: string;
  category: "advance_tax" | "itr" | "audit" | "investment";
  applicableTo?: string;
}

function buildEvents(y: number): TaxEvent[] {
  const ny = y + 1;
  return [
    { id: "form124_declaration",  date: new Date(`${y}-04-30`),  title: "Submit Form 124 to Employer",      description: "Declare HRA, home-loan, LTC & regime choice to employer for correct TDS.", category: "investment",  applicableTo: "Salaried" },
    { id: "adv_q1",               date: new Date(`${y}-06-15`),  title: "Advance Tax Q1 — 15%",             description: "15% of estimated annual tax. Applies if tax liability > ₹10,000 after TDS.",  category: "advance_tax", applicableTo: "All taxpayers" },
    { id: "form130_due",          date: new Date(`${y}-06-15`),  title: "Form 130 due from Employer",       description: "Employer must issue Form 130 (new Form 16) by 15 Jun.", category: "itr", applicableTo: "Salaried" },
    { id: "adv_q2",               date: new Date(`${y}-09-15`),  title: "Advance Tax Q2 — 45%",             description: "Cumulative 45% of estimated annual tax due.", category: "advance_tax", applicableTo: "All taxpayers" },
    { id: "itr_1_2",              date: new Date(`${y}-07-31`),  title: "ITR-1 / ITR-2 Filing Deadline",    description: "Salaried taxpayers and those with capital gains / 2+ properties.", category: "itr", applicableTo: "Salaried / Capital Gains" },
    { id: "itr_3_4",              date: new Date(`${y}-08-31`),  title: "ITR-3 / ITR-4 Filing Deadline",    description: "Business & professional income (non-audit cases). 44AD/44ADA also by 31 Aug.", category: "itr", applicableTo: "Business / Professional" },
    { id: "adv_q3",               date: new Date(`${y}-12-15`),  title: "Advance Tax Q3 — 75%",             description: "Cumulative 75% of estimated annual tax due.", category: "advance_tax", applicableTo: "All taxpayers" },
    { id: "audit_due",            date: new Date(`${y}-10-31`),  title: "Tax Audit Report (Form 3CA/3CB)",   description: "Taxpayers liable for audit must submit by 31 Oct.", category: "audit", applicableTo: "Audit cases" },
    { id: "itr_audit",            date: new Date(`${y}-11-30`),  title: "ITR Filing — Audit Cases",         description: "Return filing deadline for taxpayers who required audit.", category: "itr", applicableTo: "Audit cases" },
    { id: "adv_q4",               date: new Date(`${ny}-03-15`), title: "Advance Tax Q4 / Final — 100%",    description: "Final 100% cumulative. Also the single instalment for 44AD/44ADA taxpayers.", category: "advance_tax", applicableTo: "All taxpayers" },
    { id: "belated_revised",      date: new Date(`${ny}-03-31`), title: "Belated / Revised ITR Deadline",   description: "Last date to file belated ITR or revise a filed return (with late fee).", category: "itr", applicableTo: "All taxpayers" },
  ];
}

const CAT_META = {
  advance_tax: { icon: TrendingUp, color: "text-violet-600", bg: "bg-violet-100", label: "Advance Tax" },
  itr:         { icon: FileText,   color: "text-blue-600",   bg: "bg-blue-100",   label: "ITR Filing"  },
  audit:       { icon: Sparkles,   color: "text-amber-600",  bg: "bg-amber-100",  label: "Audit"       },
  investment:  { icon: Wallet,     color: "text-emerald-600",bg: "bg-emerald-100",label: "Investment"  },
};

type EventStatus = "past" | "urgent" | "upcoming" | "future";

function eventStatus(date: Date, today: Date): EventStatus {
  const diff = Math.ceil((date.getTime() - today.getTime()) / 86400000);
  if (diff < 0)   return "past";
  if (diff <= 14) return "urgent";
  if (diff <= 60) return "upcoming";
  return "future";
}

// ═══════════════════════════════════════════════════════════════════
// ADVANCE TAX DATA
// ═══════════════════════════════════════════════════════════════════

interface Installment {
  installment: "Q1" | "Q2" | "Q3" | "Q4";
  label: string;
  dueDate: string;
  cumulativePct: number;
  incrementalPct: number;
}

function buildStandardInstallments(y: number): Installment[] {
  return [
    { installment: "Q1", label: "1st Instalment",  dueDate: `${y}-06-15`,     cumulativePct: 15,  incrementalPct: 15  },
    { installment: "Q2", label: "2nd Instalment",  dueDate: `${y}-09-15`,     cumulativePct: 45,  incrementalPct: 30  },
    { installment: "Q3", label: "3rd Instalment",  dueDate: `${y}-12-15`,     cumulativePct: 75,  incrementalPct: 30  },
    { installment: "Q4", label: "Final Instalment",dueDate: `${y + 1}-03-15`, cumulativePct: 100, incrementalPct: 25  },
  ];
}

function buildPresumptiveInstallments(y: number): Installment[] {
  return [
    { installment: "Q4", label: "Single Instalment (100%)", dueDate: `${y + 1}-03-15`, cumulativePct: 100, incrementalPct: 100 },
  ];
}

// ═══════════════════════════════════════════════════════════════════
// ITR CHECKLIST DATA
// ═══════════════════════════════════════════════════════════════════

interface ChecklistItemDef { key: string; label: string; hint?: string; streams?: IncomeStream[]; }
interface CategoryDef { key: string; label: string; color: string; bg: string; items: ChecklistItemDef[]; }

const CHECKLIST: CategoryDef[] = [
  {
    key: "prerequisites", label: "Prerequisites", color: "text-primary", bg: "bg-primary/10",
    items: [
      { key: "pan_aadhaar_linked", label: "PAN linked with Aadhaar", hint: "Mandatory — check on incometax.gov.in" },
      { key: "itd_portal_login",   label: "IT portal login active (incometax.gov.in)" },
      { key: "bank_prevalidated",  label: "Bank account pre-validated for refund" },
    ],
  },
  {
    key: "income_docs", label: "Income Documents", color: "text-violet-600", bg: "bg-violet-100",
    items: [
      { key: "form130_received",   label: "Form 130 from employer (new Form 16)", hint: "Employer must issue by 15 Jun", streams: ["salary"] },
      { key: "form168_downloaded", label: "Form 168 (26AS) downloaded & verified", hint: "Download via incometax.gov.in" },
      { key: "ais_reviewed",       label: "AIS reviewed for discrepancies" },
      { key: "fd_interest_cert",   label: "FD / savings bank interest certificates" },
      { key: "business_records",   label: "Business turnover records / GST returns", streams: ["business"] },
      { key: "professional_invoices", label: "Professional invoices from all clients", streams: ["professional"] },
      { key: "rental_docs",        label: "Rental agreement + rent + municipal tax receipts", streams: ["rental"] },
      { key: "cg_broker_statement",label: "Capital gains statement from broker/demat", streams: ["capital_gains"] },
    ],
  },
  {
    key: "deductions", label: "Deduction Proofs (Old Regime)", color: "text-emerald-600", bg: "bg-emerald-100",
    items: [
      { key: "sec123_proofs",     label: "Sec 123 / 80C proofs: ELSS, PPF, LIC, EPF", hint: "Limit ₹1.5L. Old Regime only." },
      { key: "sec126_receipts",   label: "80D health insurance receipts", hint: "₹25K self+family; ₹50K if parents are senior citizens" },
      { key: "nps_statement",     label: "NPS statement — 80CCD(1B) + 80CCD(2)", hint: "80CCD(2) employer NPS works in BOTH regimes" },
      { key: "home_loan_cert",    label: "Home loan interest & principal certificate", hint: "Sec 24(b) max ₹2L self-occ in Old Regime" },
      { key: "hra_receipts",      label: "HRA rent receipts + landlord PAN if rent > ₹1L", streams: ["salary"] },
    ],
  },
  {
    key: "regime_choice", label: "Regime & Filing", color: "text-amber-600", bg: "bg-amber-100",
    items: [
      { key: "regime_decided",    label: "Decided between Old Regime and New Regime", hint: "New Regime is default. Compare before filing." },
      { key: "form10iea_filed",   label: "Form 10-IEA filed if opting Old Regime", streams: ["business", "professional"] },
      { key: "itr_form_identified", label: "Correct ITR form identified", hint: "ITR-1: salary ≤₹50L | ITR-2: CG/2+ properties | ITR-3: business audit | ITR-4: 44AD/ADA ≤₹50L" },
      { key: "itr_filed",         label: "ITR filed on IT portal", hint: "ITR-1/2 by 31 Jul | ITR-3/4 by 31 Aug | Audit by 31 Oct" },
      { key: "itr_everified",     label: "ITR e-verified within 30 days", hint: "e-verify via Aadhaar OTP, net banking, or DSC" },
    ],
  },
];

// ═══════════════════════════════════════════════════════════════════
// SECTION WRAPPER
// ═══════════════════════════════════════════════════════════════════

const Section = ({
  id, icon: Icon, iconBg, iconColor, title, subtitle, children, defaultOpen = true,
}: {
  id: string; icon: any; iconBg: string; iconColor: string;
  title: string; subtitle: string; children: React.ReactNode; defaultOpen?: boolean;
}) => {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <GlassCard className="overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center gap-3 p-4 pointer-events-auto"
      >
        <div className={cn("h-9 w-9 rounded-xl flex items-center justify-center shrink-0", iconBg)}>
          <Icon className={cn("h-4.5 w-4.5", iconColor)} />
        </div>
        <div className="flex-1 text-left">
          <p className="text-sm font-bold text-foreground">{title}</p>
          <p className="text-xs text-muted-foreground">{subtitle}</p>
        </div>
        {open
          ? <ChevronDown className="h-4 w-4 text-muted-foreground shrink-0" />
          : <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
        }
      </button>
      {open && <div className="px-4 pb-4 border-t border-border/30 pt-3">{children}</div>}
    </GlassCard>
  );
};

// ═══════════════════════════════════════════════════════════════════
// MAIN COMPONENT
// ═══════════════════════════════════════════════════════════════════

const TaxCompliance = () => {
  const navigate = useNavigate();
  const { user } = useAuth();
  const fy = getCurrentFinancialYear();
  const fyStartYear = parseInt(fy.split("-")[0], 10);
  const today = new Date();

  // ── Calendar state ───────────────────────────────────────────────
  const allEvents = buildEvents(fyStartYear);
  const [calChecked, setCalChecked] = useState<Set<string>>(new Set());
  const [calFilter, setCalFilter] = useState<"all" | "advance_tax" | "itr" | "audit" | "investment">("all");

  const toggleCalendar = (id: string) => {
    if (!user) return;
    setCalChecked(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      // Save to IndexedDB asynchronously
      saveCalendarState(user.id, fy, next);
      return next;
    });
  };

  const filteredEvents = [...allEvents]
    .filter(e => calFilter === "all" || e.category === calFilter)
    .sort((a, b) => a.date.getTime() - b.date.getTime());

  const nextEvent = allEvents
    .filter(e => !calChecked.has(e.id) && e.date >= today)
    .sort((a, b) => a.date.getTime() - b.date.getTime())[0];

  // ── Advance tax state ────────────────────────────────────────────
  const [isPresumptive, setIsPresumptive] = useState(false);
  const [estimatedTax,  setEstimatedTax]  = useState(0);
  const [taxInput,      setTaxInput]      = useState("");
  const [editingTax,    setEditingTax]    = useState(false);
  const [payments,      setPayments]      = useState<Record<string, { paid_amount: number; is_paid: boolean; paid_date: string | null }>>({});
  const [editingQ,      setEditingQ]      = useState<string | null>(null);
  const [editAmount,    setEditAmount]    = useState("");
  const [saving,        setSaving]        = useState(false);

  // ── ITR checklist state ──────────────────────────────────────────
  const [checked,  setChecked]  = useState<Set<string>>(new Set());
  const [streams,  setStreams]  = useState<IncomeStream[]>([]);
  const [expanded, setExpanded] = useState<Set<string>>(new Set(CHECKLIST.map(c => c.key)));

  // ── Load all data ────────────────────────────────────────────────
  useEffect(() => {
    if (!user) return;
    const load = async () => {
      // Calendar state from IndexedDB
      const calState = await getCalendarState(user.id, fy);
      setCalChecked(calState);

      // Income streams
      const inputData = await getTaxPlannerInput(user.id);
      if (inputData?.active_income_streams) {
        try {
          const s = JSON.parse(inputData.active_income_streams) as IncomeStream[];
          setStreams(s);
          setIsPresumptive(s.includes("business") || s.includes("professional"));
        } catch {}
      }
      // Estimated tax from AI planner
      const aiData = await getTaxPlannerOutput(user.id);
      if (aiData?.recommendations_json) {
        const rec = aiData.recommendations_json as any;
        const tax = Math.min(rec.taxLiabilityOld || 0, rec.taxLiabilityNew || 0);
        if (tax > 0) { setEstimatedTax(tax); setTaxInput(String(Math.round(tax))); }
      }
      // Advance tax payments
      const records = await getAdvanceTaxPayments(user.id, fy);
      const map: typeof payments = {};
      for (const r of records) {
        map[r.installment] = { paid_amount: r.paid_amount, is_paid: r.is_paid, paid_date: r.paid_date };
      }
      setPayments(map);
      // ITR checklist
      const items = await getItrChecklist(user.id, fy);
      setChecked(new Set(items.filter(i => i.is_completed).map(i => i.item_key)));
    };
    load();
  }, [user, fy]);

  // ── Advance tax handlers ─────────────────────────────────────────
  const installments = isPresumptive
    ? buildPresumptiveInstallments(fyStartYear)
    : buildStandardInstallments(fyStartYear);

  const totalPaid = Object.values(payments).reduce((s, p) => s + (p.is_paid ? p.paid_amount : 0), 0);
  const remaining = Math.max(0, estimatedTax - totalPaid);

  const handleMarkPaid = async (q: "Q1" | "Q2" | "Q3" | "Q4", inst: Installment) => {
    if (!user) return;
    const amount = parseFloat(editAmount);
    if (isNaN(amount) || amount < 0) return;
    setSaving(true);
    const rec = await upsertAdvanceTaxPayment(user.id, {
      installment: q, financial_year: fy, due_date: inst.dueDate,
      estimated_amount: Math.round((inst.incrementalPct / 100) * estimatedTax),
      paid_amount: amount, paid_date: new Date().toISOString().split("T")[0], is_paid: true,
    });
    setPayments(prev => ({ ...prev, [q]: { paid_amount: rec.paid_amount, is_paid: rec.is_paid, paid_date: rec.paid_date } }));
    setEditingQ(null); setEditAmount(""); setSaving(false);
  };

  const handleUnmark = async (q: "Q1" | "Q2" | "Q3" | "Q4", inst: Installment) => {
    if (!user) return;
    await upsertAdvanceTaxPayment(user.id, {
      installment: q, financial_year: fy, due_date: inst.dueDate,
      estimated_amount: Math.round((inst.incrementalPct / 100) * estimatedTax),
      paid_amount: 0, paid_date: null, is_paid: false,
    });
    setPayments(prev => ({ ...prev, [q]: { paid_amount: 0, is_paid: false, paid_date: null } }));
  };

  // ── ITR checklist handlers ───────────────────────────────────────
  const filteredChecklist = CHECKLIST.map(cat => ({
    ...cat,
    items: cat.items.filter(item => {
      if (!item.streams || item.streams.length === 0) return true;
      if (streams.length === 0) return true;
      return item.streams.some(s => streams.includes(s));
    }),
  })).filter(cat => cat.items.length > 0);

  const totalItems   = filteredChecklist.reduce((s, c) => s + c.items.length, 0);
  const checkedCount = filteredChecklist.reduce((s, c) => s + c.items.filter(i => checked.has(i.key)).length, 0);

  const toggleChecklist = async (catKey: string, itemKey: string) => {
    if (!user) return;
    const newVal = !checked.has(itemKey);
    setChecked(prev => { const next = new Set(prev); newVal ? next.add(itemKey) : next.delete(itemKey); return next; });
    await upsertItrChecklistItem(user.id, fy, itemKey, catKey, newVal);
  };

  // ── Render ───────────────────────────────────────────────────────
  return (
    <AppLayout>
      <div className="space-y-5 mt-4 md:mt-0">

        {/* Header */}
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="sm" className="h-9 w-9 p-0 rounded-xl pointer-events-auto"
            onClick={() => navigate("/tax-copilot")}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div className="h-10 w-10 rounded-2xl bg-emerald-100 flex items-center justify-center shrink-0">
            <ClipboardCheck className="h-5 w-5 text-emerald-600" />
          </div>
          <div>
            <h1 className="text-xl font-bold tracking-tight gradient-text">Tax Compliance</h1>
            <p className="text-xs text-muted-foreground">{fy} · Income Tax Act 2025</p>
          </div>
        </div>

        {/* Next deadline banner */}
        {nextEvent && (
          <div className="flex items-start gap-3 bg-amber-50 border border-amber-200/60 rounded-xl px-4 py-3">
            <Clock className="h-4 w-4 text-amber-600 shrink-0 mt-0.5" />
            <div>
              <p className="text-xs font-semibold text-amber-800">Next deadline</p>
              <p className="text-sm font-bold text-amber-900">{nextEvent.title}</p>
              <p className="text-xs text-amber-700">{nextEvent.date.toLocaleDateString("en-IN", { day: "numeric", month: "long", year: "numeric" })}</p>
            </div>
          </div>
        )}

        {/* ── Section 1: Tax Calendar ─────────────────────────────── */}
        <Section id="calendar" icon={CalendarDays} iconBg="bg-primary/10" iconColor="text-primary"
          title="Tax Calendar" subtitle={`${allEvents.filter(e => calChecked.has(e.id)).length} of ${allEvents.length} deadlines marked done`}>

          {/* Filter tabs */}
          <div className="flex gap-1.5 flex-wrap mb-3">
            {(["all", "advance_tax", "itr", "audit", "investment"] as const).map(f => (
              <button key={f} type="button" onClick={() => setCalFilter(f)}
                className={cn("text-[10px] font-semibold px-2.5 py-1 rounded-full transition-all pointer-events-auto",
                  calFilter === f ? "bg-primary text-primary-foreground" : "bg-muted/40 text-muted-foreground hover:bg-muted"
                )}>
                {f === "all" ? "All" : f === "advance_tax" ? "Advance Tax" : f === "itr" ? "ITR Filing" : f === "audit" ? "Audit" : "Investment"}
              </button>
            ))}
          </div>

          <div className="space-y-2">
            {filteredEvents.map(event => {
              const status = eventStatus(event.date, today);
              const done   = calChecked.has(event.id);
              const meta   = CAT_META[event.category];
              const Icon   = meta.icon;
              return (
                <div key={event.id} className={cn(
                  "rounded-xl border p-3 transition-all",
                  done ? "opacity-50 border-muted/30 bg-muted/10" :
                  status === "urgent"   ? "border-red-200 bg-red-50/40" :
                  status === "upcoming" ? "border-amber-200 bg-amber-50/30" : "border-border/30"
                )}>
                  <div className="flex items-start gap-2.5">
                    <button type="button" onClick={() => toggleCalendar(event.id)}
                      className="mt-0.5 pointer-events-auto shrink-0">
                      {done
                        ? <CheckCircle2 className="h-4 w-4 text-emerald-500" />
                        : <Circle className={cn("h-4 w-4", status === "urgent" ? "text-red-400" : status === "upcoming" ? "text-amber-400" : "text-muted-foreground/40")} />
                      }
                    </button>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className={cn("text-xs font-semibold", done ? "line-through text-muted-foreground" : "text-foreground")}>
                          {event.title}
                        </p>
                        {!done && status === "urgent" && (
                          <span className="text-[9px] font-bold bg-red-100 text-red-700 px-1.5 py-0.5 rounded-full">Urgent</span>
                        )}
                      </div>
                      <p className="text-[10px] text-muted-foreground mt-0.5">
                        {event.date.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}
                        {event.applicableTo && <span className="ml-2 text-muted-foreground/60">· {event.applicableTo}</span>}
                      </p>
                      <p className="text-[11px] text-muted-foreground mt-1 leading-relaxed">{event.description}</p>
                    </div>
                    <div className={cn("h-6 w-6 rounded-lg flex items-center justify-center shrink-0", meta.bg)}>
                      <Icon className={cn("h-3 w-3", meta.color)} />
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </Section>

        {/* ── Section 2: Advance Tax ──────────────────────────────── */}
        <Section id="advance" icon={TrendingUp} iconBg="bg-violet-100" iconColor="text-violet-600"
          title="Advance Tax" subtitle={`FY ${fy} · ${isPresumptive ? "Presumptive (44AD/44ADA)" : "Standard 4-instalment"}`}>

          {/* Estimated tax edit */}
          <div className="flex items-center justify-between mb-3">
            <div>
              <p className="text-[10px] text-muted-foreground uppercase tracking-wide">Estimated Tax Liability</p>
              {editingTax ? (
                <div className="flex items-center gap-2 mt-1">
                  <Input value={taxInput} onChange={e => setTaxInput(e.target.value)} type="number"
                    className="h-8 text-sm w-32 pointer-events-auto" />
                  <button type="button" onClick={() => { const v = parseFloat(taxInput); if (!isNaN(v)) setEstimatedTax(v); setEditingTax(false); }}
                    className="text-emerald-600 pointer-events-auto"><Check className="h-4 w-4" /></button>
                  <button type="button" onClick={() => setEditingTax(false)}
                    className="text-muted-foreground pointer-events-auto"><X className="h-4 w-4" /></button>
                </div>
              ) : (
                <div className="flex items-center gap-2 mt-1">
                  <p className="text-xl font-bold text-foreground">{estimatedTax > 0 ? formatFullINR(estimatedTax) : "—"}</p>
                  <button type="button" onClick={() => setEditingTax(true)}
                    className="text-muted-foreground/40 hover:text-primary pointer-events-auto">
                    <Pencil className="h-3.5 w-3.5" />
                  </button>
                </div>
              )}
            </div>
            {totalPaid > 0 && (
              <div className="text-right">
                <p className="text-[10px] text-muted-foreground">Remaining</p>
                <p className={cn("text-base font-bold", remaining > 0 ? "text-amber-600" : "text-emerald-600")}>
                  {remaining > 0 ? formatFullINR(remaining) : "Paid ✓"}
                </p>
              </div>
            )}
          </div>

          {estimatedTax === 0 && (
            <div className="flex items-start gap-2 bg-amber-50 border border-amber-200/60 rounded-xl px-3 py-2.5 mb-3">
              <Info className="h-3.5 w-3.5 text-amber-600 shrink-0 mt-0.5" />
              <p className="text-xs text-amber-700">Run the AI Tax Planner to auto-fill your estimated tax, or tap the edit icon above to enter it manually.</p>
            </div>
          )}

          <div className="space-y-2">
            {installments.map(inst => {
              const q       = inst.installment;
              const due     = new Date(inst.dueDate);
              const status  = eventStatus(due, today);
              const payment = payments[q];
              const isPaid  = payment?.is_paid ?? false;
              const due_amt = Math.round((inst.incrementalPct / 100) * estimatedTax);

              return (
                <div key={q} className={cn(
                  "rounded-xl border p-3",
                  isPaid ? "border-emerald-200/60 bg-emerald-50/40" :
                  status === "urgent"   ? "border-red-200 bg-red-50/30" :
                  status === "upcoming" ? "border-amber-200 bg-amber-50/20" : "border-border/30"
                )}>
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        {isPaid
                          ? <CheckCircle2 className="h-4 w-4 text-emerald-500 shrink-0" />
                          : <Circle className={cn("h-4 w-4 shrink-0", status === "urgent" ? "text-red-400" : "text-muted-foreground/30")} />
                        }
                        <p className="text-xs font-semibold text-foreground">{inst.label}</p>
                        <span className={cn("text-[9px] font-bold px-1.5 py-0.5 rounded-full",
                          isPaid ? "bg-emerald-100 text-emerald-700" :
                          status === "urgent" ? "bg-red-100 text-red-700" :
                          status === "upcoming" ? "bg-amber-100 text-amber-700" : "bg-muted/40 text-muted-foreground"
                        )}>
                          {isPaid ? "Paid" : status === "past" ? "Overdue" : status === "urgent" ? "Due soon" : "Scheduled"}
                        </span>
                      </div>
                      <p className="text-[10px] text-muted-foreground ml-6">
                        Due {due.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}
                        {" · "}{inst.cumulativePct}% cumulative
                        {estimatedTax > 0 && <span className="font-medium text-foreground"> · ₹{due_amt.toLocaleString("en-IN")}</span>}
                      </p>
                      {isPaid && payment?.paid_amount > 0 && (
                        <p className="text-[10px] text-emerald-700 ml-6 mt-0.5">
                          Paid {formatFullINR(payment.paid_amount)}
                          {payment.paid_date && ` on ${new Date(payment.paid_date).toLocaleDateString("en-IN", { day: "numeric", month: "short" })}`}
                        </p>
                      )}
                    </div>
                    {!isPaid ? (
                      editingQ === q ? (
                        <div className="flex items-center gap-1.5">
                          <Input value={editAmount} onChange={e => setEditAmount(e.target.value)} type="number"
                            placeholder="Amount paid" className="h-7 text-xs w-28 pointer-events-auto" />
                          <button type="button" onClick={() => handleMarkPaid(q as any, inst)} disabled={saving}
                            className="h-7 px-2 bg-emerald-500 text-white rounded-lg text-[10px] font-semibold pointer-events-auto">
                            {saving ? "…" : "Save"}
                          </button>
                          <button type="button" onClick={() => { setEditingQ(null); setEditAmount(""); }}
                            className="text-muted-foreground pointer-events-auto"><X className="h-3.5 w-3.5" /></button>
                        </div>
                      ) : (
                        <button type="button" onClick={() => { setEditingQ(q); setEditAmount(String(due_amt)); }}
                          className="h-7 px-2.5 bg-primary/10 text-primary rounded-lg text-[10px] font-semibold hover:bg-primary/20 transition-colors pointer-events-auto">
                          Mark Paid
                        </button>
                      )
                    ) : (
                      <button type="button" onClick={() => handleUnmark(q as any, inst)}
                        className="h-7 px-2.5 bg-muted/40 text-muted-foreground rounded-lg text-[10px] hover:bg-muted transition-colors pointer-events-auto">
                        Unmark
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </Section>

        {/* ── Section 3: ITR Readiness ────────────────────────────── */}
        <Section id="itr" icon={ClipboardCheck} iconBg="bg-emerald-100" iconColor="text-emerald-600"
          title="ITR Readiness" subtitle={`${checkedCount} of ${totalItems} documents ready`}>

          {/* Progress */}
          <div className="mb-3 space-y-1">
            <div className="h-2 bg-muted/40 rounded-full overflow-hidden">
              <div className="h-full bg-emerald-500 rounded-full transition-all"
                style={{ width: `${totalItems > 0 ? Math.round((checkedCount / totalItems) * 100) : 0}%` }} />
            </div>
            <p className="text-[10px] text-muted-foreground text-right">
              {totalItems > 0 ? Math.round((checkedCount / totalItems) * 100) : 0}% complete
            </p>
          </div>

          <div className="space-y-3">
            {filteredChecklist.map(cat => {
              const isExpanded = expanded.has(cat.key);
              const catChecked = cat.items.filter(i => checked.has(i.key)).length;
              return (
                <div key={cat.key} className="border border-border/30 rounded-xl overflow-hidden">
                  <button type="button"
                    onClick={() => setExpanded(prev => {
                      const next = new Set(prev);
                      next.has(cat.key) ? next.delete(cat.key) : next.add(cat.key);
                      return next;
                    })}
                    className="w-full flex items-center gap-2 px-3 py-2.5 bg-muted/20 pointer-events-auto">
                    <div className={cn("h-6 w-6 rounded-lg flex items-center justify-center shrink-0", cat.bg)}>
                      <ClipboardCheck className={cn("h-3 w-3", cat.color)} />
                    </div>
                    <p className="text-xs font-semibold text-foreground flex-1 text-left">{cat.label}</p>
                    <span className="text-[10px] text-muted-foreground">{catChecked}/{cat.items.length}</span>
                    {isExpanded
                      ? <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
                      : <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
                    }
                  </button>
                  {isExpanded && (
                    <div className="px-3 py-2 space-y-2">
                      {cat.items.map(item => (
                        <div key={item.key} className="flex items-start gap-2.5">
                          <button type="button" onClick={() => toggleChecklist(cat.key, item.key)}
                            className="mt-0.5 pointer-events-auto shrink-0">
                            {checked.has(item.key)
                              ? <CheckCircle2 className="h-4 w-4 text-emerald-500" />
                              : <Circle className="h-4 w-4 text-muted-foreground/30" />
                            }
                          </button>
                          <div className="flex-1 min-w-0">
                            <p className={cn("text-xs leading-snug", checked.has(item.key) ? "line-through text-muted-foreground" : "text-foreground")}>
                              {item.label}
                            </p>
                            {item.hint && (
                              <p className="text-[10px] text-muted-foreground mt-0.5 leading-relaxed">{item.hint}</p>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </Section>

      </div>
    </AppLayout>
  );
};

export default TaxCompliance;
