/**
 * providers.ts — one thin adapter per LLM vendor.
 *
 * Each provider does exactly one thing: take a system prompt + a user message,
 * return the model's raw text. Parsing, validation and anything to do with the
 * user's data happens elsewhere. Swapping vendors is a dropdown, not a rewrite.
 *
 * All of them are called directly from the browser using the user's own key.
 *
 * ── Shape ────────────────────────────────────────────────────────────────────
 * Most vendors expose OpenAI's /chat/completions contract, so they are built by
 * `openAICompatible()` rather than hand-written. Only Gemini and Anthropic have
 * genuinely different request/response shapes and need bespoke adapters.
 *
 * ── A note on model IDs ──────────────────────────────────────────────────────
 * The lists below are a starting point, not a source of truth — vendors rename
 * and retire models constantly. Every provider therefore accepts a free-typed
 * model ID, and "Test connection" is what actually tells the user whether their
 * choice works. Do not treat a missing model here as unsupported.
 *
 * ── CORS ─────────────────────────────────────────────────────────────────────
 * Browser-direct calls depend on the vendor sending permissive CORS headers.
 * Most here do; Anthropic needs an explicit opt-in header. If a vendor changes
 * its policy the request fails at the network layer, which surfaces as
 * "Could not reach the AI provider" — hence the Test button.
 */

import type { ProviderId } from './settings';

/** A provider failure the UI can render sensibly instead of a raw stack trace. */
export class ProviderError extends Error {
  readonly status: number | null;

  constructor(message: string, status: number | null = null) {
    super(message);
    this.name = 'ProviderError';
    this.status = status;
  }

  /** Plain-English message for the toast / inline error. */
  get friendlyMessage(): string {
    if (this.status === 401 || this.status === 403) {
      return 'That API key was rejected. Check it in AI Assistant settings.';
    }
    if (this.status === 429) {
      return 'Rate limited by the provider. Wait a moment and try again.';
    }
    if (this.status === 404) {
      return 'That model name was not found. Pick another one in settings.';
    }
    if (this.status !== null && this.status >= 500) {
      return 'The AI provider is having trouble right now. Try again shortly.';
    }
    return this.message;
  }
}

export interface ModelOption {
  id: string;
  label: string;
  /** Short hint shown beside the option — speed, cost, "free tier" etc. */
  note?: string;
}

export interface CompleteOptions {
  apiKey: string;
  model: string;
  system: string;
  user: string;
  /** Only used by providers with `requiresBaseUrl`. */
  baseUrl?: string;
  signal?: AbortSignal;
}

export interface LLMProvider {
  id: ProviderId;
  label: string;
  defaultModel: string;
  /** Suggested models. The user may always type their own instead. */
  models: ModelOption[];
  keyPlaceholder: string;
  keysUrl: string;
  /** One line in the settings UI explaining who this is good for. */
  blurb: string;
  /** True when the user must supply the endpoint themselves. */
  requiresBaseUrl?: boolean;
  complete(opts: CompleteOptions): Promise<string>;
}

const REQUEST_TIMEOUT_MS = 30_000;

/**
 * fetch + JSON, with a timeout and uniform error mapping.
 * Network failures become ProviderError with a null status.
 */
async function postJson(
  url: string,
  headers: Record<string, string>,
  body: unknown,
  signal?: AbortSignal,
): Promise<any> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  const onAbort = () => controller.abort();
  signal?.addEventListener('abort', onAbort);

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    if (!res.ok) {
      let detail = res.statusText;
      try {
        const errBody = await res.json();
        detail = errBody?.error?.message ?? errBody?.message ?? detail;
      } catch {
        /* body wasn't JSON — keep the status text */
      }
      throw new ProviderError(detail || `Request failed (${res.status})`, res.status);
    }

    return await res.json();
  } catch (err) {
    if (err instanceof ProviderError) throw err;
    if (err instanceof DOMException && err.name === 'AbortError') {
      throw new ProviderError(
        signal?.aborted ? 'Request cancelled.' : 'The request timed out. Check your connection.',
      );
    }
    throw new ProviderError('Could not reach the AI provider. Are you online?');
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener('abort', onAbort);
  }
}

// ─── The OpenAI-compatible family ────────────────────────────────────────────

interface CompatibleSpec {
  id: ProviderId;
  label: string;
  blurb: string;
  /** Root of the API, WITHOUT a trailing slash. e.g. https://api.groq.com/openai/v1 */
  baseUrl?: string;
  defaultModel: string;
  models: ModelOption[];
  keyPlaceholder: string;
  keysUrl: string;
  requiresBaseUrl?: boolean;
  /**
   * Whether to send `response_format: { type: 'json_object' }`. Vendors that
   * don't recognise the field reject the whole request, so it is opt-in — the
   * prompt already demands raw JSON, so this is an optimisation, not a
   * requirement.
   */
  jsonMode?: boolean;
  /** Extra headers, e.g. OpenRouter's attribution pair. */
  headers?: Record<string, string>;
}

