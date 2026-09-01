import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { App } from '@capacitor/app';
import { getLaunchPaymentId, paymentCaptureAvailable } from '@/lib/paymentCapture/native';

export function usePaymentCaptureNavigation(): void {
  const navigate = useNavigate();

  useEffect(() => {
    if (!paymentCaptureAvailable()) return;
    let active = true;

    const openCapturedPayment = async () => {
      try {
        const id = await getLaunchPaymentId();
        if (active && id) navigate(`/expenses?capturePayment=${encodeURIComponent(id)}`);
      } catch (error) {
        console.warn('[PaymentCapture] Could not read notification launch', error);
      }
    };

    void openCapturedPayment();
    const listener = App.addListener('appStateChange', ({ isActive }) => {
      if (isActive) void openCapturedPayment();
    });

    return () => {
      active = false;
      void listener.then(handle => handle.remove());
    };
  }, [navigate]);
}
