import { ChevronRight, ReceiptText } from 'lucide-react';

export function PaymentReconciliationBanner({ count, onClick }: { count: number; onClick: () => void }) {
  if (!count) return null;
  return (
    <button type="button" onClick={onClick} className="pointer-events-auto flex h-10 w-full items-center gap-2 rounded-xl border border-amber-300/70 bg-amber-50 px-3 text-left text-amber-950 shadow-sm">
      <ReceiptText className="h-4 w-4 shrink-0 text-amber-600" />
      <span className="flex-1 text-xs font-bold">{count} {count === 1 ? 'payment' : 'payments'} to review</span>
      <span className="text-[10px] font-semibold text-amber-700">Reconcile</span>
      <ChevronRight className="h-3.5 w-3.5 text-amber-600" />
    </button>
  );
}
