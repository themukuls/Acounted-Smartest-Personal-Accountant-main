/**
 * qa.ts — the conversational Q&A engine. No LLM.
 *
 * A bounded NLU pipeline: match the question to one of a finite set of intents,
 * pull any slots (amount, section), answer by querying the live TaxState and
 * the deterministic engine, and template a teaching reply. The engine does the
 * math; this layer only understands language and explains.
 *
 * When it can't understand, it never bluffs — it returns a help answer with
 * suggested questions (the graceful fallback).
 */

import { computeTaxOnTaxableIncome } from './engine';
import { TAX_TOPICS, type TaxTopic } from './knowledge';
import { BUCKET_BY_ID } from './taxonomy';
import { buildITRDraft } from './itr';
import type { OldRegimeDeductions } from './types';
import type { TaxState } from './ledger';

export interface QAAnswer {
  intent: string;
  text: string;
  /** Follow-up quick-reply chips. */
  suggestions: string[];
  /** True when we need more input from the user to answer. */
  needsInput?: boolean;
  /** Structured payload for the UI, when useful. */
  data?: Record<string, unknown>;
}

// ─── Formatting ──────────────────────────────────────────────────────────────
/** Indian-grouped rupees, e.g. 152400 → "₹1,52,400". */
export function inr(n: number): string {
  const x = Math.round(n);
  const s = Math.abs(x).toString();
  let out: string;
  if (s.length <= 3) out = s;
  else {
    const last3 = s.slice(-3);
    const rest = s.slice(0, -3).replace(/\B(?=(\d{2})+(?!\d))/g, ',');
    out = `${rest},${last3}`;
  }
  return `${x < 0 ? '-' : ''}₹${out}`;
}

// ─── Slot extraction ─────────────────────────────────────────────────────────

/** Section aliases → engine field, for "how much 80C / what if I put X in NPS". */
interface SectionAlias {
  field: keyof OldRegimeDeductions;
  section: string;
  bucketId: string;
  topicId: string;
  keywords: string[];
}
const SECTIONS: SectionAlias[] = [
  { field: 'section80C', section: '80C', bucketId: 'sec_80c', topicId: 'section80C', keywords: ['80c', 'elss', 'ppf', 'lic', 'life insurance'] },
  { field: 'section80CCD1B', section: '80CCD(1B)', bucketId: 'sec_80ccd1b', topicId: 'section80CCD1B', keywords: ['80ccd', 'nps'] },
  { field: 'section80D', section: '80D', bucketId: 'sec_80d', topicId: 'section80D', keywords: ['80d', 'health insurance', 'mediclaim'] },
  { field: 'section24b', section: '24(b)', bucketId: 'sec_24b', topicId: 'section24b', keywords: ['24b', '24 b', 'home loan interest', 'home loan'] },
  { field: 'section80E', section: '80E', bucketId: 'sec_80e', topicId: 'section80E', keywords: ['80e', 'education loan'] },
  { field: 'section80G', section: '80G', bucketId: 'sec_80g', topicId: 'section80G', keywords: ['80g', 'donation'] },
  { field: 'hra', section: 'HRA', bucketId: 'hra', topicId: 'hra', keywords: ['hra', 'house rent'] },
  { field: 'section80TTA', section: '80TTA', bucketId: 'sec_80tta', topicId: 'section80TTA', keywords: ['80tta'] },
  { field: 'section80TTB', section: '80TTB', bucketId: 'sec_80ttb', topicId: 'section80TTB', keywords: ['80ttb'] },
];

function detectSection(text: string): SectionAlias | null {
  const t = ` ${text.toLowerCase()} `;
  let best: SectionAlias | null = null;
  let bestLen = 0;
  for (const s of SECTIONS) {
    for (const kw of s.keywords) {
      if (t.includes(kw) && kw.length > bestLen) {
        best = s;
        bestLen = kw.length;
      }
    }
  }
  return best;
}

/** Parse an INR amount, handling k/lakh/crore and stripping section codes. */
export function extractAmount(text: string): number | null {
  let t = ` ${text.toLowerCase().replace(/,/g, '').replace(/₹|rs\.?/g, ' ')} `;
  // Remove section codes so "80c" / "24b" aren't read as amounts.
  t = t.replace(/\b8\d[a-z]{0,4}\b/g, ' ').replace(/\b24\s?b\b/g, ' ');
  const m = t.match(/(\d+(?:\.\d+)?)\s*(k|thousand|lakhs?|lacs?|l|crores?|cr)?\b/);
  if (!m) return null;
  let n = parseFloat(m[1]);
  const u = m[2] ?? '';
  if (u === 'k' || u === 'thousand') n *= 1000;
  else if (u === 'l' || /lakh|lac/.test(u)) n *= 100000;
  else if (u === 'cr' || /crore/.test(u)) n *= 10000000;
  else if (!u && n < 1000) return null; // a bare small number isn't an amount
  return Math.round(n);
}

