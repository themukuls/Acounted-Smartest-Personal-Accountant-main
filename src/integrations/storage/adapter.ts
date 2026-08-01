/**
 * adapter.ts — the ONLY platform-aware surface in the storage layer.
 *
 * Everything above this file (repository.ts, and eventually all 26 services)
 * talks in terms of named blobs of text: "read `transactions.json`", "rename
 * `transactions.tmp` over `transactions.json`". Where those bytes actually
 * live — Android's app-private Documents/Data directory via Capacitor, the
 * browser's Origin Private File System during `npm run dev`, or a plain Map in
 * a unit test — is decided here and nowhere else.
 *
 * Keeping this boundary paper-thin is deliberate: the moment a query or a
 * schema concept leaks into an adapter we lose the ability to swap the backing
 * store, and we would need three implementations of every fix.
 */

import { isNative } from '../../lib/platform';

/**
 * A flat, folder-of-files key/value store over UTF-8 text.
 *
 * Contract notes that implementations MUST honour:
 *  - `read` resolves to `null` for a missing file. It never throws for absence.
 *    (Capacitor's Filesystem throws; that adapter swallows it.)
 *  - `rename` overwrites the destination if it already exists.
 *  - `remove` is idempotent — removing a missing file is not an error.
 */
export interface StorageAdapter {
  /** File contents, or `null` when the file does not exist. */
  read(name: string): Promise<string | null>;
  /** Create or overwrite `name` with `contents`. */
  write(name: string, contents: string): Promise<void>;
  /** Move `from` onto `to`, replacing `to` if present. */
  rename(from: string, to: string): Promise<void>;
  /** Delete `name`. No-op when it does not exist. */
  remove(name: string): Promise<void>;
  /** True when `name` exists. */
  exists(name: string): Promise<boolean>;
}

let cached: StorageAdapter | null = null;

/**
 * The adapter for the current platform, memoised.
 *
 * Memoisation matters for more than speed: the OPFS adapter caches its
 * directory handle and the memory adapter *is* its own state, so handing out
 * fresh instances would silently split storage in two.
 */
export function getAdapter(): StorageAdapter {
  if (cached) return cached;

  if (isNative()) {
    // Lazily required so that a browser/test bundle never evaluates the
    // Capacitor Filesystem plugin.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    cached = createNativeAdapter();
  } else {
    cached = createWebAdapter();
  }
  return cached;
}

/**
 * Override the adapter. Intended for tests (inject a memory adapter with fault
 * hooks) and for the rare case where a caller must force a specific backend.
 * Pass `null` to clear the memoised instance and re-detect on next access.
 */
export function setAdapter(adapter: StorageAdapter | null): void {
  cached = adapter;
}

// ── Indirection so the two concrete modules are imported, not inlined ────────
// Declared below the public API purely for readability.

import { createCapacitorFileAdapter } from './capacitorFileAdapter';
import { createOpfsAdapter } from './opfsAdapter';

function createNativeAdapter(): StorageAdapter {
  return createCapacitorFileAdapter();
}

function createWebAdapter(): StorageAdapter {
  return createOpfsAdapter();
}
