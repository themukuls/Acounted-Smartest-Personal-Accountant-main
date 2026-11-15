import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { LocalNotifications } from '@capacitor/local-notifications';
import { App } from '@capacitor/app';
import { CheckCircle2, Clock3, RefreshCw, ShieldCheck, Smartphone, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { formatFullINR } from '@/lib/currency';
import {
  getPaymentCaptureStatus,
  listPendingPayments,
  openPaymentNotificationAccess,
  paymentCaptureAvailable,
  requestPaymentSmsPermission,
  skipPendingPayment,
  snoozePendingPayment,
  SUPPORTED_PAYMENT_APPS,
  type PaymentCaptureStatus,
  type PendingPayment,
} from '@/lib/paymentCapture/native';

interface PaymentCaptureSettingsProps {
  onClose: () => void;
}

const EMPTY_STATUS: PaymentCaptureStatus = {
  enabled: false,
  notificationAccessGranted: false,
  notificationsGranted: false,
  smsGranted: false,
  pendingCount: 0,
  lastEventAt: 0,
  lastEventSource: '',
  lastEventResult: '',
};

export function PaymentCaptureSettings({ onClose }: PaymentCaptureSettingsProps) {
  const navigate = useNavigate();
  const available = paymentCaptureAvailable();
  const [status, setStatus] = useState(EMPTY_STATUS);
  const [payments, setPayments] = useState<PendingPayment[]>([]);
  const [loading, setLoading] = useState(available);

  const refresh = useCallback(async () => {
    if (!available) return;
    setLoading(true);
    try {
      const [nextStatus, nextPayments] = await Promise.all([
        getPaymentCaptureStatus(),
        listPendingPayments(),
      ]);
      setStatus(nextStatus);
      setPayments(nextPayments);
    } catch (error) {
      console.warn('[PaymentCapture] Could not load settings', error);
    } finally {
      setLoading(false);
    }
  }, [available]);

  useEffect(() => {
    void refresh();
    if (!available) return;
    const listener = App.addListener('appStateChange', ({ isActive }) => {
      if (isActive) void refresh();
    });
    return () => { void listener.then(handle => handle.remove()); };
  }, [available, refresh]);

  const requestNotificationPermission = async () => {
    try {
      await LocalNotifications.requestPermissions();
      await refresh();
    } catch (error) {
      console.warn('[PaymentCapture] Could not request notifications', error);
    }
  };

  const requestSmsPermission = async () => {
    try {
      await requestPaymentSmsPermission();
      await refresh();
    } catch (error) {
      console.warn('[PaymentCapture] Could not request SMS access', error);
    }
  };

  const review = (_id: string) => {
    onClose();
    navigate('/expenses?reviewPayments=1');
  };

  const later = async (id: string) => {
    await snoozePendingPayment(id);
    await refresh();
  };

  const skip = async (id: string) => {
    await skipPendingPayment(id);
    await refresh();
  };

  if (!available) {
    return (
      <div className="rounded-xl border border-border/50 bg-muted/30 p-4 text-center">
        <Smartphone className="mx-auto h-7 w-7 text-muted-foreground" />
        <p className="mt-2 text-sm font-semibold">Available in the Android app</p>
        <p className="mt-1 text-xs text-muted-foreground">Payment detection only runs locally on your phone.</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-border/50 bg-background/70 p-4 space-y-3">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-sm font-bold">Detect payment-app transactions</p>
            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
              After a supported app reports a successful payment, Acounted prepares a local expense draft with the amount and time.
            </p>
          </div>
          <span className="shrink-0 rounded-full bg-emerald-100 px-2.5 py-1 text-[10px] font-bold text-emerald-700">Always on</span>
        </div>

        <div className="space-y-2 rounded-lg bg-muted/40 p-3">
            <div className="flex items-center gap-2 text-xs">
              {status.notificationAccessGranted
                ? <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                : <ShieldCheck className="h-4 w-4 text-amber-600" />}
              <span>{status.notificationAccessGranted ? 'Payment notification access is active' : 'Android notification access is still needed'}</span>
            </div>
            <div className="flex items-center gap-2 text-xs">
              {status.smsGranted
                ? <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                : <ShieldCheck className="h-4 w-4 text-amber-600" />}
              <span>{status.smsGranted ? 'Transaction SMS capture is active' : 'SMS access is still needed'}</span>
            </div>
            {!status.notificationAccessGranted && (
              <Button size="sm" className="w-full" onClick={() => void openPaymentNotificationAccess()}>
                Allow payment notification access
              </Button>
            )}
            {!status.notificationsGranted && (
              <div className="space-y-2">
                <p className="text-[11px] text-amber-700">Allow Acounted notifications so captured payments always appear as prompts.</p>
                <Button size="sm" variant="outline" className="w-full" onClick={() => void requestNotificationPermission()}>
                  Allow Acounted notifications
                </Button>
              </div>
            )}
            {!status.smsGranted && (
              <Button size="sm" variant="outline" className="w-full" onClick={() => void requestSmsPermission()}>
                Allow transaction SMS access
              </Button>
            )}
            {status.lastEventAt > 0 && (
              <div className="rounded-lg border border-border/40 bg-background/60 px-2.5 py-2">
                <p className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground">Last capture check</p>
                <p className="mt-0.5 text-[11px] font-semibold text-foreground">{status.lastEventResult}</p>
                <p className="text-[10px] text-muted-foreground">{status.lastEventSource} · {new Date(status.lastEventAt).toLocaleString()}</p>
              </div>
            )}
            <button type="button" onClick={() => void refresh()} className="flex items-center gap-1 text-[11px] font-semibold text-primary">
              <RefreshCw className={loading ? 'h-3 w-3 animate-spin' : 'h-3 w-3'} /> Refresh status
            </button>
          </div>

        <div>
          <p className="mb-1.5 text-[10px] font-bold uppercase tracking-wide text-muted-foreground">Supported apps</p>
          <div className="flex flex-wrap gap-1.5">
            {SUPPORTED_PAYMENT_APPS.map(app => (
              <span key={app} className="rounded-full border border-border/50 bg-muted/40 px-2 py-1 text-[10px] font-semibold text-foreground/80">
                {app}
              </span>
            ))}
            <span className="rounded-full border border-border/50 bg-muted/40 px-2 py-1 text-[10px] font-semibold text-foreground/80">Bank transaction SMS</span>
          </div>
        </div>
      </div>

      <div>
        <div className="mb-2 flex items-center justify-between">
          <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground">Waiting for review</p>
          {payments.length > 0 && <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-bold text-primary">{payments.length}</span>}
        </div>
        {payments.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border/60 py-8 text-center">
            <CheckCircle2 className="mx-auto h-6 w-6 text-emerald-600/70" />
            <p className="mt-2 text-xs font-semibold">No uncategorised app payments</p>
          </div>
        ) : (
          <div className="space-y-2">
            {payments.map(payment => (
              <div key={payment.id} className="rounded-xl border border-border/50 bg-background/70 p-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm font-black">{formatFullINR(Number(payment.amount))}</p>
                    <p className="truncate text-xs text-muted-foreground">{payment.merchant || `${payment.appName} payment`}</p>
                    <p className="text-[10px] font-semibold text-primary/80">{payment.appName}</p>
                    <p className="mt-1 text-[10px] text-muted-foreground">{new Date(payment.occurredAt).toLocaleString()}</p>
                  </div>
                  <Button size="sm" onClick={() => review(payment.id)}>Review</Button>
                </div>
                <div className="mt-2 flex gap-3 border-t border-border/40 pt-2">
                  <button type="button" onClick={() => void later(payment.id)} className="flex items-center gap-1 text-[11px] font-semibold text-muted-foreground hover:text-primary">
                    <Clock3 className="h-3 w-3" /> Remind later
                  </button>
                  <button type="button" onClick={() => void skip(payment.id)} className="flex items-center gap-1 text-[11px] font-semibold text-muted-foreground hover:text-destructive">
                    <Trash2 className="h-3 w-3" /> Not an expense
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <p className="text-[10px] leading-relaxed text-muted-foreground">
        Private by design: automatic capture stays on, but Android requires Notification Access and SMS permission once. Acounted immediately discards OTPs, personal messages and non-payment notifications. Only extracted payment details stay on this phone; raw messages are never stored or uploaded.
      </p>
    </div>
  );
}
