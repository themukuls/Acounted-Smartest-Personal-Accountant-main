import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { LocalNotifications } from '@capacitor/local-notifications';
import { App } from '@capacitor/app';
import { CheckCircle2, Clock3, RefreshCw, ShieldCheck, Smartphone, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { formatFullINR } from '@/lib/currency';
import {
  getPaymentCaptureStatus,
  listPendingPayments,
  openPaymentNotificationAccess,
  paymentCaptureAvailable,
  setPaymentCaptureEnabled,
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
  pendingCount: 0,
};

export function PaymentCaptureSettings({ onClose }: PaymentCaptureSettingsProps) {
  const navigate = useNavigate();
  const available = paymentCaptureAvailable();
  const [status, setStatus] = useState(EMPTY_STATUS);
  const [payments, setPayments] = useState<PendingPayment[]>([]);
  const [loading, setLoading] = useState(available);
  const [showDisclosure, setShowDisclosure] = useState(false);

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

  const enable = async () => {
    try {
      await LocalNotifications.requestPermissions();
      await setPaymentCaptureEnabled(true);
      setShowDisclosure(false);
      if (!status.notificationAccessGranted) await openPaymentNotificationAccess();
      await refresh();
    } catch (error) {
      console.warn('[PaymentCapture] Could not enable detection', error);
    }
  };

  const disable = async () => {
    await setPaymentCaptureEnabled(false);
    await refresh();
  };

  const review = (id: string) => {
    onClose();
    navigate(`/expenses?capturePayment=${encodeURIComponent(id)}`);
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
          <Switch
            checked={status.enabled}
            onCheckedChange={checked => checked ? setShowDisclosure(true) : void disable()}
            aria-label="Detect payment app transactions"
          />
        </div>

        {status.enabled && (
          <div className="space-y-2 rounded-lg bg-muted/40 p-3">
            <div className="flex items-center gap-2 text-xs">
              {status.notificationAccessGranted
                ? <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                : <ShieldCheck className="h-4 w-4 text-amber-600" />}
              <span>{status.notificationAccessGranted ? 'Payment notification access is active' : 'Android notification access is still needed'}</span>
            </div>
            {!status.notificationAccessGranted && (
              <Button size="sm" className="w-full" onClick={() => void openPaymentNotificationAccess()}>
                Open Android settings
              </Button>
            )}
            {!status.notificationsGranted && (
              <p className="text-[11px] text-amber-700">Allow Acounted notifications too, otherwise drafts are saved but prompts cannot appear.</p>
            )}
            <button type="button" onClick={() => void refresh()} className="flex items-center gap-1 text-[11px] font-semibold text-primary">
              <RefreshCw className={loading ? 'h-3 w-3 animate-spin' : 'h-3 w-3'} /> Refresh status
            </button>
          </div>
        )}

        <div>
          <p className="mb-1.5 text-[10px] font-bold uppercase tracking-wide text-muted-foreground">Supported apps</p>
          <div className="flex flex-wrap gap-1.5">
            {SUPPORTED_PAYMENT_APPS.map(app => (
              <span key={app} className="rounded-full border border-border/50 bg-muted/40 px-2 py-1 text-[10px] font-semibold text-foreground/80">
                {app}
              </span>
            ))}
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
        Private by design: Acounted checks notifications only from the supported payment apps after you enable Android Notification Access. It stores only the extracted app, amount, merchant, reference and time inside Acounted on this phone. It does not read SMS, watch the screen, or upload this data.
      </p>

      <AlertDialog open={showDisclosure} onOpenChange={setShowDisclosure}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Allow payment-app detection?</AlertDialogTitle>
            <AlertDialogDescription className="space-y-2">
              <span className="block">Android will show a broad “Notification Access” permission because it cannot grant access to only one app.</span>
              <span className="block">Acounted discards notifications from unsupported apps and rejects incoming, failed, pending, refunded and promotional messages. Detection and storage stay on this phone.</span>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Not now</AlertDialogCancel>
            <AlertDialogAction onClick={() => void enable()}>Continue to Android settings</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
