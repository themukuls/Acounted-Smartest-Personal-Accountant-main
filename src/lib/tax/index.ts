/**
 * The tax engine — single source of truth for Indian income-tax math.
 *
 * Usage:
 *   import { computeTax } from '@/lib/tax';
 *   const result = computeTax(input);
 */

export * from './types';
export * from './constants';
export * from './taxonomy';
export { classifyEntry, type ClassificationResult, type Candidate } from './classifier';
export {
  buildTaxState,
  type TaxState,
  type IncomeBreakdown,
  type LedgerEntry,
  type BucketAggregate,
  type HeadroomItem,
  type UnclassifiedItem,
} from './ledger';
export {
  buildITRDraft,
  determineITRForm,
  itrDraftToJSON,
  type ITRDraft,
  type ITRForm,
} from './itr';
export {
  answerQuestion,
  extractAmount,
  inr,
  INTENT_IDS,
  SECTION_CODES,
  type QAAnswer,
  type QAOverride,
  type IntentId,
} from './qa';
export { TAX_TOPICS, type TaxTopic } from './knowledge';
export {
  getTaxWhispers,
  type Whisper,
  type WhisperSeverity,
} from './whispers';
export {
  computeTax,
  computeTaxOnTaxableIncome,
  computeSlabTax,
  computeRebate87A,
  computeCapitalGainsTax,
  computeSurcharge,
  sumDeductions,
  type TaxOnIncomeResult,
} from './engine';
