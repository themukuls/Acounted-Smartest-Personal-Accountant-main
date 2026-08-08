"use client";

import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import {
  Search, Plus, X, Check, TrendingUp, TrendingDown,
  Wallet, CreditCard, Smartphone, Building2, StickyNote, Sparkles
} from "lucide-react";
import { Calendar } from "@/components/ui/calendar";
import { format } from "date-fns";
import { getISTDate } from "@/lib/date-utils";
import { useAuth } from '@/contexts/AuthContext';
import {
  getExpenseCategories,
  saveExpenseCategory,
  deleteExpenseCategory
} from '@/integrations/indexeddb/services/onboardingService';
import { classifyEntry, BUCKET_BY_ID } from '@/lib/tax';
import {
  DEFAULT_CATEGORIES,
  PAYMENT_METHODS as SHARED_PAYMENT_METHODS,
} from '@/lib/categories';
import {
  getLearnedMappings,
  rememberMapping,
} from '@/integrations/indexeddb/services/learnedTaxMappingsService';
import { useGate } from '@/components/paywall/useGate';

// ─── Types ─────────────────────────────────────────────────────────────────

interface TransactionFormDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (data: {
    account: string; category: string; amount: string;
    note: string; type: 'income' | 'expense';
    transactionId?: string; transaction_date: string;
  }) => Promise<void>;
  initialData?: {
    id?: string; type: 'income' | 'expense'; account: string;
    category: string; amount: string; description: string;
    transaction_date: string;
  };
  weekLabel: string;
  formType?: 'income' | 'expense' | undefined;
}

interface CategoryItem {
  id?: string;
  category_name: string;
  emoji: string;
  label: string;
  isCustom: boolean;
}

// Suggested emojis for new category creation
const EMOJI_SUGGESTIONS = [
  "🏋️","💪","🤸","🧘","⚽","🏊","🚴","🥊","🐕","🐈","🌿","☕",
  "🎮","🎵","🛒","🎁","📸","🧴","🍕","🧁","🚀","🌙","🏖️","🎯",
  "💆","🧹","🪴","🛁","🎪","🍦","🏡","🛞","🩺","🪙","🔋","📦",
];

// Payment methods — values/labels come from the shared list; icons are UI-only.
const PAYMENT_METHOD_ICONS: Record<string, typeof Wallet> = {
  "upi":           Smartphone,
  "cash":          Wallet,
  "bank-transfer": Building2,
  "credit-card":   CreditCard,
  "debit-card":    CreditCard,
};

const PAYMENT_METHODS = SHARED_PAYMENT_METHODS.map(({ value, label }) => ({
  value,
  label,
  Icon: PAYMENT_METHOD_ICONS[value] ?? Wallet,
}));

// ─── Inline category picker ────────────────────────────────────────────────

interface CategoryPickerProps {
  selected: string;
  onSelect: (name: string) => void;
  userId: string;
  onCategoriesChanged: () => void;
  allCategories: CategoryItem[];
  isExpense: boolean;
}

