import type { MyDB } from '../db';
import { getAllByIndex, get, put, remove } from '@/integrations/storage/repository';
import { v4 as uuidv4 } from 'uuid';
import { convertToIST } from '@/lib/date-utils';

export type UdharEntry   = MyDB['udhar_entries']['value'];
export type UdharPayment = UdharEntry['payments'][0];

export interface UdharSourceTransaction {
  id: string;
  amount: number;
  description: string | null;
  transaction_date: string;
}

// ── Safe defaults for entries that pre-date payment tracking ──────────────────
// Old entries won't have payments/amount_paid — add safe defaults so nothing breaks
function withDefaults(entry: UdharEntry): UdharEntry {
  return {
    ...entry,
    payments:    (entry as any).payments    ?? [],
    amount_paid: (entry as any).amount_paid ?? 0,
    source: (entry as any).source ?? 'manual',
    needs_details: (entry as any).needs_details ?? false,
  };
}

export function udharEntryIdForTransaction(transactionId: string): string {
  return `udhar-transaction::${transactionId}`;
}

/**
 * Creates (or returns) the single Lendr draft belonging to an expense.
 * The deterministic id makes retries, captured-payment reconciliation and
 * double taps safe: one ledger transaction always maps to one Lendr record.
 */
export async function ensureUdharDraftForTransaction(
  userId: string,
  transaction: UdharSourceTransaction,
): Promise<UdharEntry> {
  const id = udharEntryIdForTransaction(transaction.id);
  const existing = await get<UdharEntry>('udhar_entries', id);
  if (existing) return withDefaults(existing);

  const borrowedOn = new Date(transaction.transaction_date);
  const dueDate = new Date(borrowedOn);
  dueDate.setDate(dueDate.getDate() + 7);
  const now = new Date().toISOString();
  const draft: UdharEntry = {
    id,
    user_id: userId,
    type: 'given',
    person_name: null,
    lender_name: null,
    amount: transaction.amount,
    due_date: dueDate.toISOString(),
    is_settled: false,
    phone_number: '',
    description: transaction.description || null,
    source_transaction_id: transaction.id,
    source: 'expense',
    needs_details: true,
    payments: [],
    amount_paid: 0,
    created_at: now,
    updated_at: now,
  };
  await put('udhar_entries', draft);
  return draft;
}

/**
 * Fetches Udhar entries for a user, optionally filtered by type and date range, from IndexedDB.
 */
export async function getUdharEntries(
  userId: string,
  type?: 'given' | 'taken',
  startDate?: string,
  endDate?: string,
): Promise<UdharEntry[]> {
  const all = await getAllByIndex<UdharEntry>('udhar_entries', 'user_id', userId);

  let entries = all.map(withDefaults);

  if (type) entries = entries.filter(e => e.type === type);

  if (startDate && endDate) {
    const s = convertToIST(startDate), end = convertToIST(endDate);
    entries = entries.filter(e => {
      const d = convertToIST(e.due_date);
      return d >= s && d <= end;
    });
  } else if (startDate) {
    const s = convertToIST(startDate);
    entries = entries.filter(e => convertToIST(e.due_date) >= s);
  }

  return entries.sort((a, b) => {
    const dA = convertToIST(a.due_date).getTime();
    const dB = convertToIST(b.due_date).getTime();
    if (dA !== dB) return dA - dB;
    return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
  });
}

/**
 * Saves or updates an Udhar entry for a specific user in IndexedDB.
 */
export async function saveUdharEntry(
  userId: string,
  entry: Partial<UdharEntry> & { id?: string },
): Promise<UdharEntry> {
  const now = new Date().toISOString();

  const safeAmount = typeof entry.amount === 'number' && !isNaN(entry.amount) ? entry.amount : 0;

  let recordToSave: UdharEntry;

  if (entry.id) {
    const existing = await get<UdharEntry>('udhar_entries', entry.id);
    if (existing) {
      recordToSave = {
        ...withDefaults(existing),
        ...entry,
        amount:     safeAmount,
        user_id:    userId,
        updated_at: now,
      };
      await put('udhar_entries', recordToSave);
    } else {
      recordToSave = {
        id:           uuidv4(),
        user_id:      userId,
        created_at:   now,
        updated_at:   now,
        type:         entry.type        || 'given',
        person_name:  entry.person_name || null,
        lender_name:  entry.lender_name || null,
        amount:       safeAmount,
        due_date:     entry.due_date    || now,
        is_settled:   entry.is_settled  || false,
        phone_number: entry.phone_number || '',
        description:  entry.description || null,
        payments:     [],
        amount_paid:  0,
        ...(Object.fromEntries(
          Object.entries(entry).filter(([key]) => key !== 'id'),
        ) as Partial<UdharEntry>),
      };
      await put('udhar_entries', recordToSave);
    }
  } else {
    recordToSave = {
      id:           uuidv4(),
      user_id:      userId,
      created_at:   now,
      updated_at:   now,
      type:         entry.type        || 'given',
      person_name:  entry.person_name || null,
      lender_name:  entry.lender_name || null,
      amount:       safeAmount,
      due_date:     entry.due_date    || now,
      is_settled:   entry.is_settled  || false,
      phone_number: entry.phone_number || '',
      description:  entry.description || null,
      payments:     [],
      amount_paid:  0,
      ...(Object.fromEntries(
        Object.entries(entry).filter(([key]) => key !== 'id'),
      ) as Partial<UdharEntry>),
    };
    await put('udhar_entries', recordToSave);
  }

  return recordToSave;
}

