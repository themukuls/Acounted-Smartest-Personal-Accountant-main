/**
 * storage.ts — where the entitlement snapshot lives.
 *
 * ── Why @capacitor/preferences and NOT the repository ────────────────────────
 * The repository (src/integrations/storage) is what `exportFullDatabase()` and
 * the CSV backup serialise. If entitlement lived there, one paying user could
 * share a backup file and hand their subscription to anyone who imported it.
 * Preferences maps to Android SharedPreferences, which is app-private and never
 * touches the backup path — the same reasoning that keeps the LLM API key out.
 *
 * Reads are cached in memory after the first hit so the boot path can render
 * without awaiting anything, which is what keeps the offline promise.
 */

import { FRESH_INSTALL, type EntitlementSnapshot } from './types';

export const ENTITLEMENT_KEY = 'vidhence_entitlement';

/** Populated on first load; lets callers render synchronously afterwards. */
let cached: EntitlementSnapshot | null = null;

/** Narrow an unknown blob to a snapshot, or null if it's not one. */
function parse(raw: string | null): EntitlementSnapshot | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as Partial<EntitlementSnapshot>;
    if (!v || typeof v !== 'object') return null;
    if (
      v.status !== 'trialing' && v.status !== 'active' && v.status !== 'grace' &&
      v.status !== 'lapsed' && v.status !== 'none'
    ) return null;

    return {
      status: v.status,
      plan: v.plan === 'annual' || v.plan === 'monthly' ? v.plan : null,
      expiresAt: typeof v.expiresAt === 'number' ? v.expiresAt : null,
      lastVerifiedAt: typeof v.lastVerifiedAt === 'number' ? v.lastVerifiedAt : null,
      negativeDays: Array.isArray(v.negativeDays)
        ? v.negativeDays.filter((d): d is string => typeof d === 'string')
        : [],
      // Older Play snapshots predate trialSource; a trial with a plan is Play.
      trialSource:
        v.trialSource === 'local' || v.trialSource === 'play'
          ? v.trialSource
          : v.status === 'trialing' && (v.plan === 'annual' || v.plan === 'monthly')
            ? 'play'
            : null,
      localTrialStartedAt:
        typeof v.localTrialStartedAt === 'number' ? v.localTrialStartedAt : null,
      localTrialUsed: v.localTrialUsed === true,
    };
  } catch {
    return null;
  }
}

/** Preferences on native, localStorage on web. Both are app/origin-private. */
async function readRaw(): Promise<string | null> {
  try {
    const { Preferences } = await import('@capacitor/preferences');
    const { value } = await Preferences.get({ key: ENTITLEMENT_KEY });
    if (value != null) return value;
  } catch {
    /* plugin unavailable (web/dev) — fall through */
  }
  try {
    return localStorage.getItem(ENTITLEMENT_KEY);
  } catch {
    return null;
  }
}

async function writeRaw(value: string): Promise<void> {
  try {
    const { Preferences } = await import('@capacitor/preferences');
    await Preferences.set({ key: ENTITLEMENT_KEY, value });
    return;
  } catch {
    /* fall through to web */
  }
  try {
    localStorage.setItem(ENTITLEMENT_KEY, value);
  } catch {
    /* storage blocked — the in-memory cache still serves this session */
  }
}

/**
 * Load the snapshot. Returns FRESH_INSTALL when nothing is stored or the stored
 * value is unreadable — a corrupt snapshot must never crash the boot path.
 */
export async function loadEntitlement(): Promise<EntitlementSnapshot> {
  if (cached) return cached;
  cached = parse(await readRaw()) ?? FRESH_INSTALL;
  return cached;
}

/** Synchronous read of whatever load() already fetched. Null before first load. */
export function peekEntitlement(): EntitlementSnapshot | null {
  return cached;
}

export async function saveEntitlement(snap: EntitlementSnapshot): Promise<void> {
  cached = snap;
  await writeRaw(JSON.stringify(snap));
}

/** Tests only. */
export function resetEntitlementCache(): void {
  cached = null;
}
