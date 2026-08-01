/**
 * repository.test.ts — the storage layer that replaces IndexedDB.
 * Run with:  npx --yes bun@latest test src/integrations/storage
 *
 * The interesting tests are 5 and 6. Everything else is a round-trip check;
 * those two are the ones that prove we did not trade IndexedDB's transactional
 * durability for a file that can be shredded by a badly timed process kill.
 */

import { test, expect, describe, beforeEach, afterEach } from 'bun:test';
import { setAdapter } from './adapter';
import { createMemoryAdapter, type MemoryAdapter } from './memoryAdapter';
import {
  getAll,
  getAllByIndex,
  get,
  put,
  bulkPut,
  remove,
  clear,
  flush,
  flushStore,
  resetCache,
} from './repository';

const DEBOUNCE_MS = 400;
const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

interface Txn {
  id: string;
  user_id: string;
  amount: number;
  category: string;
}

const txn = (id: string, user_id: string, amount: number, category = 'food'): Txn => ({
  id,
  user_id,
  amount,
  category,
});

let adapter: MemoryAdapter;

beforeEach(() => {
  adapter = createMemoryAdapter();
  setAdapter(adapter);
  resetCache();
});

afterEach(() => {
  resetCache();
  setAdapter(null);
});

// ── 1. Basic CRUD ───────────────────────────────────────────────────────────

describe('CRUD round-trip', () => {
  test('put → getAll returns what went in', async () => {
    await put('transactions', txn('t1', 'u1', 100));
    await put('transactions', txn('t2', 'u1', 250));

    const all = await getAll<Txn>('transactions');
    expect(all).toHaveLength(2);
    expect(all.map((t) => t.id).sort()).toEqual(['t1', 't2']);
  });

  test('put with an existing key replaces rather than duplicates', async () => {
    await put('transactions', txn('t1', 'u1', 100));
    await put('transactions', { ...txn('t1', 'u1', 999), category: 'rent' });

    const all = await getAll<Txn>('transactions');
    expect(all).toHaveLength(1);
    expect(all[0].amount).toBe(999);
    expect(all[0].category).toBe('rent');
  });

  test('put returns the saved record', async () => {
    const saved = await put('transactions', txn('t1', 'u1', 42));
    expect(saved).toEqual(txn('t1', 'u1', 42));
  });

  test('get by key, and undefined for a missing key', async () => {
    await put('transactions', txn('t1', 'u1', 100));
    expect((await get<Txn>('transactions', 't1'))?.amount).toBe(100);
    expect(await get<Txn>('transactions', 'nope')).toBeUndefined();
  });

  test('remove deletes one record and is a no-op for a missing key', async () => {
    await bulkPut('transactions', [txn('t1', 'u1', 1), txn('t2', 'u1', 2)]);
    await remove('transactions', 't1');
    expect((await getAll<Txn>('transactions')).map((t) => t.id)).toEqual(['t2']);

    await remove('transactions', 'ghost');
    expect(await getAll<Txn>('transactions')).toHaveLength(1);
  });

  test('clear empties the store', async () => {
    await bulkPut('transactions', [txn('t1', 'u1', 1), txn('t2', 'u1', 2)]);
    await clear('transactions');
    expect(await getAll<Txn>('transactions')).toEqual([]);
  });

  test('user_notifications keys on notification_id, not id', async () => {
    await put('user_notifications', {
      user_id: 'u1',
      notification_id: 'n1',
      seen_at: '2026-01-01T00:00:00.000Z',
    });
    await put('user_notifications', {
      user_id: 'u1',
      notification_id: 'n1',
      seen_at: '2026-02-02T00:00:00.000Z',
    });

    const all = await getAll<{ notification_id: string; seen_at: string }>('user_notifications');
    expect(all).toHaveLength(1);
    expect(all[0].seen_at).toBe('2026-02-02T00:00:00.000Z');
    expect((await get('user_notifications', 'n1'))).toBeDefined();
  });

  test('data survives a cache reset by going through the adapter', async () => {
    await put('transactions', txn('t1', 'u1', 100));
    await flush();

    resetCache();
    const all = await getAll<Txn>('transactions');
    expect(all).toHaveLength(1);
    expect(all[0].id).toBe('t1');
  });
});

// ── 2. Index filtering ──────────────────────────────────────────────────────

