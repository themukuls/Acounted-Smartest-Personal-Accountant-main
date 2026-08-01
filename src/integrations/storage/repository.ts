/**
 * repository.ts — the store-level API that replaces IndexedDB.
 *
 * Model: one JSON file per store, holding a plain array of records. The whole
 * store is held in memory once touched; reads are array operations and writes
 * re-serialise the array. Measured across the entire app the access patterns
 * are 40 `getAll()`, 43 `user_id` filters, 4 `email` filters, 1 `group_id`
 * filter and exactly one cursor — there is no workload here that justifies a
 * query engine, and pretending otherwise would buy complexity with no user
 * visible return.
 *
 * Three properties in this file are load-bearing and easy to "simplify" into
 * data loss. Each is commented where it lives:
 *   1. ATOMIC WRITES  — see `persistNow`
 *   2. DEBOUNCED WRITES — see `scheduleWrite`
 *   3. FLUSH ON BACKGROUND — see `registerLifecycleHooks`
 *
 * Mutation policy: every record that leaves this module is a deep copy, and
 * every record handed to `put`/`bulkPut` is deep-copied on the way in. The
 * services spread-copy records and then mutate the copy; returning the live
 * cached objects would let a caller silently corrupt the cache (and, on the
 * next flush, the file on disk). Copying is the boring, safe default.
 */

import { getAdapter } from './adapter';
import { keyFieldFor, type StoreName } from './stores';

/** Any persisted record. The services layer supplies the concrete types. */
export type StoredRecord = Record<string, unknown>;

/**
 * How long a store sits dirty before it is written.
 *
 * DEBOUNCED WRITES — a single user action (saving a budget, logging a
 * payment) routinely produces several `put` calls in a row. Serialising and
 * re-writing the entire store file for each one turns one user action into
 * N full-file writes, which on a mid-range Android device is visible jank.
 * The debounce coalesces them into one write. It is safe ONLY because of the
 * flush-on-background handlers below — remove those and this becomes a
 * data-loss bug.
 */
const WRITE_DEBOUNCE_MS = 400;

interface StoreState {
  /** The authoritative in-memory copy. Never handed out directly. */
  records: StoredRecord[];
  /** Resolves once `records` is populated. `null` until first access. */
  loading: Promise<void> | null;
  loaded: boolean;
  /** Pending changes not yet on disk. */
  dirty: boolean;
  timer: ReturnType<typeof setTimeout> | null;
  /** Serialises overlapping persist calls so two writers can't interleave. */
  writing: Promise<void>;
  /**
   * The exact text last successfully written to `<store>.json`. This is what
   * gets copied into `<store>.bak` before the next write — it is how we keep
   * a known-good previous generation without re-reading the primary file.
   */
  lastPersisted: string | null;
}

const states = new Map<StoreName, StoreState>();

function stateFor(store: StoreName): StoreState {
  let state = states.get(store);
  if (!state) {
    state = {
      records: [],
      loading: null,
      loaded: false,
      dirty: false,
      timer: null,
      writing: Promise.resolve(),
      lastPersisted: null,
    };
    states.set(store, state);
  }
  return state;
}

// ── File naming ─────────────────────────────────────────────────────────────

const primaryFile = (store: StoreName): string => `${store}.json`;
const backupFile = (store: StoreName): string => `${store}.bak`;
const tempFile = (store: StoreName): string => `${store}.tmp`;

// ── Cloning ─────────────────────────────────────────────────────────────────

function clone<T>(value: T): T {
  if (value === null || typeof value !== 'object') return value;
  if (typeof structuredClone === 'function') {
    try {
      return structuredClone(value);
    } catch {
      // structuredClone rejects functions/DOM nodes; JSON round-trip is the
      // right fallback because everything here has to be JSON-serialisable
      // anyway to reach disk.
    }
  }
  return JSON.parse(JSON.stringify(value)) as T;
}

// ── Loading ─────────────────────────────────────────────────────────────────

