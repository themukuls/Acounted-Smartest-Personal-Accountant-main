/**
 * settings.ts — where the user's own LLM credentials live.
 *
 * Stored in localStorage under the app's `vidhence_` prefix convention. The key
 * never goes anywhere except the Authorization header of the provider the user
 * picked — no telemetry, no proxy, no logging.
 *
 * IMPORTANT: this key must never reach a backup file. Backups are emailed,
 * uploaded and passed between devices; a third-party API key sitting in one in
 * plaintext is a credential leak waiting to happen.
 *
 * That protection is now STRUCTURAL rather than a skip-list. `backup.ts` and
 * `csvBackup.ts` serialise only the repository stores enumerated in
 * `src/integrations/storage/stores.ts`, and this key lives in localStorage
 * instead — so there is no code path that could pick it up. (An earlier design
 * did rely on a SENSITIVE_LOCALSTORAGE_KEYS skip-list in dbSync.ts; that file
 * has since been reduced to notifyDatabaseChanged and the list is gone.)
 *
 * If you ever add a store for credentials, this guarantee disappears — keep
 * secrets out of the repository layer. See also src/lib/entitlement/storage.ts,
 * which keeps subscription state out of backups for the same reason.
 */

export const LLM_CONFIG_KEY = 'vidhence_llm_config';

export type ProviderId =
  | 'gemini'
  | 'openai'
  | 'anthropic'
  | 'groq'
  | 'openrouter'
  | 'deepseek'
  | 'mistral'
  | 'together'
  | 'cerebras'
  | 'xai'
  | 'custom';

export interface LLMConfig {
  provider: ProviderId;
  apiKey: string;
  /** Empty string means "use the provider's default model". */
  model: string;
  /**
   * API root for the 'custom' provider, e.g. https://my-host/v1.
   * Ignored by every other provider, which pin their own endpoint.
   */
  baseUrl?: string;
}

const VALID_PROVIDERS: ProviderId[] = [
  'gemini', 'openai', 'anthropic', 'groq', 'openrouter',
  'deepseek', 'mistral', 'together', 'cerebras', 'xai', 'custom',
];

/**
 * Read the saved config. Returns null when nothing usable is stored.
 * Never throws — localStorage can be unavailable in private-mode WebViews.
 */
export function getLLMConfig(): LLMConfig | null {
  try {
    const raw = localStorage.getItem(LLM_CONFIG_KEY);
    if (!raw) return null;

    const parsed = JSON.parse(raw) as Partial<LLMConfig>;
    if (!parsed || typeof parsed !== 'object') return null;
    if (!parsed.provider || !VALID_PROVIDERS.includes(parsed.provider)) return null;
    if (typeof parsed.apiKey !== 'string' || !parsed.apiKey.trim()) return null;

    return {
      provider: parsed.provider,
      apiKey: parsed.apiKey.trim(),
      model: typeof parsed.model === 'string' ? parsed.model.trim() : '',
      baseUrl: typeof parsed.baseUrl === 'string' ? parsed.baseUrl.trim() : undefined,
    };
  } catch {
    return null;
  }
}

export function saveLLMConfig(config: LLMConfig): void {
  try {
    localStorage.setItem(
      LLM_CONFIG_KEY,
      JSON.stringify({
        provider: config.provider,
        apiKey: config.apiKey.trim(),
        model: config.model.trim(),
        baseUrl: config.baseUrl?.trim() || undefined,
      }),
    );
  } catch {
    /* storage full or blocked — the caller surfaces a toast */
  }
}

export function clearLLMConfig(): void {
  try {
    localStorage.removeItem(LLM_CONFIG_KEY);
  } catch {
    /* no-op */
  }
}

export function isAssistantConfigured(): boolean {
  return getLLMConfig() !== null;
}

/** Show only the tail of a key, so the settings screen can confirm which one is saved. */
export function maskApiKey(key: string): string {
  const trimmed = key.trim();
  if (trimmed.length <= 8) return '••••';
  return `${'•'.repeat(8)}${trimmed.slice(-4)}`;
}
