import { Check, Pencil, Trash2 } from 'lucide-react';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { formatFullINR } from '@/lib/currency';
import type { PendingPayment } from '@/lib/paymentCapture/native';
import type { PaymentMerchantMapping } from '@/integrations/indexeddb/services/paymentMerchantService';

export function PaymentReconciliationSheet({ open, onOpenChange, payments, mappings, onReview, onSave, onSkip }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  payments: PendingPayment[];
  mappings: Record<string, PaymentMerchantMapping | null>;
  onReview: (payment: PendingPayment) => void;
  onSave: (payment: PendingPayment, mapping: PaymentMerchantMapping) => void;
  onSkip: (payment: PendingPayment) => void;
}) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" className="max-h-[88vh] rounded-t-3xl px-4 pb-[calc(1rem+env(safe-area-inset-bottom))] pt-5">
        <SheetHeader className="pr-8 text-left">
          <SheetTitle>Payments to reconcile</SheetTitle>
          <SheetDescription>Confirm the details before each expense is added. Saved payees are pre-filled next time.</SheetDescription>
        </SheetHeader>
        <ScrollArea className="mt-4 max-h-[68vh] pr-2">
          <div className="space-y-2 pb-2">
            {payments.map(payment => {
              const mapping = mappings[payment.id];
              return (
                <div key={payment.id} className={`rounded-2xl border p-3 ${mapping ? 'border-emerald-200 bg-emerald-50/50' : 'border-amber-200 bg-amber-50/40'}`}>
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-bold">{payment.merchant || `${payment.appName} payment`}</p>
                      <p className="mt-0.5 text-[10px] text-muted-foreground">{new Date(payment.occurredAt).toLocaleString()} · {payment.appName}</p>
                    </div>
                    <p className="shrink-0 text-sm font-black">{formatFullINR(Number(payment.amount))}</p>
                  </div>
                  {mapping ? (
                    <div className="mt-2 flex flex-wrap gap-1.5 text-[10px] font-semibold text-emerald-800">
                      <span className="rounded-full bg-emerald-100 px-2 py-1">{mapping.category.replace(/-/g, ' ')}</span>
                      <span className="rounded-full bg-emerald-100 px-2 py-1">{mapping.account.replace(/-/g, ' ')}</span>
                      {mapping.note && <span className="max-w-full truncate rounded-full bg-emerald-100 px-2 py-1">{mapping.note}</span>}
                    </div>
                  ) : <p className="mt-2 text-[10px] font-semibold text-amber-700">Needs category confirmation</p>}
                  <div className="mt-3 flex items-center gap-2">
                    <button type="button" onClick={() => onSkip(payment)} className="mr-auto flex items-center gap-1 text-[11px] font-semibold text-muted-foreground hover:text-destructive"><Trash2 className="h-3 w-3" /> Not expense</button>
                    <Button size="sm" variant="outline" className="h-8 gap-1" onClick={() => onReview(payment)}><Pencil className="h-3 w-3" /> {mapping ? 'Edit' : 'Review'}</Button>
                    {mapping && <Button size="sm" className="h-8 gap-1 bg-emerald-600 hover:bg-emerald-700" onClick={() => onSave(payment, mapping)}><Check className="h-3 w-3" /> Done</Button>}
                  </div>
                </div>
              );
            })}
            {payments.length === 0 && <div className="py-12 text-center text-sm text-muted-foreground">All caught up.</div>}
          </div>
        </ScrollArea>
      </SheetContent>
    </Sheet>
  );
}
