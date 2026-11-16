import { describe, expect, test } from 'bun:test';
import { normalisePaymentMerchant, paymentMerchantKey } from './paymentMerchantService';

describe('payment merchant identity', () => {
  test('uses the same stable key for a VPA from an app and an SMS', () => {
    expect(paymentMerchantKey({ merchant: '78***@ybl', sourcePackage: 'net.one97.paytm' }))
      .toBe('vpa::78***@ybl');
    expect(paymentMerchantKey({ merchant: 'Paid to 78***@ybl', sourcePackage: 'sms:ad-hdfcbk' }))
      .toBe('vpa::78***@ybl');
  });

  test('normalises casing without destroying masked VPA characters', () => {
    expect(normalisePaymentMerchant('  78***@YBL  ')).toBe('78***@ybl');
  });

  test('keeps merchant-name fallback scoped to its source', () => {
    expect(paymentMerchantKey({ merchant: 'Office Canteen', sourcePackage: 'com.phonepe.app' }))
      .toBe('merchant::com.phonepe.app::office canteen');
  });
});
