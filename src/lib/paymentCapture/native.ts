import { Capacitor, registerPlugin } from '@capacitor/core';

export interface PendingPayment {
  id: string;
  amount: string;
  merchant: string | null;
  occurredAt: number;
  reference: string | null;
  source: string;
  appName: string;
  sourcePackage: string;
  status: 'pending' | 'later';
  remindAt?: number;
}

export interface PaymentCaptureStatus {
  enabled: boolean;
  notificationAccessGranted: boolean;
  notificationsGranted: boolean;
  pendingCount: number;
}

interface PaymentCapturePlugin {
  getStatus(): Promise<PaymentCaptureStatus>;
  setEnabled(options: { enabled: boolean }): Promise<void>;
  openNotificationAccessSettings(): Promise<void>;
  listPending(): Promise<{ payments: PendingPayment[] }>;
  getPending(options: { id: string }): Promise<{ payment: PendingPayment | null }>;
  complete(options: { id: string }): Promise<void>;
  skip(options: { id: string }): Promise<void>;
  snooze(options: { id: string }): Promise<{ remindAt: number }>;
  getLaunchPayment(): Promise<{ id: string | null }>;
}

const NativePaymentCapture = registerPlugin<PaymentCapturePlugin>('PaymentCapture');

export const SUPPORTED_PAYMENT_APPS = [
  'Paytm',
  'Google Pay',
  'PhonePe',
  'BHIM',
  'CRED',
  'MobiKwik',
  'Freecharge',
  'super.money',
] as const;

export const paymentCaptureAvailable = () => Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'android';

export const getPaymentCaptureStatus = async (): Promise<PaymentCaptureStatus> => {
  if (!paymentCaptureAvailable()) {
    return { enabled: false, notificationAccessGranted: false, notificationsGranted: false, pendingCount: 0 };
  }
  return NativePaymentCapture.getStatus();
};

export const setPaymentCaptureEnabled = (enabled: boolean) => NativePaymentCapture.setEnabled({ enabled });
export const openPaymentNotificationAccess = () => NativePaymentCapture.openNotificationAccessSettings();
export const listPendingPayments = async () => (await NativePaymentCapture.listPending()).payments;
export const getPendingPayment = async (id: string) => (await NativePaymentCapture.getPending({ id })).payment;
export const completePendingPayment = (id: string) => NativePaymentCapture.complete({ id });
export const skipPendingPayment = (id: string) => NativePaymentCapture.skip({ id });
export const snoozePendingPayment = (id: string) => NativePaymentCapture.snooze({ id });
export const getLaunchPaymentId = async () => (await NativePaymentCapture.getLaunchPayment()).id;
