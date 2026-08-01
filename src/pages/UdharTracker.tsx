import React, { useState } from "react";
import { AppLayout } from "@/components/layout/AppLayout";
import { GlassCard } from "@/components/ui/glass-card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader,
  AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  HandCoins, ArrowUpRight, ArrowDownLeft, Plus, CalendarIcon,
  CheckCircle2, MessageSquare, MoreVertical, Edit3, Trash2,
  AlertTriangle, TrendingUp, TrendingDown, IndianRupee,
  Users, SlidersHorizontal, ChevronDown, ChevronUp,
} from "lucide-react";
import { formatFullINR } from "@/lib/currency";
import { format, isBefore, isToday, differenceInDays, isSameMonth } from "date-fns";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";
import { AddUdharDialog } from "@/components/udhar/AddUdharDialog";
import { useAuth } from "@/contexts/AuthContext";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  getUdharEntries, saveUdharEntry, deleteUdharEntry,
  logPayment, deletePayment,
  getOutstanding, getProgressPercent,
} from "@/integrations/indexeddb/services/udharService";
import { MyDB } from "@/integrations/indexeddb/db";

type UdharEntry = MyDB['udhar_entries']['value'];

// ─── Constants ────────────────────────────────────────────────────────────────
const STORAGE_KEY_GIVEN = 'vidhence_udhar_msg_given';
const STORAGE_KEY_TAKEN = 'vidhence_udhar_msg_taken';
export const DEFAULT_MSG_GIVEN = `Kindly settle when convenient. 🙏\n\n— Sent via Lendr`;
export const DEFAULT_MSG_TAKEN = `Will settle soon, don't worry! 🙏\n\n— Sent via Lendr`;

function safeGetItem(key: string): string | null {
  try { return localStorage.getItem(key); } catch { return null; }
}
function safeSetItem(key: string, value: string): void {
  try { localStorage.setItem(key, value); } catch {}
}

function buildMessage(msg: string, name: string, amount: number, type: 'given' | 'taken'): string {
  const greeting = type === 'given'
    ? `Hi ${name}, you owe ₹${amount.toLocaleString('en-IN')}.\n\n`
    : `Hi ${name}, I owe you ₹${amount.toLocaleString('en-IN')}.\n\n`;
  return greeting + msg;
}

// ─── Due date helper ──────────────────────────────────────────────────────────
function getDueDateStatus(dueDateStr: string, isSettled: boolean) {
  if (isSettled) return { color: "text-emerald-500", bg: "bg-emerald-50 border-emerald-200", dot: "bg-emerald-400" };
  const due = new Date(dueDateStr);
  const daysLeft = differenceInDays(due, new Date());
  if (isBefore(due, new Date()) && !isToday(due))
    return { color: "text-red-500",   bg: "bg-red-50 border-red-200",     dot: "bg-red-400" };
  if (daysLeft <= 3)
    return { color: "text-amber-500", bg: "bg-amber-50 border-amber-200", dot: "bg-amber-400" };
  return   { color: "text-blue-500",  bg: "bg-blue-50 border-blue-200",   dot: "bg-blue-400" };
}

