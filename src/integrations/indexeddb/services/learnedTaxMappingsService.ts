/**
 * learnedTaxMappingsService.ts — persistence for the tax classifier's memory.
 *
 * When a user confirms (or corrects) a classification, we remember it keyed by
 * the normalised text, so the same phrasing routes instantly next time and the
 * classifier stops asking. This is the cheap, no-ML personalisation layer.
 */

import type { MyDB } from '../db';
import { get, getAllByIndex, put, remove } from '@/integrations/storage/repository';
import { notifyDatabaseChanged } from '@/utils/dbSync';

type LearnedMapping = MyDB['learned_tax_mappings']['value'];

/** Same normalisation the classifier uses, kept in sync deliberately. */
export function normaliseKey(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const rowId = (userId: string, textKey: string) => `${userId}::${textKey}`;

/** All remembered mappings for a user as { normalisedText: bucketId }. */
export async function getLearnedMappings(
  userId: string,
): Promise<Record<string, string>> {
  try {
    const rows = await getAllByIndex<LearnedMapping>('learned_tax_mappings', 'user_id', userId);
    const out: Record<string, string> = {};
    for (const r of rows) out[r.text_key] = r.bucket_id;
    return out;
  } catch {
    return {};
  }
}

/** Remember (or update) a mapping from a piece of text to a tax bucket. */
export async function rememberMapping(
  userId: string,
  text: string,
  bucketId: string,
): Promise<void> {
  const textKey = normaliseKey(text);
  if (!textKey) return;
  try {
    // `id` is the composite `${userId}::${textKey}` and IS the primary key for
    // this store, so `get`/`put` round-trip on it directly.
    const id = rowId(userId, textKey);
    const now = new Date().toISOString();
    const existing = await get<LearnedMapping>('learned_tax_mappings', id);
    await put('learned_tax_mappings', {
      id,
      user_id: userId,
      text_key: textKey,
      bucket_id: bucketId,
      created_at: existing?.created_at ?? now,
      updated_at: now,
    });
    notifyDatabaseChanged();
  } catch (e) {
    console.warn('[learnedTaxMappings] remember failed:', e);
  }
}

/** Forget a mapping (e.g. the user cleared a wrong one). */
export async function forgetMapping(userId: string, text: string): Promise<void> {
  const textKey = normaliseKey(text);
  try {
    await remove('learned_tax_mappings', rowId(userId, textKey));
    notifyDatabaseChanged();
  } catch (e) {
    console.warn('[learnedTaxMappings] forget failed:', e);
  }
}
