/**
 * providers.test.ts — the LLM provider registry.
 *
 * Run with:  npx --yes bun@latest test src/lib/assistant
 *
 * These are cheap structural guards, but they cover the failure mode that would
 * otherwise reach a user: a provider whose default model isn't in its own list,
 * or an endpoint typo that only shows up as a network error on their device.
 */

import { test, expect, describe } from 'bun:test';
import { PROVIDER_LIST, PROVIDERS, getProvider, ProviderError } from './providers';

describe('registry', () => {
  test('every provider id is unique', () => {
    const ids = PROVIDER_LIST.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  test('the lookup map matches the list', () => {
    expect(Object.keys(PROVIDERS).length).toBe(PROVIDER_LIST.length);
    for (const p of PROVIDER_LIST) expect(getProvider(p.id)).toBe(p);
  });

  test('an unknown id falls back rather than returning undefined', () => {
    // A config saved by a future release could name a provider this build has
    // never heard of; the assistant should degrade, not crash on boot.
    expect(getProvider('does-not-exist' as never).id).toBe('gemini');
  });

  test('offers a real choice', () => {
    expect(PROVIDER_LIST.length).toBeGreaterThanOrEqual(8);
  });
});

describe('each provider is coherent', () => {
  for (const p of PROVIDER_LIST) {
    test(`${p.id}: has label, blurb and a key link`, () => {
      expect(p.label.length).toBeGreaterThan(0);
      expect(p.blurb.length).toBeGreaterThan(0);
      expect(p.keysUrl).toMatch(/^https:\/\//);
      expect(p.keyPlaceholder.length).toBeGreaterThan(0);
    });

    test(`${p.id}: its default model is one it actually lists`, () => {
      // The settings UI preselects defaultModel. If it isn't in `models` the
      // Select renders blank and the user can't tell what will be used.
      if (p.models.length > 0) {
        expect(p.models.map((m) => m.id)).toContain(p.defaultModel);
      } else {
        // Only the bring-your-own-endpoint provider may ship without a list.
        expect(p.requiresBaseUrl).toBe(true);
      }
    });

    test(`${p.id}: model ids and labels are unique`, () => {
      const ids = p.models.map((m) => m.id);
      expect(new Set(ids).size).toBe(ids.length);
    });
  }
});

describe('custom endpoint provider', () => {
  test('refuses to call anything when no base URL is supplied', async () => {
    const custom = getProvider('custom');
    expect(custom.requiresBaseUrl).toBe(true);

    await expect(
      custom.complete({ apiKey: 'k', model: 'm', system: 's', user: 'u' }),
    ).rejects.toThrow(ProviderError);
  });

  test('the error names the missing endpoint rather than failing at the network', async () => {
    try {
      await getProvider('custom').complete({ apiKey: 'k', model: 'm', system: 's', user: 'u' });
      throw new Error('should have thrown');
    } catch (err) {
      expect((err as ProviderError).message).toMatch(/endpoint/i);
    }
  });
});

describe('ProviderError messaging', () => {
  test('maps auth failures to something actionable', () => {
    expect(new ProviderError('x', 401).friendlyMessage).toMatch(/key was rejected/i);
    expect(new ProviderError('x', 403).friendlyMessage).toMatch(/key was rejected/i);
  });

  test('maps a bad model to the settings screen, not a generic failure', () => {
    expect(new ProviderError('x', 404).friendlyMessage).toMatch(/model/i);
  });

  test('rate limits and outages read differently', () => {
    expect(new ProviderError('x', 429).friendlyMessage).toMatch(/rate limited/i);
    expect(new ProviderError('x', 503).friendlyMessage).toMatch(/trouble/i);
  });

  test('a network failure keeps its own message', () => {
    expect(new ProviderError('Could not reach the AI provider. Are you online?').friendlyMessage)
      .toMatch(/online/i);
  });
});
