// src/utils/dbSync.ts

/**
 * Data-change notification.
 *
 * ── History, so nobody re-adds the machinery that used to live here ──────────
 * This file previously exported a whole sync system: it read all 23 IndexedDB
 * stores plus localStorage into one JSON blob and pushed it to
 * `window.AndroidBridge.saveFullDatabaseSync()`, which was injected by the old
 * hand-rolled WebView APK.
 *
 * That is all gone, for two reasons:
 *   1. Capacitor never injects `AndroidBridge`, so every one of those functions
 *      had silently become a no-op in the shipping app.
 *   2. Persistence is no longer something to bolt on afterwards. The repository
 *      (src/integrations/storage/repository.ts) owns it: writes are debounced,
 *      written atomically, and force-flushed when the app is backgrounded.
 *
 * What remains is the one genuinely useful piece — a global "something changed"
 * event that interested parts of the UI can listen for.
 */

/**
 * Announce that stored data changed.
 *
 * Note this is a notification, NOT a persistence call — the repository has
 * already durably queued the write by the time you call this. Fire it after a
 * mutation so any listener can react.
 */
export function notifyDatabaseChanged(): void {
  try {
    window.dispatchEvent(new Event('db-changed'));
  } catch {
    /* non-DOM environment (tests) — nothing to notify */
  }
}
