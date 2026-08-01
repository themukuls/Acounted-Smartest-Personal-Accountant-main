/**
 * extract.ts — turn one sentence into a validated AssistantAction.
 *
 * The LLM call is injected (`ExtractDeps.complete`) rather than imported, so
 * the whole normalisation path is testable without a network or an API key.
 *
 * Nothing here writes to the database. The worst a misbehaving model can do is
 * produce an `unclear` result.
 */

import { format, isValid, parseISO, differenceInDays } from 'date-fns';
import { getISTDate } from '@/lib/date-utils';
import {
  DEFAULT_ACCOUNT,
  DEFAULT_CATEGORIES,
  INCOME_CATEGORY,
  slugifyCategory,
} from '@/lib/categories';
import { getExpenseCategories } from '@/integrations/indexeddb/services/onboardingService';
import { getRecentTransactions } from '@/integrations/indexeddb/services/dataService';
import { buildSystemPrompt, buildUserPrompt } from './prompt';
import { getProvider, ProviderError } from './providers';
import {
  beginCorrectionCapture,
  buildProfile,
  getCorrections,
  personaliseAction,
  type HistoryTransaction,
} from './learning';
import type { LLMConfig } from './settings';
import {
  assistantActionSchema,
  isWritable,
  unclear,
  type AssistantAction,
  type WritableAction,
} from './types';

export interface ExtractDeps {
  /** Calls the model and returns its raw text. */
  complete: (system: string, user: string, signal?: AbortSignal) => Promise<string>;
  /** Today in IST. */
  today: Date;
  /** Category slugs the model is allowed to pick from. */
  categorySlugs: string[];
  /**
   * Optional local personalisation, applied to the model's answer AFTER it
   * comes back. It reads the user's own history to fill in the fields the model
   * had to guess. It is deliberately a post-pass and not prompt context: see
   * the privacy contract at the top of learning.ts.
   */
  personalise?: (action: WritableAction, utterance: string) => WritableAction;
  signal?: AbortSignal;
}

/** How many past transactions the local personaliser learns from. */
const HISTORY_WINDOW = 400;

/** Dates further than this from today are treated as a model mistake. */
const MAX_DATE_DRIFT_DAYS = 730;

// ─── Pure helpers (exported for tests) ────────────────────────────────────────

/**
 * Models wrap JSON in ```json fences even when told not to. Strip them, and
 * fall back to the outermost {...} span if there's stray prose around it.
 */
export function stripCodeFences(raw: string): string {
  let text = raw.trim();

  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced) text = fenced[1].trim();

  if (!text.startsWith('{')) {
    const first = text.indexOf('{');
    const last = text.lastIndexOf('}');
    if (first !== -1 && last > first) text = text.slice(first, last + 1);
  }

  return text.trim();
}

/** Filler words that carry no signal when matching a category name. */
const MATCH_STOPWORDS = new Set(['and', 'the', 'of', 'for', 'my', 'a', 'on']);

/**
 * Split a slug or a human label into comparable tokens.
 * Punctuation becomes a separator, so "Food & Dining" and "food-dining" both
 * reduce to ["food", "dining"].
 */
const tokenize = (text: string): string[] =>
  text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .split(/\s+/)
    .filter((t) => t && !MATCH_STOPWORDS.has(t));

/**
 * Two slug tokens refer to the same thing.
 * Exact, or one is a prefix of the other — but only from 4 characters, so
 * "book"/"books" matches while "med"/"medicine" does not.
 */
function tokensMatch(a: string, b: string): boolean {
  if (a === b) return true;
  const [short, long] = a.length <= b.length ? [a, b] : [b, a];
  return short.length >= 4 && long.startsWith(short);
}

/** Fraction of the larger token set that the two slugs agree on. */
function overlapScore(candidateTokens: string[], slug: string): number {
  const slugTokens = tokenize(slug);
  const shared = slugTokens.filter((st) =>
    candidateTokens.some((ct) => tokensMatch(ct, st)),
  ).length;
  if (shared === 0) return 0;
  return shared / Math.max(slugTokens.length, candidateTokens.length);
}

/**
 * Snap whatever the model said to a slug that actually exists.
 * Falls through: exact -> slugified -> best token overlap -> "others".
 *
 * The overlap has to be scored rather than a plain substring test. A bare
 * `slugged.includes(slug)` files "spaceship-fuel-tax" under "fuel" and
 * "current-account" under "rent", because a long unfamiliar phrase happens to
 * contain a short slug. Requiring half the tokens to agree keeps the useful
 * cases ("tech" -> "tech-products", "food-dining" -> "food") and drops the
 * accidental ones into "others", where the user can see and fix them.
 */