/**
 * Deletes an Udhar entry from IndexedDB.
 */
export async function deleteUdharEntry(id: string): Promise<void> {
  await remove('udhar_entries', id);
}

// ── Partial payment functions ─────────────────────────────────────────────────

/**
 * Logs a partial payment against an Udhar entry.
 * Automatically marks as settled when outstanding reaches zero.
 * Caps payment at outstanding amount — no overpayments.
 */
export async function logPayment(
  entryId: string,
  payment: { amount: number; date: string; note: string },
): Promise<UdharEntry | null> {
  const entry = await get<UdharEntry>('udhar_entries', entryId);
  if (!entry) { return null; }

  const safe        = withDefaults(entry);
  const outstanding = safe.amount - safe.amount_paid;
  if (!Number.isFinite(payment.amount) || payment.amount <= 0 || outstanding <= 0) return safe;
  const cappedAmt   = Math.min(payment.amount, outstanding);

  const newPayment: UdharPayment = {
    id:     uuidv4(),
    amount: cappedAmt,
    date:   payment.date,
    note:   payment.note,
  };

  const newAmountPaid = safe.amount_paid + cappedAmt;
  const updated: UdharEntry = {
    ...safe,
    payments:    [...safe.payments, newPayment],
    amount_paid: newAmountPaid,
    is_settled:  newAmountPaid >= safe.amount,
    updated_at:  new Date().toISOString(),
  };

  await put('udhar_entries', updated);
  return updated;
}

/**
 * Deletes a specific payment from an Udhar entry.
 * Recalculates amount_paid and is_settled automatically.
 */
export async function deletePayment(
  entryId: string,
  paymentId: string,
): Promise<UdharEntry | null> {
  const entry = await get<UdharEntry>('udhar_entries', entryId);
  if (!entry) { return null; }

  const safe        = withDefaults(entry);
  const newPayments = safe.payments.filter(p => p.id !== paymentId);
  const newPaid     = newPayments.reduce((s, p) => s + p.amount, 0);

  const updated: UdharEntry = {
    ...safe,
    payments:    newPayments,
    amount_paid: newPaid,
    is_settled:  newPaid >= safe.amount,
    updated_at:  new Date().toISOString(),
  };

  await put('udhar_entries', updated);
  return updated;
}

/**
 * Marks an entry as fully settled or unsettled without adding a payment record.
 * When settling, sets amount_paid to full amount for consistency.
 */
export async function markSettled(
  entryId: string,
  settled: boolean,
): Promise<void> {
  const entry = await get<UdharEntry>('udhar_entries', entryId);
  if (!entry) { return; }

  const safe = withDefaults(entry);
  const paidFromLedger = safe.payments.reduce((sum, payment) => sum + payment.amount, 0);
  await put('udhar_entries', {
    ...safe,
    is_settled:  settled,
    amount_paid: settled ? safe.amount : paidFromLedger,
    updated_at:  new Date().toISOString(),
  });
}

// ── Computed helpers ──────────────────────────────────────────────────────────

/** Outstanding amount remaining to be paid */
export function getOutstanding(entry: UdharEntry): number {
  const paid = (entry as any).amount_paid ?? 0;
  return Math.max(0, entry.amount - paid);
}

/** Percentage of the original amount that has been paid (0–100) */
export function getProgressPercent(entry: UdharEntry): number {
  if (entry.amount <= 0) return 0;
  const paid = (entry as any).amount_paid ?? 0;
  return Math.min(100, Math.round((paid / entry.amount) * 100));
}