// ─── Intents ─────────────────────────────────────────────────────────────────

export type IntentId =
  | 'current_position'
  | 'how_to_save'
  | 'regime_compare'
  | 'whatif_invest'
  | 'section_status'
  | 'explain'
  | 'unclassified'
  | 'itr'
  | 'help';

/** Every intent the engine can answer — handy for building an LLM router's enum. */
export const INTENT_IDS: IntentId[] = [
  'current_position', 'how_to_save', 'regime_compare', 'whatif_invest',
  'section_status', 'explain', 'unclassified', 'itr', 'help',
];

/** Section codes the engine understands, for the same reason. */
export const SECTION_CODES: string[] = [
  '80C', '80CCD(1B)', '80D', '24(b)', '80E', '80G', 'HRA', '80TTA', '80TTB',
];

/**
 * Pre-resolved intent and slots, supplied by a smarter upstream understander
 * (the LLM router) when one is configured.
 *
 * This exists so the LLM can improve *comprehension* without touching
 * *computation*: whatever it decides, the numbers still come from the
 * deterministic handlers below. Omit it and behaviour is exactly as before.
 */
export interface QAOverride {
  intent?: IntentId;
  /** Rupee amount for "what if I invest X". */
  amount?: number | null;
  /** Section code as listed in SECTION_CODES. */
  section?: string | null;
}

function sectionByCode(code: string | null | undefined): SectionAlias | null {
  if (!code) return null;
  const wanted = code.trim().toLowerCase();
  return SECTIONS.find((s) => s.section.toLowerCase() === wanted) ?? null;
}

interface IntentDef {
  id: IntentId;
  phrases: string[];
}
// Order matters only for readability; scoring is by matched-phrase length.
const INTENTS: IntentDef[] = [
  { id: 'whatif_invest', phrases: ['what if', 'if i invest', 'if i put', 'suppose i', 'should i invest', 'impact of investing'] },
  { id: 'how_to_save', phrases: ['how can i save', 'save more tax', 'reduce my tax', 'save tax', 'lower my tax', 'what should i do', 'before march', 'headroom', 'opportunit'] },
  { id: 'regime_compare', phrases: ['which regime', 'old or new', 'new or old', 'should i switch', 'old regime', 'new regime', 'regime'] },
  { id: 'section_status', phrases: ['how much have i', 'how much 80', 'used in 80', 'my 80', 'status of', 'how much nps', 'how much hra'] },
  { id: 'explain', phrases: ['what is', 'explain', 'what does', 'meaning of', 'tell me about', 'how does'] },
  { id: 'itr', phrases: ['itr', 'which form', 'file my return', 'prepare my return', 'tax return', 'file taxes'] },
  { id: 'unclassified', phrases: ['needs review', 'pending', 'unclassified', 'not categorised', 'not categorized', 'what needs'] },
  { id: 'current_position', phrases: ['where do i stand', 'how much tax', 'my tax', 'total tax', 'tax will i', 'do i owe', 'current position', 'how am i doing'] },
  { id: 'help', phrases: ['help', 'hi', 'hello', 'what can you'] },
];

function detectIntent(text: string): IntentId {
  const t = ` ${text.toLowerCase()} `;
  let best: IntentId = 'help';
  let bestLen = 0;
  for (const intent of INTENTS) {
    for (const p of intent.phrases) {
      if (t.includes(p) && p.length > bestLen) {
        best = intent.id;
        bestLen = p.length;
      }
    }
  }
  return best;
}

// ─── Handlers ────────────────────────────────────────────────────────────────

const DEFAULT_SUGGESTIONS = [
  'How can I save more tax?',
  'Which regime should I pick?',
  'What is 80C?',
];

function headroomFor(state: TaxState, bucketId: string) {
  return state.headroom.find((h) => h.bucketId === bucketId);
}

function answerCurrentPosition(state: TaxState): QAAnswer {
  const { old, new: nw, recommendedRegime, potentialSaving } = state.computation;
  const rec = recommendedRegime === 'new' ? nw : old;
  const regimeWord = recommendedRegime === 'new' ? 'new' : 'old';
  const savingLine =
    potentialSaving > 0
      ? ` That's ${inr(potentialSaving)} cheaper than the ${regimeWord === 'new' ? 'old' : 'new'} regime.`
      : '';
  return {
    intent: 'current_position',
    text:
      `Your projected tax this year is about ${inr(nw.totalTax)} on the new regime and ${inr(old.totalTax)} on the old regime. ` +
      `Best for you right now: the ${regimeWord} regime (${inr(rec.totalTax)}).${savingLine} Taxable income is roughly ${inr(rec.taxableIncome)}.`,
    suggestions: ['How can I save more tax?', 'Which regime should I pick?', 'What needs review?'],
    data: { old: old.totalTax, new: nw.totalTax, recommendedRegime },
  };
}

