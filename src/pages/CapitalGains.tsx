import { useNavigate } from "react-router-dom";
import { useState, useEffect } from "react";
import { AppLayout } from "@/components/layout/AppLayout";
import { GlassCard } from "@/components/ui/glass-card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  ArrowLeft, BarChart3, Plus, Trash2, TrendingUp, TrendingDown,
  X, Info, ChevronDown, AlertTriangle,
} from "lucide-react";
import { getCurrentFinancialYear } from "@/lib/date-utils";
import { formatCompactINR, formatFullINR } from "@/lib/currency";
import { useAuth } from "@/contexts/AuthContext";
import { cn } from "@/lib/utils";
import {
  addCapitalGainsEntry,
  getCapitalGainsEntries,
  deleteCapitalGainsEntry,
  classifyGain,
  calcCapitalGainsTax,
} from "@/integrations/indexeddb/services/capitalGainsService";
import type { MyDB } from "@/integrations/indexeddb/db";

type Entry = MyDB["capital_gains_entries"]["value"];

const ASSET_TYPES = [
  { value: "equity",      label: "Equity (Stocks)"       },
  { value: "equity_mf",   label: "Equity Mutual Fund"    },
  { value: "debt_mf",     label: "Debt / Hybrid MF"      },
  { value: "real_estate", label: "Real Estate"            },
  { value: "gold",        label: "Gold / SGBs"            },
  { value: "other",       label: "Other"                  },
];

const ASSET_LABEL: Record<string, string> = Object.fromEntries(
  ASSET_TYPES.map((a) => [a.value, a.label]),
);

interface AddForm {
  asset_type: string;
  asset_name: string;
  purchase_date: string;
  purchase_price: string;
  quantity: string;
  sale_date: string;
  sale_price: string;
}

const EMPTY_FORM: AddForm = {
  asset_type: "equity",
  asset_name: "",
  purchase_date: "",
  purchase_price: "",
  quantity: "1",
  sale_date: "",
  sale_price: "",
};

