/**
 * settings.ts — where the user's own LLM credentials live.
 *
 * Stored in localStorage under the app's `vidhence_` prefix convention. The key
 * never goes anywhere except the Authorization header of the provider the user
 * picked — no telemetry, no proxy, no logging.
 *
 * IMPORTANT: this key is deliberately excluded from backup exports. See the
 * SENSITIVE_LOCALSTORAGE_KEYS list in src/utils/dbSync.ts — without that skip,
 * exportFullDatabase() would copy the raw key into every backup JSON the user
 * might email to themselves or upload somewhere.
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
