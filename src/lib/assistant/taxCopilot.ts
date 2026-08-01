/**
 * taxCopilot.ts — the LLM's role in the Tax Copilot.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * THE DIVISION OF LABOUR — read this before changing anything here.
 *
 * The LLM does COMPREHENSION. It reads a messy question ("yaar mera tax kitna
 * banega", "can I still put money in that pension thing to save tax?") and
 * decides which of the engine's intents it maps to, plus any slots.
 *
 * The ENGINE does COMPUTATION. Every rupee in the reply comes from
 * answerQuestion() running against the user's local TaxState.
 *
 * Consequences, both deliberate:
 *   1. The user's income, deductions and tax position NEVER leave the device.
 *      Only the question text is sent. If you ever find yourself putting a
 *      number from TaxState into a prompt, stop — that breaks the promise made
 *      in the settings screen.
 *   2. The LLM cannot get the maths wrong, because it never does the maths.
 *      LLMs are unreliable at slab arithmetic; this design makes that moot.
 *
 * The LLM may also write a short general explanation (`note`), which must be
 * generic tax knowledge only — never anything about this user.
 * ────────────────────────────────────────────────────────────────────────────
 */

import { z } from 'zod';
import { answerQuestion, INTENT_IDS, SECTION_CODES, type IntentId, type QAAnswer, type TaxState } from '@/lib/tax';
import { getProvider } from './providers';
import { stripCodeFences } from './extract';
import type { LLMConfig } from './settings';

// ─── What we ask the model for ────────────────────────────────────────────────

const routeSchema = z.object({
  /** False when the question isn't about tax at all. */
  onTopic: z.boolean(),
  intent: z.enum(INTENT_IDS as [IntentId, ...IntentId[]]).nullable().default(null),
  section: z.string().nullable().default(null),
  amount: z.union([z.number(), z.string()]).nullable().default(null),
  /** Optional generic tax explanation. No user-specific claims allowed. */
  note: z.string().nullable().default(null),
  /** Up to 3 natural follow-up questions. */
  suggestions: z.array(z.string()).default([]),
});

/** What the model literally sent — `amount` may still be a string here. */
type RawTaxRoute = z.infer<typeof routeSchema>;

/** A route after normalisation: amount is a real number, section is a known code. */
export interface TaxRoute extends Omit<RawTaxRoute, 'amount'> {
  amount: number | null;
}

const SECTION_SET = new Set(SECTION_CODES.map((s) => s.toLowerCase()));

export function buildTaxRouterPrompt(): string {
  return `You are the language front-end of an Indian income-tax assistant. You do NOT answer questions and you do NOT do arithmetic — a deterministic tax engine does that using the user's own data, which you cannot see. Your only job is to work out what the user is asking and reply with JSON.

Reply with exactly one JSON object:
{"onTopic":<boolean>,"intent":<intent or null>,"section":<section code or null>,"amount":<number or null>,"note":<short general explanation or null>,"suggestions":[<up to 3 follow-up questions>]}

"intent" must be one of:
- "current_position"  — how much tax do I owe / where do I stand / my tax position
- "how_to_save"       — how to reduce tax, what should I do before March, remaining opportunities
- "regime_compare"    — old vs new regime, which should I pick, should I switch
- "whatif_invest"     — the effect of investing a specific amount ("what if I put 50k in NPS")
- "section_status"    — how much of a specific section have I used so far
- "explain"           — what does a section/concept mean, in general
- "unclassified"      — which of my entries still need a tax category
- "itr"               — which ITR form, filing, returns
- "help"              — greeting, or asking what you can do

"section" must be exactly one of: ${SECTION_CODES.join(', ')} — or null if the question isn't about a specific one. Map common names yourself: NPS -> 80CCD(1B), ELSS/PPF/LIC/life insurance -> 80C, mediclaim/health insurance -> 80D, home loan interest -> 24(b), house rent -> HRA, education loan -> 80E, donation -> 80G.

"amount" is the rupee figure only for "whatif_invest". Convert spoken forms: "50k" -> 50000, "1 lakh" -> 100000. Otherwise null.

"note" is optional and must be GENERAL tax knowledge only — a sentence or two of plain-English context about the concept being asked about. You know nothing about this user's income, deductions or tax. NEVER state or guess any figure about them, and never say things like "you have saved" or "your tax is". If you have nothing general to add, use null.

"suggestions" are up to 3 short follow-up questions the user might ask next, phrased in the first person ("How can I save more tax?").

SCOPE — this assistant handles TAX ONLY. If the user asks about anything else (logging an expense, their budget, savings goals, lending money to a friend, the weather, general chit-chat), set "onTopic": false and leave intent null. Recording expenses and loans is handled elsewhere in the app by a separate voice assistant, so do not try to do it here.

The user may write in English, Hindi, Hinglish or a mix. Understand all of them. Reply with raw JSON only — no markdown fences, no commentary.

Examples:
"where do I stand" -> {"onTopic":true,"intent":"current_position","section":null,"amount":null,"note":null,"suggestions":["How can I save more tax?","Which regime should I pick?"]}
"mera tax kitna hai" -> {"onTopic":true,"intent":"current_position","section":null,"amount":null,"note":null,"suggestions":["How can I save more tax?"]}
"can I still put money into that pension thing" -> {"onTopic":true,"intent":"section_status","section":"80CCD(1B)","amount":null,"note":"NPS contributions under 80CCD(1B) get an extra deduction on top of the 80C limit, and it's available only in the old regime.","suggestions":["What if I invest 50000 in NPS?"]}
"what if I put 50k into ELSS" -> {"onTopic":true,"intent":"whatif_invest","section":"80C","amount":50000,"note":null,"suggestions":["How can I save more tax?"]}
"log 500 for lunch" -> {"onTopic":false,"intent":null,"section":null,"amount":null,"note":null,"suggestions":[]}
"what's the weather" -> {"onTopic":false,"intent":null,"section":null,"amount":null,"note":null,"suggestions":[]}`;
}