function openAICompatible(spec: CompatibleSpec): LLMProvider {
  return {
    id: spec.id,
    label: spec.label,
    blurb: spec.blurb,
    defaultModel: spec.defaultModel,
    models: spec.models,
    keyPlaceholder: spec.keyPlaceholder,
    keysUrl: spec.keysUrl,
    requiresBaseUrl: spec.requiresBaseUrl,

    async complete({ apiKey, model, system, user, baseUrl, signal }) {
      const root = (spec.requiresBaseUrl ? baseUrl : spec.baseUrl)?.replace(/\/+$/, '');
      if (!root) {
        throw new ProviderError('No API endpoint set for this provider.');
      }

      const body: Record<string, unknown> = {
        model: model || spec.defaultModel,
        temperature: 0,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
      };
      if (spec.jsonMode) body.response_format = { type: 'json_object' };

      const data = await postJson(
        `${root}/chat/completions`,
        { Authorization: `Bearer ${apiKey}`, ...(spec.headers ?? {}) },
        body,
        signal,
      );

      const text = data?.choices?.[0]?.message?.content;
      if (typeof text !== 'string') {
        throw new ProviderError(`${spec.label} returned an unexpected response shape.`);
      }
      return text;
    },
  };
}

// ─── Google Gemini (bespoke shape) ───────────────────────────────────────────