function answerHowToSave(state: TaxState): QAAnswer {
  const top = state.headroom.filter((h) => h.potentialSaving > 0).slice(0, 3);
  if (top.length === 0) {
    return {
      intent: 'how_to_save',
      text:
        "From what I can see you've used up the easy deduction headroom in the old regime. " +
        'Bigger moves (NPS, restructuring your salary) could still help — want to explore those?',
      suggestions: ['What is NPS (80CCD(1B))?', 'Which regime should I pick?', 'Where do I stand?'],
    };
  }
  const lines = top.map(
    (h) => `• Put ${inr(h.remaining)} more into ${h.section} → save about ${inr(h.potentialSaving)}.`,
  );
  const total = top.reduce((s, h) => s + h.potentialSaving, 0);
  return {
    intent: 'how_to_save',
    text:
      `Here's where you can still save (old regime), before 31 March:\n${lines.join('\n')}\n` +
      `Do all of them and you'd save around ${inr(total)}.`,
    suggestions: top.map((h) => `What is ${h.section}?`).slice(0, 3),
    data: { headroom: top },
  };
}

function answerRegime(state: TaxState): QAAnswer {
  const { old, new: nw, recommendedRegime, potentialSaving } = state.computation;
  const winner = recommendedRegime === 'new' ? 'new' : 'old';
  const why =
    winner === 'old'
      ? 'your deductions outweigh the new regime’s lower rates'
      : 'the new regime’s lower slab rates beat the deductions you currently have';
  return {
    intent: 'regime_compare',
    text:
      `Go with the ${winner} regime: ${inr(winner === 'new' ? nw.totalTax : old.totalTax)} vs ` +
      `${inr(winner === 'new' ? old.totalTax : nw.totalTax)} — a saving of ${inr(potentialSaving)}. ` +
      `Right now ${why}.`,
    suggestions: ['How can I save more tax?', 'What is 80C?', 'Where do I stand?'],
  };
}

function answerWhatIf(state: TaxState, question: string, override?: QAOverride): QAAnswer {
  const amount = override?.amount ?? extractAmount(question);
  const section = sectionByCode(override?.section) ?? detectSection(question);
  if (!amount) {
    return {
      intent: 'whatif_invest',
      text: 'How much, and where? For example: “what if I invest ₹50,000 in 80C?”',
      suggestions: ['What if I invest ₹50,000 in 80C?', 'What if I put ₹50,000 in NPS?'],
      needsInput: true,
    };
  }
  const sec = section ?? SECTIONS[0]; // default 80C
  const head = headroomFor(state, sec.bucketId);
  const effective = head ? Math.min(amount, head.remaining) : amount;
  const taxableOld = state.computation.old.taxableIncome;
  const base = computeTaxOnTaxableIncome(taxableOld, 'old', state.input.ageCategory).totalTax;
  const after = computeTaxOnTaxableIncome(
    Math.max(0, taxableOld - effective),
    'old',
    state.input.ageCategory,
  ).totalTax;
  const saving = Math.max(0, base - after);

  const cappedNote =
    head && amount > head.remaining
      ? ` Note: only ${inr(head.remaining)} of that fits under the ${sec.section} limit.`
      : '';
  return {
    intent: 'whatif_invest',
    text:
      saving > 0
        ? `Putting ${inr(amount)} into ${sec.section} would cut your tax by about ${inr(saving)} (old regime).${cappedNote}`
        : `Putting ${inr(amount)} into ${sec.section} wouldn't change your tax right now — likely because the new regime is already cheaper for you, or that section is full.${cappedNote}`,
    suggestions: ['How can I save more tax?', 'Which regime should I pick?'],
    data: { amount, section: sec.section, saving },
  };
}

