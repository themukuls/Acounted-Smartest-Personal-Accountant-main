/**
 * csvBackup.test.ts — the interchangeability gate.
 *
 * Run with:  npx --yes bun@latest test src/integrations
 *
 * `csvRestore.test.ts` proves we can READ the native app's backup. This proves
 * we can WRITE one it would recognise, which is the other half of the promise
 * real users were made: export from the old app, restore here, back up again,
 * and the file still opens in either app with nothing lost.
 *
 * The load-bearing assertion is on timestamps. The file carries them as
 * `yyyy-MM-dd HH:mm` with no offset marker and the value is UTC;
 * `safeDate()` parses that by pinning to UTC and `fmtTimestamp()` formats it
 * back with UTC getters. If either side ever reverts to device-local, every
 * timestamp in the re-export shifts by the machine's offset and rows near a
 * month boundary land in the wrong month — so the round trip below is checked
 * on the exact text, not on a parsed instant.
 */

import { test, expect, describe, beforeEach, afterEach } from 'bun:test';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { setAdapter } from '../../storage/adapter';
import { createMemoryAdapter } from '../../storage/memoryAdapter';
import { put, resetCache } from '../../storage/repository';

import {
  parseCSVBackup,
  parseCSVRecords,
  importCSVToIndexedDB,
} from './csvRestore';
import {
  buildCSVBackup,
  backupFileName,
  escapeField,
  fmtTimestamp,
  fmtDateOnly,
  BACKUP_SECTIONS,
} from './csvBackup';

/**
 * A real user's backup, produced by the old app. It is deliberately NOT copied
 * into the repo — it carries a live email, phone number and PIN hash. When it
 * is not on this machine the round-trip block skips and the bundled synthetic
 * fixture still exercises the same code path below.
 */
const REAL_BACKUP_PATH =
  process.env.ACOUNTED_REAL_BACKUP ??
  'C:/Users/mukul/Downloads/acounted_backup_2026-08-01_14-45-48.csv';

const REAL_CSV = existsSync(REAL_BACKUP_PATH)
  ? readFileSync(REAL_BACKUP_PATH, 'utf8')
  : null;

const FIXTURE = readFileSync(
  fileURLToPath(new URL('../../../test-fixtures/legacy-android-backup.csv', import.meta.url)),
  'utf8',
);

beforeEach(() => {
  setAdapter(createMemoryAdapter());
  resetCache();
});

afterEach(() => {
  resetCache();
  setAdapter(null);
});

// ─── Helpers ─────────────────────────────────────────────────────────────────

interface ParsedSection {
  /** The `columns,…` line re-encoded from the parsed record. */
  columns: string[];
  /** Data rows, tag stripped. */
  rows: string[][];
}

/** Split a backup into `section name → { columns, rows }`. */
function sectionsOf(csv: string): Map<string, ParsedSection> {
  const out = new Map<string, ParsedSection>();
  let current: ParsedSection | null = null;

  for (const cols of parseCSVRecords(csv)) {
    if (cols.length === 0 || !cols[0]) continue;
    const tag = cols[0].toLowerCase();

    if (tag === 'section') {
      current = { columns: [], rows: [] };
      out.set((cols[1] ?? '').trim().toLowerCase(), current);
    } else if (tag === 'columns') {
      if (current) current.columns = cols.slice(1).map(c => c.trim().toLowerCase());
    } else if (current) {
      current.rows.push(cols.slice(1));
    }
  }
  return out;
}

/** Index a section's rows by the value of one of its columns. */
function byColumn(section: ParsedSection, column: string): Map<string, string[]> {
  const i = section.columns.indexOf(column);
  const out = new Map<string, string[]>();
  for (const row of section.rows) out.set(row[i] ?? '', row);
  return out;
}

function fieldOf(section: ParsedSection, row: string[], column: string): string {
  return row[section.columns.indexOf(column)] ?? '';
}

