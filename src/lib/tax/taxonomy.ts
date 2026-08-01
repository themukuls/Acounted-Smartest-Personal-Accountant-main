/**
 * taxonomy.ts — the tax-bucket taxonomy, as data.
 *
 * Every financial entry a user makes routes to exactly one of these buckets
 * (or stays unclassified until they confirm). Deduction buckets name the exact
 * `OldRegimeDeductions` field they feed, so the classifier's output plugs
 * straight into the engine. This is the "which value goes where" map.
 */

import type { OldRegimeDeductions } from './types';

export type BucketKind = 'income' | 'deduction' | 'non_taxable';

export interface TaxBucket {
  id: string;
  label: string;
  kind: BucketKind;
  /** Human-facing section label, e.g. "80C", "24(b)". */
  section?: string;
  /** For deductions: the engine field this amount contributes to. */
  engineField?: keyof OldRegimeDeductions;
  /** Deduction availability. Most old-regime deductions vanish in the new regime. */
  regime?: 'old' | 'both';
  /** Short note surfaced to the user when this bucket is chosen. */
  note?: string;
  /**
   * Matching keywords/phrases. More words = more specific = higher confidence,
   * so "home loan interest" (24b) beats "home loan" and "health insurance"
   * (80D) beats "insurance".
   */
  keywords: string[];
}