describe('getAllByIndex', () => {
  test('filters by user_id', async () => {
    await bulkPut('transactions', [
      txn('t1', 'u1', 10),
      txn('t2', 'u2', 20),
      txn('t3', 'u1', 30),
    ]);

    const mine = await getAllByIndex<Txn>('transactions', 'user_id', 'u1');
    expect(mine.map((t) => t.id).sort()).toEqual(['t1', 't3']);
  });

  test('returns [] when nothing matches', async () => {
    await bulkPut('transactions', [txn('t1', 'u1', 10)]);
    expect(await getAllByIndex<Txn>('transactions', 'user_id', 'nobody')).toEqual([]);
  });

  test('returns [] for an empty store', async () => {
    expect(await getAllByIndex<Txn>('savings_goals', 'user_id', 'u1')).toEqual([]);
  });

  test('works on non-user_id fields (email, group_id)', async () => {
    await bulkPut('profiles', [
      { id: 'p1', email: 'a@example.com' },
      { id: 'p2', email: 'b@example.com' },
    ]);
    const byEmail = await getAllByIndex<{ id: string }>('profiles', 'email', 'b@example.com');
    expect(byEmail.map((p) => p.id)).toEqual(['p2']);

    await bulkPut('lendr_expenses', [
      { id: 'e1', group_id: 'g1', user_id: 'u1' },
      { id: 'e2', group_id: 'g2', user_id: 'u1' },
      { id: 'e3', group_id: 'g1', user_id: 'u1' },
    ]);
    const byGroup = await getAllByIndex<{ id: string }>('lendr_expenses', 'group_id', 'g1');
    expect(byGroup.map((e) => e.id).sort()).toEqual(['e1', 'e3']);
  });
});

// ── 3. Debounce coalescing ──────────────────────────────────────────────────

describe('debounced writes', () => {
  test('N rapid puts produce exactly ONE adapter write of the store file', async () => {
    await put('transactions', txn('t1', 'u1', 1));
    await put('transactions', txn('t2', 'u1', 2));
    await put('transactions', txn('t3', 'u1', 3));
    await put('transactions', txn('t4', 'u1', 4));
    await put('transactions', txn('t5', 'u1', 5));

    // Nothing on disk yet — the debounce has not elapsed.
    expect(adapter.files.has('transactions.json')).toBe(false);

    await sleep(DEBOUNCE_MS + 200);

    expect(adapter.writeCounts.get('transactions.tmp')).toBe(1);
    expect(adapter.counts.rename).toBe(1);

    const onDisk = JSON.parse(adapter.files.get('transactions.json') ?? '[]') as Txn[];
    expect(onDisk).toHaveLength(5);
  });

  test('bulkPut of many records is a single write', async () => {
    await bulkPut(
      'transactions',
      Array.from({ length: 50 }, (_, i) => txn(`t${i}`, 'u1', i)),
    );
    await sleep(DEBOUNCE_MS + 200);

    expect(adapter.writeCounts.get('transactions.tmp')).toBe(1);
    expect(JSON.parse(adapter.files.get('transactions.json') ?? '[]')).toHaveLength(50);
  });
});

// ── 4. flush() ──────────────────────────────────────────────────────────────

describe('flush', () => {
  test('flush() writes immediately, without waiting for the debounce', async () => {
    await put('transactions', txn('t1', 'u1', 100));
    expect(adapter.files.has('transactions.json')).toBe(false);

    await flush();

    expect(adapter.files.has('transactions.json')).toBe(true);
    expect(JSON.parse(adapter.files.get('transactions.json') ?? '[]')).toHaveLength(1);
  });

  test('flush() cancels the pending debounce — no duplicate write follows', async () => {
    await put('transactions', txn('t1', 'u1', 100));
    await flush();
    const writesAfterFlush = adapter.writeCounts.get('transactions.tmp');

    await sleep(DEBOUNCE_MS + 200);
    expect(adapter.writeCounts.get('transactions.tmp')).toBe(writesAfterFlush as number);
  });

  test('flush() spans every dirty store', async () => {
    await put('transactions', txn('t1', 'u1', 1));
    await put('savings_goals', { id: 'g1', user_id: 'u1', goal_name: 'Bike' });
    await flush();

    expect(adapter.files.has('transactions.json')).toBe(true);
    expect(adapter.files.has('savings_goals.json')).toBe(true);
  });

  test('flushStore() targets a single store', async () => {
    await put('transactions', txn('t1', 'u1', 1));
    await put('savings_goals', { id: 'g1', user_id: 'u1', goal_name: 'Bike' });
    await flushStore('transactions');

    expect(adapter.files.has('transactions.json')).toBe(true);
    expect(adapter.files.has('savings_goals.json')).toBe(false);
  });
});

// ── 5. Crash safety ─────────────────────────────────────────────────────────

describe('crash safety', () => {
  test('a failure between the tmp-write and the rename leaves <store>.json intact', async () => {
    // Generation 1 lands cleanly.
    await put('transactions', txn('t1', 'u1', 100));
    await flush();
    const generation1 = adapter.files.get('transactions.json');
    expect(JSON.parse(generation1 ?? '[]')).toHaveLength(1);

    // Now the device dies exactly at the rename — the tmp file is written but
    // never swapped over the primary.
    adapter.setFault((op) => {
      if (op === 'rename') throw new Error('simulated process kill during rename');
    });

    await put('transactions', txn('t2', 'u1', 200));
    await flush(); // flush() logs, never rejects

    // The primary is byte-for-byte the previous generation.
    expect(adapter.files.get('transactions.json')).toBe(generation1 as string);
    const stillOnDisk = JSON.parse(adapter.files.get('transactions.json') ?? '[]') as Txn[];
    expect(stillOnDisk).toHaveLength(1);
    expect(stillOnDisk[0].id).toBe('t1');

    // And a fresh process reads it back fine.
    adapter.setFault(null);
    resetCache();
    const recovered = await getAll<Txn>('transactions');
    expect(recovered).toHaveLength(1);
    expect(recovered[0].id).toBe('t1');
  });

  test('the backup holds the previous generation after a successful write', async () => {
    await put('savings_goals', { id: 'g1', user_id: 'u1', goal_name: 'Bike' });
    await flush();
    await put('savings_goals', { id: 'g2', user_id: 'u1', goal_name: 'Laptop' });
    await flush();

    expect(JSON.parse(adapter.files.get('savings_goals.json') ?? '[]')).toHaveLength(2);
    expect(JSON.parse(adapter.files.get('savings_goals.bak') ?? '[]')).toHaveLength(1);
  });
});

