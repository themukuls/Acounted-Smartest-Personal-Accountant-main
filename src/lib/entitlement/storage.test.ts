/**
 * storage.test.ts — where entitlement lives, and where it must never appear.
 *
 * Run with:  npx --yes bun@latest test src/lib/entitlement
 *
 * The threat this guards against is concrete: if subscription state were ever
 * serialised into a backup, one paying user could share a CSV or JSON export
 * and hand their subscription to everyone who imported it. The same reasoning
 * applies to the LLM API key.
 *
 * Today the protection is structural — backups serialise only the repository
 * stores, and entitlement isn't one. These tests exist so that stays true after
 * someone refactors the storage layer without this conversation in their head.
 */

import { test, expect, describe, beforeEach } from 'bun:test';
import {
  ENTITLEMENT_KEY,
  loadEntitlement,
  saveEntitlement,
  peekEntitlement,
  resetEntitlementCache,
} from './storage';
import { FRESH_INSTALL } from './types';
import { STORE_NAMES } from '@/integrations/storage/stores';
import { LLM_CONFIG_KEY } from '@/lib/assistant/settings';

/**
 * Minimal localStorage, because the test runner has no DOM.
 *
 * storage.ts tolerates its absence (that's why the app still boots on a
 * platform without it), but these tests need to plant specific values to prove
 * the parsing guards, so a real store has to exist.
 */
if (typeof globalThis.localStorage === 'undefined') {
  const store = new Map<string, string>();
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
      setItem: (k: string, v: string) => void store.set(k, String(v)),
      removeItem: (k: string) => void store.delete(k),
      clear: () => store.clear(),
      key: (i: number) => [...store.keys()][i] ?? null,
      get length() { return store.size; },
    },
  });
}

beforeEach(() => {
  resetEntitlementCache();
  localStorage.clear();
});

describe('entitlement can never reach a backup', () => {
  test('it is not a repository store', () => {
    // Backups iterate STORE_NAMES. Anything absent from it is unreachable by
    // the export path — this is the guarantee, stated as an assertion.
    expect(STORE_NAMES).not.toContain(ENTITLEMENT_KEY as never);
    for (const name of STORE_NAMES) {
      expect(String(name).toLowerCase()).not.toContain('entitle');
      expect(String(name).toLowerCase()).not.toContain('subscription');
    }
  });

  test('secrets share the vidhence_ prefix but live outside the stores', () => {
    for (const key of [ENTITLEMENT_KEY, LLM_CONFIG_KEY]) {
      expect(key.startsWith('vidhence_')).toBe(true);
      expect(STORE_NAMES).not.toContain(key as never);
    }
  });

  test('the entitlement key and the API key are distinct', () => {
    // Sharing a key would mean clearing one silently destroys the other.
    expect(ENTITLEMENT_KEY).not.toBe(LLM_CONFIG_KEY);
  });
});

describe('load / save', () => {
  test('a fresh install reads as "none" rather than throwing', async () => {
    expect(await loadEntitlement()).toEqual(FRESH_INSTALL);
  });

  test('a saved snapshot round-trips', async () => {
    const s = {
      ...FRESH_INSTALL,
      status: 'trialing' as const,
      plan: 'annual' as const,
      trialSource: 'play' as const,
      expiresAt: 1_800_000_000_000,
      lastVerifiedAt: 1_700_000_000_000,
      negativeDays: ['2026-08-02'],
    };
    await saveEntitlement(s);
    resetEntitlementCache();
    expect(await loadEntitlement()).toEqual(s);
  });

  test('a corrupt snapshot degrades to "none" instead of crashing the boot path', async () => {
    // A snapshot that fails to parse must not stop the app from starting — the
    // worst acceptable outcome is showing the paywall, never a white screen.
    localStorage.setItem(ENTITLEMENT_KEY, '{ this is not json');
    expect(await loadEntitlement()).toEqual(FRESH_INSTALL);
  });

  test('an unknown status is rejected rather than trusted', async () => {
    // Guards against a hand-edited value inventing an entitlement.
    localStorage.setItem(ENTITLEMENT_KEY, JSON.stringify({ status: 'platinum' }));
    expect((await loadEntitlement()).status).toBe('none');
  });

  test('peek returns null before the first load, then the cached value', async () => {
    expect(peekEntitlement()).toBeNull();
    await loadEntitlement();
    expect(peekEntitlement()).toEqual(FRESH_INSTALL);
  });
});