/**
 * Restore `csv` into a fresh in-memory store, then export it again.
 *
 * `importCSVToIndexedDB` deliberately does not write `profiles` (a restore must
 * not overwrite the signed-in identity), so the profile row is put back by hand
 * — otherwise the `profiles` section would come back empty for reasons that
 * have nothing to do with the writer.
 */
async function roundTrip(csv: string): Promise<{ userId: string; exported: string }> {
  const data = parseCSVBackup(csv);
  const userId = data.profileRows[0]?.id ?? 'local-user-1';

  await importCSVToIndexedDB(userId, data);

  const profile = data.profileRows[0];
  if (profile) await put('profiles', { ...profile });

  return { userId, exported: await buildCSVBackup(userId) };
}

// ─── 1. SEV-0: the real file survives a full round trip ──────────────────────

const realTest = REAL_CSV ? test : test.skip;

if (!REAL_CSV) {
  console.warn(
    `[csvBackup.test] ${REAL_BACKUP_PATH} not found — the real-backup round trip ` +
      `is skipped on this machine. Set ACOUNTED_REAL_BACKUP to point at one.`,
  );
}

describe('a real native backup re-exports as an equivalent file', () => {
  realTest('every section in the file comes back with the same columns and row count', async () => {
    const source = sectionsOf(REAL_CSV!);
    const { exported } = await roundTrip(REAL_CSV!);
    const result = sectionsOf(exported);

    expect(source.size).toBeGreaterThan(0);

    for (const [name, original] of source) {
      const written = result.get(name);
      expect(written, `section "${name}" is missing from the re-export`).toBeDefined();
      // Column order is the contract with the Kotlin reader — exact, not a set.
      expect(written!.columns, `columns of "${name}"`).toEqual(original.columns);
      expect(written!.rows.length, `row count of "${name}"`).toBe(original.rows.length);
    }
  });

  realTest('sections the file did not carry are emitted empty, never invented', async () => {
    const source = sectionsOf(REAL_CSV!);
    const { exported } = await roundTrip(REAL_CSV!);
    const result = sectionsOf(exported);

    for (const [name, written] of result) {
      if (source.has(name)) continue;
      expect(written.rows.length, `"${name}" was not in the source but has rows`).toBe(0);
    }
  });

  realTest('every transaction keeps its id, amount, type and timestamps verbatim', async () => {
    const source = sectionsOf(REAL_CSV!);
    const { exported } = await roundTrip(REAL_CSV!);
    const result = sectionsOf(exported);

    const before = source.get('transactions')!;
    const after = result.get('transactions')!;

    expect(before.rows.length).toBeGreaterThan(100);

    const beforeById = byColumn(before, 'id');
    const afterById = byColumn(after, 'id');

    expect([...afterById.keys()].sort()).toEqual([...beforeById.keys()].sort());

    for (const [id, originalRow] of beforeById) {
      const writtenRow = afterById.get(id)!;
      for (const column of [
        'amount',
        'type',
        // The three timestamps. Compared as TEXT: this is what proves the
        // UTC round trip, because a local-time writer would shift them all.
        'created_at',
        'updated_at',
        'transaction_date',
      ]) {
        expect(
          fieldOf(after, writtenRow, column),
          `transactions.${column} for ${id}`,
        ).toBe(fieldOf(before, originalRow, column));
      }
    }
  });

  realTest('re-exporting twice is byte-identical', async () => {
    const { userId, exported } = await roundTrip(REAL_CSV!);
    expect(await buildCSVBackup(userId)).toBe(exported);
  });
});

// ─── 2. The envelope ─────────────────────────────────────────────────────────

