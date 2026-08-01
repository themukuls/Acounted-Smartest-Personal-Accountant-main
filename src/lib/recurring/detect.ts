/**
 * detect.ts — finds the money that leaves silently.
 *
 * A personal ledger contains two kinds of spend: the stuff you decided to buy,
 * and the stuff that decided itself. Netflix at ₹149 on the 12th, the wifi bill,
 * the EMI, the gym. Nobody remembers all of them, and nobody notices when one
 * quietly goes from ₹149 to ₹199. This module is the part that notices.
 *
 * PURE. No React, no storage, no `Date.now()` unless you pass it in (`opts.now`).
 * Everything here is a function of its arguments, which is why it is the only
 * part of the feature that carries tests.
 *
 * The pipeline, in order:
 *
 *   1. NORMALISE   description → a stable grouping label ("NETFLIX*Sub 4471"
 *                  and "netflix subscription" must land in the same bucket)
 *   2. CLUSTER     within a label, split on amount so "rent 25000" and a
 *                  one-off "rent deposit 60000" don't get averaged together
 *   3. MERGE       re-join time-disjoint clusters of the same label — that
 *                  join IS the price rise, and it is the headline finding
 *   4. CADENCE     fit weekly / monthly / quarterly against the dates, with a
 *                  median-offset correction so a constant billing-day shift
 *                  doesn't read as noise
 *   5. SCORE       confidence from occurrence count, timing tightness, amount
 *                  stability, missed periods and recency
 *
 * Two occurrences are never a pattern. That is not a tunable — a pair of
 * identical amounts 30 days apart is the single most common false positive in
 * this problem space (two grocery runs, two fuel fills), and shipping it would
 * teach users to ignore the whole screen.
 */

import { categoryLabel } from '@/lib/categories';

// ── Public types ─────────────────────────────────────────────────────────────

/** The subset of a transaction row the detector actually reads. */
export interface RecurringInput {
  id: string;
  amount: number;
  category: string;
  description?: string | null;
  /** ISO string. */
  transaction_date: string;
  /** 'income' rows are ignored. Absent is treated as an expense. */
  type?: string | null;
  /** Payment method slug, carried through to the result for display. */
  account?: string | null;
}

export type Cadence = 'weekly' | 'monthly' | 'quarterly';

export interface PriceChange {
  /** What it used to cost. */
  from: number;
  /** What it costs now. */
  to: number;
  /** ISO date of the first charge at the new price. */
  changedOn: string;
  /** Percentage increase, e.g. 33.6 for 149 → 199. */
  pctChange: number;
  /** Extra rupees per year at the new price. */
  annualImpact: number;
}

export interface RecurringSeries {
  /**
   * Stable identity for this series across re-runs. Built from the normalised
   * label + cadence, NOT from transaction ids — a dismissal has to survive the
   * next charge landing in the ledger.
   */
  key: string;
  /** Human label, drawn from the most representative description. */
  label: string;
  /** The current (most recent) charge. */
  amount: number;
  cadence: Cadence;
  /** ISO date of the most recent occurrence. */
  lastSeen: string;
  /** ISO date the next charge is expected. */
  nextExpected: string;
  /** 0..1. Below ~0.5 the caller should treat this as a suggestion, not a fact. */
  confidence: number;
  transactionIds: string[];
  occurrences: number;
  category: string;
  account: string | null;
  /** Normalised cost per calendar month — the comparable number. */
  monthlyCost: number;
  /** monthlyCost × 12 — the number that makes people cancel things. */
  annualCost: number;
  /** Set when the charge has stepped up. The most valuable field here. */
  priceChange: PriceChange | null;
}

export interface DetectOptions {
  /** Reference "today". Defaults to `new Date()`. Injected so tests are stable. */
  now?: Date;
  /** Minimum occurrences before a group is claimed as a pattern. Default 3. */
  minOccurrences?: number;
  /** Allowed timing drift in days. Default 3. */
  dayTolerance?: number;
  /** Allowed amount drift as a fraction. Default 0.10. */
  amountTolerance?: number;
  /** Series keys the user has dismissed. Filtered out of the result. */
  dismissedKeys?: readonly string[];
  /** Drop series whose confidence is below this. Default 0.4. */
  minConfidence?: number;
}

