import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { setAdapter } from '@/integrations/storage/adapter';
import { createMemoryAdapter } from '@/integrations/storage/memoryAdapter';
import { getAll, resetCache } from '@/integrations/storage/repository';
import {
  ensureUdharDraftForTransaction,
  getOutstanding,
  logPayment,
  markSettled,
  udharEntryIdForTransaction,
  type UdharEntry,
} from './udharService';

beforeEach(() => {
  setAdapter(createMemoryAdapter());
  resetCache();
});

afterEach(() => {
  resetCache();
  setAdapter(null);
});

const transaction = {
  id: 'expense-1',
  amount: 1_200,
  description: 'Dinner split',
  transaction_date: '2026-11-18T12:00:00.000Z',
};

describe('expense-linked Lendr records', () => {
  test('uses a deterministic id so retries never duplicate an entry', async () => {
    await Promise.all([
      ensureUdharDraftForTransaction('u1', transaction),
      ensureUdharDraftForTransaction('u1', transaction),
    ]);

    const rows = await getAll<UdharEntry>('udhar_entries');
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe(udharEntryIdForTransaction('expense-1'));
    expect(rows[0].source_transaction_id).toBe('expense-1');
    expect(rows[0].needs_details).toBeTrue();
  });

  test('prefills amount, note and a seven-day due date', async () => {
    const draft = await ensureUdharDraftForTransaction('u1', transaction);
    expect(draft.amount).toBe(1_200);
    expect(draft.description).toBe('Dinner split');
    expect(draft.due_date).toBe('2026-11-25T12:00:00.000Z');
  });
});

describe('settlement accounting', () => {
  test('unsettling a manually settled entry restores the payment-ledger balance', async () => {
    const draft = await ensureUdharDraftForTransaction('u1', transaction);
    await logPayment(draft.id, { amount: 200, date: transaction.transaction_date, note: 'Part payment' });
    await markSettled(draft.id, true);
    await markSettled(draft.id, false);

    const [entry] = await getAll<UdharEntry>('udhar_entries');
    expect(entry.amount_paid).toBe(200);
    expect(entry.is_settled).toBeFalse();
    expect(getOutstanding(entry)).toBe(1_000);
  });
});
