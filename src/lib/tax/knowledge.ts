/**
 * knowledge.ts — plain-language tax explanations.
 *
 * Because there is no LLM, the "builds understanding" part of the Q&A comes
 * from this hand-written content. Keyed by the same section ids the taxonomy
 * and engine use, so "what is 80C?" resolves deterministically.
 */

export interface TaxTopic {
  id: string;
  title: string;
  /** One or two sentences a non-expert can follow. */
  explanation: string;
  /** The limit/cap in plain words, if any. */
  limit?: string;
  /** A concrete, actionable tip. */
  tip?: string;
}

export const TAX_TOPICS: Record<string, TaxTopic> = {
  section80C: {
    id: 'section80C',
    title: 'Section 80C',
    explanation:
      'The main tax-saving bucket in the old regime. Money you put into PPF, ELSS, EPF, life insurance, NSC, your home-loan principal, or kids’ tuition is subtracted from your taxable income.',
    limit: 'Up to ₹1.5 lakh a year, combined across everything.',
    tip: 'ELSS funds have the shortest lock-in (3 years) and can grow faster than PPF, if you can take some risk.',
  },
  section80CCD1B: {
    id: 'section80CCD1B',
    title: 'Section 80CCD(1B) — NPS',
    explanation:
      'An extra deduction for money you put into the National Pension System (NPS) Tier-I, over and above your 80C limit.',
    limit: 'Up to ₹50,000 a year, separate from 80C.',
    tip: 'This is the easiest way to squeeze out ₹50k more of deductions once your 80C is full.',
  },
  section80D: {
    id: 'section80D',
    title: 'Section 80D — Health insurance',
    explanation:
      'Premiums you pay for health insurance for yourself, your family, and your parents are deductible. Preventive health check-ups count too (up to ₹5,000 within the limit).',
    limit: '₹25,000 for self/family (₹50,000 if you or your parents are senior citizens).',
    tip: 'Insuring your parents adds a second, separate 80D limit on top of your own.',
  },
  section24b: {
    id: 'section24b',
    title: 'Section 24(b) — Home-loan interest',
    explanation:
      'The interest part of your home-loan EMI (not the principal — that’s 80C) is deductible for a self-occupied house.',
    limit: 'Up to ₹2 lakh a year in the old regime for a self-occupied home.',
    tip: 'For a let-out (rented) property there is no upper limit on the interest deduction.',
  },
  section80E: {
    id: 'section80E',
    title: 'Section 80E — Education-loan interest',
    explanation:
      'Interest on a loan taken for higher education (yours, your spouse’s, or your children’s) is deductible.',
    limit: 'No upper limit, for up to 8 years.',
  },
  section80G: {
    id: 'section80G',
    title: 'Section 80G — Donations',
    explanation:
      'Donations to approved charities and relief funds are partly or fully deductible.',
    limit: 'Usually 50% or 100% of the donation, depending on the institution.',
    tip: 'Keep the 80G receipt with the institution’s registration number — you’ll need it to claim.',
  },
  section80TTA: {
    id: 'section80TTA',
    title: 'Section 80TTA — Savings interest',
    explanation: 'Interest earned in your savings bank account is deductible (non-senior citizens).',
    limit: 'Up to ₹10,000 a year.',
  },
  section80TTB: {
    id: 'section80TTB',
    title: 'Section 80TTB — Senior-citizen interest',
    explanation: 'For senior citizens, both savings and fixed-deposit interest is deductible.',
    limit: 'Up to ₹1 lakh a year.',
  },
  hra: {
    id: 'hra',
    title: 'HRA — House Rent Allowance',
    explanation:
      'If you get HRA and pay rent, part of it is exempt from tax (old regime only). The exempt amount is the smallest of: actual HRA, rent minus 10% of basic, or 50%/40% of basic (metro/non-metro).',
    tip: 'You need rent receipts, and your landlord’s PAN if annual rent is over ₹1 lakh.',
  },
  regime: {
    id: 'regime',
    title: 'Old vs New regime',
    explanation:
      'The new regime has lower slab rates but almost no deductions. The old regime has higher rates but lets you claim 80C, 80D, HRA, home-loan interest and more. Whichever gives the lower tax for your actual numbers is the one to pick.',
    tip: 'The more deductions you genuinely have, the more the old regime tends to win.',
  },
};
