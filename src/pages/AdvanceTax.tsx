import { useNavigate } from "react-router-dom";
import { useState, useEffect } from "react";
import { AppLayout } from "@/components/layout/AppLayout";
import { GlassCard } from "@/components/ui/glass-card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  ArrowLeft, TrendingUp, CheckCircle2, Circle,
  IndianRupee, Info, Pencil, Check, X, AlertTriangle,
} from "lucide-react";
import { getCurrentFinancialYear } from "@/lib/date-utils";
import { formatFullINR } from "@/lib/currency";
import { useAuth } from "@/contexts/AuthContext";
import { cn } from "@/lib/utils";
import { upsertAdvanceTaxPayment, getAdvanceTaxPayments } from "@/integrations/indexeddb/services/advanceTaxService";
import { getTaxPlannerOutput, getTaxPlannerInput } from "@/integrations/indexeddb/services/taxPlannerService";

// ── Instalment schedules ──────────────────────────────────────────────────────

interface Installment {
  installment: "Q1" | "Q2" | "Q3" | "Q4";
  label: string;
  dueDate: string;
  cumulativePct: number;
  incrementalPct: number;
}

/** Standard 4-instalment schedule (salaried / other income) */
function buildStandardInstallments(fyStartYear: number): Installment[] {
  const y = fyStartYear;
  return [
    { installment: "Q1", label: "1st Instalment",  dueDate: `${y}-06-15`,     cumulativePct: 15,  incrementalPct: 15  },
    { installment: "Q2", label: "2nd Instalment",  dueDate: `${y}-09-15`,     cumulativePct: 45,  incrementalPct: 30  },
    { installment: "Q3", label: "3rd Instalment",  dueDate: `${y}-12-15`,     cumulativePct: 75,  incrementalPct: 30  },
    { installment: "Q4", label: "Final Instalment",dueDate: `${y + 1}-03-15`, cumulativePct: 100, incrementalPct: 25  },
  ];
}

/** Single-instalment schedule for 44AD / 44ADA taxpayers — 100% by 15 March */
function buildPresumptiveInstallments(fyStartYear: number): Installment[] {
  const y = fyStartYear;
  return [
    { installment: "Q4", label: "Single Instalment (100%)", dueDate: `${y + 1}-03-15`, cumulativePct: 100, incrementalPct: 100 },
  ];
}

// ── Component ─────────────────────────────────────────────────────────────────

