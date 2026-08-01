import { useNavigate } from "react-router-dom";
import { useState, useEffect } from "react";
import { AppLayout } from "@/components/layout/AppLayout";
import { GlassCard } from "@/components/ui/glass-card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  ArrowLeft, Receipt, Plus, Trash2, X, Info, CheckCircle2, Circle, ChevronDown,
} from "lucide-react";
import { getCurrentFinancialYear } from "@/lib/date-utils";
import { formatFullINR, formatCompactINR } from "@/lib/currency";
import { useAuth } from "@/contexts/AuthContext";
import { cn } from "@/lib/utils";
import {
  addTdsEntry,
  getTdsEntries,
  deleteTdsEntry,
  updateTdsEntry,
} from "@/integrations/indexeddb/services/tdsService";
import type { MyDB } from "@/integrations/indexeddb/db";

type TdsEntry = MyDB["tds_entries"]["value"];

const INCOME_TYPES = [
  "Salary",
  "FD / Bank Interest",
  "Rent",
  "Professional / Freelance",
  "Commission",
  "Dividend",
  "Capital Gains",
  "Other",
];

const SECTIONS = [
  "192", "193", "194", "194A", "194C", "194D",
  "194H", "194I", "194J", "194N", "195", "Other",
];

// Form names updated for Income Tax Act 2025 (effective Apr 1 2026):
//   Form 16  → Form 130  (TDS certificate from employer)
//   Form 26AS → Form 168 (tax credit statement)
//   Form 16A stays as Form 16A
//   AIS stays as AIS
const FORMS = ["Form 130 (new Form 16)", "Form 16A", "Form 168 (new 26AS)", "AIS"];

const QUARTERS = ["Q1", "Q2", "Q3", "Q4"] as const;

interface AddForm {
  deductor_name: string;
  income_type: string;
  tds_section: string;
  quarter: "Q1" | "Q2" | "Q3" | "Q4";
  income_amount: string;
  tds_amount: string;
  form_type: string;
}

const EMPTY_FORM: AddForm = {
  deductor_name: "",
  income_type: "Salary",
  tds_section: "192",
  quarter: "Q1",
  income_amount: "",
  tds_amount: "",
  form_type: "Form 130 (new Form 16)",
};