// ── 6. Corrupt primary ──────────────────────────────────────────────────────

describe('corruption recovery', () => {
  test('a corrupt <store>.json falls back to a valid <store>.bak', async () => {
    const good = [txn('t1', 'u1', 100), txn('t2', 'u1', 200)];
    adapter.seed('transactions.json', '[{"id":"t1","amou');  // truncated mid-write
    adapter.seed('transactions.bak', JSON.stringify(good));

    resetCache();
    const recovered = await getAll<Txn>('transactions');
    expect(recovered).toHaveLength(2);
    expect(recovered.map((t) => t.id).sort()).toEqual(['t1', 't2']);
  });

  test('a missing <store>.json falls back to <store>.bak', async () => {
    adapter.seed('savings_goals.bak', JSON.stringify([{ id: 'g1', user_id: 'u1' }]));

    resetCache();
    expect(await getAll('savings_goals')).toHaveLength(1);
  });

  test('the recovered generation is rewritten back to the primary', async () => {
    adapter.seed('transactions.json', 'not json at all');
    adapter.seed('transactions.bak', JSON.stringify([txn('t1', 'u1', 100)]));

    resetCache();
    await getAll('transactions');
    await flush();

    expect(JSON.parse(adapter.files.get('transactions.json') ?? '[]')).toHaveLength(1);
  });

  test('both files unparseable → empty store, not a crash', async () => {
    adapter.seed('transactions.json', '###');
    adapter.seed('transactions.bak', '###');

    resetCache();
    expect(await getAll('transactions')).toEqual([]);
  });

  test('a JSON object (not an array) counts as corrupt', async () => {
    adapter.seed('transactions.json', '{"not":"an array"}');
    adapter.seed('transactions.bak', JSON.stringify([txn('t1', 'u1', 5)]));

    resetCache();
    expect(await getAll('transactions')).toHaveLength(1);
  });
});

// ── 7. Mutation isolation ───────────────────────────────────────────────────

describe('returned objects are copies', () => {
  test('mutating a getAll() result does not corrupt the cache', async () => {
    await put('transactions', txn('t1', 'u1', 100));

    const first = await getAll<Txn>('transactions');
    first[0].amount = -1;
    first.push(txn('injected', 'u1', 0));

    const second = await getAll<Txn>('transactions');
    expect(second).toHaveLength(1);
    expect(second[0].amount).toBe(100);
  });

  test('mutating a get() result does not corrupt the cache', async () => {
    await put('transactions', txn('t1', 'u1', 100));

    const one = await get<Txn>('transactions', 't1');
    expect(one).toBeDefined();
    (one as Txn).category = 'tampered';

    expect((await get<Txn>('transactions', 't1'))?.category).toBe('food');
  });

  test('mutating the object passed to put() does not corrupt the cache', async () => {
    const record = txn('t1', 'u1', 100);
    await put('transactions', record);
    record.amount = -999;

    expect((await get<Txn>('transactions', 't1'))?.amount).toBe(100);
  });

  test('nested structures are deep-copied', async () => {
    await put('udhar_entries', {
      id: 'u-1',
      user_id: 'u1',
      amount: 500,
      payments: [{ id: 'p1', amount: 100, date: '2026-01-01', note: '' }],
    });

    const fetched = await getAll<{ payments: { amount: number }[] }>('udhar_entries');
    fetched[0].payments[0].amount = 99999;
    fetched[0].payments.push({ amount: 1 } as { amount: number });

    const again = await getAll<{ payments: { amount: number }[] }>('udhar_entries');
    expect(again[0].payments).toHaveLength(1);
    expect(again[0].payments[0].amount).toBe(100);
  });

  test('mutating a getAllByIndex() result does not corrupt the cache', async () => {
    await bulkPut('transactions', [txn('t1', 'u1', 10), txn('t2', 'u1', 20)]);

    const mine = await getAllByIndex<Txn>('transactions', 'user_id', 'u1');
    mine.forEach((t) => {
      t.user_id = 'hacked';
    });

    expect(await getAllByIndex<Txn>('transactions', 'user_id', 'u1')).toHaveLength(2);
  });
});
