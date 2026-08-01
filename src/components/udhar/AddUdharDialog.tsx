"use client";

import React, { useState, useEffect, useMemo } from "react";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import {
  CalendarIcon, Calculator, Plus, Trash2,
  TrendingUp, TrendingDown, X, ChevronRight,
} from "lucide-react";
import { format } from "date-fns";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";

interface UdharFormData {
  id?: string;
  personName?: string;
  lenderName?: string;
  amount: number;
  dueDate: Date;
  phoneNumber: string;
  description?: string;
  type: 'given' | 'taken';
}

interface AddUdharDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (data: UdharFormData) => Promise<void>;
  type: 'given' | 'taken';
  initialData?: UdharFormData;
}

// ─── Quick amount chips ───────────────────────────────────────────────────────
const QUICK_AMOUNTS = ['100', '200', '500', '1000', '2000', '5000'];

// ─── Split Calculator ─────────────────────────────────────────────────────────
type SplitMode = 'equal' | 'custom' | 'percent';

interface SplitPerson {
  id: string;
  name: string;
  value: string;
}

const SplitCalculator = ({
  mainPersonName,
  onUseAmount,
  accent,
}: {
  mainPersonName: string;
  onUseAmount: (amount: string) => void;
  accent: string;
}) => {
  const [totalBill, setTotalBill] = useState('');
  const [mode,      setMode]      = useState<SplitMode>('equal');
  const [people,    setPeople]    = useState<SplitPerson[]>([
    { id: '1', name: mainPersonName || 'You', value: '' },
    { id: '2', name: '',                      value: '' },
  ]);

  useEffect(() => {
    setPeople(prev => prev.map((p, i) => i === 0 ? { ...p, name: mainPersonName || 'You' } : p));
  }, [mainPersonName]);

  const total = parseFloat(totalBill) || 0;

  const shares = useMemo(() => {
    if (!total) return people.map(() => 0);
    if (mode === 'equal') {
      const each = Math.round((total / people.length) * 100) / 100;
      return people.map(() => each);
    }
    if (mode === 'custom')  return people.map(p => parseFloat(p.value) || 0);
    if (mode === 'percent') return people.map(p => Math.round((total * (parseFloat(p.value) || 0) / 100) * 100) / 100);
    return people.map(() => 0);
  }, [total, mode, people]);

  const sharesTotal = shares.reduce((s, v) => s + v, 0);
  const isBalanced  = mode === 'equal' || Math.abs(sharesTotal - total) < 0.5;

  const addPerson    = () => setPeople(p => [...p, { id: Date.now().toString(), name: '', value: '' }]);
  const removePerson = (id: string) => setPeople(p => p.filter(x => x.id !== id));
  const updatePerson = (id: string, field: 'name' | 'value', val: string) =>
    setPeople(p => p.map(x => x.id === id ? { ...x, [field]: val } : x));

  return (
    <div className="rounded-2xl border border-border/50 bg-muted/20 overflow-hidden">
      {/* Calculator header */}
      <div className={cn("px-4 py-2.5 flex items-center gap-2", accent === 'blue' ? 'bg-blue-50' : 'bg-rose-50')}>
        <Calculator className={cn("h-3.5 w-3.5", accent === 'blue' ? 'text-blue-600' : 'text-rose-600')} />
        <p className={cn("text-xs font-semibold", accent === 'blue' ? 'text-blue-700' : 'text-rose-700')}>
          Split Calculator
        </p>
      </div>

      <div className="p-3 space-y-3">
        {/* Total + mode */}
        <div className="flex gap-2">
          <div className="flex-1">
            <p className="text-[10px] text-muted-foreground mb-1">Total Bill (₹)</p>
            <Input type="number" value={totalBill} onChange={e => setTotalBill(e.target.value)}
              placeholder="e.g. 2400" className="h-8 text-sm pointer-events-auto" />
          </div>
          <div className="w-28">
            <p className="text-[10px] text-muted-foreground mb-1">Split by</p>
            <div className="relative">
              <select value={mode} onChange={e => setMode(e.target.value as SplitMode)}
                className="w-full h-8 rounded-lg border border-input bg-background px-2 text-xs appearance-none pr-6 pointer-events-auto">
                <option value="equal">Equal</option>
                <option value="custom">Exact ₹</option>
                <option value="percent">Percent</option>
              </select>
              <ChevronRight className="absolute right-1.5 top-2 h-3.5 w-3.5 text-muted-foreground pointer-events-none rotate-90" />
            </div>
          </div>
        </div>

        {/* People */}
        <div className="space-y-1.5">
          {people.map((person, idx) => (
            <div key={person.id} className="flex items-center gap-1.5">
              <div className={cn(
                "h-6 w-6 rounded-full flex items-center justify-center text-[9px] font-bold shrink-0",
                idx === 0
                  ? (accent === 'blue' ? 'bg-blue-100 text-blue-700' : 'bg-rose-100 text-rose-700')
                  : 'bg-muted text-muted-foreground'
              )}>
                {(person.name || `P${idx + 1}`)[0].toUpperCase()}
              </div>
              <Input
                value={person.name}
                onChange={e => updatePerson(person.id, 'name', e.target.value)}
                placeholder={idx === 0 ? 'You' : `Person ${idx + 1}`}
                className="h-7 text-xs flex-1 pointer-events-auto"
              />
              {mode !== 'equal' && (
                <Input
                  type="number"
                  value={person.value}
                  onChange={e => updatePerson(person.id, 'value', e.target.value)}
                  placeholder={mode === 'percent' ? '%' : '₹'}
                  className="h-7 text-xs w-14 text-right pointer-events-auto"
                />
              )}
              <span className={cn(
                "text-[11px] font-bold w-12 text-right shrink-0",
                total > 0 && shares[idx] > 0
                  ? (accent === 'blue' ? 'text-blue-600' : 'text-rose-600')
                  : 'text-muted-foreground'
              )}>
                {total > 0 ? `₹${shares[idx]?.toFixed(0)}` : '—'}
              </span>
              {people.length > 2 && idx >= 1 && (
                <button type="button" onClick={() => removePerson(person.id)}
                  className="text-muted-foreground/40 hover:text-destructive pointer-events-auto">
                  <Trash2 className="h-3 w-3" />
                </button>
              )}
            </div>
          ))}
          <button type="button" onClick={addPerson}
            className={cn("flex items-center gap-1 text-[10px] font-medium pointer-events-auto mt-0.5",
              accent === 'blue' ? 'text-blue-600' : 'text-rose-600'
            )}>
            <Plus className="h-3 w-3" /> Add person
          </button>
        </div>

        {/* Balance check */}
        {total > 0 && mode !== 'equal' && (
          <div className={cn("text-[10px] px-2 py-1.5 rounded-lg",
            isBalanced ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700'
          )}>
            {isBalanced
              ? `✓ Splits total ₹${sharesTotal.toFixed(0)}`
              : `₹${sharesTotal.toFixed(0)} of ₹${total} — ₹${(total - sharesTotal).toFixed(0)} remaining`
            }
          </div>
        )}

        {/* Use amount buttons */}
        {total > 0 && (
          <div className="space-y-1.5">
            <p className="text-[10px] text-muted-foreground">Tap to use share as amount:</p>
            <div className="flex flex-wrap gap-1.5">
              {people.map((person, idx) => shares[idx] > 0 && (
                <button key={person.id} type="button"
                  onClick={() => onUseAmount(shares[idx].toFixed(0))}
                  className={cn(
                    "text-[11px] font-semibold px-3 py-1.5 rounded-xl transition-all pointer-events-auto border",
                    accent === 'blue'
                      ? 'bg-blue-50 text-blue-700 border-blue-200 hover:bg-blue-100'
                      : 'bg-rose-50 text-rose-700 border-rose-200 hover:bg-rose-100'
                  )}>
                  {person.name || `Person ${idx + 1}`} · ₹{shares[idx].toFixed(0)}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

// ─── Main Dialog ──────────────────────────────────────────────────────────────
export const AddUdharDialog = ({ isOpen, onClose, onSave, type, initialData }: AddUdharDialogProps) => {
  const { toast }     = useToast();
  const isGiven       = type === 'given';
  const accent        = isGiven ? 'blue' : 'rose';

  const [personName,  setPersonName]  = useState('');
  const [amount,      setAmount]      = useState('');
  const [dueDate,     setDueDate]     = useState<Date | undefined>(new Date());
  const [phoneNumber, setPhoneNumber] = useState('');
  const [description, setDescription] = useState('');
  const [isSaving,    setIsSaving]    = useState(false);
  const [showCalc,    setShowCalc]    = useState(false);

  useEffect(() => {
    if (isOpen) {
      if (initialData) {
        setPersonName(initialData.personName || initialData.lenderName || '');
        setAmount(initialData.amount.toString());
        setDueDate(initialData.dueDate);
        setPhoneNumber(initialData.phoneNumber);
        setDescription(initialData.description || '');
      } else {
        setPersonName(''); setAmount(''); setDueDate(new Date());
        setPhoneNumber(''); setDescription('');
      }
      setIsSaving(false);
      setShowCalc(false);
    }
  }, [isOpen, initialData]);

  const validateForm = () => {
    if (!personName.trim()) {
      toast({ title: 'Required', description: `${isGiven ? "Person's" : "Lender's"} name is required.`, variant: 'destructive' });
      return false;
    }
    if (!amount || parseFloat(amount) <= 0) {
      toast({ title: 'Required', description: 'Please enter a valid amount.', variant: 'destructive' });
      return false;
    }
    if (!dueDate) {
      toast({ title: 'Required', description: 'Due date is required.', variant: 'destructive' });
      return false;
    }
    if (phoneNumber.trim()) {
      const digits = phoneNumber.replace(/\D/g, '');
      if (digits.length !== 10 && digits.length !== 12) {
        toast({ title: 'Invalid', description: 'Enter a valid 10-digit phone number.', variant: 'destructive' });
        return false;
      }
    }
    return true;
  };

  const handleSubmit = async () => {
    if (!validateForm()) return;
    setIsSaving(true);
    try {
      const dataToSave: UdharFormData = {
        id: initialData?.id,
        amount: parseFloat(amount),
        dueDate: dueDate!,
        phoneNumber: phoneNumber.replace(/\D/g, ''),
        description,
        type,
      };
      if (isGiven) dataToSave.personName = personName;
      else         dataToSave.lenderName = personName;
      await onSave(dataToSave);
    } catch {
      toast({ title: 'Error', description: 'Failed to save. Please try again.', variant: 'destructive' });
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-xs sm:max-w-sm p-0 overflow-hidden rounded-2xl border-0 shadow-2xl pointer-events-auto max-h-[92vh] flex flex-col">

        {/* Coloured header */}
        <div className={cn(
          "px-5 pt-5 pb-4 shrink-0",
          isGiven ? "bg-blue-600" : "bg-rose-500"
        )}>
          <div className="flex items-start justify-between">
            <div className="flex items-center gap-2.5">
              <div className="h-9 w-9 rounded-xl bg-white/20 flex items-center justify-center">
                {isGiven
                  ? <TrendingUp  className="h-5 w-5 text-white" />
                  : <TrendingDown className="h-5 w-5 text-white" />
                }
              </div>
              <div>
                <p className="text-white font-bold text-lg leading-tight">
                  {initialData ? 'Edit' : 'Add'} {isGiven ? 'Lent' : 'Borrowed'}
                </p>
                <p className="text-white/70 text-[11px]">
                  {isGiven ? 'Money you lent to someone' : 'Money you borrowed from someone'}
                </p>
              </div>
            </div>
            <button type="button" onClick={onClose}
              className="h-7 w-7 rounded-full bg-white/20 hover:bg-white/30 flex items-center justify-center transition-colors pointer-events-auto">
              <X className="h-3.5 w-3.5 text-white" />
            </button>
          </div>
        </div>

        {/* Form body */}
        <div className="overflow-y-auto flex-1 px-5 py-4 space-y-4 bg-white">

          {/* Name */}
          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
              {isGiven ? "Who did you lend to?" : "Who did you borrow from?"}
            </label>
            <Input
              value={personName}
              onChange={e => setPersonName(e.target.value)}
              placeholder={isGiven ? 'e.g. Rahul, Priya...' : 'e.g. Axis Bank, Amit...'}
              className="h-10 text-sm pointer-events-auto border-muted-foreground/20 focus:border-primary"
            />
          </div>

          {/* Amount */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Amount (₹)</label>
              {isGiven && (
                <button type="button" onClick={() => setShowCalc(s => !s)}
                  className={cn(
                    "flex items-center gap-1 text-[10px] font-semibold px-2.5 py-1 rounded-full transition-all pointer-events-auto",
                    showCalc
                      ? "bg-blue-600 text-white"
                      : "bg-blue-50 text-blue-700 hover:bg-blue-100"
                  )}>
                  <Calculator className="h-3 w-3" />
                  Split
                </button>
              )}
            </div>

            {/* Big amount input */}
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-xl font-bold text-muted-foreground/40">₹</span>
              <Input
                type="number"
                value={amount}
                onChange={e => setAmount(e.target.value)}
                placeholder="0"
                className="h-14 text-2xl font-bold pl-9 pointer-events-auto border-muted-foreground/20"
              />
            </div>

            {/* Quick amount chips */}
            <div className="flex gap-1.5 flex-wrap">
              {QUICK_AMOUNTS.map(q => (
                <button key={q} type="button"
                  onClick={() => setAmount(a => a && parseFloat(a) > 0 ? String(parseFloat(a) + parseFloat(q)) : q)}
                  className={cn(
                    "text-[11px] font-semibold px-2.5 py-1 rounded-lg border transition-all pointer-events-auto",
                    isGiven
                      ? "border-blue-200 bg-blue-50 text-blue-700 hover:bg-blue-100"
                      : "border-rose-200 bg-rose-50 text-rose-700 hover:bg-rose-100"
                  )}>
                  +₹{parseInt(q) >= 1000 ? `${parseInt(q)/1000}k` : q}
                </button>
              ))}
              {amount && parseFloat(amount) > 0 && (
                <button type="button" onClick={() => setAmount('')}
                  className="text-[11px] font-semibold px-2.5 py-1 rounded-lg border border-muted/40 bg-muted/20 text-muted-foreground hover:bg-muted/40 transition-all pointer-events-auto">
                  Clear
                </button>
              )}
            </div>
          </div>

          {/* Split Calculator */}
          {showCalc && isGiven && (
            <SplitCalculator
              mainPersonName={personName}
              onUseAmount={val => { setAmount(val); setShowCalc(false); }}
              onSaveMultiple={onSaveMultiple}
              onCreateAll={async (people, shares) => {
                if (!onSaveMultiple) return;
                const entries: UdharFormData[] = people
                  .map((p, i) => ({ ...({} as UdharFormData), personName: p.name.trim() || `Person ${i + 1}`, amount: parseFloat(shares[i].toFixed(0)), dueDate: dueDate!, phoneNumber: p.phone?.replace(/\D/g,"") || "", description, type }))
                  .filter(e => e.amount > 0 && e.personName);
                await onSaveMultiple(entries);
                setShowCalc(false);
              }}
              accent={accent}
            />
          )}

          {/* Due Date + Phone — 2 column */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Due Date</label>
              <Popover>
                <PopoverTrigger asChild>
                  <Button variant="outline"
                    className="w-full justify-start text-left h-10 text-xs pointer-events-auto border-muted-foreground/20 font-normal">
                    <CalendarIcon className="mr-1.5 h-3.5 w-3.5 text-muted-foreground" />
                    {dueDate ? format(dueDate, 'd MMM yy') : 'Pick date'}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0 bg-white border border-border shadow-xl z-50 pointer-events-auto">
                  <Calendar mode="single" selected={dueDate} onSelect={setDueDate} initialFocus />
                </PopoverContent>
              </Popover>
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                Phone <span className="normal-case font-normal text-muted-foreground/60">(optional)</span>
              </label>
              <Input
                type="tel"
                value={phoneNumber}
                onChange={e => setPhoneNumber(e.target.value)}
                placeholder="10-digit"
                maxLength={13}
                className="h-10 text-sm pointer-events-auto border-muted-foreground/20"
              />
            </div>
          </div>

          {/* Description */}
          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
              Note <span className="normal-case font-normal text-muted-foreground/60">(optional)</span>
            </label>
            <Textarea
              value={description}
              onChange={e => {
                const words = e.target.value.split(' ').filter(w => w.length > 0);
                if (words.length <= 100) setDescription(e.target.value);
              }}
              placeholder={isGiven
                ? "e.g. Dinner at Barbeque Nation, split 4 ways"
                : "e.g. Emergency loan from Amit"}
              rows={2}
              className="text-xs pointer-events-auto border-muted-foreground/20 resize-none"
            />
          </div>
        </div>

        {/* Sticky footer */}
        <div className="px-5 py-4 bg-white border-t border-muted/20 flex gap-3 shrink-0">
          <Button variant="outline" onClick={onClose}
            className="flex-1 h-11 text-sm pointer-events-auto border-muted-foreground/20">
            Cancel
          </Button>
          <Button
            disabled={isSaving}
            onClick={handleSubmit}
            className={cn(
              "flex-2 h-11 text-sm font-semibold pointer-events-auto flex-[2]",
              isGiven
                ? "bg-blue-600 hover:bg-blue-700 text-white"
                : "bg-rose-500 hover:bg-rose-600 text-white"
            )}>
            {isSaving ? 'Saving…' : initialData ? 'Update Entry' : `Save ${isGiven ? 'Lent' : 'Borrowed'}`}
          </Button>
        </div>

      </DialogContent>
    </Dialog>
  );
};
