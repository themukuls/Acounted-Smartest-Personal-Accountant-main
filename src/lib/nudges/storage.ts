/**
 * storage.ts — persistence for nudge preferences and nudge history.
 *
 * Deliberately NOT the app's repository layer. Those stores are the user's
 * financial ledger, replicated in backups and exports; notification bookkeeping
 * has no business in there. This is a tiny key/value wrapper over
 * `@capacitor/preferences` on device and `localStorage` in the browser, so
 * `npm run dev` behaves identically without a native bridge.
 *
 * Keys are prefixed `vidhence_`.
 */

import { isNative } from '@/lib/platform';
import {
  DEFAULT_PREFERENCES,
  EMPTY_HISTORY,
  HISTORY_RETENTION_DAYS,
  NUDGE_CATEGORIES,
  type NudgeHistory,
  type NudgeHistoryEntry,
  type NudgePreferences,
} from './types';
import { addDaysToKey, dayKey } from './dates';

const PREFIX = 'vidhence_';
export const PREFS_KEY = `${PREFIX}nudge_prefs`;
export const HISTORY_KEY = `${PREFIX}nudge_history`;

/** Last-resort store so nothing throws in a test or SSR context. */
const memory = new Map<string, string>();

async function readRaw(key: string): Promise<string | null> {
  if (isNative()) {
    try {
      const { Preferences } = await import('@capacitor/preferences');
      const { value } = await Preferences.get({ key });
      return value ?? null;
    } catch (err) {
      console.warn('[nudges] Preferences.get failed, falling back', err);
    }
  }
  try {
    if (typeof localStorage !== 'undefined') return localStorage.getItem(key);
  } catch {
    /* private-mode browsers throw on access */
  }
  return memory.get(key) ?? null;
}

async function writeRaw(key: string, value: string): Promise<void> {
  if (isNative()) {
    try {
      const { Preferences } = await import('@capacitor/preferences');
      await Preferences.set({ key, value });
      return;
    } catch (err) {
      console.warn('[nudges] Preferences.set failed, falling back', err);
    }
  }
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(key, value);
      return;
    }
  } catch {
    /* fall through */
  }
  memory.set(key, value);
}

// ── Preferences ──────────────────────────────────────────────────────────────

/**
 * Merge stored preferences over the defaults, field by field.
 *
 * A whole-object spread would be wrong: a category added in a later release
 * would come back `undefined` for every existing user and read as "off",
 * silently disabling a feature they never touched.
 */
export function normalisePreferences(raw: unknown): NudgePreferences {
  const p = (raw ?? {}) as Partial<NudgePreferences>;
  const categories = { ...DEFAULT_PREFERENCES.categories };
  for (const c of NUDGE_CATEGORIES) {
    const stored = p.categories?.[c];
    if (typeof stored === 'boolean') categories[c] = stored;
  }
  const hour = (v: unknown, fallback: number): number =>
    typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= 23 ? v : fallback;

  return {
    enabled: typeof p.enabled === 'boolean' ? p.enabled : DEFAULT_PREFERENCES.enabled,
    categories,
    quietStartHour: hour(p.quietStartHour, DEFAULT_PREFERENCES.quietStartHour),
    quietEndHour: hour(p.quietEndHour, DEFAULT_PREFERENCES.quietEndHour),
    permissionAsked:
      typeof p.permissionAsked === 'boolean'
        ? p.permissionAsked
        : DEFAULT_PREFERENCES.permissionAsked,
  };
}

export async function loadPreferences(): Promise<NudgePreferences> {
  const raw = await readRaw(PREFS_KEY);
  if (!raw) return { ...DEFAULT_PREFERENCES, categories: { ...DEFAULT_PREFERENCES.categories } };
  try {
    return normalisePreferences(JSON.parse(raw));
  } catch {
    return { ...DEFAULT_PREFERENCES, categories: { ...DEFAULT_PREFERENCES.categories } };
  }
}

export async function savePreferences(prefs: NudgePreferences): Promise<void> {
  await writeRaw(PREFS_KEY, JSON.stringify(prefs));
}

// ── History ──────────────────────────────────────────────────────────────────

export function pruneHistory(history: NudgeHistory, today: Date): NudgeHistory {
  const cutoff = addDaysToKey(dayKey(today), -HISTORY_RETENTION_DAYS);
  return { entries: history.entries.filter((e) => e.deliveryDay >= cutoff) };
}

export async function loadHistory(): Promise<NudgeHistory> {
  const raw = await readRaw(HISTORY_KEY);
  if (!raw) return { entries: [] };
  try {
    const parsed = JSON.parse(raw) as NudgeHistory;
    return Array.isArray(parsed?.entries) ? parsed : { ...EMPTY_HISTORY, entries: [] };
  } catch {
    return { entries: [] };
  }
}

export async function saveHistory(history: NudgeHistory): Promise<void> {
  await writeRaw(HISTORY_KEY, JSON.stringify(history));
}

export async function appendHistory(entry: NudgeHistoryEntry, today: Date): Promise<void> {
  const history = await loadHistory();
  history.entries.push(entry);
  await saveHistory(pruneHistory(history, today));
}

/** Test/sign-out helper — drops everything this module owns. */
export async function clearNudgeStorage(): Promise<void> {
  await writeRaw(PREFS_KEY, '');
  await writeRaw(HISTORY_KEY, '');
}
