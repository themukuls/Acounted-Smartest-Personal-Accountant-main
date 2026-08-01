/**
 * searchCore.ts — the matching and totalling logic behind global search.
 *
 * Pure on purpose: no React, no storage, no clock. The dialog above it is then
 * just a form and a list, and the part that decides what "matching" means can
 * be reasoned about (and, if it ever misbehaves, tested) on its own.
 *
 * Two things make finance search different from ordinary text search:
 *
 *   1. NUMBERS ARE QUERIES. "2450" is not a fuzzy string to a person looking at
 *      their ledger — it is an exact amount they half-remember. Fuse.js scores
 *      digits terribly (every 4-digit number is a near-match for every other),
 *      so numeric queries get their own exact/prefix pass and are merged in
 *      ahead of the fuzzy hits.
 *   2. THE SUM IS THE ANSWER. "How much have I spent at Blinkit" is answered by
 *      a total, not by a list. Every result set therefore carries its own
 *      arithmetic, computed over the matches rather than the page.
 */

import Fuse, { type IFuseOptions } from 'fuse.js';
import { categoryLabel } from '@/lib/categories';

// ── Corpus ───────────────────────────────────────────────────────────────────

export type SearchKind = 'transaction' | 'udhar' | 'recall';

/** One searchable thing, flattened from whichever store it came from. */
export interface SearchRecord {
  id: string;
  kind: SearchKind;
  /** Primary line — description, person, or product name. */
  title: string;
  /** Secondary line — category, payment method, status. */
  subtitle: string;
  amount: number;
  /** ISO date used for both display and range filtering. */
  date: string;
  /** Transactions only; null elsewhere. */
  type: 'income' | 'expense' | null;
  category: string | null;
  account: string | null;
  /** Everything worth fuzzy-matching, pre-joined. */
  searchText: string;
  /** Digit forms of the amount, for the numeric pass. */
  amountText: string;
}

/**
 * Build the text a record is matched against.
 *
 * The category is included as BOTH slug and label ("trips-outings" and "Trips")
 * because users type what they see, not what we store, and the payment method
 * likewise. Doing this once at corpus-build time keeps it off the search path.
 */
