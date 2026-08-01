/**
 * useTaxState — loads the user's real financial data and builds the live
 * TaxState (Phase 2 ledger) that the Q&A layer and the tax pulse read from.
 *
 * MVP scope: salary from income_details + this FY's EXPENSE transactions as
 * deduction entries. Income transactions (freelance/interest) and capital gains
 * ingestion are refinements — noted, not silently missing.
 */

import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { getIncomeDetails } from '@/integrations/indexeddb/services/onboardingService';
import { getMonthlyTransactions } from '@/integrations/indexeddb/services/dataService';
import { getLearnedMappings } from '@/integrations/indexeddb/services/learnedTaxMappingsService';
import {
  getCapitalGainsEntries,
  classifyGain,
} from '@/integrations/indexeddb/services/capitalGainsService';
import { buildTaxState, type CapitalGains, type LedgerEntry, type TaxState } from '@/lib/tax';
import { getISTDate } from '@/lib/date-utils';

const EQUITY_ASSETS = ['equity', 'equity_mf'];

/** Aggregate realised capital-gains entries into the engine's CapitalGains shape. */
function aggregateCapitalGains(
  entries: Array<{
    asset_type: string;
    purchase_date: string;
    sale_date: string | null;
    purchase_price: number;
    sale_price: number | null;
    quantity: number;
  }>,
): CapitalGains {
  const cg: CapitalGains = { equityStcg: 0, equityLtcg: 0, otherLtcg: 0, otherStcg: 0 };
  for (const e of entries) {
    if (!e.sale_date || e.sale_price === null) continue; // unrealised
    const gain = (e.sale_price - e.purchase_price) * e.quantity;
    if (gain <= 0) continue; // losses out of scope for this MVP
    const isEquity = EQUITY_ASSETS.includes(e.asset_type);
    const term = classifyGain(e.asset_type, e.purchase_date, e.sale_date);
    if (isEquity && term === 'STCG') cg.equityStcg += gain;
    else if (isEquity && term === 'LTCG') cg.equityLtcg += gain;
    else if (!isEquity && term === 'LTCG') cg.otherLtcg += gain;
    else cg.otherStcg += gain; // non-equity STCG → slab
  }
  return cg;
}

/** Indian financial year (Apr 1 – Mar 31) containing `now`. */
function currentFinancialYear(now: Date) {
  const y = now.getFullYear();
  const startYear = now.getMonth() >= 3 ? y : y - 1; // month 3 = April
  return {
    startYear,
    label: `${startYear}-${String((startYear + 1) % 100).padStart(2, '0')}`,
    start: new Date(startYear, 3, 1).toISOString(),
    end: new Date(startYear + 1, 2, 31, 23, 59, 59).toISOString(),
  };
}

export function useTaxState() {
  const { user } = useAuth();
  const [state, setState] = useState<TaxState | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!user) {
      setState(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const fy = currentFinancialYear(getISTDate());
      const [income, expenses, incomeTxns, cgEntries, learned] = await Promise.all([
        getIncomeDetails(user.id),
        getMonthlyTransactions(user.id, fy.start, fy.end, 'expense'),
        getMonthlyTransactions(user.id, fy.start, fy.end, 'income'),
        getCapitalGainsEntries(user.id, fy.label),
        getLearnedMappings(user.id),
      ]);

      const monthly = (income?.monthly_salary ?? 0) + (income?.monthly_other_income ?? 0);
      const salaryIncome = monthly * 12;

      // Expenses feed deductions; income transactions feed non-salary income
      // (salary itself comes from the income profile — the ledger zeroes any
      // salary-classified entry to avoid double counting).
      const toEntry = (t: (typeof expenses)[number]): LedgerEntry => ({
        id: t.id,
        description: t.description || t.category || '',
        category: t.category,
        amount: t.amount,
      });
      const entries = [...expenses.map(toEntry), ...incomeTxns.map(toEntry)];

      setState(
        buildTaxState({
          financialYear: fy.label,
          ageCategory: '<60',
          hasSalaryOrPension: salaryIncome > 0,
          salaryIncome,
          entries,
          capitalGains: aggregateCapitalGains(cgEntries),
          learned,
        }),
      );
    } catch (e) {
      console.error('[useTaxState] failed to build tax state', e);
      setState(null);
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    load();
  }, [load]);

  return { state, loading, refresh: load };
}
