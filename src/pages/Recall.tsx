import React, { useState, useCallback } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AppLayout } from "@/components/layout/AppLayout";
import { GlassCard } from "@/components/ui/glass-card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { format } from "date-fns";
import { saveExpenseCategory } from "@/integrations/indexeddb/services/onboardingService";
import { cn } from "@/lib/utils";
import { formatFullINR } from "@/lib/currency";
import {
  Archive, Plus, ArrowLeft, Trash2, Edit3, ChevronDown,
  Phone, FileText, Wrench, AlertTriangle, CheckCircle2,
  Clock, X, MoreVertical, CreditCard, Shield, IndianRupee,
} from "lucide-react";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import {
  getProducts, saveProduct, deleteProduct, logService, deleteServiceEntry,
  getWarrantyStatus, getDaysLeft, getServiceStatus, getEmiStatus,
  getInsuranceStatus, getCategoryEmoji, markEmiBudgetAdded,
  calcWarrantyExpiry, calcNextServiceDate,
  CATEGORIES, WARRANTY_OPTIONS, SERVICE_INTERVALS,
  RecallProduct,
} from "@/integrations/indexeddb/services/recallService";

const QKEY = (uid: string) => ['recall_products', uid];

// ─── Status badge ─────────────────────────────────────────────────────────────
const WarrantyBadge = ({ product }: { product: RecallProduct }) => {
  const status   = getWarrantyStatus(product);
  const daysLeft = getDaysLeft(product);
  if (status === 'none') return null;
  const cfg = {
    active:        { cls: 'bg-emerald-100 text-emerald-700', label: `Active · ${Math.floor((daysLeft ?? 0) / 30)}m left` },
    expiring_soon: { cls: 'bg-amber-100 text-amber-700',   label: `Expires in ${daysLeft} day${daysLeft === 1 ? '' : 's'}` },
    expired:       { cls: 'bg-red-100 text-red-700',       label: 'Warranty expired' },
  }[status];
  return (
    <span className={cn('text-[10px] font-semibold px-2 py-0.5 rounded-full', cfg.cls)}>
      {cfg.label}
    </span>
  );
};

const ServiceBadge = ({ product }: { product: RecallProduct }) => {
  const status = getServiceStatus(product);
  if (status === 'none' || status === 'ok') return null;
  const cfg = {
    due_soon: { cls: 'bg-amber-100 text-amber-700', label: 'Service due soon' },
    overdue:  { cls: 'bg-red-100 text-red-700',     label: 'Service overdue' },
  }[status];
  return (
    <span className={cn('text-[10px] font-semibold px-2 py-0.5 rounded-full', cfg.cls)}>
      {cfg.cls && cfg.label}
    </span>
  );
};

// ─── Product card ─────────────────────────────────────────────────────────────
const ProductCard = ({ product, onClick }: { product: RecallProduct; onClick: () => void }) => (
  <button type="button" onClick={onClick}
    className="w-full text-left bg-background/70 border border-border/50 hover:border-border rounded-xl p-4 transition-all pointer-events-auto">
    <div className="flex items-start gap-3">
      <div className="h-11 w-11 rounded-xl bg-primary/8 flex items-center justify-center text-2xl shrink-0">
        {getCategoryEmoji(product.category)}
      </div>
      <div className="flex-1 min-w-0">
        <p className="font-semibold text-sm text-foreground truncate">{product.name}</p>
        <p className="text-xs text-muted-foreground mt-0.5">
          {[product.brand, product.model_number].filter(Boolean).join(' · ') || 'No model info'}
        </p>
        <div className="flex flex-wrap gap-1.5 mt-2">
          <WarrantyBadge product={product} />
          <ServiceBadge  product={product} />
        </div>
      </div>
    </div>
  </button>
);

// ─── Add/Edit form ────────────────────────────────────────────────────────────
interface FormState {
  name: string; category: RecallProduct['category'];
  brand: string; model_number: string; serial_number: string;
  purchase_date: string; purchase_price: string; purchased_from: string;
  // Payment
  payment_mode: 'full' | 'emi' | 'loan' | 'bnpl';
  amount_paid_upfront: string;
  emi_enabled: boolean;
  emi_amount: string;
  emi_tenure_months: string;
  emi_start_date: string;
  emi_interest_rate: string;
  emi_bank_or_provider: string;
  emi_account_last4: string;
  down_payment: string;
  // Insurance
  insurance_provider: string;
  insurance_policy_number: string;
  insurance_renewal_date: string;
  insurance_premium: string;
  // Warranty
  warranty_months: string; extended_warranty: boolean;
  extended_warranty_provider: string; extended_warranty_months: string;
  warranty_note: string;
  extended_warranty_note: string;
  additional_warranties: Array<{ id: string; name: string; months: string; note: string }>;
  // Service
  service_interval_months: string;
  last_service_date: string;
  service_centre_name: string; service_centre_phone: string;
  service_notes: string;
  notes: string;
}

const EMPTY_FORM: FormState = {
  name: '', category: 'electronics', brand: '', model_number: '', serial_number: '',
  purchase_date: format(new Date(), 'yyyy-MM-dd'), purchase_price: '', purchased_from: '',
  payment_mode: 'full', amount_paid_upfront: '', emi_enabled: false,
  emi_amount: '', emi_tenure_months: '12',
  emi_start_date: format(new Date(), 'yyyy-MM-dd'),
  emi_interest_rate: '0', emi_bank_or_provider: '', emi_account_last4: '',
  down_payment: '',
  insurance_provider: '', insurance_policy_number: '',
  insurance_renewal_date: '', insurance_premium: '',
  warranty_months: '12', extended_warranty: false,
  extended_warranty_provider: '', extended_warranty_months: '12',
  warranty_note: '', extended_warranty_note: '', additional_warranties: [],
  service_interval_months: '6',
  last_service_date: '',
  service_centre_name: '', service_centre_phone: '',
  service_notes: '', notes: '',
};

const STEPS = ['Basics', 'Purchase', 'Payment', 'Warranty', 'Service', 'Notes'];

