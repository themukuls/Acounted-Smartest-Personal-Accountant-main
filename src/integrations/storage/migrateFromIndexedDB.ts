/**
 * migrateFromIndexedDB.ts — the one-time move of real user data off IndexedDB.
 *
 * Every existing install has its entire ledger inside the `vidhence-db`
 * IndexedDB database. The new build reads from files, so unless this runs on
 * first launch those users open the app to an empty account. It therefore has
 * to be boring and paranoid rather than clever:
 *
 *   - IndexedDB is opened READ-ONLY and with NO upgrade callback, at the
 *     version the database already reports. An upgrade callback here could
 *     mutate (or, worse, half-create) the schema that is our only rollback
 *     path, and opening at a *higher* version than the database has would fire
 *     an upgrade with no handler and silently bump it.
 *   - Nothing is ever deleted. If this migration turns out to be wrong we can
 *     ship a build that reads IndexedDB again and lose nothing.
 *   - The "done" flag is written only after every store has been verified row
 *     for row AND `flush()` has pushed the debounce buffer to disk. A mismatch
 *     throws, which leaves the flag unset so the next launch retries — a
 *     failed retry is cheap, a silent half-migration is not.
 *   - A fresh install (no IndexedDB at all) must never throw. It marks itself
 *     migrated and gets out of the way.
 */

import { openDB, deleteDB, type IDBPDatabase } from 'idb';

import { bulkPut, flush, getAll } from './repository';
import { STORE_NAMES, keyFieldFor, type StoreName } from './stores';

/** Set once the data is safely in files. Checked before anything else. */
const MIGRATED_FLAG = 'vidhence_storage_migrated';

const DB_NAME = 'vidhence-db';
/** The schema version this app shipped with (see indexeddb/db.ts). */
const DB_VERSION = 11;

export interface MigrationResult {
  /** True when rows were actually copied out of IndexedDB. */
  migrated: boolean;
  /** Rows migrated per store. Empty when there was nothing to do. */
  counts: Record<string, number>;
}

function alreadyMigrated(): boolean {
  try {
    return localStorage.getItem(MIGRATED_FLAG) === 'true';
  } catch {
    return false;
  }
}

function markMigrated(): void {
  try {
    localStorage.setItem(MIGRATED_FLAG, 'true');
  } catch (err) {
    console.warn('[migrate] could not persist the migration flag', err);
  }
}

/**
 * Open `vidhence-db` if — and only if — it already exists, without ever
 * triggering a schema upgrade.
 *
 * `indexedDB.databases()` gives us both existence and the *actual* version, so
 * the open below can match it exactly and never fire `upgradeneeded`. Where
 * that API is missing we fall back to opening at the known version; if that
 * open produces a database with no object stores then it did not exist and we
 * just created an empty one, which would break any remaining `getDb()` caller,
 * so it is removed again. A real install always has at least 13 stores.
 */
async function openExistingDatabase(): Promise<IDBPDatabase | null> {
  if (typeof indexedDB === 'undefined') return null;

  let version = DB_VERSION;
  let knownToExist = false;

  if (typeof indexedDB.databases === 'function') {
    try {
      const found = (await indexedDB.databases()).find((entry) => entry.name === DB_NAME);
      if (!found) return null;
      knownToExist = true;
      if (typeof found.version === 'number' && found.version > 0) version = found.version;
    } catch (err) {
      console.warn('[migrate] indexedDB.databases() failed; falling back to a direct open', err);
    }
  }

  // No upgrade callback, deliberately — see the file header.
  const db = await openDB(DB_NAME, version);

  if (db.objectStoreNames.length === 0) {
    db.close();
    if (!knownToExist) {
      // We created this empty database ourselves just now. Remove it so a
      // legacy `getDb()` call still sees "no database" and builds the schema.
      try {
        await deleteDB(DB_NAME);
      } catch (err) {
        console.warn('[migrate] could not remove the empty database we created', err);
      }
    }
    return null;
  }

  return db;
}

/**
 * Copy one store across and confirm every source row landed.
 *
 * Verification is by primary key rather than a bare length comparison: the
 * repository may legitimately already hold some of these rows (a previous run
 * that threw part-way, and this is the retry), and `bulkPut` is keyed and
 * idempotent, so "every source key is present afterwards" is both the stronger
 * check and the one that does not false-alarm on a retry.
 */
async function migrateStore(db: IDBPDatabase, store: StoreName): Promise<number> {
  if (!db.objectStoreNames.contains(store)) {
    console.log(`[migrate] ${store}: store absent from IndexedDB, skipping`);
    return 0;
  }

  const rows = (await db.getAll(store)) as Record<string, unknown>[];
  if (rows.length === 0) {
    console.log(`[migrate] ${store}: 0 rows`);
    return 0;
  }

  await bulkPut(store, rows);

  const keyField = keyFieldFor(store);
  const after = await getAll<Record<string, unknown>>(store);
  const presentKeys = new Set(after.map((record) => record[keyField]));
  const verified = rows.filter((row) => presentKeys.has(row[keyField])).length;

  if (verified !== rows.length) {
    throw new Error(
      `[migrate] "${store}" verification failed: ${rows.length} rows read from IndexedDB but ` +
        `only ${verified} found in the repository. Leaving the migration flag unset so the ` +
        `next launch retries; IndexedDB is untouched.`,
    );
  }

  console.log(`[migrate] ${store}: ${rows.length} rows migrated and verified`);
  return rows.length;
}

/**
 * Move everything from IndexedDB into the file-backed repository, once.
 *
 * Safe to call on web and on native, safe to call repeatedly, and safe on a
 * fresh install with no IndexedDB. Throws only when a store failed to verify —
 * the caller should log and continue, and the migration will retry next launch.
 */
export async function migrateFromIndexedDBIfNeeded(): Promise<MigrationResult> {
  if (alreadyMigrated()) return { migrated: false, counts: {} };

  let db: IDBPDatabase | null = null;
  try {
    db = await openExistingDatabase();
  } catch (err) {
    // A database we cannot even open has nothing we can rescue; do not wedge
    // the app on every launch retrying it.
    console.error('[migrate] could not open the legacy database; treating as nothing to migrate', err);
    markMigrated();
    return { migrated: false, counts: {} };
  }

  if (!db) {
    console.log('[migrate] no legacy IndexedDB found — nothing to migrate.');
    markMigrated();
    return { migrated: false, counts: {} };
  }

  const counts: Record<string, number> = {};
  try {
    for (const store of STORE_NAMES) {
      counts[store] = await migrateStore(db, store);
    }

    // Nothing may sit in the 400ms debounce buffer when we declare victory.
    await flush();
  } finally {
    db.close();
  }

  markMigrated();

  const total = Object.values(counts).reduce((sum, n) => sum + n, 0);
  console.log(`[migrate] complete — ${total} rows across ${STORE_NAMES.length} stores. IndexedDB left intact.`);

  return { migrated: total > 0, counts };
}
