/// <reference types="vite/client" />

interface ImportMetaEnv {
  /**
   * Absolute origin of the deployed API (e.g. "https://acounted.vercel.app").
   *
   * Required for Android builds: the app is served from https://localhost, so a
   * relative "/api/..." path resolves to the WebView and never reaches the
   * server. Leave unset for web builds, where same-origin relative paths work.
   */
  readonly VITE_API_BASE_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
