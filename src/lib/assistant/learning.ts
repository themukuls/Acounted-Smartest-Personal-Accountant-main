/**
 * learning.ts — the assistant's memory of THIS user, kept entirely on-device.
 *
 * ── THE PRIVACY CONTRACT ─────────────────────────────────────────────────────
 * AssistantSettingsModal promises the user, in writing, that "only the sentence
 * you speak or type is sent to the provider — never your balances, transactions,
 * name or contact details". Everything in this file exists to make the assistant
 * feel personal WITHOUT touching that promise, so the rule is absolute:
 *
 *   Nothing in this module may ever reach prompt.ts.
 *
 * It runs in two places, both of them local:
 *   1. AFTER the model has replied — `personaliseAction()` rewrites the fields
 *      the model guessed, using the user's own history.
 *   2. AFTER the user taps Save — `captureCorrection()` remembers what they
 *      changed on the review card, so the same guess is right next time.
 *
 * The model is never told what the user buys, where, how much, or how they pay.
 * `learning.test.ts` asserts this mechanically against the real prompt builder.
 *
 * ── WHY tf-idf AND NOT A DICTIONARY ──────────────────────────────────────────
 * A merchant is whatever word is distinctive in the user's own descriptions.
 * "Blinkit rice bag 5 kg" and "blinkit 400" share exactly one useful token, and
 * that token is rare across the ledger while "bag" and "food" are common. Inverse
 * document frequency picks that out for free, per user, with no merchant list to
 * maintain and nothing India-specific hardcoded.
 *
 * Storage is localStorage, following src/lib/recurring/dismissed.ts. It is
 * deliberately NOT a repository store: `src/integrations/storage/stores.ts` is
 * the schema contract mirrored from IndexedDB, and a learned UI default has no
 * business in it. Losing this data costs the user one re-correction.
 */

import { differenceInDays, isValid, parseISO } from 'date-fns';
import {
  DEFAULT_ACCOUNT,
  INCOME_CATEGORY,
  PAYMENT_METHODS,
  categoryLabel,
} from '@/lib/categories';
import type { WritableAction } from './types';

// ─── Tuning constants ─────────────────────────────────────────────────────────

/** A transaction's evidence halves every this many days. */
const HALF_LIFE_DAYS = 180;
/** Floor so a two-year-old habit still counts for something. */
const MIN_RECENCY_WEIGHT = 0.15;

/** A merchant seen once is a coincidence. Two is a habit. */
const MIN_SUPPORTING_TXNS = 2;
/** Share of matched evidence the winning category must hold. */
const CATEGORY_MAJORITY = 0.6;
/** Same, for picking the account a specific merchant is usually paid with. */
const ACCOUNT_MAJORITY = 0.6;
/** Below this much spending history, "their usual account" isn't a fact yet. */
const MIN_ACCOUNT_HISTORY = 3;

/** Amount sanity needs a real distribution, not three data points. */
const MIN_AMOUNT_SAMPLES = 5;
/** How far from the category median counts as "worth a second look". */
const AMOUNT_OUTLIER_RATIO = 12;

/** Corrections kept per user before the oldest are pruned. */
const MAX_CORRECTIONS = 300;
/** How many tokens of one utterance a correction is filed under. */
const CORRECTION_KEYS_PER_ENTRY = 3;

// ─── Text normalisation ───────────────────────────────────────────────────────

/**
 * Words that appear in spoken money sentences and carry no merchant signal.
 * Kept broad on purpose: a false token here costs a missed match, while a
 * missing one lets "yesterday" become a merchant.
 */