function answerSectionStatus(state: TaxState, question: string, override?: QAOverride): QAAnswer {
  const section = sectionByCode(override?.section) ?? detectSection(question);
  if (!section) {
    return {
      intent: 'section_status',
      text: 'Which section — 80C, 80D, NPS, HRA…?',
      suggestions: ['How much 80C have I used?', 'How much 80D have I used?'],
      needsInput: true,
    };
  }
  const agg = state.buckets.find((b) => b.bucketId === section.bucketId);
  const head = headroomFor(state, section.bucketId);
  const used = agg?.total ?? 0;
  if (!head && used === 0) {
    return {
      intent: 'section_status',
      text: `You haven't logged anything under ${section.section} yet.`,
      suggestions: [`What is ${section.section}?`, 'How can I save more tax?'],
    };
  }
  const remainLine = head
    ? ` You have ${inr(head.remaining)} of headroom left — filling it would save about ${inr(head.potentialSaving)}.`
    : ' That section looks full.';
  return {
    intent: 'section_status',
    text: `You've used ${inr(used)} under ${section.section}.${remainLine}`,
    suggestions: [`What is ${section.section}?`, 'How can I save more tax?'],
  };
}

function answerExplain(question: string, override?: QAOverride): QAAnswer {
  const section = sectionByCode(override?.section) ?? detectSection(question);
  let topic: TaxTopic | undefined = section ? TAX_TOPICS[section.topicId] : undefined;
  if (!topic && /regime/.test(question.toLowerCase())) topic = TAX_TOPICS.regime;
  if (!topic) {
    return {
      intent: 'explain',
      text: "I can explain 80C, 80D, NPS (80CCD(1B)), 24(b) home-loan interest, HRA, 80G, 80E, and old vs new regime. Which one?",
      suggestions: ['What is 80C?', 'What is 80D?', 'Old vs new regime?'],
    };
  }
  const parts = [topic.explanation];
  if (topic.limit) parts.push(`Limit: ${topic.limit}`);
  if (topic.tip) parts.push(`Tip: ${topic.tip}`);
  return {
    intent: 'explain',
    text: `${topic.title} — ${parts.join(' ')}`,
    suggestions: ['How can I save more tax?', 'Where do I stand?'],
  };
}

function answerUnclassified(state: TaxState): QAAnswer {
  if (state.unclassified.length === 0) {
    return {
      intent: 'unclassified',
      text: "Everything you've logged is categorised for tax. Nothing needs review.",
      suggestions: DEFAULT_SUGGESTIONS,
    };
  }
  const names = state.unclassified.slice(0, 4).map((u) => `“${u.description}”`).join(', ');
  return {
    intent: 'unclassified',
    text:
      `${state.unclassified.length} ${state.unclassified.length === 1 ? 'entry needs' : 'entries need'} a tax category: ${names}. ` +
      'Open each one and pick a section so I can count it.',
    suggestions: ['How can I save more tax?', 'Where do I stand?'],
  };
}

function answerITR(state: TaxState): QAAnswer {
  const d = buildITRDraft(state);
  return {
    intent: 'itr',
    text:
      `Based on what you've logged, your likely form is ${d.form} for AY ${d.assessmentYear}. ` +
      `Gross total income is about ${inr(d.income.grossTotalIncome)}, and total tax about ` +
      `${inr(d.taxComputation.totalTaxLiability)} on the ${d.regime} regime. ` +
      `You can download a draft to review — it's a summary, not a portal-ready file, so you'll still ` +
      `add PAN, bank and verification details before filing.`,
    suggestions: ['Where do I stand?', 'How can I save more tax?', 'What needs review?'],
    data: { form: d.form, assessmentYear: d.assessmentYear },
  };
}

function answerHelp(): QAAnswer {
  return {
    intent: 'help',
    text:
      "I'm your tax co-pilot. Ask me things like “where do I stand?”, “how can I save more tax?”, " +
      "“which regime should I pick?”, “what if I invest ₹50,000 in 80C?”, or “what is 80D?”.",
    suggestions: DEFAULT_SUGGESTIONS,
  };
}

/**
 * Answer a natural-language question against the live tax state.
 *
 * `override` lets a smarter upstream understander (the LLM router) supply the
 * intent and slots it resolved. The answer itself — every rupee of it — is
 * still computed here from the user's local data, so the numbers are exact
 * whether or not an LLM was involved.
 */
export function answerQuestion(
  question: string,
  state: TaxState,
  override?: QAOverride,
): QAAnswer {
  const q = question.trim();
  if (!q && !override?.intent) return answerHelp();

  switch (override?.intent ?? detectIntent(q)) {
    case 'current_position': return answerCurrentPosition(state);
    case 'how_to_save': return answerHowToSave(state);
    case 'regime_compare': return answerRegime(state);
    case 'whatif_invest': return answerWhatIf(state, q, override);
    case 'section_status': return answerSectionStatus(state, q, override);
    case 'explain': return answerExplain(q, override);
    case 'unclassified': return answerUnclassified(state);
    case 'itr': return answerITR(state);
    default: return answerHelp();
  }
}
