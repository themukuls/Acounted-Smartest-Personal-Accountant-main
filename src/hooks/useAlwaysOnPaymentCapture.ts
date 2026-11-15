import { useEffect } from 'react';
import { LocalNotifications } from '@capacitor/local-notifications';
import {
  getPaymentCaptureStatus,
  paymentCaptureAvailable,
  requestPaymentSmsPermission,
  setPaymentCaptureEnabled,
} from '@/lib/paymentCapture/native';

/**
 * Establishes the product invariant that payment capture is always enabled.
 * Android owns the actual permissions, so a user can still deny them at OS
 * level; when permission is undecided we request it once through Android.
 */
export function useAlwaysOnPaymentCapture(): void {
  useEffect(() => {
    if (!paymentCaptureAvailable()) return;
    let active = true;

    const initialise = async () => {
      try {
        await setPaymentCaptureEnabled(true);
        await requestPaymentSmsPermission();
        const permission = await LocalNotifications.checkPermissions();
        if (active && (permission.display === 'prompt' || permission.display === 'prompt-with-rationale')) {
          await LocalNotifications.requestPermissions();
        }
        if (active) await getPaymentCaptureStatus();
      } catch (error) {
        console.warn('[PaymentCapture] Could not initialise always-on capture', error);
      }
    };

    void initialise();
    return () => { active = false; };
  }, []);
}