const STOPWORDS = new Set([
  // verbs and framing
  'spent', 'spend', 'paid', 'pay', 'bought', 'buy', 'got', 'get', 'gave', 'give',
  'took', 'take', 'sent', 'send', 'added', 'add', 'put', 'was', 'were', 'has',
  'have', 'had', 'did', 'done', 'made', 'make', 'cost', 'costs', 'charged',
  // grammar
  'the', 'and', 'for', 'from', 'with', 'via', 'using', 'used', 'through', 'that',
  'this', 'there', 'here', 'some', 'any', 'about', 'into', 'onto', 'off', 'out',
  'per', 'each', 'also', 'just', 'only', 'more', 'less', 'than', 'then',
  'his', 'her', 'him', 'she', 'they', 'them', 'their', 'our', 'you', 'your',
  // time
  'today', 'yesterday', 'tomorrow', 'tonight', 'morning', 'evening', 'night',
  'last', 'next', 'week', 'weeks', 'month', 'months', 'year', 'years', 'day',
  'days', 'ago', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday',
  'saturday', 'sunday', 'january', 'february', 'march', 'april', 'june',
  'july', 'august', 'september', 'october', 'november', 'december',
  // money
  'rupees', 'rupee', 'rest', 'inr', 'amount', 'total', 'lakh', 'lakhs', 'crore',
  'crores', 'thousand', 'hundred', 'approx', 'around', 'about',
  // units that follow a quantity rather than name a seller
  'kgs', 'gms', 'ltr', 'litre', 'litres', 'liter', 'liters', 'pack', 'packs',
  'piece', 'pieces', 'pcs', 'box', 'boxes', 'bottle', 'bottles', 'packet',
  'packets', 'size', 'qty',
]);