export function buildSearchText(parts: (string | null | undefined)[]): string {
  return parts
    .filter((p): p is string => !!p && p.trim().length > 0)
    .join(' ')
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Digit representations of an amount: "2450", "2,450", "2450.00". */
export function amountForms(amount: number): string {
  const abs = Math.abs(amount);
  const plain = String(Math.round(abs));
  const grouped = Math.round(abs).toLocaleString('en-IN');
  const exact = abs.toFixed(2);
  return Array.from(new Set([plain, grouped, exact])).join(' ');
}

// ── Filters ──────────────────────────────────────────────────────────────────

export interface SearchFilters {
  /** Inclusive yyyy-MM-dd bounds. Empty string / null means unbounded. */
  from?: string | null;
  to?: string | null;
  type?: 'all' | 'income' | 'expense';
  /** Category slug, or null for all. */
  category?: string | null;
  /** Payment-method slug, or null for all. */
  account?: string | null;
  /** Which datasets to include. Undefined means all. */
  kinds?: SearchKind[] | null;
}

export const EMPTY_FILTERS: SearchFilters = {
  from: null,
  to: null,
  type: 'all',
  category: null,
  account: null,
  kinds: null,
};

/** True when the user has narrowed anything — drives the "clear filters" chip. */
export function hasActiveFilters(filters: SearchFilters): boolean {
  return (
    !!filters.from ||
    !!filters.to ||
    (!!filters.type && filters.type !== 'all') ||
    !!filters.category ||
    !!filters.account ||
    (!!filters.kinds && filters.kinds.length > 0)
  );
}

/**
 * Date comparison by yyyy-MM-dd prefix rather than by parsed Date.
 *
 * The stored dates are UTC ISO strings and the filter inputs are IST calendar
 * days; parsing both into Date objects and comparing instants makes the last
 * day of a range drop transactions logged that evening. Comparing the date
 * portion as a string is what the user means by "up to the 30th".
 */
const datePart = (iso: string): string => iso.slice(0, 10);

export function applyFilters(records: readonly SearchRecord[], filters: SearchFilters): SearchRecord[] {
  const { from, to, type, category, account, kinds } = filters;
  const kindSet = kinds && kinds.length > 0 ? new Set(kinds) : null;

  return records.filter((r) => {
    if (kindSet && !kindSet.has(r.kind)) return false;
    if (from && datePart(r.date) < from) return false;
    if (to && datePart(r.date) > to) return false;
    if (type && type !== 'all' && r.type !== type) return false;
    if (category && r.category !== category) return false;
    if (account && r.account !== account) return false;
    return true;
  });
}

// ── Index ────────────────────────────────────────────────────────────────────

/**
 * Fuse tuning.
 *
 * `threshold: 0.4` is the same value the tax classifier settled on and it is
 * the right band here too: "mcdonald" still finds "McDonald's", while unrelated
 * words don't bleed in. `ignoreLocation` matters because a merchant name is
 * usually in the middle of a description, not at the front, and the default
 * location/distance scoring would penalise exactly the hits we want.
 */
const BASE_OPTIONS: IFuseOptions<SearchRecord> = {
  keys: [
    { name: 'title', weight: 0.5 },
    { name: 'searchText', weight: 0.35 },
    { name: 'amountText', weight: 0.15 },
  ],
  includeScore: true,
  ignoreLocation: true,
  minMatchCharLength: 2,
};

/**
 * Two indexes, because one threshold cannot serve both query lengths.
 *
 * Fuse's threshold is proportional to the pattern length: at 0.4 a four-letter
 * query is allowed a full edit, and one edit in four letters is a different
 * word. Concretely, "rent" matched every Entertainment row in the ledger —
 * "ment" is one substitution away — which buries the actual rent payments in
 * noise. Somebody who types four letters is being specific.
 *
 * At six-plus letters the same slack is what makes "mcdonald" find McDonald's
 * and "netflx" find Netflix, which is the whole point of fuzzy matching. So:
 * strict for short queries, loose for longer ones.
 *
 * This has to be two indexes rather than one index with a score cutoff, because
 * the score Fuse reports is a WEIGHTED blend across keys and is not on the same
 * scale as the threshold — filtering on it discards genuine hits that matched a
 * low-weight key.
 */
export interface SearchIndex {
  strict: Fuse<SearchRecord>;
  loose: Fuse<SearchRecord>;
}

/** Queries at or below this length use the strict index. */
const SHORT_QUERY_LENGTH = 4;

export function buildIndex(records: readonly SearchRecord[]): SearchIndex {
  const list = records as SearchRecord[];
  return {
    strict: new Fuse(list, { ...BASE_OPTIONS, threshold: 0.15 }),
    loose: new Fuse(list, { ...BASE_OPTIONS, threshold: 0.4 }),
  };
}

// ── Numeric queries ──────────────────────────────────────────────────────────

/** "2450", "₹2,450", "2450.50" — a query that is really an amount. */
const NUMERIC_QUERY = /^[₹\s]*\d[\d,]*(\.\d+)?\s*$/;

export function parseAmountQuery(query: string): { digits: string; value: number } | null {
  const trimmed = query.trim();
  if (!NUMERIC_QUERY.test(trimmed)) return null;
  const digits = trimmed.replace(/[^\d.]/g, '');
  const value = Number.parseFloat(digits);
  if (!Number.isFinite(value)) return null;
  return { digits: digits.replace(/\./g, ''), value };
}

/**
 * Rank a numeric query.
 *
 * Exact amounts first (that is nearly always what was meant), then amounts
 * whose digits START with what was typed — "24" surfacing ₹2,400 and ₹2,450 is
 * useful; surfacing ₹1,242 because it contains "24" is noise, so containment is
 * scored well below prefix rather than excluded outright.
 */
function scoreNumeric(record: SearchRecord, digits: string, value: number): number | null {
  const rounded = Math.round(Math.abs(record.amount));
  if (Math.abs(Math.abs(record.amount) - value) < 0.005) return 0;
  const plain = String(rounded);
  if (plain.startsWith(digits)) return 0.2 + Math.min(0.2, (plain.length - digits.length) * 0.02);
  if (plain.includes(digits)) return 0.6;
  return null;
}

// ── Search ───────────────────────────────────────────────────────────────────

export interface SearchTotals {
  count: number;
  /** Sum of expense amounts among the matches. */
  expenseTotal: number;
  /** Sum of income amounts among the matches. */
  incomeTotal: number;
  /**
   * The headline figure. When the matches are all one direction it is that
   * direction's total; when they are mixed it is the net. Showing a single
   * blended "total" across income and expense would be a meaningless number.
   */
  headline: number;
  /** True when both income and expense are present in the matches. */
  mixed: boolean;
  /** Sum over non-transaction matches (udhar outstanding, product prices). */
  otherTotal: number;
}

export interface SearchOutcome {
  results: SearchRecord[];
  totals: SearchTotals;
}

export function totalsFor(records: readonly SearchRecord[]): SearchTotals {
  let expenseTotal = 0;
  let incomeTotal = 0;
  let otherTotal = 0;

  for (const r of records) {
    if (r.kind !== 'transaction') otherTotal += r.amount;
    else if (r.type === 'income') incomeTotal += r.amount;
    else expenseTotal += r.amount;
  }

  const mixed = incomeTotal > 0 && expenseTotal > 0;
  const headline = mixed
    ? incomeTotal - expenseTotal
    : incomeTotal > 0
      ? incomeTotal
      : expenseTotal > 0
        ? expenseTotal
        : otherTotal;

  return { count: records.length, expenseTotal, incomeTotal, headline, mixed, otherTotal };
}

/**
 * Run a search.
 *
 * Filters are applied to the FUZZY OUTPUT rather than before indexing, because
 * the index is memoised across keystrokes and rebuilding it whenever a filter
 * chip changes would throw away the only expensive thing here. At a few hundred
 * rows the post-filter is a single cheap pass.
 *
 * An empty query is not an empty result — it means "everything that matches the
 * filters", newest first, which is what makes the filter chips usable on their
 * own.
 */
export function runSearch(
  records: readonly SearchRecord[],
  index: SearchIndex,
  query: string,
  filters: SearchFilters,
): SearchOutcome {
  const trimmed = query.trim();

  if (trimmed.length === 0) {
    const results = applyFilters(records, filters).sort(
      (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime(),
    );
    return { results, totals: totalsFor(results) };
  }

  const scores = new Map<string, number>();

  // Numeric pass — exact amounts beat everything.
  const numeric = parseAmountQuery(trimmed);
  if (numeric) {
    for (const record of records) {
      const score = scoreNumeric(record, numeric.digits, numeric.value);
      if (score !== null) scores.set(record.id, score);
    }
  }

  // A query that is ONLY digits is an amount, full stop, and the numeric pass
  // has already answered it exactly. Running Fuse over it as well drags in
  // every record whose amount merely looks similar — searching "2450" and
  // getting ₹240 and ₹924 back is not fuzziness, it is a wrong answer.
  if (!numeric) {
    const fuse = trimmed.length <= SHORT_QUERY_LENGTH ? index.strict : index.loose;
    for (const hit of fuse.search(trimmed)) {
      const score = hit.score ?? 1;
      const existing = scores.get(hit.item.id);
      if (existing === undefined || score < existing) scores.set(hit.item.id, score);
    }
  }

  if (scores.size === 0) return { results: [], totals: totalsFor([]) };

  const byId = new Map(records.map((r) => [r.id, r]));
  const matched: SearchRecord[] = [];
  for (const id of scores.keys()) {
    const record = byId.get(id);
    if (record) matched.push(record);
  }

  const results = applyFilters(matched, filters).sort((a, b) => {
    const diff = (scores.get(a.id) ?? 1) - (scores.get(b.id) ?? 1);
    // Equal relevance is common (identical merchant, different months) — break
    // the tie by recency so the list reads chronologically rather than randomly.
    if (Math.abs(diff) > 0.001) return diff;
    return new Date(b.date).getTime() - new Date(a.date).getTime();
  });

  return { results, totals: totalsFor(results) };
}

/** Category slugs actually present in the corpus, with labels, for the filter. */
export function categoriesIn(records: readonly SearchRecord[]): { value: string; label: string }[] {
  const slugs = new Set<string>();
  for (const r of records) if (r.category) slugs.add(r.category);
  return [...slugs]
    .map((value) => ({ value, label: categoryLabel(value) }))
    .sort((a, b) => a.label.localeCompare(b.label));
}