export function snapCategory(raw: string, allowed: string[]): string {
  const candidate = (raw ?? '').trim().toLowerCase();
  if (!candidate) return 'others';
  if (candidate === INCOME_CATEGORY) return INCOME_CATEGORY;
  if (allowed.includes(candidate)) return candidate;

  const slugged = slugifyCategory(candidate);
  if (allowed.includes(slugged)) return slugged;

  const candidateTokens = tokenize(candidate);
  if (candidateTokens.length === 0) return 'others';
  let bestSlug = 'others';
  let bestScore = 0;

  for (const slug of allowed) {
    const score = overlapScore(candidateTokens, slug);
    if (score > bestScore) {
      bestScore = score;
      bestSlug = slug;
    }
  }

  return bestScore >= 0.5 ? bestSlug : 'others';
}

/**
 * Keep a model-supplied date honest: must parse, and must be within
 * MAX_DATE_DRIFT_DAYS of today. Anything else falls back to today.
 */
export function sanitizeDate(raw: string, today: Date): { date: string; corrected: boolean } {
  const todayIso = format(today, 'yyyy-MM-dd');
  const parsed = parseISO(raw);

  if (!isValid(parsed)) return { date: todayIso, corrected: true };
  if (Math.abs(differenceInDays(parsed, today)) > MAX_DATE_DRIFT_DAYS) {
    return { date: todayIso, corrected: true };
  }
  return { date: raw, corrected: false };
}

/** Add a field name to `assumed` without duplicating it. */
function markAssumed(assumed: string[], field: string): string[] {
  return assumed.includes(field) ? assumed : [...assumed, field];
}

/**
 * Did the model actually emit this key, or did zod's `.default()` invent it?
 *
 * This matters for the learning layer downstream. `account` defaults to a
 * string in the schema, so by the time we hold a parsed action an omitted
 * account is indistinguishable from a confidently-chosen one — and the local
 * personaliser would then leave a fabricated default in place. Checking the raw
 * object is the only honest way to tell.
 */
function stated(json: unknown, key: string): boolean {
  if (!json || typeof json !== 'object') return false;
  const value = (json as Record<string, unknown>)[key];
  if (value === undefined || value === null) return false;
  return typeof value === 'string' ? value.trim() !== '' : true;
}

/**
 * Parse + validate + normalise. Returns null when the text isn't usable JSON,
 * which is the signal to retry.
 */
export function parseActionJson(
  raw: string,
  opts: { today: Date; categorySlugs: string[] },
): AssistantAction | null {
  let json: unknown;
  try {
    json = JSON.parse(stripCodeFences(raw));
  } catch {
    return null;
  }

  const result = assistantActionSchema.safeParse(json);
  if (!result.success) return null;

  const action = result.data;

  switch (action.kind) {
    case 'add_transaction': {
      const { date, corrected } = sanitizeDate(action.transaction_date, opts.today);
      const isIncome = action.type === 'income';

      let assumed = corrected
        ? markAssumed(action.assumed, 'transaction_date')
        : action.assumed;
      // A field the model never emitted is by definition assumed, whatever its
      // own `assumed` array claims.
      if (!isIncome && !stated(json, 'category')) assumed = markAssumed(assumed, 'category');

      // An omitted account is UPI, not the schema's legacy 'cash' default.
      const account = stated(json, 'account') ? action.account.trim() : DEFAULT_ACCOUNT;
      if (!stated(json, 'account')) assumed = markAssumed(assumed, 'account');

      return {
        ...action,
        category: isIncome
          ? INCOME_CATEGORY
          : snapCategory(action.category, opts.categorySlugs),
        account,
        transaction_date: date,
        assumed,
      };
    }

    case 'add_udhar': {
      const { date, corrected } = sanitizeDate(action.due_date, opts.today);
      return {
        ...action,
        person: action.person.trim(),
        due_date: date,
        assumed: corrected ? markAssumed(action.assumed, 'due_date') : action.assumed,
      };
    }

    case 'log_udhar_payment': {
      const { date, corrected } = sanitizeDate(action.date, opts.today);
      return {
        ...action,
        person: action.person.trim(),
        date,
        assumed: corrected ? markAssumed(action.assumed, 'date') : action.assumed,
      };
    }

    default:
      return action;
  }
}

