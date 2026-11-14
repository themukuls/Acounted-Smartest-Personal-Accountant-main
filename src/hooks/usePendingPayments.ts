import { useCallback, useEffect, useState } from 'react';
import { App } from '@capacitor/app';
import { listPendingPayments, paymentCaptureAvailable, type PendingPayment } from '@/lib/paymentCapture/native';

export function usePendingPayments() {
  const available = paymentCaptureAvailable();
  const [payments, setPayments] = useState<PendingPayment[]>([]);

  const refresh = useCallback(async () => {
    if (!available) { setPayments([]); return; }
    try { setPayments(await listPendingPayments()); }
    catch (error) { console.warn('[PaymentCapture] Could not load pending payments', error); }
  }, [available]);

  useEffect(() => {
    void refresh();
    if (!available) return;
    const resume = App.addListener('appStateChange', ({ isActive }) => { if (isActive) void refresh(); });
    window.addEventListener('focus', refresh);
    return () => { void resume.then(handle => handle.remove()); window.removeEventListener('focus', refresh); };
  }, [available, refresh]);

  return { payments, refresh, available };
}