export const TAX_BUCKETS: TaxBucket[] = [
  // ── Deductions (old regime) ───────────────────────────────────────────────
  {
    id: 'sec_80c',
    label: 'Section 80C',
    kind: 'deduction',
    section: '80C',
    engineField: 'section80C',
    regime: 'old',
    note: 'Up to ₹1.5 L across PPF, ELSS, EPF, LIC, home-loan principal, tuition.',
    keywords: [
      'ppf', 'public provident fund', 'elss', 'tax saver', 'tax saving mutual fund',
      'epf', 'employee provident fund', 'nsc', 'lic', 'life insurance', 'term plan',
      'term insurance', 'ulip', 'sukanya samriddhi', 'ssy', 'tuition fee',
      'children tuition', 'school fee', 'home loan principal', 'principal repayment',
      'tax saving fd', '5 year fd',
    ],
  },
  {
    id: 'sec_80ccd1b',
    label: 'Section 80CCD(1B) — NPS',
    kind: 'deduction',
    section: '80CCD(1B)',
    engineField: 'section80CCD1B',
    regime: 'old',
    note: 'Extra ₹50k for NPS Tier-I, over and above 80C.',
    keywords: ['nps', 'national pension', 'nps tier 1', 'nps tier i', '80ccd', 'additional nps'],
  },
  {
    id: 'sec_80d',
    label: 'Section 80D — Health insurance',
    kind: 'deduction',
    section: '80D',
    engineField: 'section80D',
    regime: 'old',
    note: 'Health-insurance premium (self/family + parents) and preventive check-ups.',
    keywords: [
      'health insurance', 'medical insurance', 'mediclaim', 'health policy',
      'health cover', 'preventive health checkup', 'parents insurance', 'family floater',
    ],
  },
  {
    id: 'sec_24b',
    label: 'Section 24(b) — Home-loan interest',
    kind: 'deduction',
    section: '24(b)',
    engineField: 'section24b',
    regime: 'old',
    note: 'Interest on a self-occupied home loan, up to ₹2 L in the old regime.',
    keywords: ['home loan interest', 'housing loan interest', 'mortgage interest', 'home loan emi interest'],
  },
  {
    id: 'sec_80e',
    label: 'Section 80E — Education-loan interest',
    kind: 'deduction',
    section: '80E',
    engineField: 'section80E',
    regime: 'old',
    note: 'Interest on an education loan — no upper limit.',
    keywords: ['education loan interest', 'student loan interest', 'study loan interest', 'education loan'],
  },
  {
    id: 'sec_80g',
    label: 'Section 80G — Donations',
    kind: 'deduction',
    section: '80G',
    engineField: 'section80G',
    regime: 'old',
    note: 'Approved charitable donations — 50%–100% deductible.',
    keywords: ['donation', 'charity', 'relief fund', 'pm cares', 'ngo', 'temple donation', 'charitable'],
  },
  {
    id: 'sec_80tta',
    label: 'Section 80TTA — Savings interest',
    kind: 'deduction',
    section: '80TTA',
    engineField: 'section80TTA',
    regime: 'old',
    note: 'Savings-account interest, up to ₹10k (non-senior).',
    keywords: ['savings account interest', 'savings interest', '80tta'],
  },
  {
    id: 'sec_80ttb',
    label: 'Section 80TTB — Senior interest',
    kind: 'deduction',
    section: '80TTB',
    engineField: 'section80TTB',
    regime: 'old',
    note: 'Savings + FD interest for senior citizens, up to ₹1 L.',
    keywords: ['80ttb', 'senior citizen interest', 'senior savings interest'],
  },
  {
    id: 'hra',
    label: 'HRA — Rent paid',
    kind: 'deduction',
    section: '10(13A)',
    engineField: 'hra',
    regime: 'old',
    note: 'House rent paid — feeds the HRA exemption (old regime).',
    keywords: ['rent paid', 'house rent', 'rent receipt', 'monthly rent', 'flat rent', 'room rent'],
  },

  // ── Income ────────────────────────────────────────────────────────────────
  {
    id: 'income_salary',
    label: 'Salary income',
    kind: 'income',
    keywords: ['salary', 'salary credited', 'monthly salary', 'payroll', 'wages', 'ctc', 'take home'],
  },
  {
    id: 'income_professional',
    label: 'Professional / freelance income (44ADA)',
    kind: 'income',
    section: '44ADA',
    keywords: [
      'freelance', 'freelancer', 'consulting', 'consultancy', 'professional fees',
      'client payment', 'client invoice', 'retainer', 'contract work',
    ],
  },
  {
    id: 'income_business',
    label: 'Business income (44AD)',
    kind: 'income',
    section: '44AD',
    keywords: ['business income', 'sales revenue', 'shop income', 'turnover', 'business turnover'],
  },
  {
    id: 'income_rental',
    label: 'Rental income',
    kind: 'income',
    keywords: ['rent received', 'rental income', 'tenant rent', 'let out', 'lease income'],
  },
  {
    id: 'income_interest',
    label: 'Interest income',
    kind: 'income',
    keywords: ['fd interest', 'fixed deposit interest', 'bank interest', 'rd interest', 'interest earned', 'interest income'],
  },
  {
    id: 'income_dividend',
    label: 'Dividend income',
    kind: 'income',
    keywords: ['dividend', 'dividend received'],
  },
  {
    id: 'income_capital_gains',
    label: 'Capital gains',
    kind: 'income',
    keywords: [
      'capital gain', 'stock sale', 'shares sold', 'sold shares', 'mutual fund redemption',
      'redeemed mutual fund', 'ltcg', 'stcg', 'equity sale',
    ],
  },
  {
    id: 'income_other',
    label: 'Other income',
    kind: 'income',
    keywords: ['other income', 'misc income', 'miscellaneous income'],
  },

  // ── Not tax-relevant (recognise so we can EXCLUDE) ────────────────────────
  {
    id: 'non_taxable_gift',
    label: 'Gift (not taxable)',
    kind: 'non_taxable',
    keywords: ['gift', 'gifted', 'shagun', 'present from', 'birthday money'],
  },
  {
    id: 'non_taxable_reimbursement',
    label: 'Reimbursement (not income)',
    kind: 'non_taxable',
    keywords: ['reimbursement', 'reimbursed', 'expense claim', 'cashback', 'refund'],
  },
  {
    id: 'non_taxable_transfer',
    label: 'Self transfer (not income)',
    kind: 'non_taxable',
    keywords: ['self transfer', 'own account', 'moved money', 'account transfer', 'transfer to self'],
  },
];

/** Fast lookup by id. */
export const BUCKET_BY_ID: Record<string, TaxBucket> = Object.fromEntries(
  TAX_BUCKETS.map((b) => [b.id, b]),
);