function parseRecords(text: string): StoredRecord[] | null {
  try {
    const parsed: unknown = JSON.parse(text);
    return Array.isArray(parsed) ? (parsed as StoredRecord[]) : null;
  } catch {
    return null;
  }
}

/**
 * Read a store off disk, preferring `<store>.json` and falling back to
 * `<store>.bak`.
 *
 * The fallback is not defensive padding — it is the second half of the atomic
 * write in `persistNow`. If the process died mid-rename, or the OPFS
 * read+write+delete rename emulation was interrupted, the primary can be
 * missing or truncated. In both cases the backup holds the previous complete
 * generation. Losing one debounce window of edits is survivable; losing a
 * user's entire transaction history is not.
 */
async function loadStore(store: StoreName, state: StoreState): Promise<void> {
  const adapter = getAdapter();

  let primary: string | null = null;
  try {
    primary = await adapter.read(primaryFile(store));
  } catch (err) {
    console.error(`[storage] failed to read ${primaryFile(store)}`, err);
  }

  if (primary !== null) {
    const parsed = parseRecords(primary);
    if (parsed) {
      state.records = parsed;
      state.lastPersisted = primary;
      state.loaded = true;
      return;
    }
    console.error(
      `[storage] CORRUPT PRIMARY: ${primaryFile(store)} is not a valid JSON array. ` +
        `Attempting recovery from ${backupFile(store)}.`,
    );
  }

  let backup: string | null = null;
  try {
    backup = await adapter.read(backupFile(store));
  } catch (err) {
    console.error(`[storage] failed to read ${backupFile(store)}`, err);
  }

  if (backup !== null) {
    const parsed = parseRecords(backup);
    if (parsed) {
      console.error(
        `[storage] RECOVERED "${store}" from ${backupFile(store)} ` +
          `(${parsed.length} records). The primary file was missing or corrupt.`,
      );
      state.records = parsed;
      state.lastPersisted = backup;
      state.loaded = true;
      // Mark dirty so the recovered generation is rewritten to the primary.
      state.dirty = true;
      scheduleWrite(store, state);
      return;
    }
    console.error(
      `[storage] UNRECOVERABLE: both ${primaryFile(store)} and ${backupFile(store)} ` +
        `are unparseable for "${store}". Starting empty.`,
    );
  }

  // Normal first-run path: neither file exists yet.
  state.records = [];
  state.lastPersisted = null;
  state.loaded = true;
}

/**
 * LAZY LOAD — stores are read on first touch, never eagerly at boot. Loading
 * all 23 files during startup would put a dozen filesystem round-trips in
 * front of first paint for data most screens never look at.
 */
async function ensureLoaded(store: StoreName): Promise<StoreState> {
  const state = stateFor(store);
  if (state.loaded) return state;
  if (!state.loading) {
    state.loading = loadStore(store, state).finally(() => {
      state.loading = null;
    });
  }
  await state.loading;
  return state;
}

// ── Persisting ──────────────────────────────────────────────────────────────

function scheduleWrite(store: StoreName, state: StoreState): void {
  state.dirty = true;
  registerLifecycleHooks();
  if (state.timer !== null) clearTimeout(state.timer);
  state.timer = setTimeout(() => {
    state.timer = null;
    void persist(store).catch((err) => {
      console.error(`[storage] debounced write for "${store}" failed`, err);
    });
  }, WRITE_DEBOUNCE_MS);
}

/**
 * ATOMIC WRITES — the single most important thing in this file.
 *
 * IndexedDB gave us transactional durability for free. A naive
 * "JSON.stringify then overwrite the file" loses a user's entire ledger if the
 * process is killed while that overwrite is in flight (Android kills
 * backgrounded processes with no warning, and the OPFS write path is
 * truncate-then-write). The sequence below never leaves the user without at
 * least one complete generation on disk:
 *
 *   1. copy the last known-good payload to `<store>.bak`
 *      → `<store>.json` is untouched; worst case we corrupt the *backup*
 *   2. write the new payload to `<store>.tmp`
 *      → `<store>.json` is still untouched; a crash here loses nothing
 *   3. rename `<store>.tmp` over `<store>.json`
 *      → the only step that changes the primary, and it is a single
 *        filesystem operation (genuinely atomic natively; emulated on OPFS,
 *        which is exactly why step 1 exists)
 *
 * Do not "optimise" this into a single write. Do not reorder steps 1 and 3
 * into a rename of the primary onto the backup — that leaves a window where
 * `<store>.json` does not exist at all.
 */
