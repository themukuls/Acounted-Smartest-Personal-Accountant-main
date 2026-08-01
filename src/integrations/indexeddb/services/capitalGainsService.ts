import type { MyDB } from '../db';
import { get, getAllByIndex, put, remove } from '@/integrations/storage/repository';
import { v4 as uuidv4 } from 'uuid';

type CapitalGainsEntry = MyDB['capital_gains_entries']['value'];

export async function getCapitalGainsEntries(userId: string, financialYear: string): Promise<CapitalGainsEntry[]> {
  const all = await getAllByIndex<CapitalGainsEntry>('capital_gains_entries', 'user_id', userId);
  return all.filter(r => r.financial_year === financialYear);
}

export async function addCapitalGainsEntry(
  userId: string,
  data: Omit<CapitalGainsEntry, 'id' | 'user_id' | 'created_at' | 'updated_at'>
): Promise<CapitalGainsEntry> {
  const now = new Date().toISOString();
  const record: CapitalGainsEntry = {
    id: uuidv4(),
    user_id: userId,
    ...data,
    created_at: now,
    updated_at: now,
  };
  await put('capital_gains_entries', record);
  return record;
}

export async function updateCapitalGainsEntry(
  id: string,
  data: Partial<CapitalGainsEntry>
): Promise<CapitalGainsEntry | null> {
  const existing = await get<CapitalGainsEntry>('capital_gains_entries', id);
  if (!existing) return null;
  const record = { ...existing, ...data, updated_at: new Date().toISOString() };
  await put('capital_gains_entries', record);
  return record;
}

export async function deleteCapitalGainsEntry(id: string): Promise<void> {
  await remove('capital_gains_entries', id);
}

// ─── Capital gains classification ────────────────────────────────────────────
// Holding periods — FY 2026-27 / Income Tax Act 2025 (unchanged from FY 2025-26):
//   Equity / equity MF : > 12 months → LTCG
//   Real estate        : > 24 months → LTCG
//   All other assets   : > 24 months → LTCG  (debt MF, gold, bonds)

export function classifyGain(
  assetType: string,
  purchaseDate: string,
  saleDate: string,
): 'LTCG' | 'STCG' {
  const purchase = new Date(purchaseDate);
  const sale     = new Date(saleDate);
  const monthsHeld =
    (sale.getFullYear() - purchase.getFullYear()) * 12 +
    (sale.getMonth() - purchase.getMonth());

  if (['equity', 'equity_mf'].includes(assetType)) {
    return monthsHeld > 12 ? 'LTCG' : 'STCG';
  }
  // Real estate, gold, debt MF, other: 24-month threshold
  return monthsHeld > 24 ? 'LTCG' : 'STCG';
}

// ─── Tax calculation — FY 2026-27 rates (confirmed unchanged, Budget 2026) ───
// Rates:
//   Equity STCG  (Sec 111A)  : 20%
//   Equity LTCG  (Sec 112A)  : 12.5% on gains above ₹1.25 L/year (exemption tracks cumulative)
//   Other  LTCG  (Sec 112)   : 12.5% without indexation (post Jul 23 2024 transfers)
//   Other  STCG              : at slab rate — returned as 0 here (caller adds to slab income)
//   4% Health & Education cess applied on all flat-rate gains tax
//
// Note: 87A rebate does NOT apply to capital gains taxed at special flat rates.

const CESS = 0.04;
const EQUITY_LTCG_EXEMPT = 125000; // ₹1.25 L annual exemption

export function calcCapitalGainsTax(
  gainType: 'LTCG' | 'STCG',
  assetType: string,
  gainAmount: number,
  ltcgCumulative = 0, // total equity LTCG already counted this year (for ₹1.25 L exemption tracking)
): number {
  if (gainAmount <= 0) return 0;

  if (gainType === 'LTCG') {
    if (['equity', 'equity_mf'].includes(assetType)) {
      // Only the amount above the ₹1.25 L cumulative exemption is taxable
      const exemptRemaining = Math.max(0, EQUITY_LTCG_EXEMPT - ltcgCumulative);
      const taxableGain     = Math.max(0, gainAmount - exemptRemaining);
      const tax             = taxableGain * 0.125;
      return Math.round(tax * (1 + CESS));
    }
    // Other assets (real estate, gold, debt MF) — 12.5% flat, no indexation
    return Math.round(gainAmount * 0.125 * (1 + CESS));
  }

  // STCG
  if (['equity', 'equity_mf'].includes(assetType)) {
    // 20% + 4% cess
    return Math.round(gainAmount * 0.20 * (1 + CESS));
  }

  // Non-equity STCG taxed at slab rate — return 0 here;
  // the caller should add this amount to slab income separately.
  return 0;
}