const TDSTracker = () => {
  const navigate = useNavigate();
  const { user } = useAuth();
  const fy = getCurrentFinancialYear();

  const [entries, setEntries] = useState<TdsEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState<AddForm>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!user) return;
    getTdsEntries(user.id, fy).then((data) => {
      setEntries(data);
      setLoading(false);
    });
  }, [user, fy]);

  const setField = (k: keyof AddForm, v: string) =>
    setForm((prev) => ({ ...prev, [k]: v }));

  const handleAdd = async () => {
    if (!user || !form.deductor_name || !form.tds_amount) return;
    setSaving(true);
    const entry = await addTdsEntry(user.id, {
      financial_year: fy,
      deductor_name:  form.deductor_name,
      income_type:    form.income_type,
      tds_section:    form.tds_section,
      quarter:        form.quarter,
      income_amount:  parseFloat(form.income_amount) || 0,
      tds_amount:     parseFloat(form.tds_amount) || 0,
      form_type:      form.form_type,
      is_verified:    false,
    });
    setEntries((prev) => [entry, ...prev]);
    setForm(EMPTY_FORM);
    setShowAdd(false);
    setSaving(false);
  };

  const handleDelete = async (id: string) => {
    await deleteTdsEntry(id);
    setEntries((prev) => prev.filter((e) => e.id !== id));
  };

  const handleToggleVerify = async (entry: TdsEntry) => {
    const updated = await updateTdsEntry(entry.id, { is_verified: !entry.is_verified });
    if (updated) setEntries((prev) => prev.map((e) => e.id === entry.id ? updated : e));
  };

  const totalIncome    = entries.reduce((s, e) => s + e.income_amount, 0);
  const totalTds       = entries.reduce((s, e) => s + e.tds_amount, 0);
  const verified       = entries.filter((e) => e.is_verified).length;
  const effectiveRate  = totalIncome > 0 ? ((totalTds / totalIncome) * 100).toFixed(1) : "0";

  return (
    <AppLayout>
      <div className="space-y-5 mt-4 md:mt-0">

        {/* Header */}
        <div className="flex items-center gap-3">
          <Button
            variant="ghost" size="sm"
            className="h-9 w-9 p-0 rounded-xl pointer-events-auto"
            onClick={() => navigate("/tax-copilot")}
          >
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div className="h-10 w-10 rounded-2xl bg-blue-100 flex items-center justify-center shrink-0">
            <Receipt className="h-5 w-5 text-blue-600" />
          </div>
          <div className="flex-1">
            <h1 className="text-xl font-bold tracking-tight gradient-text">TDS Tracker</h1>
            <p className="text-xs text-muted-foreground">Tax Year 2026-27</p>
          </div>
          <Button
            size="sm"
            className="bg-gradient-primary text-primary-foreground pointer-events-auto h-8 px-3 text-xs gap-1.5"
            onClick={() => setShowAdd(true)}
          >
            <Plus className="h-3.5 w-3.5" /> Add
          </Button>
        </div>

        {/* Summary */}
        <div className="grid grid-cols-3 gap-2">
          <GlassCard className="p-3 text-center">
            <p className="text-xs text-muted-foreground mb-1">Total Income</p>
            <p className="text-base font-bold text-foreground">{formatCompactINR(totalIncome)}</p>
          </GlassCard>
          <GlassCard className="p-3 text-center">
            <p className="text-xs text-muted-foreground mb-1">TDS Deducted</p>
            <p className="text-base font-bold text-blue-600">{formatCompactINR(totalTds)}</p>
          </GlassCard>
          <GlassCard className="p-3 text-center">
            <p className="text-xs text-muted-foreground mb-1">Eff. Rate</p>
            <p className="text-base font-bold text-foreground">{effectiveRate}%</p>
          </GlassCard>
        </div>

        {entries.length > 0 && (
          <GlassCard className="p-3 flex items-center justify-between">
            <p className="text-xs text-muted-foreground">Verification status</p>
            <p className="text-xs font-semibold text-foreground">{verified}/{entries.length} entries verified</p>
          </GlassCard>
        )}

        {/* Add Form */}
        {showAdd && (
          <GlassCard className="p-4 border-primary/20">
            <div className="flex items-center justify-between mb-4">
              <p className="text-sm font-bold text-foreground">Add TDS Entry</p>
              <button
                onClick={() => { setShowAdd(false); setForm(EMPTY_FORM); }}
                className="pointer-events-auto"
              >
                <X className="h-4 w-4 text-muted-foreground" />
              </button>
            </div>
            <div className="space-y-3">
              <div>
                <label className="text-xs font-medium text-muted-foreground mb-1 block">Deductor / Company Name</label>
                <Input
                  value={form.deductor_name}
                  onChange={(e) => setField("deductor_name", e.target.value)}
                  placeholder="e.g. Infosys Ltd, HDFC Bank"
                  className="h-9 text-sm pointer-events-auto"
                  autoFocus
                />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-xs font-medium text-muted-foreground mb-1 block">Income Type</label>
                  <div className="relative">
                    <select
                      value={form.income_type}
                      onChange={(e) => setField("income_type", e.target.value)}
                      className="w-full h-9 rounded-lg border border-input bg-background px-3 text-sm appearance-none pr-8 pointer-events-auto"
                    >
                      {INCOME_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                    </select>
                    <ChevronDown className="absolute right-2.5 top-2.5 h-4 w-4 text-muted-foreground pointer-events-none" />
                  </div>
                </div>
                <div>
                  <label className="text-xs font-medium text-muted-foreground mb-1 block">TDS Section</label>
                  <div className="relative">
                    <select
                      value={form.tds_section}
                      onChange={(e) => setField("tds_section", e.target.value)}
                      className="w-full h-9 rounded-lg border border-input bg-background px-3 text-sm appearance-none pr-8 pointer-events-auto"
                    >
                      {SECTIONS.map((s) => <option key={s} value={s}>Sec {s}</option>)}
                    </select>
                    <ChevronDown className="absolute right-2.5 top-2.5 h-4 w-4 text-muted-foreground pointer-events-none" />
                  </div>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-xs font-medium text-muted-foreground mb-1 block">Quarter</label>
                  <div className="relative">
                    <select
                      value={form.quarter}
                      onChange={(e) => setField("quarter", e.target.value as any)}
                      className="w-full h-9 rounded-lg border border-input bg-background px-3 text-sm appearance-none pr-8 pointer-events-auto"
                    >
                      {QUARTERS.map((q) => <option key={q} value={q}>{q}</option>)}
                    </select>
                    <ChevronDown className="absolute right-2.5 top-2.5 h-4 w-4 text-muted-foreground pointer-events-none" />
                  </div>
                </div>
                <div>
                  <label className="text-xs font-medium text-muted-foreground mb-1 block">Form Type</label>
                  <div className="relative">
                    <select
                      value={form.form_type}
                      onChange={(e) => setField("form_type", e.target.value)}
                      className="w-full h-9 rounded-lg border border-input bg-background px-3 text-sm appearance-none pr-8 pointer-events-auto"
                    >
                      {FORMS.map((f) => <option key={f} value={f}>{f}</option>)}
                    </select>
                    <ChevronDown className="absolute right-2.5 top-2.5 h-4 w-4 text-muted-foreground pointer-events-none" />
                  </div>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-xs font-medium text-muted-foreground mb-1 block">Income Amount (₹)</label>
                  <Input
                    type="number" value={form.income_amount}
                    onChange={(e) => setField("income_amount", e.target.value)}
                    placeholder="0" className="h-9 text-sm pointer-events-auto"
                  />
                </div>
                <div>
                  <label className="text-xs font-medium text-muted-foreground mb-1 block">TDS Amount (₹)</label>
                  <Input
                    type="number" value={form.tds_amount}
                    onChange={(e) => setField("tds_amount", e.target.value)}
                    placeholder="0" className="h-9 text-sm pointer-events-auto"
                  />
                </div>
              </div>
              <Button
                className="w-full bg-gradient-primary text-primary-foreground pointer-events-auto h-9 text-sm"
                onClick={handleAdd}
                disabled={saving || !form.deductor_name || !form.tds_amount}
              >
                {saving ? "Saving…" : "Add Entry"}
              </Button>
            </div>
          </GlassCard>
        )}

        {/* Empty state */}
        {!loading && entries.length === 0 && !showAdd && (
          <GlassCard className="p-6 text-center space-y-3">
            <div className="h-12 w-12 rounded-2xl bg-blue-100 flex items-center justify-center mx-auto">
              <Receipt className="h-6 w-6 text-blue-600" />
            </div>
            <p className="text-sm font-semibold text-foreground">No TDS entries yet</p>
            <p className="text-xs text-muted-foreground max-w-xs mx-auto">
              Track TDS deducted from your salary, FD interest, rent, and other income sources.
            </p>
            <Button
              size="sm"
              className="bg-gradient-primary text-primary-foreground pointer-events-auto gap-1.5"
              onClick={() => setShowAdd(true)}
            >
              <Plus className="h-3.5 w-3.5" /> Add TDS Entry
            </Button>
          </GlassCard>
        )}

        {/* Entries */}
        {entries.length > 0 && (
          <div className="space-y-2">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
              All Entries ({entries.length})
            </p>
            {entries.map((entry) => (
              <GlassCard
                key={entry.id}
                className={cn("p-3 border transition-all", entry.is_verified ? "border-emerald-200 bg-emerald-50/20" : "")}
              >
                <div className="flex items-start gap-3">
                  <button
                    onClick={() => handleToggleVerify(entry)}
                    className="shrink-0 mt-0.5 pointer-events-auto"
                  >
                    {entry.is_verified
                      ? <CheckCircle2 className="h-5 w-5 text-emerald-500" />
                      : <Circle className="h-5 w-5 text-muted-foreground/40" />}
                  </button>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <p className="text-sm font-semibold text-foreground truncate">{entry.deductor_name}</p>
                        <p className="text-xs text-muted-foreground">
                          {entry.income_type} · Sec {entry.tds_section} · {entry.quarter} · {entry.form_type}
                        </p>
                      </div>
                      <div className="text-right shrink-0">
                        <p className="text-sm font-bold text-blue-600">{formatCompactINR(entry.tds_amount)}</p>
                        {entry.income_amount > 0 && (
                          <p className="text-xs text-muted-foreground">on {formatCompactINR(entry.income_amount)}</p>
                        )}
                      </div>
                    </div>
                  </div>
                  <button
                    onClick={() => handleDelete(entry.id)}
                    className="pointer-events-auto mt-0.5 shrink-0"
                  >
                    <Trash2 className="h-3.5 w-3.5 text-muted-foreground/50 hover:text-red-500 transition-colors" />
                  </button>
                </div>
              </GlassCard>
            ))}
          </div>
        )}

        {/* Info note — updated for Act 2025 form names */}
        <GlassCard className="p-4 bg-blue-50/40 border-blue-200/40">
          <div className="flex items-start gap-2.5">
            <Info className="h-4 w-4 text-blue-600 mt-0.5 shrink-0" />
            <div>
              <p className="text-xs font-semibold text-blue-800 mb-1">Reconciliation Tip · Income Tax Act 2025</p>
              <p className="text-xs text-blue-700 leading-relaxed">
                Cross-check your TDS entries with <strong>Form 168</strong> (new Form 26AS) and the
                Annual Information Statement (AIS) on the Income Tax portal. Both are available at
                incometax.gov.in. Discrepancies must be raised with your deductor before filing your ITR.
              </p>
              <div className="mt-2 grid grid-cols-2 gap-x-4 gap-y-0.5 text-[10px] text-blue-600">
                <span>Form 16 → <strong>Form 130</strong></span>
                <span>Form 26AS → <strong>Form 168</strong></span>
                <span>Form 12BB → <strong>Form 124</strong></span>
                <span>Form 16A — unchanged</span>
              </div>
            </div>
          </div>
        </GlassCard>

      </div>
    </AppLayout>
  );
};

export default TDSTracker;