/** Lowercase, punctuation to spaces, whitespace collapsed. */
export function normaliseText(text: string): string {
  return (text ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * The tokens of a description that could plausibly name a merchant or a thing.
 * Drops anything with a digit in it ("400", "5kg", "hq27"), anything under
 * three characters, and the stopword list above.
 */
export function merchantTokens(text: string): string[] {
  const seen = new Set<string>();
  for (const token of normaliseText(text).split(' ')) {
    if (token.length < 3) continue;
    if (/\d/.test(token)) continue;
    if (STOPWORDS.has(token)) continue;
    seen.add(token);
  }
  return [...seen];
}

// ─── The profile ──────────────────────────────────────────────────────────────

/** The only shape of the user's ledger this module ever sees. */
export interface HistoryTransaction {
  type: 'income' | 'expense';
  amount: number;
  category: string;
  account: string;
  description?: string | null;
  transaction_date: string;
}

interface ProfileEntry {
  tokens: string[];
  category: string;
  account: string;
  weight: number;
}

export interface UserProfile {
  /** One entry per past EXPENSE that had a usable description. */
  entries: ProfileEntry[];
  /** token -> how many entries contain it, for the idf term. */
  documentFrequency: Map<string, number>;
  /** Recency-weighted account usage across all expenses. */
  accountWeights: Map<string, number>;
  /** Raw count of expenses with an account, gating "their usual account". */
  accountSamples: number;
  /** category -> the amounts seen, for the outlier check. */
  amountsByCategory: Map<string, number[]>;
}

export const EMPTY_PROFILE: UserProfile = {
  entries: [],
  documentFrequency: new Map(),
  accountWeights: new Map(),
  accountSamples: 0,
  amountsByCategory: new Map(),
};

const VALID_ACCOUNTS = new Set(PAYMENT_METHODS.map((p) => p.value));

/** Tolerant date parse — the ledger holds ISO timestamps, backups hold both. */
function toDate(raw: string): Date | null {
  const iso = parseISO(raw);
  if (isValid(iso)) return iso;
  const loose = new Date(raw);
  return isValid(loose) ? loose : null;
}

/** Exponential recency decay, floored so old habits never vanish entirely. */
export function recencyWeight(dateIso: string, today: Date): number {
  const when = toDate(dateIso);
  if (!when) return MIN_RECENCY_WEIGHT;
  const age = Math.max(0, differenceInDays(today, when));
  return Math.max(MIN_RECENCY_WEIGHT, Math.pow(0.5, age / HALF_LIFE_DAYS));
}

/**
 * Fold the user's transactions into the compact form the matcher needs.
 * Pure: same input, same profile, no storage, no clock of its own.
 */
export function buildProfile(
  transactions: readonly HistoryTransaction[],
  today: Date,
): UserProfile {
  const profile: UserProfile = {
    entries: [],
    documentFrequency: new Map(),
    accountWeights: new Map(),
    accountSamples: 0,
    amountsByCategory: new Map(),
  };

  for (const txn of transactions ?? []) {
    // Income is excluded throughout. Salary lands in a different account from
    // groceries, and letting it vote would drag every default towards the bank.
    if (txn?.type !== 'expense') continue;

    const weight = recencyWeight(txn.transaction_date, today);

    if (VALID_ACCOUNTS.has(txn.account)) {
      profile.accountWeights.set(
        txn.account,
        (profile.accountWeights.get(txn.account) ?? 0) + weight,
      );
      profile.accountSamples += 1;
    }

    if (Number.isFinite(txn.amount) && txn.amount > 0 && txn.category) {
      const bucket = profile.amountsByCategory.get(txn.category);
      if (bucket) bucket.push(txn.amount);
      else profile.amountsByCategory.set(txn.category, [txn.amount]);
    }

    const tokens = merchantTokens(txn.description ?? '');
    if (tokens.length === 0 || !txn.category) continue;

    profile.entries.push({ tokens, category: txn.category, account: txn.account, weight });
    for (const token of tokens) {
      profile.documentFrequency.set(token, (profile.documentFrequency.get(token) ?? 0) + 1);
    }
  }

  return profile;
}

/** The user's own most-used payment method, or null when there isn't enough history. */
export function dominantAccount(profile: UserProfile): string | null {
  if (profile.accountSamples < MIN_ACCOUNT_HISTORY) return null;
  let best: string | null = null;
  let bestWeight = 0;
  for (const [account, weight] of profile.accountWeights) {
    if (weight > bestWeight) {
      bestWeight = weight;
      best = account;
    }
  }
  return best;
}

// ─── Matching an utterance against the profile ────────────────────────────────

export interface Suggestion {
  value: string;
  /** Share of the matched evidence this value holds, 0..1. */
  confidence: number;
  /** How many distinct past transactions backed it. */
  support: number;
}

/**
 * Rarity of a token across the user's own descriptions. A merchant name they
 * used 8 times out of 400 scores far above "food", which appears in 150.
 */
function idf(token: string, profile: UserProfile): number {
  const df = profile.documentFrequency.get(token) ?? 0;
  return Math.log((profile.entries.length + 1) / (df + 1)) + 1;
}

/**
 * Find the past transactions that look like this utterance, and report what
 * category and account they agree on.
 *
 * Every matching entry contributes `recency × Σ idf(shared tokens)`, so one
 * strong merchant match outweighs a dozen incidental "food" collisions.
 */
export function matchHistory(
  text: string,
  profile: UserProfile,
): { category: Suggestion | null; account: Suggestion | null } {
  const empty = { category: null, account: null };
  const tokens = new Set(merchantTokens(text));
  if (tokens.size === 0 || profile.entries.length === 0) return empty;

  const categoryScore = new Map<string, number>();
  const categorySupport = new Map<string, number>();
  const accountScore = new Map<string, number>();
  const accountSupport = new Map<string, number>();
  let total = 0;

  for (const entry of profile.entries) {
    let shared = 0;
    for (const token of entry.tokens) {
      if (tokens.has(token)) shared += idf(token, profile);
    }
    if (shared === 0) continue;

    const score = entry.weight * shared;
    total += score;

    categoryScore.set(entry.category, (categoryScore.get(entry.category) ?? 0) + score);
    categorySupport.set(entry.category, (categorySupport.get(entry.category) ?? 0) + 1);

    if (VALID_ACCOUNTS.has(entry.account)) {
      accountScore.set(entry.account, (accountScore.get(entry.account) ?? 0) + score);
      accountSupport.set(entry.account, (accountSupport.get(entry.account) ?? 0) + 1);
    }
  }

  if (total === 0) return empty;

  const pick = (
    scores: Map<string, number>,
    support: Map<string, number>,
  ): Suggestion | null => {
    let value: string | null = null;
    let best = 0;
    for (const [key, score] of scores) {
      if (score > best) {
        best = score;
        value = key;
      }
    }
    if (!value) return null;
    return { value, confidence: best / total, support: support.get(value) ?? 0 };
  };

  return { category: pick(categoryScore, categorySupport), account: pick(accountScore, accountSupport) };
}

const passes = (s: Suggestion | null, majority: number): s is Suggestion =>
  s !== null && s.confidence >= majority && s.support >= MIN_SUPPORTING_TXNS;

// ─── Amount sanity ────────────────────────────────────────────────────────────

export interface AmountNotice {
  direction: 'high' | 'low';
  /** The median this user normally spends in that category. */
  typical: number;
  category: string;
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/**
 * Is this amount wildly unlike what the user normally spends here?
 *
 * This NEVER changes the amount. A misheard "four hundred" that was really
 * "four thousand" is the user's to fix; silently rewriting a number in a ledger
 * is the single worst thing this app could do. All we do is raise a flag the
 * review card can show.
 */
export function amountNoticeFor(
  category: string,
  amount: number,
  profile: UserProfile,
): AmountNotice | null {
  if (!Number.isFinite(amount) || amount <= 0) return null;
  const samples = profile.amountsByCategory.get(category);
  if (!samples || samples.length < MIN_AMOUNT_SAMPLES) return null;

  const typical = median(samples);
  if (typical <= 0) return null;

  if (amount > typical * AMOUNT_OUTLIER_RATIO) return { direction: 'high', typical, category };
  if (amount * AMOUNT_OUTLIER_RATIO < typical) return { direction: 'low', typical, category };
  return null;
}

// ─── Learned corrections (localStorage) ───────────────────────────────────────

export interface CorrectionRecord {
  category?: string;
  account?: string;
  updated_at: string;
}

export type CorrectionMap = Record<string, CorrectionRecord>;

const STORAGE_PREFIX = 'vidhence_assistant_corrections';

const storageKey = (userId: string | null | undefined): string =>
  userId ? `${STORAGE_PREFIX}_${userId}` : STORAGE_PREFIX;

/** The slice of the Storage API this module needs. */
export interface CorrectionStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

let injectedStorage: CorrectionStorage | null | undefined;

/**
 * Point the correction store somewhere else. Tests use this; nothing in the app
 * calls it, so production always lands on localStorage.
 */
export function setCorrectionStorage(storage: CorrectionStorage | null): void {
  injectedStorage = storage;
}

function storage(): CorrectionStorage | null {
  if (injectedStorage !== undefined) return injectedStorage;
  try {
    // Absent in private-mode WebViews and in some test runners.
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

/** Every remembered correction for a user. Never throws. */
export function getCorrections(userId: string | null | undefined): CorrectionMap {
  try {
    const raw = storage()?.getItem(storageKey(userId));
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    return parsed as CorrectionMap;
  } catch {
    return {};
  }
}

function writeCorrections(userId: string | null | undefined, map: CorrectionMap): void {
  try {
    const entries = Object.entries(map);
    // Prune oldest-first so a chatty user doesn't grow this without bound.
    const kept = entries.length <= MAX_CORRECTIONS
      ? entries
      : entries
          .sort((a, b) => (a[1].updated_at < b[1].updated_at ? 1 : -1))
          .slice(0, MAX_CORRECTIONS);
    storage()?.setItem(storageKey(userId), JSON.stringify(Object.fromEntries(kept)));
  } catch {
    /* quota or private mode — a lost correction costs one re-edit */
  }
}

/**
 * Which tokens of an utterance a correction gets filed under.
 * Longest first: "blinkit" is a better key than "bag", and length is a decent
 * free proxy for distinctiveness when we have no profile to consult.
 */
function correctionKeys(text: string): string[] {
  return merchantTokens(text)
    .sort((a, b) => b.length - a.length)
    .slice(0, CORRECTION_KEYS_PER_ENTRY);
}

/** Remember what the user changed, keyed by the distinctive words they said. */
export function rememberCorrection(
  userId: string | null | undefined,
  text: string,
  fields: { category?: string; account?: string },
): void {
  const keys = correctionKeys(text);
  if (keys.length === 0) return;
  if (!fields.category && !fields.account) return;

  const map = getCorrections(userId);
  const now = new Date().toISOString();
  for (const key of keys) {
    map[key] = { ...map[key], ...fields, updated_at: now };
  }
  writeCorrections(userId, map);
}

/**
 * The correction that applies to this utterance, if any.
 * Longest matching token wins — the specific merchant beats the generic noun.
 */
export function lookupCorrection(map: CorrectionMap, text: string): CorrectionRecord | null {
  const tokens = merchantTokens(text).sort((a, b) => b.length - a.length);
  for (const token of tokens) {
    const hit = map[token];
    if (hit) return hit;
  }
  return null;
}

/** Wipe a user's learned corrections (settings "forget what you've learned"). */
export function forgetCorrections(userId: string | null | undefined): void {
  try {
    storage()?.removeItem(storageKey(userId));
  } catch {
    /* no-op */
  }
}

// ─── Did the user say it themselves? ──────────────────────────────────────────

/**
 * True when the utterance names a category outright ("spent 400 on food").
 *
 * This is the guard behind "never override a category the user typed
 * themselves". It deliberately does NOT trust the model's own `assumed` list —
 * models are unreliable about admitting what they guessed, and the cost of
 * being wrong here is overwriting something the user actually said.
 */
export function utteranceNamesCategory(utterance: string, categorySlugs: string[]): boolean {
  const spoken = new Set(merchantTokens(utterance));
  if (spoken.size === 0) return false;

  for (const slug of categorySlugs) {
    if (slug === 'others') continue; // nobody says "others" out loud
    const names = [...merchantTokens(slug), ...merchantTokens(categoryLabel(slug))];
    if (names.some((token) => spoken.has(token))) return true;
  }
  return false;
}

/** Words that mean the user told us how they paid. */
const ACCOUNT_WORDS = [
  'upi', 'gpay', 'google pay', 'phonepe', 'paytm', 'bhim', 'scanner', 'qr',
  'cash', 'card', 'credit', 'debit', 'bank', 'netbanking', 'net banking',
  'transfer', 'neft', 'imps', 'rtgs', 'cheque', 'check',
];

export function utteranceNamesAccount(utterance: string): boolean {
  const text = ` ${normaliseText(utterance)} `;
  return ACCOUNT_WORDS.some((word) => text.includes(` ${word} `));
}

// ─── The personalisation pass ─────────────────────────────────────────────────

export interface PersonalisationContext {
  profile: UserProfile;
  corrections: CorrectionMap;
  categorySlugs: string[];
}

export interface PersonalisationResult {
  action: WritableAction;
  /** Fields this layer supplied. Already merged into `action.assumed`. */
  applied: string[];
  amountNotice: AmountNotice | null;
}

const withAssumed = (assumed: string[], fields: string[]): string[] => {
  const out = [...assumed];
  for (const field of fields) if (!out.includes(field)) out.push(field);
  return out;
};

/**
 * Improve the model's guess using nothing but local data.
 *
 * Precedence, highest first:
 *   1. What the user said in this very sentence — never overridden.
 *   2. A correction they made on the review card for this merchant before.
 *   3. What their own history says this merchant usually is.
 *   4. The model's answer.
 *   5. UPI, the overwhelmingly common default.
 */
export function personaliseAction(
  action: WritableAction,
  utterance: string,
  ctx: PersonalisationContext,
): PersonalisationResult {
  // Udhar entries are about people, not merchants — nothing to personalise.
  if (action.kind !== 'add_transaction') {
    return { action, applied: [], amountNotice: null };
  }

  const applied: string[] = [];
  const text = [utterance, action.description].filter(Boolean).join(' ');
  const correction = lookupCorrection(ctx.corrections, text);
  const match = matchHistory(text, ctx.profile);
  const allowed = new Set(ctx.categorySlugs);

  let category = action.category;
  let account = action.account;

  // ── Category ───────────────────────────────────────────────────────────────
  // Income always files under the income pseudo-category; there is nothing to
  // learn, and re-categorising a salary would be actively wrong.
  if (action.type === 'expense' && !utteranceNamesCategory(utterance, ctx.categorySlugs)) {
    if (correction?.category && allowed.has(correction.category)) {
      if (correction.category !== category) applied.push('category');
      category = correction.category;
    } else if (passes(match.category, CATEGORY_MAJORITY) && allowed.has(match.category.value)) {
      if (match.category.value !== category) applied.push('category');
      category = match.category.value;
    }
  }

  // ── Account ────────────────────────────────────────────────────────────────
  // Expenses only. Income accounts follow a different pattern (salary lands in
  // a bank account), and the model usually gets that right from the sentence.
  if (action.type === 'expense' && !utteranceNamesAccount(utterance)) {
    const learned =
      (correction?.account && VALID_ACCOUNTS.has(correction.account) ? correction.account : null) ??
      (passes(match.account, ACCOUNT_MAJORITY) && VALID_ACCOUNTS.has(match.account.value)
        ? match.account.value
        : null) ??
      dominantAccount(ctx.profile) ??
      DEFAULT_ACCOUNT;

    if (learned !== account) applied.push('account');
    account = learned;
  }

  if (!VALID_ACCOUNTS.has(account)) account = DEFAULT_ACCOUNT;

  const amountNotice =
    action.type === 'expense' ? amountNoticeFor(category, action.amount, ctx.profile) : null;

  const next: WritableAction = {
    ...action,
    category: action.type === 'income' ? INCOME_CATEGORY : category,
    account,
    assumed: withAssumed(action.assumed, applied),
  };

  rememberForReview(next, amountNotice);
  return { action: next, applied, amountNotice };
}

// ─── Handing the notice to the review card ────────────────────────────────────

/**
 * The last amount notice we produced, so ActionReviewCard can show it without
 * every caller having to thread a new prop through. Guarded by an identity
 * check: edit the amount or the category and the notice stops applying, which
 * is exactly the behaviour you want from a "does that look right?" hint.
 */
let lastNotice: { amount: number; category: string; notice: AmountNotice } | null = null;

function rememberForReview(action: WritableAction, notice: AmountNotice | null): void {
  lastNotice =
    notice && action.kind === 'add_transaction'
      ? { amount: action.amount, category: action.category, notice }
      : null;
}

/** The notice for this action, if it is still the one we flagged. */
export function getAmountNotice(action: WritableAction): AmountNotice | null {
  if (!lastNotice || action.kind !== 'add_transaction') return null;
  if (action.amount !== lastNotice.amount || action.category !== lastNotice.category) return null;
  return lastNotice.notice;
}

// ─── Capturing what the user changed ──────────────────────────────────────────

/**
 * What we handed to the review card, so that whatever comes back from Save can
 * be diffed against it. Module state rather than a prop because AssistantSheet
 * owns the round trip and this must not change its signature.
 */
let pending: { userId: string | null; utterance: string; action: WritableAction } | null = null;

export function beginCorrectionCapture(
  userId: string | null,
  utterance: string,
  action: WritableAction,
): void {
  pending = { userId, utterance, action };
}

/**
 * Called from apply.ts once the user taps Save. Anything they changed on the
 * card is a correction, and a correction outranks history next time.
 */
export function captureCorrection(userId: string, finalAction: WritableAction): void {
  const context = pending;
  pending = null;

  if (!context || context.action.kind !== 'add_transaction') return;
  if (finalAction.kind !== 'add_transaction') return;
  // Guard against a stale capture from an abandoned utterance.
  if (context.userId && context.userId !== userId) return;
  // Income has no merchant memory worth keeping.
  if (finalAction.type !== 'expense') return;

  const fields: { category?: string; account?: string } = {};
  if (finalAction.category !== context.action.category) fields.category = finalAction.category;
  if (finalAction.account !== context.action.account) fields.account = finalAction.account;
  if (!fields.category && !fields.account) return;

  const text = [context.utterance, finalAction.description].filter(Boolean).join(' ');
  rememberCorrection(userId, text, fields);
}

/** Test seam — drops the in-memory handoff state between cases. */
export function resetLearningState(): void {
  pending = null;
  lastNotice = null;
}