const CategoryPicker = ({
  selected, onSelect, userId, onCategoriesChanged, allCategories, isExpense
}: CategoryPickerProps) => {
  const { toast } = useToast();
  const [mode, setMode]           = useState<'chips' | 'search' | 'create'>('chips');
  const [query, setQuery]         = useState('');
  const [newEmoji, setNewEmoji]   = useState('🏷️');
  const [saving, setSaving]       = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);
  const longPressTimer            = useRef<ReturnType<typeof setTimeout> | null>(null);
  const searchRef                 = useRef<HTMLInputElement>(null);
  const chipRowRef                = useRef<HTMLDivElement>(null);
  const accentRed                 = isExpense;

  // Focus search input when entering search mode
  useEffect(() => {
    if (mode === 'search' || mode === 'create') {
      setTimeout(() => searchRef.current?.focus(), 80);
    }
  }, [mode]);

  // Filter logic
  const filtered = allCategories.filter(c =>
    c.label.toLowerCase().includes(query.toLowerCase()) ||
    c.category_name.toLowerCase().includes(query.toLowerCase())
  );
  const noMatch  = query.trim().length > 0 && filtered.length === 0;
  const showCreate = query.trim().length > 1 && !allCategories.some(
    c => c.category_name === query.trim().toLowerCase().replace(/\s+/g, '-')
  );

  const handleEnterSearch = () => {
    setQuery('');
    setMode('search');
  };

  const handleSelect = (name: string) => {
    onSelect(name);
    setMode('chips');
    setQuery('');
    setDeleteTarget(null);
  };

  const handleCreateCategory = async () => {
    if (!query.trim()) return;
    setSaving(true);
    const name = query.trim().toLowerCase().replace(/\s+/g, '-');
    try {
      await saveExpenseCategory(userId, {
        category_name: name,
        category_type: 'variable',
        amount: 0,
        frequency: 'monthly',
      });
      onCategoriesChanged();
      onSelect(name);
      setMode('chips');
      setQuery('');
      toast({ title: `${newEmoji} ${query.trim()} added`, description: "Category created and selected." });
    } catch {
      toast({ title: "Couldn't create category", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  // Long-press on custom chip to reveal delete
  const handleLongPressStart = (name: string) => {
    longPressTimer.current = setTimeout(() => setDeleteTarget(name), 600);
  };
  const handleLongPressEnd = () => {
    if (longPressTimer.current) clearTimeout(longPressTimer.current);
  };

  const handleDeleteCategory = async (cat: CategoryItem) => {
    if (!cat.id) { setDeleteTarget(null); return; }
    try {
      await deleteExpenseCategory(cat.id);
      if (selected === cat.category_name) onSelect('');
      onCategoriesChanged();
      setDeleteTarget(null);
      toast({ title: "Category removed" });
    } catch {
      toast({ title: "Couldn't delete", variant: "destructive" });
    }
  };

  const accentChip  = accentRed ? "bg-destructive/10 border-destructive/40 text-destructive" : "bg-primary/10 border-primary/40 text-primary";
  const accentFill  = accentRed ? "bg-destructive text-white" : "bg-primary text-white";
  const accentLight = accentRed ? "bg-destructive/8 border-destructive/20 text-destructive" : "bg-primary/8 border-primary/20 text-primary";
  const accentText  = accentRed ? "text-destructive" : "text-primary";

  // ── Chips mode ──────────────────────────────────────────────────────────
  if (mode === 'chips') {
    return (
      <div>
        <div className="flex items-center justify-between mb-2">
          <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Category</p>
          <button
            type="button"
            onClick={handleEnterSearch}
            className={cn("flex items-center gap-1 text-[10px] font-semibold pointer-events-auto transition-colors", accentText)}
          >
            <Search className="h-3 w-3" /> Search or create
          </button>
        </div>

        {/* Scrollable chip row */}
        <div className="relative w-full">
          <div
            ref={chipRowRef}
            className="flex gap-2 overflow-x-auto pb-1 w-full"
            style={{ scrollbarWidth: 'none', msOverflowStyle: 'none', WebkitOverflowScrolling: 'touch' }}
          >
          {/* Selected category — always first, only if something is selected */}
          {(() => {
            if (!selected) return null;
            const selectedCat = allCategories.find(c => c.category_name === selected);
            if (!selectedCat) return null;
            return (
              <button
                key={`selected-${selectedCat.category_name}`}
                type="button"
                onClick={() => handleSelect(selectedCat.category_name)}
                className={cn(
                  "flex items-center gap-1.5 px-3 py-1.5 rounded-full border text-xs font-medium whitespace-nowrap transition-all pointer-events-auto shrink-0",
                  accentChip
                )}
              >
                <span>{selectedCat.emoji}</span>
                <span>{selectedCat.label}</span>
              </button>
            );
          })()}

          {/* Default categories — skip the selected one (already shown above) */}
          {allCategories.filter(c => !c.isCustom && c.category_name !== selected).map(cat => (
            <button
              key={cat.category_name}
              type="button"
              onClick={() => handleSelect(cat.category_name)}
              className={cn(
                "flex items-center gap-1.5 px-3 py-1.5 rounded-full border text-xs font-medium whitespace-nowrap transition-all pointer-events-auto shrink-0",
                "bg-background/60 border-border/50 text-foreground hover:border-primary/30"
              )}
            >
              <span>{cat.emoji}</span>
              <span>{cat.label}</span>
            </button>
          ))}

          {/* Custom categories — always at end, in blue, skip selected (shown above) */}
          {allCategories.filter(c => c.isCustom && c.category_name !== selected).map(cat => (
            <div key={cat.category_name} className="relative shrink-0">
              {deleteTarget === cat.category_name ? (
                <div className="flex items-center gap-1.5 px-2 py-1.5 rounded-full border border-destructive/40 bg-destructive/8 whitespace-nowrap">
                  <span className="text-xs text-destructive font-medium">Remove?</span>
                  <button
                    type="button"
                    onClick={() => handleDeleteCategory(cat)}
                    className="pointer-events-auto"
                  >
                    <Check className="h-3.5 w-3.5 text-destructive" />
                  </button>
                  <button
                    type="button"
                    onClick={() => setDeleteTarget(null)}
                    className="pointer-events-auto"
                  >
                    <X className="h-3.5 w-3.5 text-muted-foreground" />
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => handleSelect(cat.category_name)}
                  onMouseDown={() => handleLongPressStart(cat.category_name)}
                  onMouseUp={handleLongPressEnd}
                  onMouseLeave={handleLongPressEnd}
                  onTouchStart={() => handleLongPressStart(cat.category_name)}
                  onTouchEnd={handleLongPressEnd}
                  className={cn(
                    "flex items-center gap-1.5 px-3 py-1.5 rounded-full border text-xs font-medium whitespace-nowrap transition-all pointer-events-auto",
                    selected === cat.category_name
                      ? "bg-primary/15 border-primary/50 text-primary"
                      : "bg-primary/5 border-primary/20 text-primary hover:bg-primary/10"
                  )}
                >
                  <span>{cat.emoji}</span>
                  <span>{cat.label}</span>
                </button>
              )}
            </div>
          ))}

          {/* + Add chip */}
          <button
            type="button"
            onClick={handleEnterSearch}
            className="flex items-center gap-1 px-3 py-1.5 rounded-full border border-dashed border-border/60 text-xs font-medium text-muted-foreground hover:border-primary/40 hover:text-primary transition-all pointer-events-auto shrink-0"
          >
            <Plus className="h-3 w-3" /> Add
          </button>
        </div>
        {/* Right-edge fade — hints at scrollability */}
        <div className="absolute right-0 top-0 bottom-1 w-8 bg-gradient-to-l from-background to-transparent pointer-events-none" />
        </div>
        <p className="text-[10px] text-muted-foreground/50 mt-1.5">
          Hold a custom category to remove it
        </p>
      </div>
    );
  }

  // ── Search / Create mode ────────────────────────────────────────────────
  return (
    <div className="space-y-2.5">
      <div className="flex items-center justify-between mb-1">
        <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Category</p>
        <button
          type="button"
          onClick={() => { setMode('chips'); setQuery(''); }}
          className="text-[10px] text-muted-foreground hover:text-foreground flex items-center gap-1 pointer-events-auto"
        >
          <X className="h-3 w-3" /> Cancel
        </button>
      </div>

      {/* Search input */}
      <div className={cn(
        "flex items-center gap-2 border rounded-xl px-3 py-2 transition-colors",
        accentLight
      )}>
        <Search className={cn("h-3.5 w-3.5 shrink-0", accentText)} />
        <input
          ref={searchRef}
          type="text"
          placeholder="Search or type a new name…"
          value={query}
          onChange={e => setQuery(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Enter' && showCreate) handleCreateCategory();
            if (e.key === 'Escape') { setMode('chips'); setQuery(''); }
          }}
          className="flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground/50 pointer-events-auto text-foreground"
        />
        {query && (
          <button type="button" onClick={() => setQuery('')} className="pointer-events-auto">
            <X className="h-3.5 w-3.5 text-muted-foreground" />
          </button>
        )}
      </div>

      {/* Filtered chip row — selected first, then rest */}
      {filtered.length > 0 && (
        <div
          className="flex gap-2 overflow-x-auto pb-1 w-full"
          style={{ scrollbarWidth: 'none', WebkitOverflowScrolling: 'touch' }}
        >
          {/* Selected chip first if it's in filtered results */}
          {filtered.filter(cat => cat.category_name === selected).map(cat => (
            <button
              key={`sel-${cat.category_name}`}
              type="button"
              onClick={() => handleSelect(cat.category_name)}
              className={cn(
                "flex items-center gap-1.5 px-3 py-1.5 rounded-full border text-xs font-medium whitespace-nowrap transition-all pointer-events-auto shrink-0",
                accentChip
              )}
            >
              <span>{cat.emoji}</span>
              <span>{cat.label}</span>
            </button>
          ))}
          {/* Rest of filtered results */}
          {filtered.filter(cat => cat.category_name !== selected).map(cat => (
            <button
              key={cat.category_name}
              type="button"
              onClick={() => handleSelect(cat.category_name)}
              className={cn(
                "flex items-center gap-1.5 px-3 py-1.5 rounded-full border text-xs font-medium whitespace-nowrap transition-all pointer-events-auto shrink-0",
                cat.isCustom
                  ? "bg-primary/5 border-primary/20 text-primary hover:bg-primary/10"
                  : "bg-background/60 border-border/50 text-foreground hover:border-primary/30"
              )}
            >
              <span>{cat.emoji}</span>
              <span>{cat.label}</span>
            </button>
          ))}
        </div>
      )}

      {/* No results */}
      {noMatch && !showCreate && (
        <p className="text-xs text-muted-foreground text-center py-2">No match found.</p>
      )}

      {/* Inline create prompt */}
      {showCreate && (
        <div className="space-y-2.5 animate-[fadeIn_0.2s_ease]">
          {/* Emoji picker */}
          <div>
            <p className="text-[10px] text-muted-foreground mb-2">Pick an emoji for your category</p>
            <div
              className="flex gap-2 overflow-x-auto pb-1 w-full"
              style={{ scrollbarWidth: 'none', WebkitOverflowScrolling: 'touch' }}
            >
              {EMOJI_SUGGESTIONS.map(e => (
                <button
                  key={e}
                  type="button"
                  onClick={() => setNewEmoji(e)}
                  className={cn(
                    "w-9 h-9 flex items-center justify-center rounded-xl border text-lg shrink-0 transition-all pointer-events-auto",
                    newEmoji === e
                      ? accentChip + " scale-110"
                      : "border-border/40 bg-background/60 hover:border-primary/30"
                  )}
                >
                  {e}
                </button>
              ))}
            </div>
          </div>

          {/* Create confirm button */}
          <button
            type="button"
            onClick={handleCreateCategory}
            disabled={saving}
            className={cn(
              "w-full flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-semibold transition-all pointer-events-auto",
              accentFill,
              "disabled:opacity-50"
            )}
          >
            {saving ? (
              <div className="h-4 w-4 rounded-full border-2 border-white border-t-transparent animate-spin" />
            ) : (
              <>
                <span className="text-base">{newEmoji}</span>
                Create "{query.trim()}"
              </>
            )}
          </button>
        </div>
      )}
    </div>
  );
};

// ─── Main dialog ───────────────────────────────────────────────────────────

export const TransactionFormDialog = ({
  isOpen, onClose, onSave, initialData, weekLabel, formType: propFormType
}: TransactionFormDialogProps) => {
  const { toast } = useToast();
  const { user }  = useAuth();
  // The dialog can be opened by more than one caller, and a disabled Save
  // button is only a suggestion — so the gate lives in handleSave() below.
  const { guard }  = useGate();

  const [formData, setFormData]   = useState({ account: '', category: '', amount: '', note: '' });
  const [currentFormType, setCurrentFormType] = useState<'income' | 'expense' | undefined>(undefined);
  const [isSaving, setIsSaving]   = useState(false);
  const [selectedDateTime, setSelectedDateTime] = useState<Date>(getISTDate());
  const [quickDate, setQuickDate] = useState<'today' | 'yesterday' | 'other'>('today');
  const [showCalendar, setShowCalendar] = useState(false);
  const [showNote, setShowNote]   = useState(false);
  const [allCategories, setAllCategories] = useState<CategoryItem[]>([]);
  const [learned, setLearned]     = useState<Record<string, string>>({});
  const [confirmedBucket, setConfirmedBucket] = useState<string | null>(null);

  // ── Fetch & merge categories ──────────────────────────────────────────
  const fetchCategories = useCallback(async () => {
    if (!user) return;
    try {
      const dbCats = await getExpenseCategories(user.id);
      const map = new Map<string, CategoryItem>();

      // DB categories first
      dbCats.forEach(cat => {
        const def = DEFAULT_CATEGORIES.find(d => d.category_name === cat.category_name);
        map.set(cat.category_name, {
          id:            cat.id,
          category_name: cat.category_name,
          emoji:         def?.emoji ?? '🏷️',
          label:         def?.label ?? cat.category_name.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase()),
          isCustom:      !def,
        });
      });

      // Default categories not in DB
      DEFAULT_CATEGORIES.forEach(def => {
        if (!map.has(def.category_name)) {
          map.set(def.category_name, { ...def, isCustom: false });
        }
      });

      // Split: defaults first (alphabetical), then custom at end (alphabetical)
      const defaults = Array.from(map.values())
        .filter(c => !c.isCustom)
        .sort((a, b) => a.label.localeCompare(b.label));
      const custom = Array.from(map.values())
        .filter(c => c.isCustom)
        .sort((a, b) => a.label.localeCompare(b.label));

      setAllCategories([...defaults, ...custom]);
    } catch (e) {
      console.error('Failed to fetch categories', e);
    }
  }, [user]);

  // ── Init on open ──────────────────────────────────────────────────────
  useEffect(() => {
    if (!isOpen) return;
    if (initialData) {
      setFormData({ account: initialData.account, category: initialData.category, amount: initialData.amount, note: initialData.description || '' });
      setCurrentFormType(initialData.type);
      setSelectedDateTime(new Date(initialData.transaction_date));
      setQuickDate('other');
    } else {
      setFormData({ account: '', category: '', amount: '', note: '' });
      setCurrentFormType(propFormType ?? 'expense');
      setSelectedDateTime(getISTDate());
      setQuickDate('today');
    }
    setShowNote(false);
    setShowCalendar(false);
    setConfirmedBucket(null);
    fetchCategories();
    if (user) getLearnedMappings(user.id).then(setLearned).catch(() => {});
  }, [isOpen, initialData, propFormType, fetchCategories, user]);

  // ── Tax insight (derived, offline classifier — never blocks saving) ─────
  const categoryLabel = allCategories.find(c => c.category_name === formData.category)?.label;
  const taxInsight = useMemo(() => {
    if (!formData.amount) return null;
    const text = [formData.note, categoryLabel].filter(Boolean).join(' ').trim();
    if (!text) return null;
    return classifyEntry(formData.note || '', { hintCategory: categoryLabel, learned });
  }, [formData.amount, formData.note, categoryLabel, learned]);

  // The bucket we'll act on: an explicit user pick, else a confident auto-match.
  const effectiveBucketId =
    confirmedBucket ??
    (taxInsight && !taxInsight.needsConfirmation ? taxInsight.bucketId : null);
  const effectiveBucket = effectiveBucketId ? BUCKET_BY_ID[effectiveBucketId] : null;

  // ── Save ──────────────────────────────────────────────────────────────
  const handleSave = async () => {
    // First statement in the handler, before validation and before onSave().
    // Returning here — rather than relying on the button being hidden — is what
    // makes this an actual gate.
    if (!guard('canWrite')) return;

    if (!currentFormType) {
      toast({ title: "Pick a type", description: "Select Expense or Income first.", variant: "destructive" });
      return;
    }
    if (!formData.account || !formData.amount || (currentFormType === 'expense' && !formData.category)) {
      toast({ title: "Fill all fields", description: "Amount, category and payment method are required.", variant: "destructive" });
      return;
    }
    setIsSaving(true);
    try {
      await onSave({ ...formData, type: currentFormType, transactionId: initialData?.id, transaction_date: selectedDateTime.toISOString() });
      // Remember the tax classification so we don't have to ask again.
      if (user && effectiveBucketId) {
        const learnText = formData.note?.trim() || categoryLabel || '';
        if (learnText) rememberMapping(user.id, learnText, effectiveBucketId);
      }
    } catch {
      toast({ title: "Save failed", variant: "destructive" });
    } finally {
      setIsSaving(false);
    }
  };

  const isExpense   = currentFormType === 'expense';
  const accentBg    = isExpense ? 'bg-destructive/8' : 'bg-primary/5';
  const accentBorder = isExpense ? 'border-destructive/20' : 'border-primary/20';
  const accentText  = isExpense ? 'text-destructive' : 'text-primary';
  const accentFill  = isExpense ? 'bg-destructive' : 'bg-primary';
  const accentLight = isExpense ? 'bg-destructive/8 border-destructive/20' : 'bg-primary/8 border-primary/20';

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-md w-[calc(100%-2rem)] max-h-[92vh] overflow-y-auto overflow-x-hidden [grid-template-columns:minmax(0,1fr)] bg-background border border-border/60 shadow-2xl pointer-events-auto p-0">

        {/* Accent bar — red for expense, blue for income */}
        <div className={cn("h-1.5 w-full rounded-t-lg", currentFormType ? accentFill : "bg-muted")} />

        <div className="p-4 space-y-4 min-w-0 w-full">

          {/* ── Header ── */}
          <DialogHeader className="pb-0">
            <div className="flex items-center gap-2">
              <div className={cn("h-8 w-8 rounded-xl flex items-center justify-center shrink-0", accentLight)}>
                {isExpense
                  ? <TrendingDown className={cn("h-4 w-4", accentText)} />
                  : <TrendingUp   className={cn("h-4 w-4", accentText)} />
                }
              </div>
              <DialogTitle className="text-base font-bold text-foreground">
                {initialData ? "Edit Transaction" : "Add Transaction"}
              </DialogTitle>
            </div>
          </DialogHeader>

          {/* ── Type toggle ── */}
          {!initialData && (
            <div className="w-full flex items-center bg-muted/60 rounded-xl p-1 gap-1">
              {([{ type: 'expense', label: 'Expense', Icon: TrendingDown }, { type: 'income', label: 'Income', Icon: TrendingUp }] as const).map(({ type, label, Icon }) => (
                <button
                  key={type}
                  type="button"
                  onClick={() => setCurrentFormType(type)}
                  className={cn(
                    "flex-1 min-w-0 flex items-center justify-center gap-1.5 py-1.5 rounded-lg text-xs font-bold transition-all pointer-events-auto",
                    currentFormType === type
                      ? type === 'expense' ? "bg-destructive text-white shadow-sm" : "bg-primary text-white shadow-sm"
                      : "text-muted-foreground hover:text-foreground"
                  )}
                >
                  <Icon className="h-3.5 w-3.5" />
                  {label}
                </button>
              ))}
            </div>
          )}

          {/* ── Amount ── */}
          <div className={cn("rounded-xl border p-3 pb-2.5", accentLight)}>
            <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-1.5">Amount</p>
            <div className="flex items-center gap-2">
              <span className={cn("text-xl font-black", accentText)}>₹</span>
              <input
                type="number"
                placeholder="0"
                value={formData.amount}
                onChange={e => setFormData(p => ({ ...p, amount: e.target.value }))}
                className="flex-1 bg-transparent text-xl font-black text-foreground outline-none placeholder:text-muted-foreground/40 pointer-events-auto [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
              />
            </div>
          </div>

          {/* ── Date ── */}
          <div className="space-y-2">
            <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">When</p>
            <div className="w-full flex gap-2">
              {([{ key: 'today', label: 'Today' }, { key: 'yesterday', label: 'Yesterday' }, { key: 'other', label: 'Other' }] as const).map(({ key, label }) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => {
                    setQuickDate(key);
                    if (key === 'today')     { const d = getISTDate(); setSelectedDateTime(d); }
                    if (key === 'yesterday') { const d = getISTDate(); d.setDate(d.getDate() - 1); setSelectedDateTime(d); }
                    if (key === 'other')     setShowCalendar(true);
                  }}
                  className={cn(
                    "flex-1 min-w-0 py-1.5 rounded-lg text-xs font-semibold border transition-all pointer-events-auto",
                    quickDate === key
                      ? cn(accentFill, "text-white border-transparent")
                      : "bg-background/60 text-muted-foreground border-border/50 hover:border-primary/40"
                  )}
                >
                  {key === 'other' && quickDate === 'other' ? format(selectedDateTime, "d MMM") : label}
                </button>
              ))}
            </div>
            {quickDate === 'other' && showCalendar && (
              <div className="rounded-xl border border-border/60 overflow-hidden shadow-lg">
                <Calendar
                  mode="single"
                  selected={selectedDateTime}
                  onSelect={date => {
                    if (date) { const d = new Date(date); d.setHours(selectedDateTime.getHours()); d.setMinutes(selectedDateTime.getMinutes()); setSelectedDateTime(d); setShowCalendar(false); }
                  }}
                  initialFocus
                />
              </div>
            )}
          </div>

          {/* ── Category (expense only) ── */}
          {currentFormType === 'expense' && user && (
            <CategoryPicker
              selected={formData.category}
              onSelect={cat => setFormData(p => ({ ...p, category: cat }))}
              userId={user.id}
              onCategoriesChanged={fetchCategories}
              allCategories={allCategories}
              isExpense={isExpense}
            />
          )}

          {/* ── Payment method ── */}
          <div className="space-y-2">
            <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Paid via</p>
            <div className="w-full flex flex-wrap gap-2">
              {PAYMENT_METHODS.map(({ value, label, Icon }) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => setFormData(p => ({ ...p, account: value }))}
                  className={cn(
                    "flex items-center gap-1.5 px-3 py-1.5 rounded-full border text-xs font-semibold transition-all pointer-events-auto",
                    formData.account === value
                      ? cn(accentFill, "text-white border-transparent shadow-sm")
                      : "bg-background/60 text-muted-foreground border-border/50 hover:border-primary/40"
                  )}
                >
                  <Icon className="h-3.5 w-3.5" />
                  {label}
                </button>
              ))}
            </div>
          </div>

          {/* ── Note ── */}
          <div className="space-y-1.5">
            <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground flex items-center gap-1">
              <StickyNote className="h-3 w-3" /> Note <span className="font-normal normal-case tracking-normal">(optional)</span>
            </p>
            <textarea
              rows={showNote ? 3 : 1}
              placeholder="What was this for?"
              value={formData.note}
              onFocus={() => setShowNote(true)}
              onChange={e => {
                const words = e.target.value.split(' ').filter(w => w.length > 0);
                if (words.length <= 100) setFormData(p => ({ ...p, note: e.target.value }));
              }}
              className="w-full bg-background/60 border border-border/50 rounded-xl px-3 py-2 text-xs text-foreground placeholder:text-muted-foreground/40 outline-none focus:border-primary/40 resize-none transition-all duration-200 pointer-events-auto"
            />
          </div>

          {/* ── Tax insight strip (offline classifier) ── */}
          {taxInsight && (effectiveBucket || taxInsight.bucketId) && (
            <div className={cn(
              "rounded-xl border p-2.5 space-y-1.5",
              effectiveBucket ? "bg-primary/5 border-primary/20" : "bg-amber-500/5 border-amber-500/20"
            )}>
              {effectiveBucket ? (
                <div className="flex items-center gap-1.5">
                  <Sparkles className="h-3.5 w-3.5 text-primary shrink-0" />
                  <p className="text-[11px] text-foreground">
                    Counts toward{" "}
                    <span className="font-bold text-primary">
                      {effectiveBucket.section ?? effectiveBucket.label}
                    </span>
                    {effectiveBucket.kind === "non_taxable" && " (not taxable)"}
                  </p>
                </div>
              ) : (
                <>
                  <p className="text-[11px] font-semibold text-foreground flex items-center gap-1.5">
                    <Sparkles className="h-3.5 w-3.5 text-amber-500 shrink-0" /> Tax category?
                  </p>
                  <div className="flex flex-wrap gap-1.5">
                    {[taxInsight.bucketId, ...taxInsight.alternatives.map(a => a.bucketId)]
                      .filter((id): id is string => !!id)
                      .slice(0, 3)
                      .map(id => {
                        const b = BUCKET_BY_ID[id];
                        if (!b) return null;
                        return (
                          <button
                            key={id}
                            type="button"
                            onClick={() => setConfirmedBucket(id)}
                            className="px-2.5 py-1 rounded-full border border-amber-500/30 bg-background/60 text-[11px] font-medium text-foreground hover:border-primary/40 pointer-events-auto"
                          >
                            {b.section ?? b.label}
                          </button>
                        );
                      })}
                  </div>
                </>
              )}
            </div>
          )}

          {/* ── Save ── */}
          <button
            type="button"
            onClick={handleSave}
            disabled={isSaving || !currentFormType || !formData.account || !formData.amount || (currentFormType === 'expense' && !formData.category)}
            className={cn(
              "w-full py-3 rounded-2xl text-sm font-bold text-white transition-all pointer-events-auto mt-1",
              "disabled:opacity-40 disabled:cursor-not-allowed",
              isExpense ? "bg-destructive hover:bg-destructive/90 shadow-md shadow-destructive/20" : "bg-primary hover:bg-primary/90 shadow-md shadow-primary/20"
            )}
          >
            {isSaving ? (
              <span className="flex items-center justify-center gap-2">
                <span className="h-4 w-4 rounded-full border-2 border-white border-t-transparent animate-spin" />
                Saving…
              </span>
            ) : initialData ? "Update" : `Save ${currentFormType === 'income' ? 'income' : 'expense'}`}
          </button>

        </div>
      </DialogContent>
    </Dialog>
  );
};
