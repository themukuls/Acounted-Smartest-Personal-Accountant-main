/**
 * classifier.ts — routes a free-text entry to a tax bucket, no LLM.
 *
 * Four cheap, deterministic layers (as per the plan):
 *   1. keyword dictionary, weighted by specificity (more words = stronger)
 *   2. fuzzy fallback (fuse.js) for messy spelling/phrasing
 *   3. a confidence band that decides when to just ASK the user
 *   4. (learned per-user overrides live in a separate store — Phase 2)
 *
 * The classifier never guesses silently: below the confidence threshold it
 * returns needsConfirmation so the UI can ask instead of mis-filing money.
 */

import Fuse from 'fuse.js';
import { TAX_BUCKETS, BUCKET_BY_ID, type TaxBucket } from './taxonomy';

export interface Candidate {
  bucketId: string;
  confidence: number; // 0..1
  matchedKeyword?: string;
}

export interface ClassificationResult {
  /** Best bucket, or null when nothing matched. */
  bucketId: string | null;
  bucket: TaxBucket | null;
  confidence: number;
  matchedKeyword?: string;
  /** Ranked runners-up, useful for a "did you mean?" chip row. */
  alternatives: Candidate[];
  /** True when the caller should confirm with the user before filing. */
  needsConfirmation: boolean;
}

// Confidence thresholds.
const CONFIDENT = 0.8; // at/above this we can auto-file
const FLOOR = 0.35; // below this we treat as "no match"

const normalize = (s: string): string =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

// Flatten the taxonomy into { keyword, bucketId } once.
interface KeywordRow {
  keyword: string;
  normalized: string;
  words: number;
  bucketId: string;
}
const KEYWORD_ROWS: KeywordRow[] = TAX_BUCKETS.flatMap((b) =>
  b.keywords.map((k) => {
    const normalized = normalize(k);
    return { keyword: k, normalized, words: normalized.split(' ').length, bucketId: b.id };
  }),
);

const fuse = new Fuse(KEYWORD_ROWS, {
  keys: ['normalized'],
  includeScore: true,
  threshold: 0.4, // fuse: 0 = exact, 1 = anything
  ignoreLocation: true,
  minMatchCharLength: 3,
});

/** Confidence for an exact substring hit, scaled by keyword specificity. */
function dictionaryConfidence(words: number): number {
  // 1-word keyword → 0.82, 2 words → 0.9, 3+ → 0.95
  if (words >= 3) return 0.95;
  if (words === 2) return 0.9;
  return 0.82;
}

/**
 * Classify a free-text entry. `hintCategory` (e.g. the picker category the
 * user already chose) is appended to the text so structured input sharpens
 * the match.
 */
export function classifyEntry(
  text: string,
  opts?: {
    hintCategory?: string;
    /** Remembered { normalisedText: bucketId } for this user (classifier memory). */
    learned?: Record<string, string>;
  },
): ClassificationResult {
  const haystack = ` ${normalize([text, opts?.hintCategory].filter(Boolean).join(' '))} `;

  if (haystack.trim().length === 0) {
    return { bucketId: null, bucket: null, confidence: 0, alternatives: [], needsConfirmation: true };
  }

  // ── Layer 0: user memory — a confirmed mapping wins outright ───────────────
  if (opts?.learned) {
    const normalizedText = haystack.trim();
    // Exact match on the whole (normalised) entry.
    let hitBucket = opts.learned[normalizedText];
    let hitKey = normalizedText;
    if (!hitBucket) {
      // Otherwise the longest learned key contained in the text.
      for (const [key, bucketId] of Object.entries(opts.learned)) {
        if (key && haystack.includes(` ${key} `) && key.length > hitKey.length) {
          hitBucket = bucketId;
          hitKey = key;
        }
      }
      // reset hitKey sentinel if nothing found
      if (!hitBucket) hitKey = '';
    }
    if (hitBucket && BUCKET_BY_ID[hitBucket]) {
      return {
        bucketId: hitBucket,
        bucket: BUCKET_BY_ID[hitBucket],
        confidence: 1,
        matchedKeyword: hitKey || undefined,
        alternatives: [],
        needsConfirmation: false,
      };
    }
  }

  // ── Layer 1: weighted dictionary (substring, word-boundary padded) ────────
  // Best score per bucket; a longer matched keyword wins within a bucket.
  const perBucket = new Map<string, { confidence: number; keyword: string; words: number }>();
  for (const row of KEYWORD_ROWS) {
    if (haystack.includes(` ${row.normalized} `)) {
      const confidence = dictionaryConfidence(row.words);
      const prev = perBucket.get(row.bucketId);
      if (!prev || row.words > prev.words) {
        perBucket.set(row.bucketId, { confidence, keyword: row.keyword, words: row.words });
      }
    }
  }

  if (perBucket.size > 0) {
    const ranked = [...perBucket.entries()]
      .map(([bucketId, v]) => ({ bucketId, confidence: v.confidence, matchedKeyword: v.keyword, words: v.words }))
      .sort((a, b) => b.words - a.words || b.confidence - a.confidence);

    const top = ranked[0];
    const second = ranked[1];
    // Ambiguous when two DIFFERENT buckets match with equal specificity
    // (e.g. "home loan" hitting neither interest nor principal decisively).
    const ambiguous = !!second && second.words === top.words;

    const confidence = ambiguous ? Math.min(top.confidence, 0.5) : top.confidence;
    return {
      bucketId: top.bucketId,
      bucket: BUCKET_BY_ID[top.bucketId],
      confidence,
      matchedKeyword: top.matchedKeyword,
      alternatives: ranked.slice(1).map(({ bucketId, confidence: c, matchedKeyword }) => ({
        bucketId,
        confidence: c,
        matchedKeyword,
      })),
      needsConfirmation: confidence < CONFIDENT,
    };
  }

  // ── Layer 2: fuzzy fallback ───────────────────────────────────────────────
  const fuzzy = fuse.search(haystack.trim());
  if (fuzzy.length > 0) {
    // fuse score: 0 = perfect. Convert to confidence, capped below CONFIDENT
    // so fuzzy matches always ask for confirmation.
    const seen = new Set<string>();
    const cands: Candidate[] = [];
    for (const r of fuzzy) {
      const bucketId = r.item.bucketId;
      if (seen.has(bucketId)) continue;
      seen.add(bucketId);
      const confidence = Math.min(0.75, 1 - (r.score ?? 1));
      if (confidence >= FLOOR) cands.push({ bucketId, confidence, matchedKeyword: r.item.keyword });
    }
    if (cands.length > 0) {
      const top = cands[0];
      return {
        bucketId: top.bucketId,
        bucket: BUCKET_BY_ID[top.bucketId],
        confidence: top.confidence,
        matchedKeyword: top.matchedKeyword,
        alternatives: cands.slice(1),
        needsConfirmation: true,
      };
    }
  }

  // ── Nothing matched ───────────────────────────────────────────────────────
  return { bucketId: null, bucket: null, confidence: 0, alternatives: [], needsConfirmation: true };
}