async function persistNow(store: StoreName, state: StoreState): Promise<void> {
  if (!state.dirty) return;

  const adapter = getAdapter();
  const payload = JSON.stringify(state.records);

  // Clear the flag *before* awaiting: a `put` that lands while this write is
  // in flight must re-mark the store dirty so its change is not swallowed.
  state.dirty = false;

  try {
    // 1. previous generation → backup
    if (state.lastPersisted !== null && state.lastPersisted !== payload) {
      await adapter.write(backupFile(store), state.lastPersisted);
    }
    // 2. new generation → temp
    await adapter.write(tempFile(store), payload);
    // 3. atomically swap temp over the primary
    await adapter.rename(tempFile(store), primaryFile(store));

    state.lastPersisted = payload;
  } catch (err) {
    // The primary is untouched, so the data on disk is still consistent.
    // Re-arm the dirty flag so a later flush retries.
    state.dirty = true;
    throw err;
  }
}

function persist(store: StoreName): Promise<void> {
  const state = stateFor(store);
  const run = state.writing.then(() => persistNow(store, state));
  // Keep the chain alive even if this link rejects.
  state.writing = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

// ── Lifecycle: flush on background ──────────────────────────────────────────

let lifecycleRegistered = false;

/**
 * FLUSH ON BACKGROUND.
 *
 * The 400ms debounce is only acceptable if we can guarantee it is drained
 * before the process can die. Android kills backgrounded WebViews without
 * warning and without running any "unload" ceremony beyond the visibility
 * transition, so an in-flight debounce is silently lost data — the user taps
 * save, taps home, and their entry is gone.
 *
 * We hook three signals:
 *   - Capacitor `appStateChange` (isActive === false) — the native signal
 *   - `pagehide` — fires on browser tab close/navigation, and on BFCache entry
 *   - `visibilitychange` → hidden — the most reliable mobile-web signal
 *
 * Registration is lazy (first scheduled write) so importing this module in a
 * test or an SSR context attaches nothing.
 */
function registerLifecycleHooks(): void {
  if (lifecycleRegistered) return;
  lifecycleRegistered = true;

  const forceFlush = (): void => {
    void flush();
  };

  if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
    window.addEventListener('pagehide', forceFlush);
  }
  if (typeof document !== 'undefined' && typeof document.addEventListener === 'function') {
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') forceFlush();
    });
  }

  // Guarded: @capacitor/app resolves on web too, but the import (and the
  // native bridge behind it) must never be allowed to break a browser build.
  if (typeof window !== 'undefined') {
    void (async () => {
      try {
        const { App } = await import('@capacitor/app');
        await App.addListener('appStateChange', ({ isActive }) => {
          if (!isActive) forceFlush();
        });
      } catch (err) {
        console.warn('[storage] @capacitor/app appStateChange listener unavailable', err);
      }
    })();
  }
}

// ── Public API ──────────────────────────────────────────────────────────────

/** Every record in a store. Returns deep copies — safe to mutate. */
export async function getAll<T = StoredRecord>(store: StoreName): Promise<T[]> {
  const state = await ensureLoaded(store);
  return clone(state.records) as T[];
}

/**
 * Every record whose `field` strictly equals `value`.
 *
 * This is a plain `.filter()` over the cached array, and that is genuinely
 * sufficient: the largest store in this app is a personal transaction ledger,
 * and the replaced IndexedDB indexes (`user_id`, `email`, `group_id`) were
 * equality lookups over at most a few thousand rows.
 */
export async function getAllByIndex<T = StoredRecord>(
  store: StoreName,
  field: string,
  value: unknown,
): Promise<T[]> {
  const state = await ensureLoaded(store);
  const matches = state.records.filter((record) => record[field] === value);
  return clone(matches) as T[];
}

