/**
 * types.ts — the contract between the LLM and the app.
 *
 * The model's ONLY job is to produce one of these objects. It never writes to
 * the database, never sees existing data, and never does arithmetic on the
 * user's finances. Everything the model returns is parsed through zod before
 * it gets anywhere near IndexedDB, so a hallucinated field is a validation
 * error rather than a corrupt ledger row.
 */

import { z } from 'zod';

// ─── Amount parsing ───────────────────────────────────────────────────────────

/**
 * Parse a rupee amount the way an Indian user says it.
 *
 * The prompt asks the model for a plain number, but models drift — they return
 * "₹1,200", "2.5k" or "1 lakh". Rather than trust that, we normalise here.
 * Exported so it can be tested directly.
 *
 * Returns NaN for anything unparseable; callers must check.
 */
export function parseIndianAmount(raw: string | number): number {
  if (typeof raw === 'number') return raw;

  const text = String(raw)
    .toLowerCase()
    .replace(/[₹,\s]/g, '')
    .trim();
  if (!text) return NaN;

  // Suffix multipliers, longest first so "lakh" wins over "l".
  const MULTIPLIERS: [RegExp, number][] = [
    [/^(-?\d*\.?\d+)crores?$/, 1_00_00_000],
    [/^(-?\d*\.?\d+)cr$/,      1_00_00_000],
    [/^(-?\d*\.?\d+)lakhs?$/,     1_00_000],
    [/^(-?\d*\.?\d+)lacs?$/,      1_00_000],
    [/^(-?\d*\.?\d+)l$/,          1_00_000],
    [/^(-?\d*\.?\d+)k$/,             1_000],
    [/^(-?\d*\.?\d+)thousands?$/,    1_000],
  ];

  for (const [pattern, multiplier] of MULTIPLIERS) {
    const m = text.match(pattern);
    if (m) return parseFloat(m[1]) * multiplier;
  }

  // Plain number — reject trailing junk so "45abc" doesn't become 45.
  if (!/^-?\d*\.?\d+$/.test(text)) return NaN;
  return parseFloat(text);
}

/**
 * Accepts a number or a string and lands on a positive finite number.
 *
 * This matters more than it looks: saveTransaction in dataService.ts does
 * `typeof amount === 'number' ? amount : 0`, so a string amount is silently
 * written as ₹0. Coercing here is what stops that.
 */
const amountSchema = z
  .union([z.number(), z.string()])
  .transform(parseIndianAmount)
  .refine((n) => Number.isFinite(n) && n > 0, {
    message: 'amount must be a positive number',
  });

/** A calendar day, as the model is asked to emit it. */
const dateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'date must be YYYY-MM-DD');

/** Fields the model guessed rather than heard, so the UI can flag them. */
const assumedSchema = z.array(z.string()).default([]);

// ─── Action schemas ───────────────────────────────────────────────────────────

export const addTransactionSchema = z.object({
  kind: z.literal('add_transaction'),
  type: z.enum(['income', 'expense']),
  amount: amountSchema,
  /** Category slug, e.g. "food". Snapped to a known slug downstream. */
  category: z.string().default('others'),
  /** Payment method, e.g. "upi". Defaults to cash like the rest of the app. */
  account: z.string().default('cash'),
  description: z.string().default(''),
  transaction_date: dateSchema,
  assumed: assumedSchema,
});

export const addUdharSchema = z.object({
  kind: z.literal('add_udhar'),
  /** 'given' = they owe you. 'taken' = you owe them. */
  type: z.enum(['given', 'taken']),
  person: z.string().min(1, 'person is required'),
  amount: amountSchema,
  due_date: dateSchema,
  description: z.string().default(''),
  assumed: assumedSchema,
});

export const logUdharPaymentSchema = z.object({
  kind: z.literal('log_udhar_payment'),
  person: z.string().min(1, 'person is required'),
  amount: amountSchema,
  date: dateSchema,
  assumed: assumedSchema,
});

export const unclearSchema = z.object({
  kind: z.literal('unclear'),
  reason: z.string().default("I couldn't work out what to record from that."),
});

export const assistantActionSchema = z.discriminatedUnion('kind', [
  addTransactionSchema,
  addUdharSchema,
  logUdharPaymentSchema,
  unclearSchema,
]);

// ─── Inferred types ───────────────────────────────────────────────────────────

export type AddTransactionAction = z.infer<typeof addTransactionSchema>;
export type AddUdharAction = z.infer<typeof addUdharSchema>;
export type LogUdharPaymentAction = z.infer<typeof logUdharPaymentSchema>;
export type UnclearAction = z.infer<typeof unclearSchema>;
export type AssistantAction = z.infer<typeof assistantActionSchema>;

/** Every action kind except `unclear` — i.e. the ones that write something. */
export type WritableAction = Exclude<AssistantAction, UnclearAction>;

export function isWritable(action: AssistantAction): action is WritableAction {
  return action.kind !== 'unclear';
}

/** Build an `unclear` result without repeating the shape everywhere. */
export function unclear(reason: string): UnclearAction {
  return { kind: 'unclear', reason };
}