// ── Constants ────────────────────────────────────────────────────────────────

const DAY_MS = 24 * 60 * 60 * 1000;

/** Average period length in days, used only to *guess* the period multiple. */
const CADENCE_DAYS: Record<Cadence, number> = {
  weekly: 7,
  monthly: 30.4375,
  quarterly: 91.3125,
};

/** How many times a cadence occurs in a calendar month. */
const PER_MONTH: Record<Cadence, number> = {
  weekly: 52 / 12,
  monthly: 1,
  quarterly: 1 / 3,
};

/** Cadences are tried in this order; the first acceptable fit wins ties. */
const CADENCE_ORDER: Cadence[] = ['monthly', 'weekly', 'quarterly'];

/**
 * Words that carry no identity. Payment rails, reference noise and the generic
 * verbs people type. Stripping these is what makes "paid netflix via upi" and
 * "netflix" the same subscription.
 */
const NOISE_WORDS = new Set([
  'paid', 'pay', 'payment', 'payments', 'bill', 'billing', 'billed',
  'for', 'the', 'a', 'an', 'to', 'of', 'via', 'on', 'at', 'from', 'my',
  'upi', 'imps', 'neft', 'rtgs', 'ach', 'nach', 'emandate', 'mandate',
  'autopay', 'auto', 'debit', 'credit', 'card', 'txn', 'transaction',
  'ref', 'reference', 'no', 'id', 'inr', 'rs', 'rupees',
  'month', 'monthly', 'week', 'weekly', 'quarter', 'quarterly', 'year', 'yearly',
  'recharge', 'renewal', 'renew', 'plan', 'charge', 'charges',
]);

// ── Normalisation ────────────────────────────────────────────────────────────

/**
 * description → grouping token.
 *
 * Descriptions in this app are stored as DOMPurify-sanitised HTML, so tags come
 * off first. Then: lowercase, kill everything that isn't a letter, drop the
 * noise vocabulary, and keep the surviving words sorted so word order can't
 * fork a group ("netflix subscription" vs "subscription netflix").
 *
 * Digits are dropped wholesale. Statement descriptions are full of card
 * fragments and reference numbers that differ on every single charge — keeping
 * them would guarantee every group has exactly one member.
 */