// ─── The extraction call ──────────────────────────────────────────────────────

const RETRY_NUDGE =
  '\n\nYour previous reply was not valid JSON. Reply with ONLY the JSON object — no prose, no markdown fences.';

export async function extractAction(
  utterance: string,
  deps: ExtractDeps,
): Promise<AssistantAction> {
  const text = utterance.trim();
  if (!text) return unclear('I did not catch anything. Try again?');

  const system = buildSystemPrompt({ today: deps.today, categorySlugs: deps.categorySlugs });
  const user = buildUserPrompt(text);
  const opts = { today: deps.today, categorySlugs: deps.categorySlugs };

  /**
   * The local personalisation pass. It runs on the way OUT, never on the way
   * in — by the time this executes the network call is already over, so nothing
   * it reads can possibly influence what was sent.
   */
  const finish = (action: AssistantAction): AssistantAction => {
    if (!deps.personalise || !isWritable(action)) return action;
    try {
      return deps.personalise(action, text);
    } catch {
      // Personalisation is an improvement, not a dependency. A bad profile must
      // never cost the user the extraction they just waited for.
      return action;
    }
  };

  const first = await deps.complete(system, user, deps.signal);
  const parsed = parseActionJson(first, opts);
  if (parsed) return finish(parsed);

  // One retry — models usually comply once told explicitly.
  const second = await deps.complete(system + RETRY_NUDGE, user, deps.signal);
  const retried = parseActionJson(second, opts);
  if (retried) return finish(retried);

  return unclear(
    "I couldn't turn that into a record. Try something like \"spent 450 on groceries yesterday\".",
  );
}

// ─── Wiring it to the user's configured provider ──────────────────────────────

/**
 * Build the deps for the real, configured provider.
 *
 * `userId` is used only for LOCAL lookups — the user's own category slugs and,
 * now, their own transaction history for the personalisation post-pass. Neither
 * the id nor anything read with it is sent to the provider: `buildSystemPrompt`
 * receives exactly two things, the date and the slug list, and
 * `learning.test.ts` asserts that mechanically.
 */
export async function createExtractDeps(
  config: LLMConfig,
  userId: string,
  signal?: AbortSignal,
): Promise<ExtractDeps> {
  const provider = getProvider(config.provider);

  const defaultSlugs = DEFAULT_CATEGORIES.map((c) => c.category_name);
  let customSlugs: string[] = [];
  try {
    const rows = await getExpenseCategories(userId);
    customSlugs = rows
      .map((r) => r.category_name)
      .filter((slug) => slug && !defaultSlugs.includes(slug));
  } catch {
    /* categories are a nice-to-have; the defaults are enough */
  }

  const today = getISTDate();
  const categorySlugs = Array.from(new Set([...defaultSlugs, ...customSlugs]));

  // ── Local personalisation context ──────────────────────────────────────────
  let history: HistoryTransaction[] = [];
  try {
    history = (await getRecentTransactions(userId, HISTORY_WINDOW)) as HistoryTransaction[];
  } catch {
    /* a new install has no history; the defaults below still apply */
  }
  const profile = buildProfile(history, today);
  const corrections = getCorrections(userId);

  return {
    today,
    categorySlugs,
    signal,
    personalise: (action, utterance) => {
      const { action: next } = personaliseAction(action, utterance, {
        profile,
        corrections,
        categorySlugs,
      });
      // Stash what we handed over, so apply.ts can tell what the user changed.
      beginCorrectionCapture(userId, utterance, next);
      return next;
    },
    complete: (system, user, sig) =>
      provider.complete({
        apiKey: config.apiKey,
        model: config.model,
        baseUrl: config.baseUrl,
        system,
        user,
        signal: sig,
      }),
  };
}

/** Round-trip a trivial prompt to prove the key and model work. */
export async function testConnection(config: LLMConfig): Promise<void> {
  const provider = getProvider(config.provider);
  const reply = await provider.complete({
    apiKey: config.apiKey,
    model: config.model,
    baseUrl: config.baseUrl,
    system: 'Reply with exactly this JSON and nothing else: {"ok":true}',
    user: 'ping',
  });
  if (!reply || !reply.trim()) {
    throw new ProviderError('The provider replied with nothing.');
  }
}