const CapitalGains = () => {
  const navigate = useNavigate();
  const { user } = useAuth();
  const fy = getCurrentFinancialYear();

  const [entries, setEntries] = useState<Entry[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState<AddForm>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!user) return;
    getCapitalGainsEntries(user.id, fy).then((data) => {
      setEntries(data);
      setLoading(false);
    });
  }, [user, fy]);

  const setField = (k: keyof AddForm, v: string) =>
    setForm((prev) => ({ ...prev, [k]: v }));

  const handleAdd = async () => {
    if (!user || !form.asset_name || !form.purchase_date || !form.purchase_price) return;
    setSaving(true);
    const entry = await addCapitalGainsEntry(user.id, {
      asset_type:     form.asset_type,
      asset_name:     form.asset_name,
      purchase_date:  form.purchase_date,
      sale_date:      form.sale_date || null,
      purchase_price: parseFloat(form.purchase_price) || 0,
      sale_price:     form.sale_price ? parseFloat(form.sale_price) : null,
      quantity:       parseFloat(form.quantity) || 1,
      financial_year: fy,
    });
    setEntries((prev) => [entry, ...prev]);
    setForm(EMPTY_FORM);
    setShowAdd(false);
    setSaving(false);
  };

  const handleDelete = async (id: string) => {
    await deleteCapitalGainsEntry(id);
    setEntries((prev) => prev.filter((e) => e.id !== id));
  };

  // ── Summary calculations (cess included in service) ────────────────────────
  const soldEntries = entries.filter((e) => e.sale_date && e.sale_price !== null);
  let ltcgTotal = 0, stcgTotal = 0, ltcgTax = 0, stcgTax = 0;
  let ltcgCumulative = 0; // tracks equity LTCG for ₹1.25 L exemption

  for (const e of soldEntries) {
    if (!e.sale_date || e.sale_price === null) continue;
    const gain = (e.sale_price - e.purchase_price) * e.quantity;
    const type = classifyGain(e.asset_type, e.purchase_date, e.sale_date);

    if (type === "LTCG") {
      ltcgTotal += gain;
      ltcgTax   += calcCapitalGainsTax("LTCG", e.asset_type, gain, ltcgCumulative);
      if (["equity", "equity_mf"].includes(e.asset_type)) ltcgCumulative += gain;
    } else {
      stcgTotal += gain;
      stcgTax   += calcCapitalGainsTax("STCG", e.asset_type, gain);
    }
  }

  // Non-equity STCG (returned as 0 by service — taxed at slab) shown separately
  const nonEquityStcg = soldEntries
    .filter((e) => {
      if (!e.sale_date || e.sale_price === null) return false;
      return !["equity", "equity_mf"].includes(e.asset_type) &&
        classifyGain(e.asset_type, e.purchase_date, e.sale_date) === "STCG";
    })
    .reduce((s, e) => s + (e.sale_price! - e.purchase_price) * e.quantity, 0);

  const totalFlatRateTax = ltcgTax + stcgTax; // already includes 4% cess

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
          <div className="h-10 w-10 rounded-2xl bg-amber-100 flex items-center justify-center shrink-0">
            <BarChart3 className="h-5 w-5 text-amber-600" />
          </div>
          <div className="flex-1">
            <h1 className="text-xl font-bold tracking-tight gradient-text">Capital Gains</h1>
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

        {/* Summary tiles */}
        <div className="grid grid-cols-2 gap-3">
          <GlassCard className="p-3">
            <p className="text-xs text-muted-foreground mb-1">LTCG Gains</p>
            <p className={cn("text-lg font-bold", ltcgTotal >= 0 ? "text-emerald-600" : "text-red-500")}>
              {formatCompactINR(ltcgTotal)}
            </p>
            <p className="text-xs text-muted-foreground">
              Tax ~{formatCompactINR(ltcgTax)}
              <span className="ml-1 text-[10px]">(incl. cess)</span>
            </p>
          </GlassCard>
          <GlassCard className="p-3">
            <p className="text-xs text-muted-foreground mb-1">STCG Gains</p>
            <p className={cn("text-lg font-bold", stcgTotal >= 0 ? "text-amber-600" : "text-red-500")}>
              {formatCompactINR(stcgTotal)}
            </p>
            <p className="text-xs text-muted-foreground">
              Tax ~{formatCompactINR(stcgTax)}
              <span className="ml-1 text-[10px]">(incl. cess)</span>
            </p>
          </GlassCard>
        </div>

        {/* Total tax card */}
        {totalFlatRateTax > 0 && (
          <GlassCard className="p-4 bg-gradient-to-br from-primary/8 to-primary/3 border-primary/15">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-semibold text-foreground">Estimated Capital Gains Tax</p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Flat-rate tax only · includes 4% cess · 87A rebate does not apply
                </p>
              </div>
              <p className="text-lg font-bold text-primary shrink-0">{formatFullINR(totalFlatRateTax)}</p>
            </div>
            {nonEquityStcg !== 0 && (
              <div className="mt-3 pt-3 border-t border-primary/10 flex items-start gap-2">
                <AlertTriangle className="h-3.5 w-3.5 text-amber-500 shrink-0 mt-0.5" />
                <p className="text-xs text-muted-foreground">
                  Non-equity STCG of <strong>{formatCompactINR(nonEquityStcg)}</strong> is taxed at
                  your applicable slab rate — add it to your slab income in the AI Tax Planner.
                </p>
              </div>
            )}
          </GlassCard>
        )}

        {/* Add form */}
        {showAdd && (
          <GlassCard className="p-4 border-primary/20">
            <div className="flex items-center justify-between mb-4">
              <p className="text-sm font-bold text-foreground">Add Transaction</p>
              <button
                onClick={() => { setShowAdd(false); setForm(EMPTY_FORM); }}
                className="pointer-events-auto"
              >
                <X className="h-4 w-4 text-muted-foreground" />
              </button>
            </div>
            <div className="space-y-3">
              <div>
                <label className="text-xs font-medium text-muted-foreground mb-1 block">Asset Type</label>
                <div className="relative">
                  <select
                    value={form.asset_type}
                    onChange={(e) => setField("asset_type", e.target.value)}
                    className="w-full h-9 rounded-lg border border-input bg-background px-3 text-sm appearance-none pr-8 pointer-events-auto"
                  >
                    {ASSET_TYPES.map((a) => (
                      <option key={a.value} value={a.value}>{a.label}</option>
                    ))}
                  </select>
                  <ChevronDown className="absolute right-2.5 top-2.5 h-4 w-4 text-muted-foreground pointer-events-none" />
                </div>
              </div>
              <div>
                <label className="text-xs font-medium text-muted-foreground mb-1 block">Asset Name</label>
                <Input
                  value={form.asset_name}
                  onChange={(e) => setField("asset_name", e.target.value)}
                  placeholder="e.g. Reliance Industries, HDFC Flexi Cap"
                  className="h-9 text-sm pointer-events-auto"
                />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-xs font-medium text-muted-foreground mb-1 block">Buy Date</label>
                  <Input
                    type="date" value={form.purchase_date}
                    onChange={(e) => setField("purchase_date", e.target.value)}
                    className="h-9 text-sm pointer-events-auto"
                  />
                </div>
                <div>
                  <label className="text-xs font-medium text-muted-foreground mb-1 block">Qty / Units</label>
                  <Input
                    type="number" value={form.quantity}
                    onChange={(e) => setField("quantity", e.target.value)}
                    className="h-9 text-sm pointer-events-auto" placeholder="1"
                  />
                </div>
              </div>
              <div>
                <label className="text-xs font-medium text-muted-foreground mb-1 block">Buy Price per unit (₹)</label>
                <Input
                  type="number" value={form.purchase_price}
                  onChange={(e) => setField("purchase_price", e.target.value)}
                  placeholder="0" className="h-9 text-sm pointer-events-auto"
                />
              </div>
              <div className="pt-1 border-t border-muted/30">
                <p className="text-xs font-medium text-muted-foreground mb-2">
                  Sale Details <span className="font-normal">(leave blank if not yet sold)</span>
                </p>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="text-xs text-muted-foreground mb-1 block">Sale Date</label>
                    <Input
                      type="date" value={form.sale_date}
                      onChange={(e) => setField("sale_date", e.target.value)}
                      className="h-9 text-sm pointer-events-auto"
                    />
                  </div>
                  <div>
                    <label className="text-xs text-muted-foreground mb-1 block">Sale Price per unit (₹)</label>
                    <Input
                      type="number" value={form.sale_price}
                      onChange={(e) => setField("sale_price", e.target.value)}
                      placeholder="0" className="h-9 text-sm pointer-events-auto"
                    />
                  </div>
                </div>
              </div>
              <Button
                className="w-full bg-gradient-primary text-primary-foreground pointer-events-auto h-9 text-sm"
                onClick={handleAdd}
                disabled={saving || !form.asset_name || !form.purchase_date || !form.purchase_price}
              >
                {saving ? "Saving…" : "Add Transaction"}
              </Button>
            </div>
          </GlassCard>
        )}

        {/* Empty state */}
        {!loading && entries.length === 0 && !showAdd && (
          <GlassCard className="p-6 text-center space-y-3">
            <div className="h-12 w-12 rounded-2xl bg-amber-100 flex items-center justify-center mx-auto">
              <BarChart3 className="h-6 w-6 text-amber-600" />
            </div>
            <p className="text-sm font-semibold text-foreground">No transactions yet</p>
            <p className="text-xs text-muted-foreground max-w-xs mx-auto">
              Add buy/sell transactions to track capital gains and estimate your tax liability.
            </p>
            <Button
              size="sm"
              className="bg-gradient-primary text-primary-foreground pointer-events-auto gap-1.5"
              onClick={() => setShowAdd(true)}
            >
              <Plus className="h-3.5 w-3.5" /> Add Transaction
            </Button>
          </GlassCard>
        )}

        {/* Entries list */}
        {entries.length > 0 && (
          <div className="space-y-2">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
              Transactions ({entries.length})
            </p>
            {entries.map((entry) => {
              const hasSale  = entry.sale_date && entry.sale_price !== null;
              const gain     = hasSale ? (entry.sale_price! - entry.purchase_price) * entry.quantity : null;
              const gainType = hasSale
                ? classifyGain(entry.asset_type, entry.purchase_date, entry.sale_date!)
                : null;

              return (
                <GlassCard key={entry.id} className="p-3">
                  <div className="flex items-start gap-3">
                    <div className={cn(
                      "h-8 w-8 rounded-lg flex items-center justify-center shrink-0",
                      gain === null ? "bg-muted/40" : gain >= 0 ? "bg-emerald-100" : "bg-red-100",
                    )}>
                      {gain !== null
                        ? (gain >= 0
                          ? <TrendingUp  className="h-4 w-4 text-emerald-600" />
                          : <TrendingDown className="h-4 w-4 text-red-500"    />)
                        : <TrendingUp className="h-4 w-4 text-muted-foreground" />}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <p className="text-sm font-semibold text-foreground truncate">{entry.asset_name}</p>
                          <p className="text-xs text-muted-foreground">
                            {ASSET_LABEL[entry.asset_type] || entry.asset_type}
                          </p>
                        </div>
                        <div className="text-right shrink-0">
                          {gain !== null && (
                            <>
                              <p className={cn("text-sm font-bold", gain >= 0 ? "text-emerald-600" : "text-red-500")}>
                                {gain >= 0 ? "+" : ""}{formatCompactINR(gain)}
                              </p>
                              {gainType && (
                                <span className={cn(
                                  "text-[10px] font-bold px-1.5 py-0.5 rounded-full",
                                  gainType === "LTCG"
                                    ? "bg-emerald-100 text-emerald-700"
                                    : "bg-amber-100 text-amber-700",
                                )}>
                                  {gainType}
                                </span>
                              )}
                            </>
                          )}
                          {!hasSale && (
                            <span className="text-[10px] bg-muted/40 text-muted-foreground px-1.5 py-0.5 rounded-full">
                              Holding
                            </span>
                          )}
                        </div>
                      </div>
                      <p className="text-xs text-muted-foreground mt-1">
                        Bought {new Date(entry.purchase_date).toLocaleDateString("en-IN", {
                          day: "numeric", month: "short", year: "numeric",
                        })} · ₹{entry.purchase_price} × {entry.quantity}
                        {hasSale && ` → ₹${entry.sale_price}`}
                      </p>
                    </div>
                    <button
                      onClick={() => handleDelete(entry.id)}
                      className="pointer-events-auto mt-0.5 shrink-0"
                    >
                      <Trash2 className="h-3.5 w-3.5 text-muted-foreground/50 hover:text-red-500 transition-colors" />
                    </button>
                  </div>
                </GlassCard>
              );
            })}
          </div>
        )}

        {/* Info note */}
        <GlassCard className="p-4 bg-blue-50/40 border-blue-200/40">
          <div className="flex items-start gap-2.5">
            <Info className="h-4 w-4 text-blue-600 mt-0.5 shrink-0" />
            <div>
              <p className="text-xs font-semibold text-blue-800 mb-1">
                FY 2026-27 Rates — confirmed unchanged by Budget 2026
              </p>
              <ul className="text-xs text-blue-700 space-y-0.5">
                <li>• <strong>Equity LTCG</strong> (Sec 112A): 12.5% on gains above ₹1.25 L/year + 4% cess</li>
                <li>• <strong>Equity STCG</strong> (Sec 111A): 20% + 4% cess</li>
                <li>• <strong>Other LTCG</strong> (real estate, gold, debt MF — post Jul 23 2024): 12.5% without indexation + 4% cess</li>
                <li>• <strong>Non-equity STCG</strong>: taxed at your applicable income slab rate (not shown here — add to AI Tax Planner)</li>
                <li>• <strong>Debt MF</strong> (bought after Apr 1 2023): always at slab rate regardless of holding period</li>
              </ul>
              <p className="text-[10px] text-blue-600 mt-1.5">
                87A rebate does not apply to capital gains. Tax shown is approximate — consult a CA for exact liability.
              </p>
            </div>
          </div>
        </GlassCard>

      </div>
    </AppLayout>
  );
};

export default CapitalGains;