/** A single record by primary key, or `undefined` (matching IndexedDB's `get`). */
export async function get<T = StoredRecord>(
  store: StoreName,
  key: string,
): Promise<T | undefined> {
  const state = await ensureLoaded(store);
  const field = keyFieldFor(store);
  const found = state.records.find((record) => record[field] === key);
  return found === undefined ? undefined : (clone(found) as T);
}

/**
 * Insert or replace a record by primary key. Returns the saved record, which
 * is what every service already expects back from its save function.
 */
export async function put<T extends object>(store: StoreName, record: T): Promise<T> {
  const state = await ensureLoaded(store);
  const field = keyFieldFor(store);
  const stored = clone(record) as unknown as StoredRecord;
  const key = stored[field];

  if (key === undefined || key === null) {
    throw new Error(`[storage] put("${store}"): record is missing its key field "${field}"`);
  }

  const index = state.records.findIndex((existing) => existing[field] === key);
  if (index >= 0) {
    state.records[index] = stored;
  } else {
    state.records.push(stored);
  }

  scheduleWrite(store, state);
  return clone(record);
}

/** Insert or replace many records in one pass (one debounced write, not N). */
export async function bulkPut<T extends object>(store: StoreName, records: T[]): Promise<T[]> {
  const state = await ensureLoaded(store);
  const field = keyFieldFor(store);

  for (const record of records) {
    const stored = clone(record) as unknown as StoredRecord;
    const key = stored[field];
    if (key === undefined || key === null) {
      throw new Error(
        `[storage] bulkPut("${store}"): a record is missing its key field "${field}"`,
      );
    }
    const index = state.records.findIndex((existing) => existing[field] === key);
    if (index >= 0) {
      state.records[index] = stored;
    } else {
      state.records.push(stored);
    }
  }

  if (records.length > 0) scheduleWrite(store, state);
  return clone(records);
}

/** Delete a record by primary key. No-op when absent. */
export async function remove(store: StoreName, key: string): Promise<void> {
  const state = await ensureLoaded(store);
  const field = keyFieldFor(store);
  const index = state.records.findIndex((record) => record[field] === key);
  if (index < 0) return;
  state.records.splice(index, 1);
  scheduleWrite(store, state);
}

/** Empty a store. */
export async function clear(store: StoreName): Promise<void> {
  const state = await ensureLoaded(store);
  if (state.records.length === 0 && !state.dirty) {
    state.records = [];
    return;
  }
  state.records = [];
  scheduleWrite(store, state);
}

/** Force the pending write for one store to disk immediately. */
export async function flushStore(store: StoreName): Promise<void> {
  const state = states.get(store);
  if (!state) return;
  if (state.timer !== null) {
    clearTimeout(state.timer);
    state.timer = null;
  }
  await persist(store);
}

/**
 * Force every pending write to disk immediately.
 *
 * Never rejects: it is called from `pagehide` and `appStateChange`, where an
 * unhandled rejection would be both useless and noisy. Failures are logged;
 * the affected store stays dirty and will be retried.
 */
export async function flush(): Promise<void> {
  const pending = Array.from(states.keys());
  const results = await Promise.allSettled(pending.map((store) => flushStore(store)));
  results.forEach((result, i) => {
    if (result.status === 'rejected') {
      console.error(`[storage] flush of "${pending[i]}" failed`, result.reason);
    }
  });
}

/**
 * Drop every cached store and cancel every pending write, without touching
 * disk. For tests and for sign-out, where the next read must come from the
 * adapter rather than from another user's cache.
 */
export function resetCache(): void {
  for (const state of states.values()) {
    if (state.timer !== null) {
      clearTimeout(state.timer);
      state.timer = null;
    }
  }
  states.clear();
}

/** True when at least one store has unwritten changes. Diagnostics/tests. */
export function hasPendingWrites(): boolean {
  for (const state of states.values()) {
    if (state.dirty) return true;
  }
  return false;
}