const gemini: LLMProvider = {
  id: 'gemini',
  label: 'Google Gemini',
  blurb: 'Free tier without a card. Easiest place to start.',
  defaultModel: 'gemini-2.0-flash',
  models: [
    { id: 'gemini-2.0-flash', label: 'Gemini 2.0 Flash', note: 'fast, free tier' },
    { id: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash' },
    { id: 'gemini-2.5-pro', label: 'Gemini 2.5 Pro', note: 'slower, stronger' },
  ],
  keyPlaceholder: 'AIza…',
  keysUrl: 'https://aistudio.google.com/app/apikey',

  async complete({ apiKey, model, system, user, signal }) {
    const data = await postJson(
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
        model || gemini.defaultModel,
      )}:generateContent`,
      { 'x-goog-api-key': apiKey },
      {
        system_instruction: { parts: [{ text: system }] },
        contents: [{ role: 'user', parts: [{ text: user }] }],
        generationConfig: { temperature: 0, responseMimeType: 'application/json' },
      },
      signal,
    );

    const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (typeof text !== 'string') {
      throw new ProviderError('Gemini returned an unexpected response shape.');
    }
    return text;
  },
};

// ─── Anthropic (bespoke shape) ───────────────────────────────────────────────

const anthropic: LLMProvider = {
  id: 'anthropic',
  label: 'Anthropic Claude',
  blurb: 'Strong at following the output format exactly.',
  defaultModel: 'claude-haiku-4-5-20251001',
  models: [
    { id: 'claude-haiku-4-5-20251001', label: 'Claude Haiku 4.5', note: 'fast, cheap' },
    { id: 'claude-sonnet-5', label: 'Claude Sonnet 5' },
    { id: 'claude-opus-5', label: 'Claude Opus 5', note: 'strongest' },
  ],
  keyPlaceholder: 'sk-ant-…',
  keysUrl: 'https://console.anthropic.com/settings/keys',

  async complete({ apiKey, model, system, user, signal }) {
    const data = await postJson(
      'https://api.anthropic.com/v1/messages',
      {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        // Required for browser-originated calls; without it the request is
        // blocked by CORS before it ever reaches Anthropic.
        'anthropic-dangerous-direct-browser-access': 'true',
      },
      {
        model: model || anthropic.defaultModel,
        max_tokens: 1024,
        temperature: 0,
        system,
        messages: [{ role: 'user', content: user }],
      },
      signal,
    );

    const text = data?.content?.[0]?.text;
    if (typeof text !== 'string') {
      throw new ProviderError('Claude returned an unexpected response shape.');
    }
    return text;
  },
};

// ─── The compatible ones ─────────────────────────────────────────────────────

const openai = openAICompatible({
  id: 'openai',
  label: 'OpenAI',
  blurb: 'The most familiar option. Requires a paid account.',
  baseUrl: 'https://api.openai.com/v1',
  defaultModel: 'gpt-4o-mini',
  models: [
    { id: 'gpt-4o-mini', label: 'GPT-4o mini', note: 'cheap, plenty for this' },
    { id: 'gpt-4o', label: 'GPT-4o' },
    { id: 'gpt-4.1-mini', label: 'GPT-4.1 mini' },
  ],
  keyPlaceholder: 'sk-…',
  keysUrl: 'https://platform.openai.com/api-keys',
  jsonMode: true,
});

const groq = openAICompatible({
  id: 'groq',
  label: 'Groq',
  blurb: 'Extremely fast, generous free tier. Good default for voice.',
  baseUrl: 'https://api.groq.com/openai/v1',
  defaultModel: 'llama-3.3-70b-versatile',
  models: [
    { id: 'llama-3.3-70b-versatile', label: 'Llama 3.3 70B', note: 'best quality here' },
    { id: 'llama-3.1-8b-instant', label: 'Llama 3.1 8B', note: 'fastest' },
    { id: 'openai/gpt-oss-120b', label: 'GPT-OSS 120B' },
  ],
  keyPlaceholder: 'gsk_…',
  keysUrl: 'https://console.groq.com/keys',
  jsonMode: true,
});

const openrouter = openAICompatible({
  id: 'openrouter',
  label: 'OpenRouter',
  blurb: 'One key, hundreds of models — including free ones.',
  baseUrl: 'https://openrouter.ai/api/v1',
  defaultModel: 'google/gemini-2.0-flash-001',
  models: [
    { id: 'google/gemini-2.0-flash-001', label: 'Gemini 2.0 Flash' },
    { id: 'anthropic/claude-3.5-sonnet', label: 'Claude 3.5 Sonnet' },
    { id: 'openai/gpt-4o-mini', label: 'GPT-4o mini' },
    { id: 'meta-llama/llama-3.3-70b-instruct', label: 'Llama 3.3 70B' },
  ],
  keyPlaceholder: 'sk-or-…',
  keysUrl: 'https://openrouter.ai/keys',
  jsonMode: true,
  headers: { 'HTTP-Referer': 'https://acounted.com', 'X-Title': 'Acounted' },
});

const deepseek = openAICompatible({
  id: 'deepseek',
  label: 'DeepSeek',
  blurb: 'Very cheap per token.',
  baseUrl: 'https://api.deepseek.com/v1',
  defaultModel: 'deepseek-chat',
  models: [
    { id: 'deepseek-chat', label: 'DeepSeek Chat' },
    { id: 'deepseek-reasoner', label: 'DeepSeek Reasoner', note: 'slower' },
  ],
  keyPlaceholder: 'sk-…',
  keysUrl: 'https://platform.deepseek.com/api_keys',
  jsonMode: true,
});

const mistral = openAICompatible({
  id: 'mistral',
  label: 'Mistral',
  blurb: 'European provider, EU data residency.',
  baseUrl: 'https://api.mistral.ai/v1',
  defaultModel: 'mistral-small-latest',
  models: [
    { id: 'mistral-small-latest', label: 'Mistral Small' },
    { id: 'mistral-large-latest', label: 'Mistral Large' },
    { id: 'open-mistral-nemo', label: 'Mistral Nemo', note: 'cheapest' },
  ],
  keyPlaceholder: '…',
  keysUrl: 'https://console.mistral.ai/api-keys',
  jsonMode: true,
});

const together = openAICompatible({
  id: 'together',
  label: 'Together AI',
  blurb: 'Wide catalogue of open models.',
  baseUrl: 'https://api.together.xyz/v1',
  defaultModel: 'meta-llama/Llama-3.3-70B-Instruct-Turbo',
  models: [
    { id: 'meta-llama/Llama-3.3-70B-Instruct-Turbo', label: 'Llama 3.3 70B Turbo' },
    { id: 'mistralai/Mixtral-8x7B-Instruct-v0.1', label: 'Mixtral 8x7B' },
  ],
  keyPlaceholder: '…',
  keysUrl: 'https://api.together.xyz/settings/api-keys',
  jsonMode: true,
});

const cerebras = openAICompatible({
  id: 'cerebras',
  label: 'Cerebras',
  blurb: 'Fastest inference available, free tier.',
  baseUrl: 'https://api.cerebras.ai/v1',
  defaultModel: 'llama-3.3-70b',
  models: [
    { id: 'llama-3.3-70b', label: 'Llama 3.3 70B' },
    { id: 'llama3.1-8b', label: 'Llama 3.1 8B', note: 'fastest' },
  ],
  keyPlaceholder: 'csk-…',
  keysUrl: 'https://cloud.cerebras.ai',
});

const xai = openAICompatible({
  id: 'xai',
  label: 'xAI Grok',
  blurb: "xAI's Grok models.",
  baseUrl: 'https://api.x.ai/v1',
  defaultModel: 'grok-2-latest',
  models: [
    { id: 'grok-2-latest', label: 'Grok 2' },
    { id: 'grok-beta', label: 'Grok Beta' },
  ],
  keyPlaceholder: 'xai-…',
  keysUrl: 'https://console.x.ai',
  jsonMode: true,
});

const custom = openAICompatible({
  id: 'custom',
  label: 'Custom (OpenAI-compatible)',
  blurb: 'Any endpoint that speaks /chat/completions — self-hosted included.',
  defaultModel: '',
  models: [],
  keyPlaceholder: 'your key, or anything if unauthenticated',
  keysUrl: 'https://platform.openai.com/docs/api-reference/chat',
  requiresBaseUrl: true,
});

// ─── Registry ────────────────────────────────────────────────────────────────

export const PROVIDER_LIST: LLMProvider[] = [
  gemini,
  groq,
  openai,
  anthropic,
  openrouter,
  deepseek,
  mistral,
  together,
  cerebras,
  xai,
  custom,
];

export const PROVIDERS: Record<string, LLMProvider> = Object.fromEntries(
  PROVIDER_LIST.map((p) => [p.id, p]),
);

export function getProvider(id: ProviderId): LLMProvider {
  return PROVIDERS[id] ?? gemini;
}
