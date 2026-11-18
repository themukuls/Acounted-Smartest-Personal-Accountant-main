import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import type { MyDB } from '../db';
import type { PendingPayment } from '@/lib/paymentCapture/native';
import { setAdapter } from '@/integrations/storage/adapter';
import { createMemoryAdapter } from '@/integrations/storage/memoryAdapter';
import { getAll, resetCache } from '@/integrations/storage/repository';
import { capturedTransactionId, isSameCapturedPayment, normaliseCapturedMerchant, saveCapturedPaymentTransaction } from './capturedPaymentService';

beforeEach(() => {
  setAdapter(createMemoryAdapter());
  resetCache();
});

afterEach(() => {
  resetCache();
  setAdapter(null);
});

const existing = (overrides: Partial<MyDB['transactions']['value']> = {}): MyDB['transactions']['value'] => ({
  id: 'captured-payment::u1::p1', user_id: 'u1', type: 'expense', amount: 141,
  category: 'food', account: 'upi', description: 'Lunch',
  transaction_date: '2026-11-18T06:00:00.000Z', created_at: '2026-11-18T06:01:00.000Z',
  updated_at: '2026-11-18T06:01:00.000Z', capture_payment_id: 'p1',
  capture_reference: null, capture_merchant: 'Office Canteen', capture_source: 'paytm',
  ...overrides,
});

const payment = (overrides: Partial<PendingPayment> = {}): PendingPayment => ({
  id: 'p2', amount: '141', merchant: '78abc@ybl', occurredAt: Date.parse('2026-11-18T06:03:00.000Z'),
  reference: '456789123456', source: 'bank_sms', appName: 'Bank SMS',
  sourcePackage: 'sms:bank', status: 'pending', ...overrides,
});

describe('captured payment idempotency', () => {
  test('uses a deterministic ledger primary key for retries', () => {
    expect(capturedTransactionId('u1', 'p1')).toBe('captured-payment::u1::p1');
  });

  test('recognises app notification plus bank SMS as one payment', () => {
    expect(isSameCapturedPayment(existing(), payment())).toBeTrue();
  });

  test('never merges different bank references', () => {
    expect(isSameCapturedPayment(
      existing({ capture_reference: '111111111111', capture_source: 'bank_sms' }),
      payment({ reference: '222222222222' }),
    )).toBeFalse();
  });

  test('manual expenses never participate in capture deduplication', () => {
    expect(isSameCapturedPayment(existing({ capture_payment_id: undefined }), payment())).toBeFalse();
  });

  test('normalises equivalent VPA formatting', () => {
    expect(normaliseCapturedMerchant('VPA: 78ABC@YBL')).toBe('78abc@ybl');
  });

  test('retrying one captured payment creates exactly one ledger row', async () => {
    const captured = payment({ id: 'same-pending-id' });
    const details = { category: 'food', account: 'upi', description: 'Lunch' };
    await Promise.all([
      saveCapturedPaymentTransaction('u1', captured, details),
      saveCapturedPaymentTransaction('u1', captured, details),
    ]);

    const rows = await getAll<MyDB['transactions']['value']>('transactions');
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe(capturedTransactionId('u1', 'same-pending-id'));
  });

  test('a second app/SMS capture resolves to the existing ledger row', async () => {
    await saveCapturedPaymentTransaction('u1', payment({
      id: 'app-capture', reference: null, source: 'paytm', merchant: 'Office Canteen',
      occurredAt: Date.parse('2026-11-18T06:00:00.000Z'),
    }), { category: 'food', account: 'upi', description: 'Lunch' });
    const result = await saveCapturedPaymentTransaction('u1', payment({ id: 'sms-capture' }), {
      category: 'food', account: 'upi', description: 'Payment to 78abc@ybl',
    });

    expect(result.created).toBeFalse();
    expect(await getAll('transactions')).toHaveLength(1);
  });
});