const AdvanceTax = () => {
  const navigate  = useNavigate();
  const { user }  = useAuth();
  const fy        = getCurrentFinancialYear();
  const fyStartYear = parseInt(fy.split("-")[0], 10);

  // Is this user under presumptive taxation (44AD / 44ADA)?
  const [isPresumptive, setIsPresumptive] = useState(false);
  const [estimatedTax, setEstimatedTax]   = useState<number>(0);
  const [taxInput, setTaxInput]           = useState<string>("");
  const [editingTax, setEditingTax]       = useState(false);
  const [payments, setPayments]           = useState<Record<string, { paid_amount: number; is_paid: boolean; paid_date: string | null }>>({});
  const [editingQ, setEditingQ]           = useState<string | null>(null);
  const [editAmount, setEditAmount]       = useState<string>("");
  const [saving, setSaving]               = useState(false);

  useEffect(() => {
    if (!user) return;
    const loadData = async () => {
      // Check if user has business / professional income streams
      const inputData = await getTaxPlannerInput(user.id);
      if (inputData) {
        let streams: string[] = [];
        try { streams = JSON.parse(inputData.active_income_streams || "[]"); } catch {}
        setIsPresumptive(streams.includes("business") || streams.includes("professional"));
      }

      // Pre-fill estimated tax from AI planner output
      const aiData = await getTaxPlannerOutput(user.id);
      if (aiData?.recommendations_json) {
        const rec = aiData.recommendations_json as any;
        const tax = Math.min(rec.taxLiabilityOld || 0, rec.taxLiabilityNew || 0);
        if (tax > 0) {
          setEstimatedTax(tax);
          setTaxInput(String(Math.round(tax)));
        }
      }

      // Load saved payment records
      const records = await getAdvanceTaxPayments(user.id, fy);
      const map: typeof payments = {};
      for (const r of records) {
        map[r.installment] = { paid_amount: r.paid_amount, is_paid: r.is_paid, paid_date: r.paid_date };
      }
      setPayments(map);
    };
    loadData();
  }, [user, fy]);

  const installments = isPresumptive
    ? buildPresumptiveInstallments(fyStartYear)
    : buildStandardInstallments(fyStartYear);

  const totalPaid = Object.values(payments).reduce((s, p) => s + (p.is_paid ? p.paid_amount : 0), 0);
  const remaining = Math.max(0, estimatedTax - totalPaid);

  const handleTaxSave = () => {
    const v = parseFloat(taxInput);
    if (!isNaN(v) && v >= 0) setEstimatedTax(v);
    setEditingTax(false);
  };

  const handleMarkPaid = async (q: "Q1" | "Q2" | "Q3" | "Q4", installment: Installment) => {
    if (!user) return;
    const amount = parseFloat(editAmount);
    if (isNaN(amount) || amount < 0) return;
    setSaving(true);
    const rec = await upsertAdvanceTaxPayment(user.id, {
      installment: q,
      financial_year: fy,
      due_date: installment.dueDate,
      estimated_amount: Math.round((installment.incrementalPct / 100) * estimatedTax),
      paid_amount: amount,
      paid_date: new Date().toISOString().split("T")[0],
      is_paid: true,
    });
    setPayments((prev) => ({ ...prev, [q]: { paid_amount: rec.paid_amount, is_paid: rec.is_paid, paid_date: rec.paid_date } }));
    setEditingQ(null);
    setEditAmount("");
    setSaving(false);
  };

  const handleUnmark = async (q: "Q1" | "Q2" | "Q3" | "Q4", installment: Installment) => {
    if (!user) return;
    const rec = await upsertAdvanceTaxPayment(user.id, {
      installment: q,
      financial_year: fy,
      due_date: installment.dueDate,
      estimated_amount: Math.round((installment.incrementalPct / 100) * estimatedTax),
      paid_amount: 0,
      paid_date: null,
      is_paid: false,
    });
    setPayments((prev) => ({ ...prev, [q]: { paid_amount: 0, is_paid: false, paid_date: null } }));
  };

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
          <div className="h-10 w-10 rounded-2xl bg-violet-100 flex items-center justify-center shrink-0">
            <TrendingUp className="h-5 w-5 text-violet-600" />
          </div>
          <div>
            <h1 className="text-xl font-bold tracking-tight gradient-text">Advance Tax</h1>
            <p className="text-xs text-muted-foreground">Tax Year 2026-27 instalment tracker</p>
          </div>
        </div>

        {/* Presumptive taxpayer notice */}
        {isPresumptive && (
          <GlassCard className="p-3 bg-amber-50/40 border-amber-200/40">
            <div className="flex items-start gap-2">
              <AlertTriangle className="h-4 w-4 text-amber-600 mt-0.5 shrink-0" />
              <div>
                <p className="text-xs font-semibold text-amber-800">Presumptive Scheme (44AD / 44ADA)</p>
                <p className="text-xs text-amber-700 mt-0.5">
                  You have business or professional income. Under the presumptive scheme,
                  advance tax is paid as a <strong>single instalment of 100%</strong> by <strong>15 March</strong>.
                  The 4-instalment schedule does not apply to you.
                </p>
              </div>
            </div>
          </GlassCard>
        )}

        {/* Estimated tax card */}
        <GlassCard className="p-4">
          <div className="flex items-center justify-between mb-1">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Estimated Annual Tax</p>
            <button
              onClick={() => { setEditingTax(true); setTaxInput(String(Math.round(estimatedTax))); }}
              className="pointer-events-auto"
            >
              <Pencil className="h-3.5 w-3.5 text-muted-foreground hover:text-foreground transition-colors" />
            </button>
          </div>

          {editingTax ? (
            <div className="flex items-center gap-2 mt-2">
              <span className="text-muted-foreground text-sm">₹</span>
              <Input
                type="number"
                value={taxInput}
                onChange={(e) => setTaxInput(e.target.value)}
                className="h-9 text-sm pointer-events-auto"
                placeholder="e.g. 50000"
                autoFocus
              />
              <Button size="sm" className="h-9 bg-gradient-primary text-primary-foreground pointer-events-auto" onClick={handleTaxSave}>
                <Check className="h-3.5 w-3.5" />
              </Button>
              <Button size="sm" variant="ghost" className="h-9 pointer-events-auto" onClick={() => setEditingTax(false)}>
                <X className="h-3.5 w-3.5" />
              </Button>
            </div>
          ) : (
            <p className="text-2xl font-bold text-primary mt-1">
              {estimatedTax > 0 ? formatFullINR(estimatedTax) : "—"}
            </p>
          )}

          {estimatedTax > 0 && (
            <div className="mt-3 pt-3 border-t border-muted/30 grid grid-cols-2 gap-3">
              <div>
                <p className="text-xs text-muted-foreground">Total Paid</p>
                <p className="text-base font-bold text-emerald-600">{formatFullINR(totalPaid)}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Remaining</p>
                <p className="text-base font-bold text-foreground">{formatFullINR(remaining)}</p>
              </div>
            </div>
          )}
        </GlassCard>

        {estimatedTax <= 0 && (
          <div className="flex items-start gap-2 p-3 rounded-xl bg-amber-50 border border-amber-200">
            <Info className="h-4 w-4 text-amber-600 mt-0.5 shrink-0" />
            <p className="text-xs text-amber-800">
              Enter your estimated annual tax above, or run the <strong>AI Tax Planner</strong> to auto-fill it.
              Advance tax applies when total liability exceeds ₹10,000.
            </p>
          </div>
        )}

        {/* Instalment cards */}
        <div className="space-y-3">
          {installments.map((inst) => {
            const instAmount = estimatedTax > 0 ? Math.round((inst.incrementalPct / 100) * estimatedTax) : 0;
            const payment    = payments[inst.installment];
            const isPaid     = payment?.is_paid ?? false;
            const paidAmt    = payment?.paid_amount ?? 0;
            const dueDate    = new Date(inst.dueDate).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
            const isOverdue  = new Date(inst.dueDate) < new Date() && !isPaid;
            const isEditing  = editingQ === inst.installment;

            return (
              <GlassCard
                key={inst.installment}
                className={cn(
                  "p-4 border transition-all",
                  isPaid    ? "border-emerald-200 bg-emerald-50/30"
                  : isOverdue ? "border-red-200 bg-red-50/30"
                  : "border-muted/30",
                )}
              >
                <div className="flex items-start gap-3">
                  <div className={cn(
                    "h-9 w-9 rounded-xl flex items-center justify-center shrink-0",
                    isPaid ? "bg-emerald-100" : isOverdue ? "bg-red-100" : "bg-violet-100",
                  )}>
                    {isPaid
                      ? <CheckCircle2 className="h-4.5 w-4.5 text-emerald-600" />
                      : <Circle className={cn("h-4.5 w-4.5", isOverdue ? "text-red-500" : "text-violet-500")} />}
                  </div>

                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-2">
                      <div>
                        <p className="text-sm font-semibold text-foreground">{inst.label}</p>
                        <p className="text-xs text-muted-foreground">
                          Due {dueDate} · {inst.incrementalPct}% of annual tax
                        </p>
                      </div>
                      <div className="text-right shrink-0">
                        <p className="text-sm font-bold text-foreground">
                          {instAmount > 0 ? formatFullINR(instAmount) : "—"}
                        </p>
                        <span className={cn(
                          "text-[10px] font-bold px-1.5 py-0.5 rounded-full",
                          isPaid    ? "bg-emerald-100 text-emerald-700"
                          : isOverdue ? "bg-red-100 text-red-700"
                          : "bg-muted/40 text-muted-foreground",
                        )}>
                          {isPaid ? "Paid" : isOverdue ? "Overdue" : "Pending"}
                        </span>
                      </div>
                    </div>

                    {isPaid && (
                      <div className="mt-2 flex items-center justify-between">
                        <p className="text-xs text-emerald-700">
                          Paid: <span className="font-semibold">{formatFullINR(paidAmt)}</span>
                          {payment?.paid_date && ` on ${new Date(payment.paid_date).toLocaleDateString("en-IN", { day: "numeric", month: "short" })}`}
                        </p>
                        <button
                          onClick={() => handleUnmark(inst.installment, inst)}
                          className="text-xs text-muted-foreground underline pointer-events-auto"
                        >
                          Undo
                        </button>
                      </div>
                    )}

                    {!isPaid && isEditing && (
                      <div className="mt-2 flex items-center gap-2">
                        <span className="text-muted-foreground text-xs">₹</span>
                        <Input
                          type="number"
                          value={editAmount}
                          onChange={(e) => setEditAmount(e.target.value)}
                          placeholder={instAmount > 0 ? String(instAmount) : "Amount paid"}
                          className="h-8 text-xs pointer-events-auto"
                          autoFocus
                        />
                        <Button
                          size="sm"
                          className="h-8 bg-gradient-primary text-primary-foreground pointer-events-auto text-xs px-3"
                          onClick={() => handleMarkPaid(inst.installment, inst)}
                          disabled={saving}
                        >
                          <Check className="h-3 w-3" />
                        </Button>
                        <Button
                          size="sm" variant="ghost"
                          className="h-8 pointer-events-auto px-2"
                          onClick={() => { setEditingQ(null); setEditAmount(""); }}
                        >
                          <X className="h-3 w-3" />
                        </Button>
                      </div>
                    )}

                    {!isPaid && !isEditing && (
                      <Button
                        size="sm" variant="outline"
                        className="mt-2 h-7 text-xs rounded-lg pointer-events-auto"
                        onClick={() => { setEditingQ(inst.installment); setEditAmount(instAmount > 0 ? String(instAmount) : ""); }}
                      >
                        Mark as Paid
                      </Button>
                    )}
                  </div>
                </div>
              </GlassCard>
            );
          })}
        </div>

        {/* Info note */}
        <GlassCard className="p-4 bg-blue-50/40 border-blue-200/40">
          <div className="flex items-start gap-2.5">
            <Info className="h-4 w-4 text-blue-600 mt-0.5 shrink-0" />
            <div>
              <p className="text-xs font-semibold text-blue-800 mb-1">Advance Tax Rules — FY 2026-27</p>
              <ul className="text-xs text-blue-700 space-y-0.5">
                <li>• Mandatory if total tax liability <strong>exceeds ₹10,000</strong> (after TDS)</li>
                <li>• Senior citizens (60+) with <strong>no business income</strong> are exempt</li>
                <li>• 44AD / 44ADA taxpayers: <strong>single instalment by 15 March</strong> (not quarterly)</li>
                <li>• Non-payment attracts interest u/s 234B &amp; 234C</li>
                <li>• TDS deducted by employer counts — only pay the shortfall</li>
              </ul>
            </div>
          </div>
        </GlassCard>

      </div>
    </AppLayout>
  );
};

export default AdvanceTax;