// ─── Routing ──────────────────────────────────────────────────────────────────

export interface TaxRouterDeps {
  complete: (system: string, user: string, signal?: AbortSignal) => Promise<string>;
  signal?: AbortSignal;
}

/** Normalise a model-supplied amount to a number, or null. */
function toAmount(raw: number | string | null): number | null {
  if (raw === null) return null;
  const n = typeof raw === 'number' ? raw : parseFloat(String(raw).replace(/[^0-9.]/g, ''));
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** Drop a section the engine doesn't know, rather than passing junk downstream. */
function toSection(raw: string | null): string | null {
  if (!raw) return null;
  const match = SECTION_CODES.find((c) => c.toLowerCase() === raw.trim().toLowerCase());
  return match ?? null;
}

/** Ask the model to route one question. Returns null if it can't be parsed. */
export async function routeTaxQuestion(
  question: string,
  deps: TaxRouterDeps,
): Promise<TaxRoute | null> {
  const raw = await deps.complete(buildTaxRouterPrompt(), question.trim(), deps.signal);

  let json: unknown;
  try {
    json = JSON.parse(stripCodeFences(raw));
  } catch {
    return null;
  }

  const parsed = routeSchema.safeParse(json);
  if (!parsed.success) return null;

  return {
    ...parsed.data,
    section: toSection(parsed.data.section),
    amount: toAmount(parsed.data.amount),
  };
}

// ─── The answer the page renders ──────────────────────────────────────────────

export interface CopilotAnswer extends QAAnswer {
  /** True when the LLM handled comprehension; false on the offline path. */
  usedLLM: boolean;
  /** Set when the question was not about tax. */
  offTopic?: boolean;
}

const OFF_TOPIC_REPLY =
  "I only handle tax here. To log an expense, an income or a loan, tap the mic button at the bottom right — that assistant can record it for you.";

/**
 * Answer a tax question, using the LLM for comprehension when one is
 * configured and falling back to the offline keyword engine when it isn't
 * (or when the call fails).
 */
export async function answerTaxQuestion(
  question: string,
  state: TaxState,
  config: LLMConfig | null,
  signal?: AbortSignal,
): Promise<CopilotAnswer> {
  // No key configured — the original offline engine, unchanged.
  if (!config) {
    return { ...answerQuestion(question, state), usedLLM: false };
  }

  const provider = getProvider(config.provider);

  try {
    const route = await routeTaxQuestion(question, {
      signal,
      complete: (system, user, sig) =>
        provider.complete({
          apiKey: config.apiKey,
          model: config.model,
          baseUrl: config.baseUrl,
          system,
          user,
          signal: sig,
        }),
    });

    // Model gave us nothing usable — degrade to keywords rather than fail.
    if (!route) {
      return { ...answerQuestion(question, state), usedLLM: false };
    }

    if (!route.onTopic) {
      return {
        intent: 'off_topic',
        text: OFF_TOPIC_REPLY,
        suggestions: ['Where do I stand?', 'How can I save more tax?'],
        usedLLM: true,
        offTopic: true,
      };
    }

    // The engine computes the answer. The LLM only chose which question to ask it.
    const engineAnswer = answerQuestion(question, state, {
      intent: route.intent ?? undefined,
      section: route.section,
      amount: route.amount,
    });

    // A general explanation may be appended, but never replaces the figures.
    const note = route.note?.trim();
    const text = note ? `${engineAnswer.text}\n\n${note}` : engineAnswer.text;

    return {
      ...engineAnswer,
      text,
      suggestions:
        route.suggestions.length > 0
          ? route.suggestions.slice(0, 3)
          : engineAnswer.suggestions,
      usedLLM: true,
    };
  } catch (err) {
    // A cancelled request is the caller navigating away, not a failure — don't
    // manufacture an answer nobody asked for any more.
    if (signal?.aborted) throw err;

    // Offline, bad key, rate limited — the copilot still works, just dumber.
    return { ...answerQuestion(question, state), usedLLM: false };
  }
}