export function normaliseLabel(description: string | null | undefined): string {
  if (!description) return '';
  const words = description
    .replace(/<[^>]*>/g, ' ')
    .toLowerCase()
    .replace(/[^a-z\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length >= 2 && !NOISE_WORDS.has(w));

  // De-duplicate and sort: order-independent, repetition-independent.
  return Array.from(new Set(words)).sort().join(' ');
}

/** Title-cased display label from an original description. */
function prettyLabel(raw: string): string {
  const cleaned = raw.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
  if (!cleaned) return '';
  return cleaned
    .split(' ')
    .map((w) => (w.length > 3 && w === w.toUpperCase() ? w : w.charAt(0).toUpperCase() + w.slice(1)))
    .join(' ');
}

// ── Small date helpers (no timezone games — these are calendar operations) ────

const toDate = (iso: string): Date => new Date(iso);

const daysBetween = (a: Date, b: Date): number => (b.getTime() - a.getTime()) / DAY_MS;

/**
 * Add `n` periods to a date, clamping the day-of-month the way billing systems
 * do: Jan 31 + 1 month is the last day of February, not March 3rd.
 */
function addPeriods(date: Date, cadence: Cadence, n: number): Date {
  if (cadence === 'weekly') return new Date(date.getTime() + n * 7 * DAY_MS);
  const months = cadence === 'monthly' ? n : n * 3;
  const y = date.getFullYear();
  const m = date.getMonth() + months;
  const d = date.getDate();
  const lastDayOfTarget = new Date(y, m + 1, 0).getDate();
  const result = new Date(date.getTime());
  result.setFullYear(y, m, Math.min(d, lastDayOfTarget));
  return result;
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

// ── Step 4: cadence fitting ──────────────────────────────────────────────────

interface CadenceFit {
  cadence: Cadence;
  /** Mean absolute timing error in days after removing the constant offset. */
  meanDeviation: number;
  /** Worst single deviation, in days. */
  maxDeviation: number;
  /** Periods where a charge was expected but none exists. */
  missedPeriods: number;
  /** Period index of the last occurrence, relative to the anchor. */
  lastIndex: number;
  /** Constant offset (days) applied to the anchor to best fit the series. */
  offsetDays: number;
  /** Occurrences discarded as off-schedule to reach this fit. */
  droppedCount: number;
}

/** A fit plus the subset of the input it actually describes. */
interface SeriesFit {
  fit: CadenceFit;
  /** Indices into the original array that belong to the series, in order. */
  kept: number[];
}

/**
 * A tolerance is only a tolerance if it is small relative to the period.
 *
 * ±3 days against a 30-day month is a 10% window — genuine slack. ±3 days
 * against a 7-day week covers 86% of the grid, at which point *any* set of
 * dates can be snapped to a weekly schedule and "weekly" stops meaning
 * anything. Capping the window at a quarter of the period keeps the caller's
 * `dayTolerance` honest for monthly and quarterly (where it binds unchanged)
 * while making weekly claims earn themselves.
 */
const MAX_TOLERANCE_FRACTION = 0.25;

function effectiveTolerance(cadence: Cadence, dayTolerance: number): number {
  return Math.min(dayTolerance, CADENCE_DAYS[cadence] * MAX_TOLERANCE_FRACTION);
}

/**
 * Try to fit one cadence to a sorted list of dates.
 *
 * Method: index each date to the nearest whole period from the first date, then
 * subtract the MEDIAN residual before judging the fit. The median subtraction is
 * what buys real tolerance — a series billed consistently 2 days later than the
 * anchor suggests is a perfect monthly series with a 2-day offset, not a series
 * with 2 days of error on every point. Without it, ±3 days of genuine drift on
 * top of a systematic offset would be rejected.
 *
 * Returns null when the dates cannot be a series of this cadence at all
 * (duplicate period slots, or a fit outside `tolerance`).
 */
function fitCadence(dates: Date[], cadence: Cadence, dayTolerance: number): CadenceFit | null {
  const measured = measureFit(dates, cadence);
  if (!measured) return null;
  if (measured.maxDeviation > effectiveTolerance(cadence, dayTolerance)) return null;
  return measured.fit;
}

/**
 * The raw geometry of a cadence fit, before any tolerance judgement.
 * Split out so the trimming pass below can see per-occurrence errors.
 */
function measureFit(
  dates: Date[],
  cadence: Cadence,
): { fit: CadenceFit; errors: number[]; maxDeviation: number } | null {
  if (dates.length < 2) return null;

  const anchor = dates[0];
  const periodDays = CADENCE_DAYS[cadence];
  const indices = dates.map((date) => Math.round(daysBetween(anchor, date) / periodDays));

  // Strictly increasing period slots: two charges in the same slot means this
  // cadence is too coarse for the data (e.g. weekly data read as monthly).
  for (let i = 1; i < indices.length; i++) {
    if (indices[i] <= indices[i - 1]) return null;
  }

  const residuals = dates.map((date, i) => daysBetween(addPeriods(anchor, cadence, indices[i]), date));
  const offset = median(residuals);
  const errors = residuals.map((r) => Math.abs(r - offset));
  const maxDeviation = Math.max(...errors);
  const lastIndex = indices[indices.length - 1];

  return {
    fit: {
      cadence,
      meanDeviation: errors.reduce((s, e) => s + e, 0) / errors.length,
      maxDeviation,
      missedPeriods: lastIndex + 1 - dates.length,
      lastIndex,
      offsetDays: offset,
      droppedCount: 0,
    },
    errors,
    maxDeviation,
  };
}

/**
 * Fit one cadence, discarding at most a minority of off-schedule occurrences.
 *
 * Real ledgers contain the odd charge that landed a week late, or a manual
 * entry logged on the wrong day. Rejecting an entire eight-month subscription
 * because one payment slipped is the wrong trade — the user still has the
 * subscription, and it is still costing them money. So: fit, and if a small
 * minority of points fall outside the window, drop those and re-fit on what
 * remains.
 *
 * The guards on how far this can go are what keep it honest. At most a third of
 * the occurrences may be discarded, never below `minOccurrences` survivors, and
 * the survivors must fit cleanly with no second trimming pass. A series that
 * only holds together after throwing half its evidence away was never a series.
 */
const MAX_DROP_FRACTION = 1 / 3;

function fitCadenceRobust(
  dates: Date[],
  cadence: Cadence,
  dayTolerance: number,
  minOccurrences: number,
): SeriesFit | null {
  const all = dates.map((_, i) => i);

  const strict = fitCadence(dates, cadence, dayTolerance);
  if (strict) return { fit: strict, kept: all };

  const measured = measureFit(dates, cadence);
  if (!measured) return null;

  const tolerance = effectiveTolerance(cadence, dayTolerance);
  const kept = all.filter((i) => measured.errors[i] <= tolerance);

  const dropped = dates.length - kept.length;
  if (dropped === 0) return null; // nothing to trim; it simply doesn't fit
  if (kept.length < minOccurrences) return null;
  if (dropped > Math.floor(dates.length * MAX_DROP_FRACTION)) return null;

  const refit = fitCadence(kept.map((i) => dates[i]), cadence, dayTolerance);
  if (!refit) return null;

  return { fit: { ...refit, droppedCount: dropped }, kept };
}

/**
 * Best cadence for a series, or null.
 *
 * Ordered preference (monthly first) matters: a series 30 days apart fits both
 * "monthly" and "4-weekly-ish", and monthly is overwhelmingly the truth for
 * subscriptions, rent and EMIs. Only if monthly is rejected outright do we look
 * at weekly and quarterly.
 */
function bestCadence(dates: Date[], tolerance: number, minOccurrences = 3): SeriesFit | null {
  for (const cadence of CADENCE_ORDER) {
    const candidate = fitCadenceRobust(dates, cadence, tolerance, minOccurrences);
    if (!candidate) continue;
    const { fit, kept } = candidate;

    // A fit that requires more skipped periods than actual charges is not a
    // pattern, it's a coincidence stretched over a wide grid.
    if (fit.missedPeriods >= kept.length) continue;

    // At the bare minimum of evidence, demand a perfect run. Three charges with
    // a hole in the middle is three unrelated payments that happen to be
    // snappable to a grid — the single most common way a detector like this
    // manufactures subscriptions out of ordinary spending. Once there are four
    // or more charges the shape is real enough that a skipped period is more
    // likely a genuinely missed payment than a coincidence.
    if (kept.length < 4 && fit.missedPeriods > 0) continue;

    return candidate;
  }
  return null;
}

// ── Step 3: price change ─────────────────────────────────────────────────────

/**
 * A step change in the charge amount.
 *
 * "Current price" is the most recent amount; we walk backwards while amounts
 * stay within 2% of it (rounding, GST tweaks, ₹1 differences) and report the
 * first amount that doesn't. Only increases are reported — a price DROP is not
 * something anyone needs to act on.
 */
function detectPriceChange(
  occurrences: { amount: number; date: Date }[],
  perMonth: number,
): PriceChange | null {
  if (occurrences.length < 2) return null;
  const current = occurrences[occurrences.length - 1].amount;
  if (current <= 0) return null;

  let i = occurrences.length - 1;
  while (i > 0 && Math.abs(occurrences[i - 1].amount - current) / current <= 0.02) i--;
  if (i === 0) return null; // never changed

  const previous = occurrences[i - 1].amount;
  if (current <= previous) return null; // a drop, or noise

  return {
    from: previous,
    to: current,
    changedOn: occurrences[i].date.toISOString(),
    pctChange: ((current - previous) / previous) * 100,
    annualImpact: (current - previous) * perMonth * 12,
  };
}

// ── Step 2 + 3: amount clustering, then price-rise merging ───────────────────

interface Occurrence {
  id: string;
  amount: number;
  date: Date;
  description: string;
  category: string;
  account: string | null;
}

/**
 * Split one label group into amount clusters.
 *
 * Walks the group in date order, extending the current cluster while the next
 * amount is within `tolerance` of the cluster's running median. The running
 * median (rather than the first amount) means a cluster of ₹1000-ish charges
 * isn't derailed by one ₹1100 outlier at the front.
 */
function clusterByAmount(group: Occurrence[], tolerance: number): Occurrence[][] {
  const clusters: Occurrence[][] = [];
  let current: Occurrence[] = [];
  let reference = 0;

  for (const occ of group) {
    if (current.length === 0) {
      current = [occ];
      reference = occ.amount;
      continue;
    }
    const within = reference > 0 && Math.abs(occ.amount - reference) / reference <= tolerance;
    if (within) {
      current.push(occ);
      reference = median(current.map((o) => o.amount));
    } else {
      clusters.push(current);
      current = [occ];
      reference = occ.amount;
    }
  }
  if (current.length > 0) clusters.push(current);
  return clusters;
}

/**
 * Re-join clusters that are the same subscription at a different price.
 *
 * This is the step that finds price rises. A subscription that went ₹149 → ₹199
 * is ONE series with a price change, not two series — and reporting it as two
 * would bury exactly the fact the user needs.
 *
 * Three conditions, all necessary:
 *
 *   - the clusters are DISJOINT IN TIME (the old price stops, the new one
 *     starts). Interleaved amounts mean two genuinely different things sharing
 *     a description, not a repricing.
 *   - the joined series still fits a cadence.
 *   - the EARLIER side already has at least two charges at a settled price.
 *   - BOTH sides are individually flat (see `SETTLED_PRICE_SPREAD`).
 *
 * The last two conditions are what stop this step from being a false-positive
 * machine. Without them, ordinary spending that merely trends upward — a
 * utility bill, or groceries creeping up month on month near the same date —
 * chains cluster after cluster into one long "subscription with a price rise",
 * and reports a fresh price rise every single month. A price step is a step: a
 * settled price, then a different settled price. One charge is not a price, and
 * a moving target is not a price either.
 */
const SETTLED_PRICE_SPREAD = 0.02;

/** True when every amount sits within `SETTLED_PRICE_SPREAD` of the median. */
function isSettledPrice(cluster: Occurrence[]): boolean {
  const amounts = cluster.map((o) => o.amount);
  const med = median(amounts);
  if (med <= 0) return false;
  return amounts.every((a) => Math.abs(a - med) / med <= SETTLED_PRICE_SPREAD);
}

function mergePriceSteps(clusters: Occurrence[][], tolerance: number): Occurrence[][] {
  if (clusters.length < 2) return clusters;

  const merged: Occurrence[][] = [];
  let current = clusters[0];

  for (let i = 1; i < clusters.length; i++) {
    const next = clusters[i];
    const currentEnd = current[current.length - 1].date.getTime();
    const nextStart = next[0].date.getTime();
    const eligible =
      nextStart > currentEnd &&
      current.length >= 2 &&
      isSettledPrice(current) &&
      isSettledPrice(next);

    const candidate = eligible ? [...current, ...next] : null;
    if (candidate && bestCadence(candidate.map((o) => o.date), tolerance)) {
      current = candidate;
    } else {
      merged.push(current);
      current = next;
    }
  }
  merged.push(current);
  return merged;
}

// ── Step 5: confidence ───────────────────────────────────────────────────────

/**
 * How much we believe this is really a subscription, 0..1.
 *
 * Deliberately multiplicative: a series can be perfectly regular and still be
 * untrustworthy if it stopped four months ago, and a long series is still weak
 * if half its expected charges are missing. Any one bad factor should be able
 * to drag the score down on its own.
 */
function scoreConfidence(
  occurrences: Occurrence[],
  fit: CadenceFit,
  dayTolerance: number,
  now: Date,
): number {
  const n = occurrences.length;

  // More history is more convincing, with diminishing returns after ~6.
  const countFactor = Math.min(1, 0.55 + (n - 3) * 0.12);

  // Timing: dead-on = 1, at the tolerance edge = 0.55.
  const timingFactor = 1 - 0.45 * Math.min(1, fit.meanDeviation / Math.max(dayTolerance, 0.001));

  // Amount stability: coefficient of variation against the median.
  const amounts = occurrences.map((o) => o.amount);
  const med = median(amounts) || 1;
  const spread = amounts.reduce((s, a) => s + Math.abs(a - med), 0) / amounts.length / med;
  const amountFactor = 1 - Math.min(0.4, spread * 2);

  // Missed charges: each hole in the grid costs, capped so a long series with
  // one skipped month isn't written off.
  const completeness = n / (n + fit.missedPeriods);
  const completenessFactor = 0.5 + 0.5 * completeness;

  // Recency: a series whose last charge is more than ~2 periods old is probably
  // cancelled. It still shows (users want to confirm it stopped) but ranks low.
  const periodDays = CADENCE_DAYS[fit.cadence];
  const sinceLast = daysBetween(occurrences[n - 1].date, now);
  const periodsOverdue = Math.max(0, sinceLast / periodDays - 1);
  const recencyFactor = 1 / (1 + Math.max(0, periodsOverdue - 0.5));

  // Charges thrown away as off-schedule are evidence against, not free.
  const tidiness = n / (n + fit.droppedCount);

  const raw =
    countFactor * timingFactor * amountFactor * completenessFactor * recencyFactor * tidiness;
  return Math.max(0, Math.min(1, Number(raw.toFixed(4))));
}

// ── Entry point ──────────────────────────────────────────────────────────────

/**
 * Find every recurring charge in a transaction list.
 *
 * Returns series sorted by annual cost, descending — the most expensive silent
 * commitment first, because that is the one worth acting on.
 */
export function detectRecurring(
  transactions: readonly RecurringInput[],
  opts: DetectOptions = {},
): RecurringSeries[] {
  const now = opts.now ?? new Date();
  const minOccurrences = Math.max(3, opts.minOccurrences ?? 3);
  const dayTolerance = opts.dayTolerance ?? 3;
  const amountTolerance = opts.amountTolerance ?? 0.1;
  const minConfidence = opts.minConfidence ?? 0.4;
  const dismissed = new Set(opts.dismissedKeys ?? []);

  // ── Step 1: normalise and bucket ───────────────────────────────────────────
  const groups = new Map<string, Occurrence[]>();

  for (const t of transactions) {
    if (t.type === 'income') continue;
    if (!Number.isFinite(t.amount) || t.amount <= 0) continue;
    const date = toDate(t.transaction_date);
    if (Number.isNaN(date.getTime())) continue;

    const descToken = normaliseLabel(t.description);
    // No usable description → fall back to the category, prefixed so a
    // category-only group can never collide with a description that happens to
    // normalise to the same word.
    const token = descToken || `cat:${t.category ?? 'others'}`;

    const bucket = groups.get(token);
    const occ: Occurrence = {
      id: t.id,
      amount: t.amount,
      date,
      description: (t.description ?? '').trim(),
      category: t.category ?? 'others',
      account: t.account ?? null,
    };
    if (bucket) bucket.push(occ);
    else groups.set(token, [occ]);
  }

  const results: RecurringSeries[] = [];

  for (const [token, rawGroup] of groups) {
    if (rawGroup.length < minOccurrences) continue;

    const group = [...rawGroup].sort((a, b) => a.date.getTime() - b.date.getTime());
    const clusters = mergePriceSteps(clusterByAmount(group, amountTolerance), dayTolerance);

    // A label that shattered into many small clusters is ad-hoc spending that
    // happens to share a word, not a subscription. Only clusters that survive
    // on their own merits below are kept, so no extra guard is needed here.
    for (let ci = 0; ci < clusters.length; ci++) {
      const cluster = clusters[ci];
      if (cluster.length < minOccurrences) continue;

      const candidate = bestCadence(cluster.map((o) => o.date), dayTolerance, minOccurrences);
      if (!candidate) continue;

      const { fit } = candidate;
      // The fit may have discarded off-schedule charges. Everything downstream
      // — amounts, ids, price change, totals — must describe the series that
      // was actually fitted, not the cluster we started from.
      const occurrences = candidate.kept.map((i) => cluster[i]);
      if (occurrences.length < minOccurrences) continue;

      const last = occurrences[occurrences.length - 1];
      const perMonth = PER_MONTH[fit.cadence];

      // Next charge: one period past the last one. Using the last actual date
      // (not the fitted grid) keeps the prediction honest when the biller has
      // genuinely shifted its billing day.
      const nextExpected = addPeriods(last.date, fit.cadence, 1);

      const priceChange = detectPriceChange(
        occurrences.map((o) => ({ amount: o.amount, date: o.date })),
        perMonth,
      );

      const confidence = scoreConfidence(occurrences, fit, dayTolerance, now);
      if (confidence < minConfidence) continue;

      // Display label: the longest original description in the cluster (the
      // most informative one), falling back to the category.
      const descriptions = occurrences.map((o) => o.description).filter(Boolean);
      const label =
        prettyLabel(descriptions.sort((a, b) => b.length - a.length)[0] ?? '') ||
        categoryLabel(last.category);

      // Key identity: label token + cadence. Deliberately NOT including the
      // amount or the cluster index — a dismissed subscription must stay
      // dismissed after its next charge, and after a price rise.
      const key = `${token}|${fit.cadence}`;
      if (dismissed.has(key)) continue;

      const monthlyCost = last.amount * perMonth;

      results.push({
        key,
        label,
        amount: last.amount,
        cadence: fit.cadence,
        lastSeen: last.date.toISOString(),
        nextExpected: nextExpected.toISOString(),
        confidence,
        transactionIds: occurrences.map((o) => o.id),
        occurrences: occurrences.length,
        category: last.category,
        account: last.account,
        monthlyCost,
        annualCost: monthlyCost * 12,
        priceChange,
      });
    }
  }

  // De-duplicate by key, keeping the highest-confidence series. Two clusters of
  // the same label that refused to merge would otherwise both claim the key,
  // and a dismissal would only silence one of them.
  const byKey = new Map<string, RecurringSeries>();
  for (const series of results) {
    const existing = byKey.get(series.key);
    if (!existing || series.confidence > existing.confidence) byKey.set(series.key, series);
  }

  return [...byKey.values()].sort((a, b) => b.annualCost - a.annualCost);
}

// ── Derived views the UI needs (kept pure and here, not in a component) ───────

export interface RecurringSummary {
  /** Every detected series. */
  series: RecurringSeries[];
  /** Total normalised monthly commitment. */
  monthlyTotal: number;
  /** monthlyTotal × 12 — the headline. */
  annualTotal: number;
  /** Series whose next charge lands within `dueSoonDays`. */
  dueSoon: RecurringSeries[];
  /** Series with a detected price increase. */
  priceRises: RecurringSeries[];
  /** Combined extra annual cost of every price rise. */
  priceRiseAnnualImpact: number;
}

/** Days ahead that counts as "due soon". One week reads as actionable. */
export const DUE_SOON_DAYS = 7;

export function summarise(
  series: readonly RecurringSeries[],
  opts: { now?: Date; dueSoonDays?: number } = {},
): RecurringSummary {
  const now = opts.now ?? new Date();
  const dueSoonDays = opts.dueSoonDays ?? DUE_SOON_DAYS;

  const monthlyTotal = series.reduce((sum, s) => sum + s.monthlyCost, 0);
  const priceRises = series.filter((s) => s.priceChange !== null);

  const dueSoon = series
    .filter((s) => {
      const days = daysBetween(now, toDate(s.nextExpected));
      return days <= dueSoonDays;
    })
    .sort((a, b) => toDate(a.nextExpected).getTime() - toDate(b.nextExpected).getTime());

  return {
    series: [...series],
    monthlyTotal,
    annualTotal: monthlyTotal * 12,
    dueSoon,
    priceRises,
    priceRiseAnnualImpact: priceRises.reduce((sum, s) => sum + (s.priceChange?.annualImpact ?? 0), 0),
  };
}

/**
 * Whole days from `now` until the next charge. Negative means overdue — the
 * charge should already have landed and hasn't, which usually means cancelled.
 *
 * Counted in CALENDAR days, not elapsed hours. "Due in 2 days" has to mean the
 * day after tomorrow regardless of what o'clock the previous charges happened
 * to be stamped at; an elapsed-hours count renders the same gap as 2 or 3
 * depending on the time of day the user opens the app.
 */
export function daysUntilNext(series: RecurringSeries, now: Date = new Date()): number {
  const dayStart = (d: Date): number => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  return Math.round((dayStart(toDate(series.nextExpected)) - dayStart(now)) / DAY_MS);
}
