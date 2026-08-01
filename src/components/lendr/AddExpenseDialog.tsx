"use client";
import React, { useState, useEffect, useMemo } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Receipt, ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { Member, Split, SplitMode, calculateSplits } from "@/integrations/indexeddb/services/lendrService";
import { format } from "date-fns";

interface Props {
  open: boolean;
  onClose: () => void;
  members: Member[];
  onSave: (data: {
    id?: string;
    description: string;
    total_amount: number;
    paid_by_member_id: string;
    date: string;
    splits: Split[];
  }) => Promise<void>;
  initial?: {
    id: string;
    description: string;
    total_amount: number;
    paid_by_member_id: string;
    date: string;
    splits: Split[];
  };
}

const SPLIT_MODES: { value: SplitMode; label: string; hint: string }[] = [
  { value: "equal",   label: "Equal",    hint: "Split evenly"          },
  { value: "exact",   label: "Exact ₹",  hint: "Enter each amount"     },
  { value: "percent", label: "Percent",  hint: "Enter % for each"      },
  { value: "shares",  label: "Shares",   hint: "Enter shares (ratio)"  },
];

export const AddExpenseDialog = ({ open, onClose, members, onSave, initial }: Props) => {
  const [desc,      setDesc]      = useState("");
  const [amount,    setAmount]    = useState("");
  const [paidBy,    setPaidBy]    = useState(members[0]?.id ?? "");
  const [date,      setDate]      = useState(format(new Date(), "yyyy-MM-dd"));
  const [mode,      setMode]      = useState<SplitMode>("equal");
  const [inputs,    setInputs]    = useState<Record<string, string>>({});
  const [saving,    setSaving]    = useState(false);
  const [error,     setError]     = useState("");

  useEffect(() => {
    if (!open) return;
    if (initial) {
      setDesc(initial.description);
      setAmount(initial.total_amount.toString());
      setPaidBy(initial.paid_by_member_id);
      setDate(initial.date.slice(0, 10));
      setMode("equal");
      setInputs({});
    } else {
      setDesc(""); setAmount(""); setPaidBy(members[0]?.id ?? "");
      setDate(format(new Date(), "yyyy-MM-dd"));
      setMode("equal"); setInputs({}); setError("");
    }
  }, [open, initial]);

  const total = parseFloat(amount) || 0;

  // Live split preview
  const previewSplits = useMemo(() => {
    if (!total || members.length === 0) return [];
    const numInputs: Record<string, number> = {};
    for (const m of members) numInputs[m.id] = parseFloat(inputs[m.id] ?? "") || (mode === "shares" ? 1 : mode === "percent" ? (100 / members.length) : 0);
    return calculateSplits(members, total, mode, numInputs, paidBy);
  }, [total, members, mode, inputs, paidBy]);

  const splitTotal = previewSplits.reduce((s, sp) => s + sp.amount, 0);
  const splitValid = mode === "equal" || Math.abs(splitTotal - total) < 0.5;

  const setInput = (memberId: string, val: string) =>
    setInputs(p => ({ ...p, [memberId]: val }));

  const handleSave = async () => {
    if (!desc.trim())    { setError("Description is required.");        return; }
    if (total <= 0)      { setError("Enter a valid amount.");           return; }
    if (!paidBy)         { setError("Select who paid.");                return; }
    if (!splitValid)     { setError(`Splits must add up to ₹${total}.`); return; }

    setSaving(true);
    try {
      await onSave({
        id:                initial?.id,
        description:       desc.trim(),
        total_amount:      total,
        paid_by_member_id: paidBy,
        date:              new Date(date).toISOString(),
        splits:            previewSplits,
      });
      onClose();
    } catch (e: any) {
      setError(e.message ?? "Failed to save expense.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-xs sm:max-w-md bg-gradient-to-br from-white via-white to-primary/5 border border-white/20 shadow-xl rounded-2xl pointer-events-auto max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-lg font-semibold bg-gradient-to-r from-primary to-primary/70 bg-clip-text text-transparent flex items-center gap-2">
            <Receipt className="h-4 w-4" />
            {initial ? "Edit Expense" : "Add Expense"}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-3 py-2">
          {/* Description */}
          <div className="space-y-1.5">
            <Label className="text-xs">Description</Label>
            <Input value={desc} onChange={e => { setDesc(e.target.value); setError(""); }}
              placeholder="e.g. Dinner, Cab, Hotel" className="h-9 text-sm pointer-events-auto" />
          </div>

          {/* Amount + Date */}
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1.5">
              <Label className="text-xs">Amount (₹)</Label>
              <Input type="number" value={amount} onChange={e => { setAmount(e.target.value); setError(""); }}
                placeholder="0" className="h-9 text-sm pointer-events-auto" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Date</Label>
              <Input type="date" value={date} onChange={e => setDate(e.target.value)}
                className="h-9 text-sm pointer-events-auto" />
            </div>
          </div>

          {/* Paid by */}
          <div className="space-y-1.5">
            <Label className="text-xs">Paid by</Label>
            <div className="relative">
              <select value={paidBy} onChange={e => setPaidBy(e.target.value)}
                className="w-full h-9 rounded-lg border border-input bg-background px-3 text-sm appearance-none pr-8 pointer-events-auto">
                {members.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
              </select>
              <ChevronDown className="absolute right-2.5 top-2.5 h-4 w-4 text-muted-foreground pointer-events-none" />
            </div>
          </div>

          {/* Split mode */}
          <div className="space-y-1.5">
            <Label className="text-xs">Split</Label>
            <div className="grid grid-cols-4 gap-1 bg-muted/40 rounded-xl p-1">
              {SPLIT_MODES.map(m => (
                <button key={m.value} type="button" onClick={() => { setMode(m.value); setInputs({}); setError(""); }}
                  className={cn(
                    "py-1.5 rounded-lg text-xs font-medium transition-all pointer-events-auto",
                    mode === m.value ? "bg-background shadow-sm text-foreground" : "text-muted-foreground"
                  )}>
                  {m.label}
                </button>
              ))}
            </div>
          </div>

          {/* Per-member inputs */}
          <div className="space-y-2">
            {members.map(m => {
              const preview = previewSplits.find(s => s.member_id === m.id);
              return (
                <div key={m.id} className="flex items-center gap-2">
                  <div className="h-7 w-7 rounded-full bg-muted flex items-center justify-center text-[10px] font-bold text-muted-foreground shrink-0">
                    {m.name[0].toUpperCase()}
                  </div>
                  <span className="text-sm flex-1 truncate">{m.name}</span>
                  {mode === "equal" ? (
                    <span className="text-sm font-medium text-muted-foreground w-20 text-right">
                      ₹{preview?.amount.toFixed(2) ?? "—"}
                    </span>
                  ) : (
                    <div className="flex items-center gap-1">
                      {mode !== "equal" && (
                        <Input
                          type="number"
                          value={inputs[m.id] ?? ""}
                          onChange={e => setInput(m.id, e.target.value)}
                          placeholder={mode === "shares" ? "1" : mode === "percent" ? "%" : "₹"}
                          className="h-7 text-xs w-20 text-right pointer-events-auto"
                        />
                      )}
                      {preview && (
                        <span className="text-[10px] text-muted-foreground w-16 text-right">
                          = ₹{preview.amount.toFixed(2)}
                        </span>
                      )}
                    </div>
                  )}
                  {m.id === paidBy && (
                    <span className="text-[9px] bg-primary/10 text-primary px-1.5 py-0.5 rounded-full font-semibold shrink-0">paid</span>
                  )}
                </div>
              );
            })}
          </div>

          {/* Split validation */}
          {mode !== "equal" && total > 0 && (
            <div className={cn(
              "text-xs px-3 py-2 rounded-lg",
              splitValid ? "bg-emerald-50 text-emerald-700" : "bg-red-50 text-red-600"
            )}>
              {splitValid
                ? `✓ Splits add up to ₹${splitTotal.toFixed(2)}`
                : `Total ₹${splitTotal.toFixed(2)} of ₹${total} — difference of ₹${(total - splitTotal).toFixed(2)}`}
            </div>
          )}

          {error && <p className="text-destructive text-xs">{error}</p>}

          <div className="flex gap-2 pt-1">
            <Button variant="outline" onClick={onClose} className="flex-1 pointer-events-auto">Cancel</Button>
            <Button onClick={handleSave} disabled={saving || !splitValid}
              className="flex-1 bg-gradient-primary text-primary-foreground pointer-events-auto">
              {saving ? "Saving…" : initial ? "Update" : "Add Expense"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};
