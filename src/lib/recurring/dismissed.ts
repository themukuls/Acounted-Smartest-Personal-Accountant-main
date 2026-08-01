/**
 * dismissed.ts — the subscriptions the user told us to stop asking about.
 *
 * A detector that can't be corrected is a detector people stop reading. One
 * false positive that reappears every single time the screen loads does more
 * damage to the feature than five missed subscriptions.
 *
 * Stored in localStorage under the app's `vidhence_` prefix, keyed per user so
 * two accounts on one device don't inherit each other's dismissals. It is
 * deliberately NOT a repository store: `src/integrations/storage/stores.ts` is
 * the schema contract mirrored from IndexedDB, and a UI preference has no place
 * in it. localStorage is also the right durability level here — losing a
 * dismissal shows the user a card they already rejected, which is annoying, not
 * destructive.
 *
 * Every function is failure-tolerant. localStorage throws in private-mode
 * WebViews and when the quota is full, and none of that should be able to take
 * down the Subscriptions screen.
 */

const STORAGE_PREFIX = 'vidhence_recurring_dismissed';

const storageKey = (userId: string | undefined | null): string =>
  userId ? `${STORAGE_PREFIX}_${userId}` : STORAGE_PREFIX;

/** The dismissed series keys for a user. Never throws; returns [] on failure. */
export function getDismissedKeys(userId: string | undefined | null): string[] {
  try {
    const raw = localStorage.getItem(storageKey(userId));
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((k): k is string => typeof k === 'string');
  } catch {
    return [];
  }
}

/** Overwrite the dismissed set. Returns false when the write failed. */
function writeDismissedKeys(userId: string | undefined | null, keys: string[]): boolean {
  try {
    localStorage.setItem(storageKey(userId), JSON.stringify(keys));
    return true;
  } catch {
    return false;
  }
}

/** Add a key. Idempotent — dismissing twice is not an error. */
export function dismissKey(userId: string | undefined | null, key: string): string[] {
  const current = getDismissedKeys(userId);
  if (current.includes(key)) return current;
  const next = [...current, key];
  writeDismissedKeys(userId, next);
  return next;
}

/** Remove a key, putting the series back on the screen. */
export function restoreKey(userId: string | undefined | null, key: string): string[] {
  const current = getDismissedKeys(userId);
  const next = current.filter((k) => k !== key);
  if (next.length !== current.length) writeDismissedKeys(userId, next);
  return next;
}

/** Clear every dismissal for a user. */
export function restoreAll(userId: string | undefined | null): string[] {
  writeDismissedKeys(userId, []);
  return [];
}