// ─── Message Template Sheet ───────────────────────────────────────────────────
function MessageTemplateSheet({ open, onClose, givenTemplate, takenTemplate, onSave }: {
  open: boolean; onClose: () => void;
  givenTemplate: string; takenTemplate: string;
  onSave: (given: string, taken: string) => void;
}) {
  const [draftGiven, setDraftGiven] = React.useState(givenTemplate);
  const [draftTaken, setDraftTaken] = React.useState(takenTemplate);
  const [tab, setTab] = React.useState<'given' | 'taken'>('given');
  React.useEffect(() => { if (open) { setDraftGiven(givenTemplate); setDraftTaken(takenTemplate); } }, [open]);

  return (
    <Sheet open={open} onOpenChange={v => !v && onClose()}>
      <SheetContent side="bottom" className="rounded-t-2xl pb-8">
        <SheetHeader className="mb-5">
          <SheetTitle className="text-base font-bold flex items-center gap-2">
            <SlidersHorizontal className="h-4 w-4 text-primary" /> Customise WhatsApp Message
          </SheetTitle>
          <p className="text-sm text-muted-foreground">Name and amount are always added automatically.</p>
        </SheetHeader>
        <div className="flex rounded-xl bg-muted p-1 mb-4">
          {(['given', 'taken'] as const).map(t => (
            <button key={t} onClick={() => setTab(t)}
              className={cn("flex-1 text-sm font-medium py-2 rounded-lg transition-colors",
                tab === t ? "bg-background shadow-sm text-foreground" : "text-muted-foreground")}>
              {t === 'given' ? 'Money Lent' : 'Money Borrowed'}
            </button>
          ))}
        </div>
        <div className="rounded-lg bg-primary/5 border border-primary/20 px-3 py-2.5 mb-4">
          <p className="text-xs text-primary font-semibold mb-1">Auto-added at start:</p>
          <p className="text-sm text-foreground">
            {tab === 'given' ? 'Hi [Name], you owe ₹[Amount].' : 'Hi [Name], I owe you ₹[Amount].'}
          </p>
        </div>
        <div className="space-y-2 mb-5">
          <div className="flex items-center justify-between">
            <label className="text-sm font-medium">Your message</label>
            <button onClick={() => tab === 'given' ? setDraftGiven(DEFAULT_MSG_GIVEN) : setDraftTaken(DEFAULT_MSG_TAKEN)}
              className="text-xs text-muted-foreground hover:text-primary">Reset</button>
          </div>
          <Textarea value={tab === 'given' ? draftGiven : draftTaken}
            onChange={e => tab === 'given' ? setDraftGiven(e.target.value) : setDraftTaken(e.target.value)}
            className="text-sm min-h-[100px] resize-none" />
        </div>
        <div className="flex gap-3">
          <Button variant="outline" className="flex-1" onClick={onClose}>Cancel</Button>
          <Button className="flex-1" onClick={() => {
            onSave(draftGiven.trim() || DEFAULT_MSG_GIVEN, draftTaken.trim() || DEFAULT_MSG_TAKEN);
            onClose();
          }}>Save</Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}

// ─── Summary Pill ─────────────────────────────────────────────────────────────
function SummaryPill({ label, amount, count, icon: Icon, accent }: {
  label: string; amount: number; count: number; icon: React.ElementType; accent: string;
}) {
  return (
    <div className={cn("flex-1 rounded-2xl p-4 flex flex-col gap-1 border", accent)}>
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">{label}</span>
        <Icon className="h-4 w-4 text-muted-foreground" />
      </div>
      <p className="text-lg font-bold text-foreground leading-tight">{formatFullINR(amount)}</p>
      <p className="text-xs text-muted-foreground">{count} {count === 1 ? "entry" : "entries"}</p>
    </div>
  );
}

// ─── Entry Card — Ledger style ────────────────────────────────────────────────
function UdharEntryCard({ entry, onSettle, onWhatsApp, onEdit, onDelete, onPaymentLogged }: {
  entry: UdharEntry;
  onSettle: (e: UdharEntry) => void;
  onWhatsApp: (name: string, amount: number, type: 'given' | 'taken', phone: string) => void;
  onEdit: (e: UdharEntry) => void;
  onDelete: (id: string, name: string, type: 'given' | 'taken') => void;
  onPaymentLogged: () => void;
}) {
  const name        = entry.type === 'given' ? entry.person_name : entry.lender_name;
  const isSettled   = entry.is_settled;
  const isGiven     = entry.type === 'given';
  const due         = getDueDateStatus(entry.due_date, isSettled);
  const initials    = (name || '?').split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2);
  const payments    = (entry as any).payments   ?? [];
  const amountPaid  = (entry as any).amount_paid ?? 0;
  const outstanding = getOutstanding(entry);
  const pct         = getProgressPercent(entry);
  const hasPayments = payments.length > 0;

  const [expanded,    setExpanded]    = React.useState(false);
  const [showPayForm, setShowPayForm] = React.useState(false);
  const [payAmount,   setPayAmount]   = React.useState('');
  const [payNote,     setPayNote]     = React.useState('');
  const [payDate,     setPayDate]     = React.useState(format(new Date(), 'yyyy-MM-dd'));
  const [savingPay,   setSavingPay]   = React.useState(false);
  const { toast } = useToast();

  const handleLogPayment = async () => {
    const amt = parseFloat(payAmount);
    if (!amt || amt <= 0) { toast({ title: 'Enter a valid amount', variant: 'destructive' }); return; }
    if (amt > outstanding) {
      toast({ title: 'Exceeds outstanding', description: `Max: ${formatFullINR(outstanding)}`, variant: 'destructive' });
      return;
    }
    setSavingPay(true);
    await logPayment(entry.id, { amount: amt, date: new Date(payDate).toISOString(), note: payNote });
    setSavingPay(false);
    setShowPayForm(false);
    setPayAmount(''); setPayNote('');
    onPaymentLogged();

    // Offer WhatsApp confirmation
    if (entry.phone_number) {
      const newOut = outstanding - amt;
      const msg = newOut <= 0
        ? `Hi ${name}, received ${formatFullINR(amt)}. We're all settled! 🎉 — Sent via Lendr`
        : `Hi ${name}, received ${formatFullINR(amt)}. Still outstanding: ${formatFullINR(newOut)} 🙏 — Sent via Lendr`;
      if (window.confirm(`Send WhatsApp confirmation to ${name}?`)) {
        window.open(`https://wa.me/${entry.phone_number}?text=${encodeURIComponent(msg)}`, '_blank');
      }
    }
  };

  return (
    <div className={cn(
      "relative rounded-xl border bg-background/70 transition-all duration-200",
      isSettled ? "opacity-60 border-border/40" : "border-border/60 hover:shadow-sm"
    )}>
      {/* Accent bar */}
      <div className={cn("absolute left-0 top-3 bottom-3 w-1 rounded-full",
        isSettled ? "bg-emerald-400" : isGiven ? "bg-blue-400" : "bg-rose-400"
      )} />

      <div className="pl-4 pr-3 py-3 space-y-2.5">

        {/* ── Top row: avatar + info + actions ── */}
        <div className="flex items-start gap-3">
          <div className={cn("h-9 w-9 rounded-full flex items-center justify-center text-sm font-bold shrink-0 mt-0.5",
            isGiven ? "bg-blue-100 text-blue-700" : "bg-rose-100 text-rose-700"
          )}>
            {initials}
          </div>

          <div className="flex-1 min-w-0">
            <p className={cn("font-semibold text-sm leading-tight", isSettled && "line-through text-muted-foreground")}>
              {name}
            </p>
            <div className="flex items-baseline gap-1.5 mt-0.5">
              <p className="text-base font-bold text-foreground">{formatFullINR(entry.amount)}</p>
              {!isSettled && outstanding < entry.amount && (
                <p className="text-[11px] text-amber-600 font-semibold">
                  · {formatFullINR(outstanding)} left
                </p>
              )}
            </div>
            {entry.description && (
              <p className="text-[11px] text-muted-foreground mt-0.5 truncate">{entry.description}</p>
            )}
          </div>

          {/* Right actions */}
          <div className="flex flex-col items-end gap-1.5 shrink-0">
            {/* Due date */}
            <span className={cn("text-[10px] font-semibold px-1.5 py-0.5 rounded-full border flex items-center gap-1", due.bg, due.color)}>
              <span className={cn("h-1.5 w-1.5 rounded-full inline-block", due.dot)} />
              {isSettled ? "Settled" : format(new Date(entry.due_date), "MMM d")}
            </span>
            {/* Action buttons */}
            <div className="flex items-center gap-1">
              <button onClick={() => onSettle(entry)} title={isSettled ? "Unsettle" : "Mark Settled"}
                className={cn("h-7 w-7 rounded-full flex items-center justify-center transition-colors",
                  isSettled ? "bg-emerald-100 text-emerald-600 hover:bg-emerald-200" : "bg-muted text-muted-foreground hover:bg-emerald-100 hover:text-emerald-600"
                )}>
                <CheckCircle2 className="h-3.5 w-3.5" />
              </button>
              <button
                onClick={() => onWhatsApp(name || '', outstanding > 0 ? outstanding : entry.amount, entry.type, entry.phone_number || '')}
                title={entry.phone_number ? "Send WhatsApp reminder" : "Add phone to enable"}
                className={cn("h-7 w-7 rounded-full flex items-center justify-center transition-colors",
                  entry.phone_number ? "bg-green-100 text-green-600 hover:bg-green-200" : "bg-muted text-muted-foreground opacity-40 cursor-not-allowed"
                )}>
                <MessageSquare className="h-3.5 w-3.5" />
              </button>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button className="h-7 w-7 rounded-full bg-muted text-muted-foreground hover:bg-muted/80 flex items-center justify-center">
                    <MoreVertical className="h-3.5 w-3.5" />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-32 bg-white/95 backdrop-blur-md border border-white/20 shadow-xl z-50">
                  <DropdownMenuItem onClick={() => onEdit(entry)} className="flex items-center gap-2 cursor-pointer">
                    <Edit3 className="h-3.5 w-3.5" /> Edit
                  </DropdownMenuItem>
                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <DropdownMenuItem onSelect={e => e.preventDefault()}
                        className="flex items-center gap-2 cursor-pointer text-destructive hover:bg-destructive/10">
                        <Trash2 className="h-3.5 w-3.5" /> Delete
                      </DropdownMenuItem>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>Delete Entry?</AlertDialogTitle>
                        <AlertDialogDescription>Remove entry for "{name}"? Cannot be undone.</AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                        <AlertDialogAction onClick={() => onDelete(entry.id, name || '', entry.type)}
                          className="bg-destructive text-destructive-foreground">Delete</AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>
        </div>

        {/* ── Ledger progress bar + record payment ── */}
        {!isSettled && (
          <div className="space-y-1.5">
            {/* Bar */}
            <div className="flex items-center gap-2">
              <div className="flex-1 h-2.5 bg-muted/40 rounded-full overflow-hidden">
                <div
                  className={cn("h-full rounded-full transition-all duration-300",
                    pct >= 100 ? "bg-emerald-500" : isGiven ? "bg-blue-500" : "bg-rose-500"
                  )}
                  style={{ width: `${pct}%` }}
                />
              </div>
              {/* + button right next to bar */}
              <button
                type="button"
                onClick={() => { setShowPayForm(s => !s); if (!showPayForm) setExpanded(true); }}
                className={cn(
                  "h-7 w-7 rounded-full flex items-center justify-center transition-all shrink-0",
                  showPayForm
                    ? "bg-primary text-primary-foreground"
                    : isGiven ? "bg-blue-100 text-blue-600 hover:bg-blue-200" : "bg-rose-100 text-rose-600 hover:bg-rose-200"
                )}
                title="Record payment"
              >
                <Plus className="h-3.5 w-3.5" />
              </button>
            </div>

            {/* Bar labels */}
            <div className="flex items-center justify-between">
              <p className="text-[10px] text-muted-foreground">
                {amountPaid > 0
                  ? <><span className="font-semibold text-foreground">{formatFullINR(amountPaid)}</span> paid · <span className={cn("font-semibold", isGiven ? "text-blue-600" : "text-rose-600")}>{formatFullINR(outstanding)}</span> left</>
                  : <span className={cn("font-semibold", isGiven ? "text-blue-600" : "text-rose-600")}>{formatFullINR(outstanding)}</span>
                }
              </p>
              {hasPayments && (
                <button type="button" onClick={() => setExpanded(s => !s)}
                  className="text-[10px] text-primary flex items-center gap-0.5 pointer-events-auto">
                  {payments.length} payment{payments.length !== 1 ? 's' : ''}
                  {expanded ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                </button>
              )}
            </div>
          </div>
        )}

        {/* Settled progress bar */}
        {isSettled && hasPayments && (
          <div className="space-y-1">
            <div className="h-2 bg-emerald-100 rounded-full overflow-hidden">
              <div className="h-full bg-emerald-500 rounded-full w-full" />
            </div>
            <div className="flex items-center justify-between">
              <p className="text-[10px] text-emerald-600 font-medium">Fully settled · {formatFullINR(entry.amount)}</p>
              <button type="button" onClick={() => setExpanded(s => !s)}
                className="text-[10px] text-primary flex items-center gap-0.5 pointer-events-auto">
                {payments.length} payment{payments.length !== 1 ? 's' : ''}
                {expanded ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
              </button>
            </div>
          </div>
        )}

        {/* ── Payment entry form ── */}
        {showPayForm && !isSettled && (
          <div className={cn(
            "rounded-xl p-3 space-y-2.5 border",
            isGiven ? "bg-blue-50/40 border-blue-200/40" : "bg-rose-50/40 border-rose-200/40"
          )}>
            <p className="text-xs font-semibold text-foreground">
              {isGiven ? "Record payment received" : "Record payment made"}
            </p>

            {/* Amount + Date side by side */}
            <div className="grid grid-cols-2 gap-2">
              <div>
                <p className="text-[10px] text-muted-foreground mb-1">Amount (₹)</p>
                <Input type="number" value={payAmount} onChange={e => setPayAmount(e.target.value)}
                  placeholder="0" className="h-8 text-sm pointer-events-auto" />
              </div>
              <div>
                <p className="text-[10px] text-muted-foreground mb-1">Date</p>
                <Input type="date" value={payDate} onChange={e => setPayDate(e.target.value)}
                  className="h-8 text-xs pointer-events-auto" />
              </div>
            </div>

            {/* Note */}
            <Input value={payNote} onChange={e => setPayNote(e.target.value)}
              placeholder="Note — e.g. GPay, cash, bank transfer..."
              className="h-8 text-xs pointer-events-auto" />

            {/* Quick amount chips */}
            <div className="flex gap-1.5 flex-wrap">
              {[outstanding, Math.round(outstanding / 2), Math.round(outstanding / 4)]
                .filter((v, i, arr) => v > 0 && arr.indexOf(v) === i)
                .map((v, i) => (
                  <button key={i} type="button" onClick={() => setPayAmount(v.toString())}
                    className={cn("text-[10px] font-medium px-2.5 py-1 rounded-lg border pointer-events-auto",
                      isGiven ? "bg-blue-50 text-blue-700 border-blue-200" : "bg-rose-50 text-rose-700 border-rose-200"
                    )}>
                    {i === 0 ? 'Full' : i === 1 ? 'Half' : '¼'} · ₹{v.toLocaleString('en-IN')}
                  </button>
                ))}
            </div>

            {/* Save / Cancel */}
            <div className="flex gap-2 pt-0.5">
              <Button variant="outline" size="sm" onClick={() => { setShowPayForm(false); setPayAmount(''); setPayNote(''); }}
                className="flex-1 h-8 text-xs pointer-events-auto">Cancel</Button>
              <Button size="sm" onClick={handleLogPayment} disabled={savingPay}
                className={cn("flex-1 h-8 text-xs pointer-events-auto",
                  isGiven ? "bg-blue-600 hover:bg-blue-700 text-white" : "bg-rose-500 hover:bg-rose-600 text-white"
                )}>
                {savingPay ? 'Saving…' : 'Save Payment'}
              </Button>
            </div>
          </div>
        )}

        {/* ── Payment history / ledger ── */}
        {expanded && hasPayments && (
          <div className="rounded-xl border border-border/30 bg-muted/10 overflow-hidden">
            <div className="px-3 py-2 bg-muted/20 border-b border-border/20">
              <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">
                Payment Ledger
              </p>
            </div>
            <div className="divide-y divide-border/20">
              {[...payments]
                .sort((a: any, b: any) => new Date(b.date).getTime() - new Date(a.date).getTime())
                .map((p: any) => (
                  <div key={p.id} className="flex items-center gap-3 px-3 py-2">
                    <div className="h-1.5 w-1.5 rounded-full bg-emerald-400 shrink-0" />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-baseline gap-1.5">
                        <span className="text-xs font-bold text-emerald-700">{formatFullINR(p.amount)}</span>
                        <span className="text-[10px] text-muted-foreground">
                          {format(new Date(p.date), 'd MMM yyyy')}
                        </span>
                      </div>
                      {p.note && <p className="text-[10px] text-muted-foreground mt-0.5">{p.note}</p>}
                    </div>
                    <button type="button"
                      onClick={async () => { await deletePayment(entry.id, p.id); onPaymentLogged(); }}
                      className="text-muted-foreground/30 hover:text-destructive transition-colors pointer-events-auto">
                      <Trash2 className="h-3 w-3" />
                    </button>
                  </div>
                ))}
            </div>
            {/* Running total */}
            <div className="px-3 py-2 bg-muted/20 border-t border-border/20 flex items-center justify-between">
              <p className="text-[10px] text-muted-foreground">Total received</p>
              <p className="text-xs font-bold text-foreground">{formatFullINR(amountPaid)}</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Section ──────────────────────────────────────────────────────────────────
function UdharSection({ type, entries, isLoading, onAdd, onSettle, onWhatsApp, onEdit, onDelete, onPaymentLogged }: {
  type: 'given' | 'taken';
  entries: UdharEntry[];
  isLoading: boolean;
  onAdd: () => void;
  onSettle: (e: UdharEntry) => void;
  onWhatsApp: (name: string, amount: number, type: 'given' | 'taken', phone: string) => void;
  onEdit: (e: UdharEntry) => void;
  onDelete: (id: string, name: string, type: 'given' | 'taken') => void;
  onPaymentLogged: () => void;
}) {
  const isGiven      = type === 'given';
  const unsettled    = entries.filter(e => !e.is_settled);
  const settled      = entries.filter(e => e.is_settled);
  const overdueCount = unsettled.filter(e =>
    isBefore(new Date(e.due_date), new Date()) && !isToday(new Date(e.due_date))
  ).length;

  return (
    <GlassCard className="p-4 space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <div className={cn("h-8 w-8 rounded-xl flex items-center justify-center",
            isGiven ? "bg-blue-100" : "bg-rose-100")}>
            {isGiven
              ? <ArrowUpRight className="h-4 w-4 text-blue-600" />
              : <ArrowDownLeft className="h-4 w-4 text-rose-600" />
            }
          </div>
          <div>
            <h2 className="text-sm font-bold text-foreground">{isGiven ? "Lent" : "Borrowed"}</h2>
            {overdueCount > 0 && (
              <p className="text-[10px] text-red-500 font-medium flex items-center gap-0.5">
                <AlertTriangle className="h-2.5 w-2.5" /> {overdueCount} overdue
              </p>
            )}
          </div>
        </div>
        <Button size="sm" onClick={onAdd}
          className={cn("h-8 text-xs font-semibold rounded-xl px-3",
            isGiven ? "bg-blue-600 hover:bg-blue-700 text-white" : "bg-rose-600 hover:bg-rose-700 text-white"
          )}>
          <Plus className="h-3.5 w-3.5 mr-1" /> Add {isGiven ? "Lent" : "Borrowed"}
        </Button>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-8">
          <div className="animate-spin rounded-full h-6 w-6 border-2 border-primary border-t-transparent" />
        </div>
      ) : entries.length === 0 ? (
        <div className="text-center py-8">
          <div className={cn("h-12 w-12 rounded-full mx-auto flex items-center justify-center mb-3",
            isGiven ? "bg-blue-50" : "bg-rose-50")}>
            <Users className={cn("h-5 w-5", isGiven ? "text-blue-300" : "text-rose-300")} />
          </div>
          <p className="text-sm text-muted-foreground">No entries yet</p>
          <p className="text-xs text-muted-foreground/60 mt-0.5">
            Tap "Add {isGiven ? "Lent" : "Borrowed"}" to add one
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {unsettled.map(entry => (
            <UdharEntryCard key={entry.id} entry={entry}
              onSettle={onSettle} onWhatsApp={onWhatsApp}
              onEdit={onEdit} onDelete={onDelete} onPaymentLogged={onPaymentLogged} />
          ))}
          {settled.length > 0 && (
            <>
              <p className="text-[10px] uppercase tracking-widest text-muted-foreground/60 font-medium pt-1 px-1">
                Settled ({settled.length})
              </p>
              {settled.map(entry => (
                <UdharEntryCard key={entry.id} entry={entry}
                  onSettle={onSettle} onWhatsApp={onWhatsApp}
                  onEdit={onEdit} onDelete={onDelete} onPaymentLogged={onPaymentLogged} />
              ))}
            </>
          )}
        </div>
      )}
    </GlassCard>
  );
}

// ─── Month Picker ──────────────────────────────────────────────────────────────
const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

function MonthYearPicker({ selected, onSelect }: {
  selected: { year: number; month: number } | null;
  onSelect: (val: { year: number; month: number } | null) => void;
}) {
  const currentYear = new Date().getFullYear();
  const [viewYear, setViewYear] = useState(selected?.year ?? currentYear);
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <button onClick={() => setViewYear(y => y - 1)}
          className="h-7 w-7 rounded-lg bg-muted flex items-center justify-center text-sm font-bold">‹</button>
        <span className="text-sm font-semibold">{viewYear}</span>
        <button onClick={() => setViewYear(y => y + 1)} disabled={viewYear >= currentYear}
          className="h-7 w-7 rounded-lg bg-muted flex items-center justify-center text-sm font-bold disabled:opacity-30">›</button>
      </div>
      <div className="grid grid-cols-3 gap-1.5">
        {MONTHS.map((m, idx) => {
          const isSelected = selected?.year === viewYear && selected?.month === idx;
          const isFuture   = viewYear === currentYear && idx > new Date().getMonth();
          return (
            <button key={m} disabled={isFuture} onClick={() => onSelect({ year: viewYear, month: idx })}
              className={cn("rounded-lg py-1.5 text-xs font-medium transition-colors",
                isSelected ? "bg-primary text-primary-foreground" :
                isFuture    ? "text-muted-foreground/30 cursor-not-allowed" :
                              "bg-muted/60 text-foreground hover:bg-muted"
              )}>
              {m}
            </button>
          );
        })}
      </div>
      {selected && (
        <button onClick={() => onSelect(null)}
          className="w-full text-xs text-muted-foreground hover:text-foreground py-1 border-t border-border/40 pt-2">
          Clear filter
        </button>
      )}
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────
const UdharTracker: React.FC = () => {
  const { user }    = useAuth();
  const { toast }   = useToast();
  const queryClient = useQueryClient();

  const [selectedMonth,      setSelectedMonth]      = useState<{ year: number; month: number } | null>(null);
  const [monthPickerOpen,    setMonthPickerOpen]    = useState(false);
  const [showAddUdharDialog, setShowAddUdharDialog] = useState(false);
  const [currentUdharType,   setCurrentUdharType]   = useState<'given' | 'taken'>('given');
  const [editingUdharEntry,  setEditingUdharEntry]  = useState<UdharEntry | null>(null);
  const [showMsgSheet,       setShowMsgSheet]       = useState(false);

  const [givenTemplate, setGivenTemplate] = useState(() => safeGetItem(STORAGE_KEY_GIVEN) || DEFAULT_MSG_GIVEN);
  const [takenTemplate, setTakenTemplate] = useState(() => safeGetItem(STORAGE_KEY_TAKEN) || DEFAULT_MSG_TAKEN);

  const handleSaveTemplates = (given: string, taken: string) => {
    setGivenTemplate(given); setTakenTemplate(taken);
    safeSetItem(STORAGE_KEY_GIVEN, given); safeSetItem(STORAGE_KEY_TAKEN, taken);
    toast({ title: "Templates saved!" });
  };

  const invalidate = (type: 'given' | 'taken') =>
    queryClient.invalidateQueries({ queryKey: ['udharEntries', user?.id, type] });

  const invalidateBoth = () => {
    invalidate('given'); invalidate('taken');
  };

  const { data: allGivenEntries = [], isLoading: isLoadingGiven } = useQuery<UdharEntry[]>({
    queryKey: ['udharEntries', user?.id, 'given'],
    queryFn: () => user ? getUdharEntries(user.id, 'given') : Promise.resolve([]),
    enabled: !!user,
    staleTime: 1000 * 60 * 2,
  });

  const { data: allTakenEntries = [], isLoading: isLoadingTaken } = useQuery<UdharEntry[]>({
    queryKey: ['udharEntries', user?.id, 'taken'],
    queryFn: () => user ? getUdharEntries(user.id, 'taken') : Promise.resolve([]),
    enabled: !!user,
    staleTime: 1000 * 60 * 2,
  });

  const filterEntries = (entries: UdharEntry[]) => {
    if (!selectedMonth) return entries;
    const filterDate = new Date(selectedMonth.year, selectedMonth.month, 1);
    return entries.filter(e => !e.is_settled || isSameMonth(new Date(e.due_date), filterDate));
  };

  const givenEntries = filterEntries(allGivenEntries);
  const takenEntries = filterEntries(allTakenEntries);
  const isLoading    = isLoadingGiven || isLoadingTaken;

  const totalGiven = givenEntries.filter(e => !e.is_settled).reduce((s, e) => s + e.amount, 0);
  const totalTaken = takenEntries.filter(e => !e.is_settled).reduce((s, e) => s + e.amount, 0);
  const netBalance = totalGiven - totalTaken;

  const handleSettleUdhar = async (entry: UdharEntry) => {
    if (!user) return;
    await saveUdharEntry(user.id, { ...entry, is_settled: !entry.is_settled, updated_at: new Date().toISOString() });
    invalidate(entry.type);
    toast({ title: entry.is_settled ? "Marked unsettled" : "Marked settled!" });
  };

  const handleWhatsApp = (name: string, amount: number, type: 'given' | 'taken', phone: string) => {
    const template = type === 'given' ? givenTemplate : takenTemplate;
    window.open(`https://wa.me/${phone.replace(/\D/g, '')}?text=${encodeURIComponent(buildMessage(template, name, amount, type))}`, '_blank');
  };

  const handleEditUdhar    = (entry: UdharEntry) => { setEditingUdharEntry(entry); setCurrentUdharType(entry.type); setShowAddUdharDialog(true); };
  const handleAddUdharClick = (type: 'given' | 'taken') => { setEditingUdharEntry(null); setCurrentUdharType(type); setShowAddUdharDialog(true); };
  const handleDeleteUdhar  = async (id: string, name: string, type: 'given' | 'taken') => {
    if (!user) return;
    await deleteUdharEntry(id);
    invalidate(type);
    toast({ title: "Deleted", description: `Entry for ${name} removed.` });
  };

  const handleSaveUdhar = async (data: {
    id?: string; personName?: string; lenderName?: string;
    amount: number; dueDate: Date; phoneNumber: string;
    description: string; type: 'given' | 'taken';
  }) => {
    if (!user) return;
    await saveUdharEntry(user.id, {
      id: data.id, type: data.type,
      person_name: data.personName || null, lender_name: data.lenderName || null,
      amount: data.amount, due_date: data.dueDate.toISOString(),
      is_settled: data.id ? editingUdharEntry?.is_settled : false,
      phone_number: data.phoneNumber, description: data.description || null,
    });
    invalidate(data.type);
    toast({ title: "Saved!", description: `Entry ${data.id ? "updated" : "added"}.` });
    setShowAddUdharDialog(false);
    setEditingUdharEntry(null);
  };

  return (
    <AppLayout>
      <div className="space-y-4 pt-6 md:pt-0 pb-6">

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
          <div className="flex items-center gap-2 shrink-0">
            <Popover open={monthPickerOpen} onOpenChange={setMonthPickerOpen}>
              <PopoverTrigger asChild>
                <Button variant="outline" size="sm"
                  className={cn("h-9 text-xs gap-1.5 rounded-xl border-border/60",
                    selectedMonth && "border-primary/40 bg-primary/5 text-primary")}>
                  <CalendarIcon className="h-3.5 w-3.5" />
                  {selectedMonth ? format(new Date(selectedMonth.year, selectedMonth.month, 1), "MMM yyyy") : "All Months"}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-64 p-3 bg-card border border-border shadow-lg z-50" align="end">
                <MonthYearPicker selected={selectedMonth}
                  onSelect={val => { setSelectedMonth(val); setMonthPickerOpen(false); }} />
              </PopoverContent>
            </Popover>
            <button onClick={() => setShowMsgSheet(true)}
              className="text-[10px] text-muted-foreground hover:text-primary transition-colors pointer-events-auto">
              Customise message
            </button>
          </div>
        </div>

        {/* Summary */}
        <GlassCard className="p-4" hover={false}>
          <div className="flex gap-3 mb-3">
            <SummaryPill label="You'll Receive" amount={totalGiven}
              count={givenEntries.filter(e => !e.is_settled).length} icon={TrendingUp} accent="bg-blue-50/80 border-blue-200/60" />
            <SummaryPill label="You Owe" amount={totalTaken}
              count={takenEntries.filter(e => !e.is_settled).length} icon={TrendingDown} accent="bg-rose-50/80 border-rose-200/60" />
          </div>
          <div className={cn("rounded-xl p-3 flex items-center justify-between",
            netBalance >= 0 ? "bg-emerald-50 border border-emerald-200/60" : "bg-orange-50 border border-orange-200/60")}>
            <span className="text-xs font-medium text-muted-foreground">Net Balance</span>
            <div className="flex items-center gap-1.5">
              <IndianRupee className={cn("h-3.5 w-3.5", netBalance >= 0 ? "text-emerald-600" : "text-orange-600")} />
              <span className={cn("text-sm font-bold", netBalance >= 0 ? "text-emerald-700" : "text-orange-700")}>
                {formatFullINR(Math.abs(netBalance))}
              </span>
              <Badge variant="outline" className={cn("text-[9px] font-semibold border-0 px-1.5 py-0",
                netBalance >= 0 ? "bg-emerald-100 text-emerald-700" : "bg-orange-100 text-orange-700")}>
                {netBalance >= 0 ? "in your favor" : "you owe more"}
              </Badge>
            </div>
          </div>
        </GlassCard>

        {/* Sections */}
        <UdharSection type="given" entries={givenEntries} isLoading={isLoading}
          onAdd={() => handleAddUdharClick('given')} onPaymentLogged={invalidateBoth}
          onSettle={handleSettleUdhar} onWhatsApp={handleWhatsApp}
          onEdit={handleEditUdhar} onDelete={handleDeleteUdhar} />

        <UdharSection type="taken" entries={takenEntries} isLoading={isLoading}
          onAdd={() => handleAddUdharClick('taken')} onPaymentLogged={invalidateBoth}
          onSettle={handleSettleUdhar} onWhatsApp={handleWhatsApp}
          onEdit={handleEditUdhar} onDelete={handleDeleteUdhar} />

      </div>

      {/* Dialogs */}
      <AddUdharDialog
        isOpen={showAddUdharDialog}
        onClose={() => { setShowAddUdharDialog(false); setEditingUdharEntry(null); }}
        onSave={handleSaveUdhar}
        onSaveMultiple={async (entries) => {
          if (!user) return;
          for (const entry of entries) await handleSaveUdhar(entry);
          setShowAddUdharDialog(false);
          toast({ title: `${entries.length} entries created!` });
        }}
        type={currentUdharType}
        initialData={editingUdharEntry ? {
          id: editingUdharEntry.id,
          personName: editingUdharEntry.person_name || undefined,
          lenderName: editingUdharEntry.lender_name || undefined,
          amount: editingUdharEntry.amount,
          dueDate: new Date(editingUdharEntry.due_date),
          phoneNumber: editingUdharEntry.phone_number,
          description: editingUdharEntry.description || undefined,
          type: editingUdharEntry.type,
        } : undefined}
      />

      <MessageTemplateSheet open={showMsgSheet} onClose={() => setShowMsgSheet(false)}
        givenTemplate={givenTemplate} takenTemplate={takenTemplate} onSave={handleSaveTemplates} />

    </AppLayout>
  );
};

// ─── Error Boundary ───────────────────────────────────────────────────────────
class UdharErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { hasError: boolean; error: string }
> {
  constructor(props: any) { super(props); this.state = { hasError: false, error: '' }; }
  static getDerivedStateFromError(error: Error) { return { hasError: true, error: error.message }; }
  render() {
    if (this.state.hasError) return (
      <AppLayout>
        <div className="flex flex-col items-center justify-center h-64 gap-4 p-6 text-center">
          <HandCoins className="h-10 w-10 text-muted-foreground" />
          <p className="text-base font-medium text-foreground">Something went wrong</p>
          <p className="text-sm text-muted-foreground">{this.state.error}</p>
          <Button onClick={() => this.setState({ hasError: false, error: '' })}>Try Again</Button>
        </div>
      </AppLayout>
    );
    return this.props.children;
  }
}

const UdharTrackerWithBoundary: React.FC = () => (
  <UdharErrorBoundary><UdharTracker /></UdharErrorBoundary>
);

export default UdharTrackerWithBoundary;