const ProductForm = ({
  initial, onSave, onCancel,
}: { initial?: RecallProduct; onSave: (f: FormState) => Promise<void>; onCancel: () => void }) => {
  const [step,   setStep]   = useState(0);
  const [form,   setForm]   = useState<FormState>(() => {
    if (!initial) return EMPTY_FORM;
    return {
      name:                       initial.name,
      category:                   initial.category,
      brand:                      initial.brand,
      model_number:               initial.model_number,
      serial_number:              initial.serial_number,
      purchase_date:              initial.purchase_date?.slice(0, 10) ?? '',
      purchase_price:             initial.purchase_price ? String(initial.purchase_price) : '',
      purchased_from:             initial.purchased_from,
      warranty_months:            String(initial.warranty_months),
      extended_warranty:          initial.extended_warranty,
      extended_warranty_provider: initial.extended_warranty_provider,
      extended_warranty_months:   initial.extended_warranty_expiry ? '12' : '12',
      warranty_note:              (initial as any).warranty_note ?? '',
      extended_warranty_note:     (initial as any).extended_warranty_note ?? '',
      additional_warranties:      ((initial as any).additional_warranties ?? []).map((w: any) => ({ ...w, months: String(w.months) })),
      service_interval_months:    String(initial.service_interval_months),
      last_service_date:          initial.last_service_date?.slice(0, 10) ?? '',
      service_centre_name:        initial.service_centre_name,
      service_centre_phone:       initial.service_centre_phone,
      service_notes:              (initial as any).service_notes ?? '',
      notes:                      initial.notes,
    };
  });
  const [saving, setSaving] = useState(false);
  const [error,  setError]  = useState('');

  const set = (k: keyof FormState, v: any) => setForm(p => ({ ...p, [k]: v }));

  const handleSave = async () => {
    if (!form.name.trim()) { setError('Product name is required.'); setStep(0); return; }
    setSaving(true);
    try {
      await onSave(form);
    } catch (e: any) {
      setError(e.message ?? 'Failed to save.');
    } finally {
      setSaving(false);
    }
  };

  const stepContent = [
    // Step 0 — Basics
    <div key="basics" className="space-y-3">
      <div className="space-y-1.5">
        <Label className="text-xs">Product Name *</Label>
        <Input value={form.name} onChange={e => set('name', e.target.value)}
          placeholder="e.g. Samsung 1.5T AC" className="h-9 text-sm pointer-events-auto" />
      </div>
      <div className="space-y-1.5">
        <Label className="text-xs">Category</Label>
        <div className="grid grid-cols-3 gap-2">
          {CATEGORIES.map(cat => (
            <button key={cat.value} type="button" onClick={() => set('category', cat.value)}
              className={cn('flex flex-col items-center gap-1 py-2 rounded-xl border text-xs font-medium transition-all pointer-events-auto',
                form.category === cat.value
                  ? 'border-primary bg-primary/8 text-primary'
                  : 'border-border/40 bg-muted/20 text-muted-foreground'
              )}>
              <span style={{ fontSize: 20 }}>{cat.emoji}</span>
              {cat.label}
            </button>
          ))}
        </div>
      </div>
      <div className="space-y-1.5">
        <Label className="text-xs">Brand</Label>
        <Input value={form.brand} onChange={e => set('brand', e.target.value)}
          placeholder="e.g. Samsung, Apple, Honda" className="h-9 text-sm pointer-events-auto" />
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div className="space-y-1.5">
          <Label className="text-xs">Model Number</Label>
          <Input value={form.model_number} onChange={e => set('model_number', e.target.value)}
            placeholder="e.g. RZ28T" className="h-9 text-sm pointer-events-auto" />
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs">Serial Number</Label>
          <Input value={form.serial_number} onChange={e => set('serial_number', e.target.value)}
            placeholder="Optional" className="h-9 text-sm pointer-events-auto" />
        </div>
      </div>
    </div>,

    // Step 1 — Purchase
    <div key="purchase" className="space-y-3">
      <div className="grid grid-cols-2 gap-2">
        <div className="space-y-1.5">
          <Label className="text-xs">Purchase Date</Label>
          <Input type="date" value={form.purchase_date} onChange={e => set('purchase_date', e.target.value)}
            className="h-9 text-sm pointer-events-auto" />
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs">Price (₹)</Label>
          <Input type="number" value={form.purchase_price} onChange={e => set('purchase_price', e.target.value)}
            placeholder="0" className="h-9 text-sm pointer-events-auto" />
        </div>
      </div>
      <div className="space-y-1.5">
        <Label className="text-xs">Purchased From</Label>
        <Input value={form.purchased_from} onChange={e => set('purchased_from', e.target.value)}
          placeholder="e.g. Amazon, Croma, Local shop" className="h-9 text-sm pointer-events-auto" />
      </div>
    </div>,

    // Step 2 — Payment & EMI
    <div key="payment" className="space-y-3">
      {/* Payment mode */}
      <div className="space-y-1.5">
        <Label className="text-xs">How did you pay?</Label>
        <div className="grid grid-cols-2 gap-2">
          {[
            { value: 'full',  label: '💳 Full Payment' },
            { value: 'emi',   label: '📅 EMI'          },
            { value: 'loan',  label: '🏦 Bank Loan'    },
            { value: 'bnpl',  label: '🛒 Buy Now Pay Later' },
          ].map(opt => (
            <button key={opt.value} type="button"
              onClick={() => { set('payment_mode', opt.value); set('emi_enabled', opt.value !== 'full'); }}
              className={cn('py-2.5 px-3 rounded-xl border text-xs font-medium transition-all pointer-events-auto text-left',
                form.payment_mode === opt.value
                  ? 'border-primary bg-primary/8 text-primary'
                  : 'border-border/40 bg-muted/20 text-muted-foreground'
              )}>
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      {form.payment_mode === 'full' ? (
        <div className="space-y-1.5">
          <Label className="text-xs">Amount Paid (₹)</Label>
          <Input type="number" value={form.amount_paid_upfront}
            onChange={e => set('amount_paid_upfront', e.target.value)}
            placeholder="Full amount paid" className="h-9 text-sm pointer-events-auto" />
        </div>
      ) : (
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1.5">
              <Label className="text-xs">Down Payment (₹)</Label>
              <Input type="number" value={form.down_payment}
                onChange={e => set('down_payment', e.target.value)}
                placeholder="0" className="h-9 text-sm pointer-events-auto" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">EMI Amount (₹/month)</Label>
              <Input type="number" value={form.emi_amount}
                onChange={e => set('emi_amount', e.target.value)}
                placeholder="0" className="h-9 text-sm pointer-events-auto" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1.5">
              <Label className="text-xs">Number of EMIs</Label>
              <div className="relative">
                <select value={form.emi_tenure_months}
                  onChange={e => set('emi_tenure_months', e.target.value)}
                  className="w-full h-9 rounded-lg border border-input bg-background px-3 text-sm appearance-none pr-8 pointer-events-auto">
                  {[3,6,9,12,18,24,36,48,60].map(m => (
                    <option key={m} value={m}>{m} months</option>
                  ))}
                </select>
                <ChevronDown className="absolute right-2.5 top-2.5 h-4 w-4 text-muted-foreground pointer-events-none" />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">First EMI Date</Label>
              <Input type="date" value={form.emi_start_date}
                onChange={e => set('emi_start_date', e.target.value)}
                className="h-9 text-sm pointer-events-auto" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1.5">
              <Label className="text-xs">Interest Rate (% p.a.)</Label>
              <Input type="number" value={form.emi_interest_rate}
                onChange={e => set('emi_interest_rate', e.target.value)}
                placeholder="0 for zero-cost" className="h-9 text-sm pointer-events-auto" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Card / Account (last 4)</Label>
              <Input type="text" value={form.emi_account_last4} maxLength={4}
                onChange={e => set('emi_account_last4', e.target.value)}
                placeholder="1234" className="h-9 text-sm pointer-events-auto" />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Bank / Provider</Label>
            <Input value={form.emi_bank_or_provider}
              onChange={e => set('emi_bank_or_provider', e.target.value)}
              placeholder="e.g. HDFC Credit Card, Bajaj Finserv"
              className="h-9 text-sm pointer-events-auto" />
          </div>

          {/* Live summary */}
          {form.emi_amount && form.emi_tenure_months && (
            <div className="bg-primary/5 border border-primary/15 rounded-xl p-3 space-y-1.5">
              <p className="text-xs font-semibold text-primary">Payment Summary</p>
              <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
                <span className="text-muted-foreground">Down payment</span>
                <span className="font-medium text-right">₹{(parseFloat(form.down_payment)||0).toLocaleString('en-IN')}</span>
                <span className="text-muted-foreground">EMI × {form.emi_tenure_months}</span>
                <span className="font-medium text-right">₹{((parseFloat(form.emi_amount)||0) * parseInt(form.emi_tenure_months)).toLocaleString('en-IN')}</span>
                <span className="text-muted-foreground font-semibold border-t pt-1">Total cost</span>
                <span className="font-semibold text-primary text-right border-t pt-1">
                  ₹{((parseFloat(form.down_payment)||0) + (parseFloat(form.emi_amount)||0) * parseInt(form.emi_tenure_months)).toLocaleString('en-IN')}
                </span>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Insurance — relevant for vehicles and appliances */}
      {(form.category === 'vehicle' || form.category === 'appliance' || form.category === 'electronics') && (
        <div className="space-y-2 border border-border/40 rounded-xl p-3 mt-2">
          <p className="text-xs font-semibold text-muted-foreground">Insurance <span className="font-normal">(optional)</span></p>
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1.5">
              <Label className="text-xs">Provider</Label>
              <Input value={form.insurance_provider}
                onChange={e => set('insurance_provider', e.target.value)}
                placeholder="e.g. HDFC ERGO" className="h-9 text-sm pointer-events-auto" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Policy Number</Label>
              <Input value={form.insurance_policy_number}
                onChange={e => set('insurance_policy_number', e.target.value)}
                placeholder="Optional" className="h-9 text-sm pointer-events-auto" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1.5">
              <Label className="text-xs">Renewal Date</Label>
              <Input type="date" value={form.insurance_renewal_date}
                onChange={e => set('insurance_renewal_date', e.target.value)}
                className="h-9 text-sm pointer-events-auto" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Annual Premium (₹)</Label>
              <Input type="number" value={form.insurance_premium}
                onChange={e => set('insurance_premium', e.target.value)}
                placeholder="0" className="h-9 text-sm pointer-events-auto" />
            </div>
          </div>
        </div>
      )}
    </div>,

    // Step 3 — Warranty
    <div key="warranty" className="space-y-3">

      {/* Main warranty */}
      <div className="space-y-2 border border-border/40 rounded-xl p-3">
        <p className="text-xs font-semibold text-foreground">Main Warranty</p>
        <div className="space-y-1.5">
          <Label className="text-xs">Warranty Period</Label>
          <div className="relative">
            <select value={form.warranty_months} onChange={e => set('warranty_months', e.target.value)}
              className="w-full h-9 rounded-lg border border-input bg-background px-3 text-sm appearance-none pr-8 pointer-events-auto">
              {WARRANTY_OPTIONS.map(o => (
                <option key={o.months} value={o.months}>{o.label}</option>
              ))}
            </select>
            <ChevronDown className="absolute right-2.5 top-2.5 h-4 w-4 text-muted-foreground pointer-events-none" />
          </div>
          {form.warranty_months === '-1' && (
            <Input type="number" placeholder="Enter months"
              onChange={e => set('warranty_months', e.target.value)}
              className="h-9 text-sm pointer-events-auto" />
          )}
        </div>

        {/* Auto-computed expiry */}
        {form.purchase_date && parseInt(form.warranty_months) > 0 && (() => {
          const expiry = calcWarrantyExpiry(new Date(form.purchase_date).toISOString(), parseInt(form.warranty_months));
          return expiry ? (
            <div className="flex items-center gap-2 bg-emerald-50/60 border border-emerald-200/40 rounded-lg px-3 py-2">
              <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500 shrink-0" />
              <p className="text-xs text-emerald-700">
                Warranty expires on <span className="font-semibold">{format(new Date(expiry), 'd MMM yyyy')}</span>
              </p>
            </div>
          ) : null;
        })()}

        <div className="space-y-1.5">
          <Label className="text-xs">Warranty Notes <span className="text-muted-foreground font-normal">(optional)</span></Label>
          <textarea value={form.warranty_note} onChange={e => set('warranty_note', e.target.value)}
            placeholder="e.g. Covers manufacturing defects only. Does not cover physical damage."
            rows={2}
            className="w-full rounded-lg border border-input bg-background px-3 py-2 text-xs pointer-events-auto resize-none focus:outline-none focus:ring-2 focus:ring-primary/30" />
        </div>
      </div>

      {/* Extended warranty */}
      <div className="space-y-2 border border-border/40 rounded-xl p-3">
        <div className="flex items-center justify-between">
          <p className="text-xs font-semibold text-foreground">Extended Warranty</p>
          <button type="button" onClick={() => set('extended_warranty', !form.extended_warranty)}
            className={cn('w-10 h-5 rounded-full transition-all pointer-events-auto relative',
              form.extended_warranty ? 'bg-primary' : 'bg-muted')}>
            <span className={cn('absolute top-0.5 w-4 h-4 rounded-full bg-white transition-all',
              form.extended_warranty ? 'left-5' : 'left-0.5')} />
          </button>
        </div>
        {form.extended_warranty && (
          <div className="space-y-2 pt-1">
            <Input value={form.extended_warranty_provider}
              onChange={e => set('extended_warranty_provider', e.target.value)}
              placeholder="Provider (e.g. AppleCare, Bajaj Finserv)"
              className="h-9 text-sm pointer-events-auto" />
            <div className="relative">
              <select value={form.extended_warranty_months}
                onChange={e => set('extended_warranty_months', e.target.value)}
                className="w-full h-9 rounded-lg border border-input bg-background px-3 text-sm appearance-none pr-8 pointer-events-auto">
                {[12,24,36,48,60].map(m => (
                  <option key={m} value={m}>{m/12 === 1 ? '1 year' : `${m/12} years`}</option>
                ))}
              </select>
              <ChevronDown className="absolute right-2.5 top-2.5 h-4 w-4 text-muted-foreground pointer-events-none" />
            </div>

            {/* Extended warranty auto-computed expiry */}
            {form.purchase_date && parseInt(form.extended_warranty_months) > 0 && (() => {
              const base = calcWarrantyExpiry(new Date(form.purchase_date).toISOString(), parseInt(form.warranty_months) || 0);
              const extExpiry = calcWarrantyExpiry(base ?? new Date(form.purchase_date).toISOString(), parseInt(form.extended_warranty_months));
              return extExpiry ? (
                <div className="flex items-center gap-2 bg-blue-50/60 border border-blue-200/40 rounded-lg px-3 py-2">
                  <CheckCircle2 className="h-3.5 w-3.5 text-blue-500 shrink-0" />
                  <p className="text-xs text-blue-700">
                    Extended warranty expires <span className="font-semibold">{format(new Date(extExpiry), 'd MMM yyyy')}</span>
                  </p>
                </div>
              ) : null;
            })()}

            <div className="space-y-1.5">
              <Label className="text-xs">Extended Warranty Notes <span className="text-muted-foreground font-normal">(optional)</span></Label>
              <textarea value={form.extended_warranty_note} onChange={e => set('extended_warranty_note', e.target.value)}
                placeholder="e.g. Covers all parts. Claim via AppleCare app."
                rows={2}
                className="w-full rounded-lg border border-input bg-background px-3 py-2 text-xs pointer-events-auto resize-none focus:outline-none focus:ring-2 focus:ring-primary/30" />
            </div>
          </div>
        )}
      </div>

      {/* Additional warranties — part-specific */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <p className="text-xs font-semibold text-muted-foreground">Part-specific Warranties</p>
          <button type="button"
            onClick={() => set('additional_warranties', [...form.additional_warranties, { id: crypto.randomUUID(), name: '', months: '12', note: '' }])}
            className="flex items-center gap-1 text-xs text-primary hover:underline pointer-events-auto">
            <Plus className="h-3 w-3" /> Add
          </button>
        </div>
        {form.additional_warranties.length === 0 && (
          <p className="text-xs text-muted-foreground/60">e.g. Compressor warranty, Panel warranty</p>
        )}
        {form.additional_warranties.map((w, idx) => (
          <div key={w.id} className="border border-border/40 rounded-xl p-3 space-y-2">
            <div className="flex items-center gap-2">
              <Input value={w.name} onChange={e => {
                const updated = [...form.additional_warranties];
                updated[idx] = { ...w, name: e.target.value };
                set('additional_warranties', updated);
              }} placeholder="Part name (e.g. Compressor)" className="h-8 text-xs flex-1 pointer-events-auto" />
              <div className="relative w-28">
                <select value={w.months} onChange={e => {
                  const updated = [...form.additional_warranties];
                  updated[idx] = { ...w, months: e.target.value };
                  set('additional_warranties', updated);
                }} className="w-full h-8 rounded-lg border border-input bg-background px-2 text-xs appearance-none pr-6 pointer-events-auto">
                  {[6,12,24,36,60,120].map(m => <option key={m} value={m}>{m >= 12 ? `${m/12}yr` : `${m}mo`}</option>)}
                </select>
                <ChevronDown className="absolute right-1.5 top-2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
              </div>
              <button type="button" onClick={() => set('additional_warranties', form.additional_warranties.filter((_, i) => i !== idx))}
                className="text-muted-foreground/40 hover:text-destructive pointer-events-auto">
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>

            {/* Auto-computed expiry for this part */}
            {form.purchase_date && parseInt(w.months) > 0 && (() => {
              const exp = calcWarrantyExpiry(new Date(form.purchase_date).toISOString(), parseInt(w.months));
              return exp ? <p className="text-[10px] text-muted-foreground">Expires: {format(new Date(exp), 'd MMM yyyy')}</p> : null;
            })()}

            <textarea value={w.note} onChange={e => {
              const updated = [...form.additional_warranties];
              updated[idx] = { ...w, note: e.target.value };
              set('additional_warranties', updated);
            }} placeholder="Notes for this part warranty (optional)"
              rows={1}
              className="w-full rounded-lg border border-input bg-background px-2 py-1.5 text-xs pointer-events-auto resize-none focus:outline-none focus:ring-1 focus:ring-primary/30" />
          </div>
        ))}
      </div>
    </div>,

    // Step 4 — Service
    <div key="service" className="space-y-3">

      {/* Service interval */}
      <div className="space-y-1.5">
        <Label className="text-xs">Service Frequency</Label>
        <div className="relative">
          <select value={form.service_interval_months} onChange={e => set('service_interval_months', e.target.value)}
            className="w-full h-9 rounded-lg border border-input bg-background px-3 text-sm appearance-none pr-8 pointer-events-auto">
            {SERVICE_INTERVALS.map(o => (
              <option key={o.months} value={o.months}>{o.label}</option>
            ))}
          </select>
          <ChevronDown className="absolute right-2.5 top-2.5 h-4 w-4 text-muted-foreground pointer-events-none" />
        </div>
      </div>

      {/* Last service date — only shown if tracking is enabled */}
      {parseInt(form.service_interval_months) > 0 && (
        <div className="space-y-1.5">
          <Label className="text-xs">Last Service Date <span className="text-muted-foreground font-normal">(optional)</span></Label>
          <Input type="date" value={form.last_service_date}
            onChange={e => set('last_service_date', e.target.value)}
            className="h-9 text-sm pointer-events-auto" />
        </div>
      )}

      {/* Auto-computed next service date */}
      {parseInt(form.service_interval_months) > 0 && form.last_service_date && (() => {
        const next = calcNextServiceDate(new Date(form.last_service_date).toISOString(), parseInt(form.service_interval_months));
        const isPast = new Date(next) < new Date();
        return (
          <div className={cn('flex items-center gap-2 rounded-lg px-3 py-2 border',
            isPast ? 'bg-amber-50/60 border-amber-200/40' : 'bg-emerald-50/60 border-emerald-200/40'
          )}>
            <Wrench className={cn('h-3.5 w-3.5 shrink-0', isPast ? 'text-amber-500' : 'text-emerald-500')} />
            <p className={cn('text-xs', isPast ? 'text-amber-700' : 'text-emerald-700')}>
              {isPast ? 'Service overdue — was due ' : 'Next service due '}
              <span className="font-semibold">{format(new Date(next), 'd MMM yyyy')}</span>
            </p>
          </div>
        );
      })()}

      {/* Service centre */}
      <div className="space-y-1.5">
        <Label className="text-xs">Service Centre Name</Label>
        <Input value={form.service_centre_name} onChange={e => set('service_centre_name', e.target.value)}
          placeholder="e.g. Samsung Care, Authorized dealer" className="h-9 text-sm pointer-events-auto" />
      </div>
      <div className="space-y-1.5">
        <Label className="text-xs">Service Centre Phone</Label>
        <Input type="tel" value={form.service_centre_phone} onChange={e => set('service_centre_phone', e.target.value)}
          placeholder="e.g. 1800-XXX-XXXX" className="h-9 text-sm pointer-events-auto" />
      </div>

      {/* Service notes */}
      <div className="space-y-1.5">
        <Label className="text-xs">Service Notes <span className="text-muted-foreground font-normal">(optional)</span></Label>
        <textarea value={form.service_notes} onChange={e => set('service_notes', e.target.value)}
          placeholder="e.g. Always ask them to clean filters. Use only genuine parts."
          rows={2}
          className="w-full rounded-lg border border-input bg-background px-3 py-2 text-xs pointer-events-auto resize-none focus:outline-none focus:ring-2 focus:ring-primary/30" />
      </div>
    </div>,

    // Step 4 — Notes
    <div key="notes" className="space-y-3">
      <div className="space-y-1.5">
        <Label className="text-xs">Notes</Label>
        <textarea value={form.notes} onChange={e => set('notes', e.target.value)}
          placeholder="Warranty terms, important specs, anything you want to remember…"
          rows={6}
          className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm pointer-events-auto resize-none focus:outline-none focus:ring-2 focus:ring-primary/30" />
      </div>
    </div>,
  ];

  return (
    <div className="space-y-4">
      {/* Step indicator */}
      <div className="flex items-center gap-1 overflow-x-auto scrollbar-none">
        {STEPS.map((s, i) => (
          <React.Fragment key={s}>
            <button type="button" onClick={() => setStep(i)}
              className={cn('text-xs font-medium transition-colors pointer-events-auto whitespace-nowrap shrink-0',
                i === step ? 'text-primary' : i < step ? 'text-muted-foreground' : 'text-muted-foreground/40'
              )}>
              {s}
            </button>
            {i < STEPS.length - 1 && <span className="text-muted-foreground/30 text-xs">›</span>}
          </React.Fragment>
        ))}
      </div>

      {/* Progress bar */}
      <div className="h-1 bg-muted rounded-full overflow-hidden">
        <div className="h-full bg-primary rounded-full transition-all"
          style={{ width: `${((step + 1) / STEPS.length) * 100}%` }} />
      </div>

      {stepContent[step]}

      {error && <p className="text-destructive text-xs">{error}</p>}

      <div className="flex gap-2 pt-2">
        {step > 0 ? (
          <Button variant="outline" onClick={() => setStep(s => s - 1)} className="flex-1 pointer-events-auto">
            Back
          </Button>
        ) : (
          <Button variant="outline" onClick={onCancel} className="flex-1 pointer-events-auto">
            Cancel
          </Button>
        )}
        {step < STEPS.length - 1 ? (
          <Button onClick={() => setStep(s => s + 1)}
            className="flex-1 bg-gradient-primary text-primary-foreground pointer-events-auto">
            Next
          </Button>
        ) : (
          <Button onClick={handleSave} disabled={saving}
            className="flex-1 bg-gradient-primary text-primary-foreground pointer-events-auto">
            {saving ? 'Saving…' : initial ? 'Update' : 'Save Product'}
          </Button>
        )}
      </div>
    </div>
  );
};

// ─── Log Service Dialog ───────────────────────────────────────────────────────
const LogServiceDialog = ({ onSave, onCancel }: {
  onSave: (d: { date: string; description: string; cost: number }) => Promise<void>;
  onCancel: () => void;
}) => {
  const [date,  setDate]  = useState(format(new Date(), 'yyyy-MM-dd'));
  const [desc,  setDesc]  = useState('');
  const [cost,  setCost]  = useState('');
  const [saving,setSaving]= useState(false);

  const handleSave = async () => {
    if (!desc.trim()) return;
    setSaving(true);
    try { await onSave({ date: new Date(date).toISOString(), description: desc.trim(), cost: parseFloat(cost) || 0 }); }
    finally { setSaving(false); }
  };

  return (
    <GlassCard className="p-4 space-y-3 border-primary/20">
      <p className="text-sm font-semibold text-foreground">Log Service</p>
      <div className="grid grid-cols-2 gap-2">
        <div className="space-y-1.5">
          <Label className="text-xs">Date</Label>
          <Input type="date" value={date} onChange={e => setDate(e.target.value)}
            className="h-9 text-sm pointer-events-auto" />
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs">Cost (₹)</Label>
          <Input type="number" value={cost} onChange={e => setCost(e.target.value)}
            placeholder="0" className="h-9 text-sm pointer-events-auto" />
        </div>
      </div>
      <div className="space-y-1.5">
        <Label className="text-xs">What was done</Label>
        <Input value={desc} onChange={e => setDesc(e.target.value)}
          placeholder="e.g. Annual service, gas refill, filter change"
          className="h-9 text-sm pointer-events-auto" />
      </div>
      <div className="flex gap-2">
        <Button variant="outline" onClick={onCancel} className="flex-1 pointer-events-auto">Cancel</Button>
        <Button onClick={handleSave} disabled={saving || !desc.trim()}
          className="flex-1 bg-gradient-primary text-primary-foreground pointer-events-auto">
          {saving ? 'Saving…' : 'Log Service'}
        </Button>
      </div>
    </GlassCard>
  );
};

// ─── Product Detail ───────────────────────────────────────────────────────────
const ProductDetail = ({ product, onBack, onUpdate, onDelete }: {
  product: RecallProduct;
  onBack: () => void;
  onUpdate: (p: RecallProduct) => void;
  onDelete: () => void;
}) => {
  const { toast }      = useToast();
  const [editing,      setEditing]      = useState(false);
  const [loggingService, setLoggingService] = useState(false);
  const { user }       = useAuth();
  const queryClient    = useQueryClient();

  const invalidate = () => user && queryClient.invalidateQueries({ queryKey: QKEY(user.id) });

  const handleSave = async (form: FormState) => {
    if (!user) return;
    const warrantyExpiry = calcWarrantyExpiry(
      new Date(form.purchase_date).toISOString(),
      parseInt(form.warranty_months) || 0,
    );
    const extWarrantyExpiry = form.extended_warranty
      ? calcWarrantyExpiry(new Date(form.purchase_date).toISOString(), parseInt(form.extended_warranty_months) || 12)
      : null;

    const updated = await saveProduct(user.id, {
      ...form,
      purchase_price:             parseFloat(form.purchase_price) || 0,
      warranty_months:            parseInt(form.warranty_months) || 0,
      warranty_expiry:            warrantyExpiry,
      extended_warranty_months:   undefined as any,
      extended_warranty_expiry:   extWarrantyExpiry,
      service_interval_months:    parseInt(form.service_interval_months) || 0,
      next_service_date:          form.last_service_date ? calcNextServiceDate(new Date(form.last_service_date).toISOString(), parseInt(form.service_interval_months) || 0) : product.next_service_date,
      last_service_date:          form.last_service_date ? new Date(form.last_service_date).toISOString() : product.last_service_date,
      service_history:            product.service_history,
      service_notes:              form.service_notes,
      warranty_note:              form.warranty_note,
      extended_warranty_note:     form.extended_warranty_note,
      additional_warranties:      form.additional_warranties.map(w => ({ ...w, months: parseInt(w.months) || 0, expiry: form.purchase_date ? calcWarrantyExpiry(new Date(form.purchase_date).toISOString(), parseInt(w.months) || 0) : null })),
      // Payment
      payment_mode:               form.payment_mode,
      amount_paid_upfront:        parseFloat(form.amount_paid_upfront) || 0,
      emi_enabled:                form.emi_enabled,
      emi_amount:                 parseFloat(form.emi_amount) || 0,
      emi_tenure_months:          parseInt(form.emi_tenure_months) || 0,
      emi_start_date:             form.emi_start_date ? new Date(form.emi_start_date).toISOString() : null,
      emi_interest_rate:          parseFloat(form.emi_interest_rate) || 0,
      emi_bank_or_provider:       form.emi_bank_or_provider,
      emi_account_last4:          form.emi_account_last4,
      down_payment:               parseFloat(form.down_payment) || 0,
      // Insurance
      insurance_provider:         form.insurance_provider,
      insurance_policy_number:    form.insurance_policy_number,
      insurance_renewal_date:     form.insurance_renewal_date ? new Date(form.insurance_renewal_date).toISOString() : null,
      insurance_premium:          parseFloat(form.insurance_premium) || 0,
    }, product.id);

    onUpdate(updated);
    invalidate();
    setEditing(false);
    toast({ title: 'Product updated.' });
  };

  const handleLogService = async (entry: { date: string; description: string; cost: number }) => {
    const updated = await logService(product.id, entry);
    if (updated) { onUpdate(updated); invalidate(); }
    setLoggingService(false);
    toast({ title: 'Service logged.' });
  };

  const handleDeleteService = async (serviceId: string) => {
    await deleteServiceEntry(product.id, serviceId);
    invalidate();
    toast({ title: 'Entry removed.' });
  };

  if (editing) return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <button onClick={() => setEditing(false)}
          className="h-9 w-9 rounded-xl bg-muted/40 flex items-center justify-center pointer-events-auto">
          <ArrowLeft className="h-4 w-4 text-muted-foreground" />
        </button>
        <p className="font-semibold text-foreground">Edit Product</p>
      </div>
      <ProductForm initial={product} onSave={handleSave} onCancel={() => setEditing(false)} />
    </div>
  );

  const warrantyStatus = getWarrantyStatus(product);
  const serviceStatus  = getServiceStatus(product);
  const daysLeft       = getDaysLeft(product);

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center gap-3">
        <button onClick={onBack}
          className="h-9 w-9 rounded-xl bg-muted/40 flex items-center justify-center pointer-events-auto">
          <ArrowLeft className="h-4 w-4 text-muted-foreground" />
        </button>
        <div className="h-11 w-11 rounded-xl bg-primary/8 flex items-center justify-center text-2xl shrink-0">
          {getCategoryEmoji(product.category)}
        </div>
        <div className="flex-1 min-w-0">
          <p className="font-bold text-foreground truncate">{product.name}</p>
          <p className="text-xs text-muted-foreground">{product.brand} {product.model_number}</p>
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button className="h-8 w-8 rounded-xl bg-muted/40 flex items-center justify-center pointer-events-auto">
              <MoreVertical className="h-4 w-4 text-muted-foreground" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="bg-white/95 backdrop-blur-md border border-white/20 shadow-xl z-50">
            <DropdownMenuItem onClick={() => setEditing(true)} className="gap-2 cursor-pointer">
              <Edit3 className="h-3.5 w-3.5" /> Edit
            </DropdownMenuItem>
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <DropdownMenuItem onSelect={e => e.preventDefault()}
                  className="gap-2 cursor-pointer text-destructive">
                  <Trash2 className="h-3.5 w-3.5" /> Delete
                </DropdownMenuItem>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Delete "{product.name}"?</AlertDialogTitle>
                  <AlertDialogDescription>All service history will be permanently deleted.</AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction onClick={onDelete} className="bg-destructive text-destructive-foreground">Delete</AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {/* Warranty status */}
      <GlassCard className={cn('p-4', {
        'bg-emerald-50/40 border-emerald-200/40': warrantyStatus === 'active',
        'bg-amber-50/40 border-amber-200/40':     warrantyStatus === 'expiring_soon',
        'bg-red-50/40 border-red-200/40':         warrantyStatus === 'expired',
      })}>
        <div className="flex items-center gap-2 mb-3">
          {warrantyStatus === 'active'        && <CheckCircle2 className="h-4 w-4 text-emerald-500" />}
          {warrantyStatus === 'expiring_soon' && <AlertTriangle className="h-4 w-4 text-amber-500" />}
          {warrantyStatus === 'expired'       && <X className="h-4 w-4 text-red-500" />}
          {warrantyStatus === 'none'          && <FileText className="h-4 w-4 text-muted-foreground" />}
          <p className="text-sm font-semibold text-foreground">
            {warrantyStatus === 'active'        && `Warranty active · ${daysLeft} days left`}
            {warrantyStatus === 'expiring_soon' && `Warranty expires in ${daysLeft} days!`}
            {warrantyStatus === 'expired'       && 'Warranty has expired'}
            {warrantyStatus === 'none'          && 'No warranty tracked'}
          </p>
        </div>
        <div className="grid grid-cols-2 gap-3 text-xs">
          {product.purchase_date && (
            <div>
              <p className="text-muted-foreground">Purchased</p>
              <p className="font-medium text-foreground mt-0.5">
                {format(new Date(product.purchase_date), 'd MMM yyyy')}
              </p>
            </div>
          )}
          {product.warranty_expiry && (
            <div>
              <p className="text-muted-foreground">Warranty ends</p>
              <p className={cn('font-medium mt-0.5', warrantyStatus === 'expired' ? 'text-red-600' : warrantyStatus === 'expiring_soon' ? 'text-amber-600' : 'text-foreground')}>
                {format(new Date(product.warranty_expiry), 'd MMM yyyy')}
              </p>
            </div>
          )}
          {product.purchase_price > 0 && (
            <div>
              <p className="text-muted-foreground">Purchase price</p>
              <p className="font-medium text-foreground mt-0.5">{formatFullINR(product.purchase_price)}</p>
            </div>
          )}
          {product.purchased_from && (
            <div>
              <p className="text-muted-foreground">Bought from</p>
              <p className="font-medium text-foreground mt-0.5">{product.purchased_from}</p>
            </div>
          )}
          {product.serial_number && (
            <div>
              <p className="text-muted-foreground">Serial number</p>
              <p className="font-medium text-foreground mt-0.5 font-mono text-[11px]">{product.serial_number}</p>
            </div>
          )}
          {product.extended_warranty && (
            <div>
              <p className="text-muted-foreground">Extended warranty</p>
              <p className="font-medium text-foreground mt-0.5">
                {product.extended_warranty_provider || 'Yes'}
                {product.extended_warranty_expiry && ` · ${format(new Date(product.extended_warranty_expiry), 'MMM yyyy')}`}
              </p>
            </div>
          )}
        </div>

        {/* Warranty notes */}
        {(product as any).warranty_note && (
          <div className="pt-2 border-t border-border/30">
            <p className="text-[10px] text-muted-foreground mb-1">Warranty notes</p>
            <p className="text-xs text-foreground whitespace-pre-wrap">{(product as any).warranty_note}</p>
          </div>
        )}
        {product.extended_warranty && (product as any).extended_warranty_note && (
          <div className="pt-2 border-t border-border/30">
            <p className="text-[10px] text-muted-foreground mb-1">Extended warranty notes</p>
            <p className="text-xs text-foreground whitespace-pre-wrap">{(product as any).extended_warranty_note}</p>
          </div>
        )}

        {/* Additional part warranties */}
        {((product as any).additional_warranties ?? []).length > 0 && (
          <div className="pt-2 border-t border-border/30 space-y-2">
            <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">Part Warranties</p>
            {((product as any).additional_warranties as any[]).map((w: any) => (
              <div key={w.id} className="flex items-start gap-2">
                <div className="h-1.5 w-1.5 rounded-full bg-primary mt-1.5 shrink-0" />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between">
                    <p className="text-xs font-medium text-foreground">{w.name}</p>
                    {w.expiry && (
                      <p className="text-[10px] text-muted-foreground">
                        Until {format(new Date(w.expiry), 'd MMM yyyy')}
                      </p>
                    )}
                  </div>
                  {w.note && <p className="text-[10px] text-muted-foreground mt-0.5">{w.note}</p>}
                </div>
              </div>
            ))}
          </div>
        )}
      </GlassCard>

      {/* Payment & EMI */}
      {(() => {
        const emi = getEmiStatus(product);
        const ins = getInsuranceStatus(product);
        if (!emi && !product.insurance_provider && product.payment_mode === 'full' && !product.amount_paid_upfront) return null;
        return (
          <GlassCard className="p-4 space-y-3">
            <div className="flex items-center gap-2">
              <CreditCard className="h-4 w-4 text-muted-foreground" />
              <p className="text-sm font-semibold text-foreground">Payment & EMI</p>
            </div>

            {/* Full payment */}
            {!emi && product.payment_mode === 'full' && (
              <div className="grid grid-cols-2 gap-3 text-xs">
                <div>
                  <p className="text-muted-foreground">Purchase price</p>
                  <p className="font-medium text-foreground mt-0.5">{formatFullINR(product.purchase_price)}</p>
                </div>
                {product.amount_paid_upfront > 0 && (
                  <div>
                    <p className="text-muted-foreground">Amount paid</p>
                    <p className="font-medium text-emerald-600 mt-0.5">{formatFullINR(product.amount_paid_upfront)}</p>
                  </div>
                )}
              </div>
            )}

            {/* EMI details */}
            {emi && (
              <div className="space-y-3">
                <div className="grid grid-cols-2 gap-3 text-xs">
                  <div>
                    <p className="text-muted-foreground">MRP / Price</p>
                    <p className="font-medium text-foreground mt-0.5">{formatFullINR(product.purchase_price)}</p>
                  </div>
                  <div>
                    <p className="text-muted-foreground">Total cost</p>
                    <p className="font-medium text-foreground mt-0.5">{formatFullINR(emi.total_cost)}</p>
                  </div>
                  {emi.down_payment > 0 && (
                    <div>
                      <p className="text-muted-foreground">Down payment</p>
                      <p className="font-medium text-foreground mt-0.5">{formatFullINR(emi.down_payment)}</p>
                    </div>
                  )}
                  <div>
                    <p className="text-muted-foreground">EMI amount</p>
                    <p className="font-medium text-foreground mt-0.5">{formatFullINR(emi.amount_per_emi)}/mo</p>
                  </div>
                  {emi.total_interest > 0 && (
                    <div>
                      <p className="text-muted-foreground">Total interest</p>
                      <p className="font-medium text-amber-600 mt-0.5">{formatFullINR(emi.total_interest)}</p>
                    </div>
                  )}
                  {emi.total_interest === 0 && (
                    <div>
                      <p className="text-muted-foreground">Interest</p>
                      <p className="font-medium text-emerald-600 mt-0.5">₹0 (0% EMI)</p>
                    </div>
                  )}
                </div>

                {/* Progress bar */}
                {!emi.is_fully_paid ? (
                  <div className="space-y-2">
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-muted-foreground">{emi.emis_paid} of {emi.total_emis} EMIs paid</span>
                      <span className="font-medium text-foreground">{Math.round((emi.emis_paid / emi.total_emis) * 100)}%</span>
                    </div>
                    <div className="h-2 bg-muted/40 rounded-full overflow-hidden">
                      <div className="h-full bg-primary rounded-full transition-all"
                        style={{ width: `${(emi.emis_paid / emi.total_emis) * 100}%` }} />
                    </div>
                    <div className="grid grid-cols-2 gap-3 text-xs pt-1">
                      <div>
                        <p className="text-muted-foreground">Paid so far</p>
                        <p className="font-medium text-emerald-600 mt-0.5">{formatFullINR(emi.amount_paid_so_far)}</p>
                      </div>
                      <div>
                        <p className="text-muted-foreground">Remaining</p>
                        <p className="font-medium text-foreground mt-0.5">{formatFullINR(emi.amount_remaining)} ({emi.emis_remaining} EMIs)</p>
                      </div>
                      {emi.next_emi_date && (
                        <div>
                          <p className="text-muted-foreground">Next EMI due</p>
                          <p className="font-medium text-primary mt-0.5">{format(new Date(emi.next_emi_date), 'd MMM yyyy')}</p>
                        </div>
                      )}
                      {emi.provider && (
                        <div>
                          <p className="text-muted-foreground">Via</p>
                          <p className="font-medium text-foreground mt-0.5">
                            {emi.provider}{emi.account_last4 ? ` ••••${emi.account_last4}` : ''}
                          </p>
                        </div>
                      )}
                    </div>
                  </div>
                ) : (
                  <div className="flex items-center gap-2 bg-emerald-50/60 border border-emerald-200/60 rounded-xl px-3 py-2.5">
                    <CheckCircle2 className="h-4 w-4 text-emerald-500 shrink-0" />
                    <div>
                      <p className="text-xs font-semibold text-emerald-700">Fully paid off!</p>
                      <p className="text-[10px] text-emerald-600">
                        Total paid: {formatFullINR(emi.total_cost)}
                        {emi.total_interest > 0 && ` (incl. ${formatFullINR(emi.total_interest)} interest)`}
                      </p>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Insurance */}
            {product.insurance_provider && (
              <div className={cn('border-t border-border/30 pt-3 space-y-2', emi ? '' : '')}>
                <div className="flex items-center gap-1.5">
                  <Shield className="h-3.5 w-3.5 text-muted-foreground" />
                  <p className="text-xs font-semibold text-muted-foreground">Insurance</p>
                  {ins !== 'none' && (
                    <span className={cn('text-[10px] font-semibold px-2 py-0.5 rounded-full ml-auto',
                      ins === 'active' ? 'bg-emerald-100 text-emerald-700' :
                      ins === 'expiring_soon' ? 'bg-amber-100 text-amber-700' :
                      'bg-red-100 text-red-700'
                    )}>
                      {ins === 'active' ? 'Active' : ins === 'expiring_soon' ? 'Renew soon' : 'Expired'}
                    </span>
                  )}
                </div>
                <div className="grid grid-cols-2 gap-3 text-xs">
                  <div>
                    <p className="text-muted-foreground">Provider</p>
                    <p className="font-medium text-foreground mt-0.5">{product.insurance_provider}</p>
                  </div>
                  {product.insurance_renewal_date && (
                    <div>
                      <p className="text-muted-foreground">Renewal</p>
                      <p className={cn('font-medium mt-0.5',
                        ins === 'expired' ? 'text-red-600' : ins === 'expiring_soon' ? 'text-amber-600' : 'text-foreground'
                      )}>{format(new Date(product.insurance_renewal_date), 'd MMM yyyy')}</p>
                    </div>
                  )}
                  {product.insurance_premium > 0 && (
                    <div>
                      <p className="text-muted-foreground">Annual premium</p>
                      <p className="font-medium text-foreground mt-0.5">{formatFullINR(product.insurance_premium)}</p>
                    </div>
                  )}
                  {product.insurance_policy_number && (
                    <div>
                      <p className="text-muted-foreground">Policy no.</p>
                      <p className="font-medium text-foreground mt-0.5 font-mono text-[11px]">{product.insurance_policy_number}</p>
                    </div>
                  )}
                </div>
              </div>
            )}
          </GlassCard>
        );
      })()}

      {/* Service */}
      {product.service_interval_months > 0 && (
        <GlassCard className={cn('p-4', {
          'bg-red-50/40 border-red-200/40':     serviceStatus === 'overdue',
          'bg-amber-50/40 border-amber-200/40': serviceStatus === 'due_soon',
        })}>
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <Wrench className="h-4 w-4 text-muted-foreground" />
              <p className="text-sm font-semibold text-foreground">Service</p>
            </div>
            <Button size="sm" onClick={() => setLoggingService(true)}
              className="h-7 text-xs bg-gradient-primary text-primary-foreground gap-1 pointer-events-auto">
              <Plus className="h-3 w-3" /> Log
            </Button>
          </div>

          <div className="grid grid-cols-2 gap-3 text-xs mb-3">
            {product.last_service_date && (
              <div>
                <p className="text-muted-foreground">Last service</p>
                <p className="font-medium text-foreground mt-0.5">
                  {format(new Date(product.last_service_date), 'd MMM yyyy')}
                </p>
              </div>
            )}
            {product.next_service_date && (
              <div>
                <p className="text-muted-foreground">Next due</p>
                <p className={cn('font-medium mt-0.5',
                  serviceStatus === 'overdue' ? 'text-red-600' : serviceStatus === 'due_soon' ? 'text-amber-600' : 'text-foreground'
                )}>
                  {format(new Date(product.next_service_date), 'd MMM yyyy')}
                </p>
              </div>
            )}
            {product.service_centre_name && (
              <div>
                <p className="text-muted-foreground">Service centre</p>
                <p className="font-medium text-foreground mt-0.5">{product.service_centre_name}</p>
              </div>
            )}
            {product.service_centre_phone && (
              <div>
                <p className="text-muted-foreground">Phone</p>
                <a href={`tel:${product.service_centre_phone}`}
                  className="font-medium text-primary mt-0.5 flex items-center gap-1 pointer-events-auto">
                  <Phone className="h-3 w-3" /> {product.service_centre_phone}
                </a>
              </div>
            )}
          </div>

          {/* Service notes */}
          {(product as any).service_notes && (
            <div className="bg-muted/20 rounded-lg px-3 py-2">
              <p className="text-[10px] text-muted-foreground mb-0.5">Service notes</p>
              <p className="text-xs text-foreground whitespace-pre-wrap">{(product as any).service_notes}</p>
            </div>
          )}

          {loggingService && (
            <LogServiceDialog
              onSave={handleLogService}
              onCancel={() => setLoggingService(false)}
            />
          )}

          {/* Service history */}
          {product.service_history.length > 0 && (
            <div className="space-y-2 pt-3 border-t border-border/30">
              <p className="text-xs font-semibold text-muted-foreground">Service history</p>
              {product.service_history.map(entry => (
                <div key={entry.id} className="flex items-start gap-2">
                  <div className="h-1.5 w-1.5 rounded-full bg-primary mt-1.5 shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-medium text-foreground">{entry.description}</p>
                    <p className="text-[10px] text-muted-foreground">
                      {format(new Date(entry.date), 'd MMM yyyy')}
                      {entry.cost > 0 && ` · ${formatFullINR(entry.cost)}`}
                    </p>
                  </div>
                  <button onClick={() => handleDeleteService(entry.id)}
                    className="text-muted-foreground/40 hover:text-destructive transition-colors pointer-events-auto">
                    <Trash2 className="h-3 w-3" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </GlassCard>
      )}

      {/* Notes */}
      {product.notes && (
        <GlassCard className="p-4">
          <p className="text-xs font-semibold text-muted-foreground mb-2">Notes</p>
          <p className="text-sm text-foreground whitespace-pre-wrap leading-relaxed">{product.notes}</p>
        </GlassCard>
      )}
    </div>
  );
};

// ─── Main Recall page ─────────────────────────────────────────────────────────
type View = 'list' | 'add' | 'detail';

const Recall = () => {
  const { user }     = useAuth();
  const { toast }    = useToast();
  const queryClient  = useQueryClient();

  const [view,    setView]    = useState<View>('list');
  const [selected, setSelected] = useState<RecallProduct | null>(null);
  const [emiPrompt, setEmiPrompt] = useState<{ product: RecallProduct } | null>(null);

  const { data: products = [], isLoading } = useQuery({
    queryKey: QKEY(user?.id ?? ''),
    queryFn:  () => user ? getProducts(user.id) : Promise.resolve([]),
    enabled:  !!user,
  });

  const invalidate = () => user && queryClient.invalidateQueries({ queryKey: QKEY(user.id) });

  const needsAttention = products.filter(p => {
    const ws = getWarrantyStatus(p);
    const ss = getServiceStatus(p);
    return ws === 'expiring_soon' || ws === 'expired' || ss === 'overdue' || ss === 'due_soon';
  });

  const handleSave = async (form: FormState) => {
    if (!user) return;
    const warrantyExpiry = calcWarrantyExpiry(
      new Date(form.purchase_date).toISOString(),
      parseInt(form.warranty_months) || 0,
    );
    const extWarrantyExpiry = form.extended_warranty
      ? calcWarrantyExpiry(new Date(form.purchase_date).toISOString(), parseInt(form.extended_warranty_months) || 12)
      : null;
    const intervalMonths = parseInt(form.service_interval_months) || 0;
    const nextServiceDate = intervalMonths > 0
      ? calcNextServiceDate(new Date(form.purchase_date).toISOString(), intervalMonths)
      : null;

    await saveProduct(user.id, {
      ...form,
      purchase_price:             parseFloat(form.purchase_price) || 0,
      warranty_months:            parseInt(form.warranty_months) || 0,
      warranty_expiry:            warrantyExpiry,
      extended_warranty_expiry:   extWarrantyExpiry,
      service_interval_months:    intervalMonths,
      next_service_date:          nextServiceDate,
      last_service_date:          null,
      service_history:            [],
      // Payment
      payment_mode:               form.payment_mode,
      amount_paid_upfront:        parseFloat(form.amount_paid_upfront) || 0,
      emi_enabled:                form.emi_enabled,
      emi_amount:                 parseFloat(form.emi_amount) || 0,
      emi_tenure_months:          parseInt(form.emi_tenure_months) || 0,
      emi_start_date:             form.emi_start_date ? new Date(form.emi_start_date).toISOString() : null,
      emi_interest_rate:          parseFloat(form.emi_interest_rate) || 0,
      emi_bank_or_provider:       form.emi_bank_or_provider,
      emi_account_last4:          form.emi_account_last4,
      down_payment:               parseFloat(form.down_payment) || 0,
      // Insurance
      insurance_provider:         form.insurance_provider,
      insurance_policy_number:    form.insurance_policy_number,
      insurance_renewal_date:     form.insurance_renewal_date ? new Date(form.insurance_renewal_date).toISOString() : null,
      insurance_premium:          parseFloat(form.insurance_premium) || 0,
    });

    invalidate();
    toast({ title: 'Product added to Recall!' });
    // Show EMI budget prompt if product has EMI and prompt hasn't been shown
    if (form.emi_enabled && parseFloat(form.emi_amount) > 0) {
      // Get the saved product to show in prompt
      const saved = await getProducts(user.id);
      const justSaved = saved[0]; // Most recent = just saved
      if (justSaved && !justSaved.emi_budget_added) {
        setEmiPrompt({ product: justSaved });
        return; // Don't go to list yet — wait for prompt response
      }
    }
    setView('list');
  };

  const handleEmiPromptYes = async () => {
    if (!emiPrompt || !user) return;
    const p = emiPrompt.product;
    try {
      await saveExpenseCategory(user.id, {
        category_name: `${p.name} EMI`,
        amount:         p.emi_amount,
        category_type: 'fixed',
        frequency:     'monthly',
        user_id:        user.id,
      });
      await markEmiBudgetAdded(p.id);
      invalidate();
      toast({ title: 'Added to budget!', description: `${p.name} EMI of ${formatFullINR(p.emi_amount)}/mo added to your fixed expenses.` });
    } catch (e: any) {
      toast({ title: 'Error', description: e.message, variant: 'destructive' });
    } finally {
      setEmiPrompt(null);
      setView('list');
    }
  };

  const handleEmiPromptNo = async () => {
    if (!emiPrompt) return;
    await markEmiBudgetAdded(emiPrompt.product.id);
    invalidate();
    setEmiPrompt(null);
    setView('list');
  };

  const handleDelete = async (id: string) => {
    await deleteProduct(id);
    invalidate();
    toast({ title: 'Product removed.' });
    setView('list');
    setSelected(null);
  };

  // ── List view ────────────────────────────────────────────────────────────────
  if (view === 'list') return (
    <AppLayout>
      <div className="space-y-5 mt-4 md:mt-0">

        {/* Header */}
        <div className="flex items-center justify-between gap-3">
          <h1 className="text-xl font-bold text-foreground tracking-tight">
            {(() => {
              const h = new Date().getHours();
              const name = user?.display_name?.trim().split(" ")[0] || "";
              if (h < 5)  return `Up late${name ? `, ${name}` : ""}? 🌙`;
              if (h < 12) return `Good morning${name ? `, ${name}` : ""} ☀️`;
              if (h < 17) return `Hey${name ? ` ${name}` : ""} 👋`;
              if (h < 21) return `Good evening${name ? `, ${name}` : ""} 🌆`;
              return `Night owl${name ? `, ${name}` : ""}? 🦉`;
            })()}
          </h1>
          <Button size="sm" onClick={() => setView('add')}
            className="h-9 bg-gradient-primary text-primary-foreground gap-1.5 pointer-events-auto shrink-0">
            <Plus className="h-3.5 w-3.5" /> Add
          </Button>
        </div>

        {/* Sub-line — always visible, quietly human */}
        <p className="text-sm text-muted-foreground -mt-1">
          You can't remember everything — that's what Recall is for.
        </p>

        {/* Summary */}
        {products.length > 0 && (
          <div className="grid grid-cols-2 gap-3">
            <GlassCard className="p-3">
              <p className="text-xs text-muted-foreground">Products tracked</p>
              <p className="text-2xl font-bold text-foreground mt-1">{products.length}</p>
            </GlassCard>
            <GlassCard className="p-3">
              <p className="text-xs text-muted-foreground">Needs attention</p>
              <p className={cn('text-2xl font-bold mt-1', needsAttention.length > 0 ? 'text-amber-600' : 'text-foreground')}>
                {needsAttention.length}
              </p>
            </GlassCard>
          </div>
        )}

        {/* Needs attention */}
        {needsAttention.length > 0 && (
          <div className="space-y-2">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
              <AlertTriangle className="h-3 w-3 text-amber-500" /> Needs attention
            </p>
            {needsAttention.map(p => (
              <ProductCard key={p.id} product={p} onClick={() => { setSelected(p); setView('detail'); }} />
            ))}
          </div>
        )}

        {/* All products */}
        {isLoading ? (
          <div className="flex items-center justify-center py-12">
            <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-primary" />
          </div>
        ) : products.length === 0 ? (
          <GlassCard className="p-8 text-center space-y-3">
            <div className="h-14 w-14 rounded-2xl bg-primary/8 flex items-center justify-center mx-auto text-3xl">📦</div>
            <p className="text-sm font-semibold text-foreground">Nothing tracked yet</p>
            <p className="text-xs text-muted-foreground max-w-xs mx-auto">
              Add your appliances, electronics, and vehicles. Recall remembers warranty dates, service schedules, and everything else so you don't have to.
            </p>
            <Button size="sm" onClick={() => setView('add')}
              className="bg-gradient-primary text-primary-foreground gap-1.5 pointer-events-auto">
              <Plus className="h-3.5 w-3.5" /> Add your first product
            </Button>
          </GlassCard>
        ) : (
          <div className="space-y-2">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
              All products ({products.length})
            </p>
            {products
              .filter(p => !needsAttention.find(n => n.id === p.id))
              .map(p => (
                <ProductCard key={p.id} product={p} onClick={() => { setSelected(p); setView('detail'); }} />
              ))}
          </div>
        )}
      </div>
    </AppLayout>
  );

  // ── Add view ─────────────────────────────────────────────────────────────────
  if (view === 'add') return (
    <AppLayout>
      <div className="space-y-4 mt-4 md:mt-0">
        <div className="flex items-center gap-3">
          <button onClick={() => setView('list')}
            className="h-9 w-9 rounded-xl bg-muted/40 flex items-center justify-center pointer-events-auto">
            <ArrowLeft className="h-4 w-4 text-muted-foreground" />
          </button>
          <p className="font-bold text-foreground">Add Product</p>
        </div>
        <ProductForm onSave={handleSave} onCancel={() => setView('list')} />
      </div>
    </AppLayout>
  );

  // ── Detail view ──────────────────────────────────────────────────────────────
  if (view === 'detail' && selected) return (
    <AppLayout>
      <div className="mt-4 md:mt-0">
        <ProductDetail
          product={selected}
          onBack={() => { setView('list'); setSelected(null); }}
          onUpdate={p => setSelected(p)}
          onDelete={() => handleDelete(selected.id)}
        />
      </div>
    </AppLayout>
  );

  // ── EMI Budget Prompt ────────────────────────────────────────────────────────
  if (emiPrompt) return (
    <AppLayout>
      <div className="min-h-[60vh] flex items-center justify-center p-4">
        <GlassCard className="p-6 max-w-sm w-full space-y-5 text-center">
          <div className="h-14 w-14 rounded-2xl bg-primary/10 flex items-center justify-center mx-auto text-3xl">
            {getCategoryEmoji(emiPrompt.product.category)}
          </div>

          <div>
            <p className="font-bold text-foreground text-base">{emiPrompt.product.name}</p>
            <p className="text-xs text-muted-foreground mt-1">
              {emiPrompt.product.emi_bank_or_provider || 'EMI'} · {emiPrompt.product.emi_tenure_months} months
            </p>
          </div>

          <div className="bg-primary/6 border border-primary/15 rounded-xl py-3 px-4">
            <p className="text-xs text-muted-foreground">Monthly EMI amount</p>
            <p className="text-2xl font-bold text-primary mt-1">{formatFullINR(emiPrompt.product.emi_amount)}</p>
            <p className="text-xs text-muted-foreground mt-0.5">per month</p>
          </div>

          <div className="space-y-1">
            <p className="text-sm font-semibold text-foreground">Add to monthly budget?</p>
            <p className="text-xs text-muted-foreground leading-relaxed">
              This will add <span className="font-medium text-foreground">{emiPrompt.product.name} EMI</span> as a fixed expense in your Budget so it's tracked every month automatically.
            </p>
          </div>

          <div className="flex gap-3">
            <Button variant="outline" onClick={handleEmiPromptNo}
              className="flex-1 pointer-events-auto">
              Skip
            </Button>
            <Button onClick={handleEmiPromptYes}
              className="flex-1 bg-gradient-primary text-primary-foreground pointer-events-auto">
              Yes, add it
            </Button>
          </div>
        </GlassCard>
      </div>
    </AppLayout>
  );

  return null;
};

export default Recall;
