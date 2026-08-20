import { createRoot } from 'react-dom/client'
import App from './App.tsx'
import './index.css'
import { isNative } from './lib/platform'
import { migrateFromIndexedDBIfNeeded } from './integrations/storage/migrateFromIndexedDB'

// ── Copy protection (native app only) ─────────────────────────────────────────
// Inside the native app we disable text selection, copy/cut, the long-press
// callout and the right-click / long-press menu so on-screen content can't be
// copied out. The regular web build is untouched, and form fields
// (input/textarea/contenteditable) stay fully usable so typing, selecting and
// pasting inside forms keeps working.
//
// This used to sniff `location.protocol === 'file:'` and a hand-injected
// AndroidBridge global. Capacitor serves the bundle over https://localhost and
// injects no such global, so both checks would silently never fire — the
// protection would have been dead code in the Capacitor build.
const isNativeApp = isNative();

function isEditableTarget(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el || typeof el.closest !== 'function') return false;
  return !!el.closest('input, textarea, [contenteditable="true"], [contenteditable=""]');
}

function enableCopyProtection() {
  // 1. CSS: no selection / callout anywhere, except editable fields.
  const style = document.createElement('style');
  style.textContent = `
    * {
      -webkit-user-select: none;
      -moz-user-select: none;
      -ms-user-select: none;
      user-select: none;
      -webkit-touch-callout: none;
    }
    input, textarea, [contenteditable="true"], [contenteditable=""] {
      -webkit-user-select: text;
      -moz-user-select: text;
      -ms-user-select: text;
      user-select: text;
      -webkit-touch-callout: default;
    }
  `;
  document.head.appendChild(style);

  // 2. Block the actual copy/selection gestures on non-editable content.
  const block = (e: Event) => {
    if (!isEditableTarget(e.target)) e.preventDefault();
  };
  (['copy', 'cut', 'contextmenu', 'selectstart', 'dragstart'] as const).forEach((evt) =>
    document.addEventListener(evt, block, { capture: true }),
  );
}

if (isNativeApp) enableCopyProtection();

// Existing installs keep their data in IndexedDB; move it into the file-backed
// repository before the first screen can read from it. A failure here must not
// cost the user the app — log it and render anyway; the migration is retried on
// the next launch because its flag is only set on a verified success.
async function bootstrap() {
  // Install the real billing implementation before any entitlement hook can
  // query the adapter. Web/PWA builds deliberately keep the no-store stub.
  if (isNativeApp) {
    try {
      const [{ setBillingAdapter }, { playAdapter }] = await Promise.all([
        import('./lib/entitlement/adapter'),
        import('./lib/entitlement/playAdapter'),
      ]);
      setBillingAdapter(playAdapter);
    } catch (error) {
      // Billing being unavailable must never stop an offline-first finance app
      // from opening. The paywall will offer the no-card local trial instead.
      console.error('[App] Google Play Billing unavailable; using safe fallback', error);
    }
  }

  try {
    await migrateFromIndexedDBIfNeeded();
  } catch (error) {
    console.error('[App] IndexedDB → file migration failed; continuing', error);
  }
  createRoot(document.getElementById("root")!).render(<App />);
}

void bootstrap();

// ── Service Worker Registration (web only) ────────────────────────────────────
// Never register inside the Capacitor WebView. The native app already ships its
// assets on-device, so a service worker buys nothing — but it does introduce a
// second, independently-versioned asset cache that survives app updates. That
// is exactly how you end up with a freshly-installed APK still serving the
// previous release's JS bundle.
if (!isNativeApp && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register('/service-worker.js')
      .then((registration) => {
        console.log('[App] Service Worker registered, scope:', registration.scope);

        // Check for updates every time app loads
        registration.update();
      })
      .catch((error) => {
        console.error('[App] Service Worker registration failed:', error);
      });
  });
}