describe('file envelope', () => {
  test('every section is emitted, even with no data at all', async () => {
    const exported = await buildCSVBackup('nobody');
    const result = sectionsOf(exported);

    // `profiles` is the one section that may be absent — the native writer
    // guards it with `profileDao.getById(userId)?.let { … }`.
    for (const section of BACKUP_SECTIONS) {
      if (section.name === 'profiles') continue;
      expect(result.get(section.name)?.columns, `section "${section.name}"`).toEqual(section.columns);
    }
    expect(result.has('profiles')).toBe(false);
  });

  test('LF endings, no BOM, no preamble, blank line after each section', async () => {
    const exported = await buildCSVBackup('nobody');

    expect(exported.startsWith('\uFEFF')).toBe(false);
    expect(exported.includes('\r')).toBe(false);
    expect(exported.startsWith('section,transactions\n')).toBe(true);
    expect(exported.endsWith('\n\n')).toBe(true);
  });

  test('data rows are tagged with the section name uppercased', async () => {
    const { exported } = await roundTrip(FIXTURE);
    for (const line of exported.split('\n')) {
      if (line === '' || line.startsWith('section,') || line.startsWith('columns,')) continue;
      expect(line.split(',')[0]).toMatch(/^[A-Z_]+$/);
    }
  });
});

// ─── 3. Value encoding ───────────────────────────────────────────────────────

describe('value encoding matches Csv.kt', () => {
  test('a field is quoted only when it contains a comma, quote or newline', () => {
    expect(escapeField('plain')).toBe('plain');
    expect(escapeField('Big Bazaar, Andheri West')).toBe('"Big Bazaar, Andheri West"');
    expect(escapeField('Dinner at "The Bombay Canteen"')).toBe('"Dinner at ""The Bombay Canteen"""');
    expect(escapeField('two\nlines')).toBe('"two\nlines"');
    expect(escapeField('')).toBe('');
  });

  test('integral numbers lose the decimal, non-integral keep it', async () => {
    const { exported } = await roundTrip(FIXTURE);
    const transactions = sectionsOf(exported).get('transactions')!;
    const amounts = transactions.rows.map(r => fieldOf(transactions, r, 'amount'));

    expect(amounts).toContain('85000');
    expect(amounts).toContain('2450.5');
    expect(amounts.some(a => a.includes(','))).toBe(false);
  });

  test('timestamps are formatted in UTC, to the minute, with no offset marker', () => {
    expect(fmtTimestamp('2025-11-30T20:05:00.000Z')).toBe('2025-11-30 20:05');
    // Seconds are truncated, never rounded.
    expect(fmtTimestamp('2025-11-30T20:05:59.999Z')).toBe('2025-11-30 20:05');
    // An offset-less input is already UTC — reading it must not shift it.
    expect(fmtTimestamp('2025-11-30 20:05')).toBe('2025-11-30 20:05');
    // An explicit offset is converted, not ignored.
    expect(fmtTimestamp('2025-12-01T01:35:00+05:30')).toBe('2025-11-30 20:05');
    expect(fmtTimestamp('')).toBe('');
    expect(fmtTimestamp(null)).toBe('');
  });

  test('date-only columns render as yyyy-MM-dd, not as a midnight timestamp', () => {
    expect(fmtDateOnly('2025-05-21')).toBe('2025-05-21');
    expect(fmtDateOnly('2025-05-21T00:00:00.000Z')).toBe('2025-05-21');
    expect(fmtDateOnly('')).toBe('');
  });
});

// ─── 4. Filename ─────────────────────────────────────────────────────────────

describe('filename matches the native app', () => {
  test('acounted_backup_yyyy-MM-dd_HH-mm-ss.csv', () => {
    expect(backupFileName()).toMatch(/^acounted_backup_\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}\.csv$/);
  });

  test('the stamp is local wall-clock, matching LocalDateTime.now()', () => {
    // 2026-08-01 14:45:48 in whatever zone this machine is in.
    const local = new Date(2026, 7, 1, 14, 45, 48);
    expect(backupFileName(local)).toBe('acounted_backup_2026-08-01_14-45-48.csv');
  });
});
