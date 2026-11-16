/**
 * csvRestore.test.ts — the migration gate.
 *
 * Run with:  npx --yes bun@latest test src/integrations
 *
 * These assertions exist because the reader silently destroyed real users'
 * financial history: the Kotlin writer emits
 *   id,user_id,created_at,updated_at,type,amount,category,account,description,transaction_date
 * while the old reader indexed positionally as if it were
 *   id,user_id,transaction_date,type,category,account,description,amount
 * so EVERY restored transaction came back with amount 0 and a timestamp where
 * its type should be. The amount/type assertion below is the canary — if it
 * ever fails again, the reader has drifted from the writer.
 *
 * Fixture + column-by-column contract: src/test-fixtures/README.md
 */

import { test, expect, describe, beforeEach, afterEach } from 'bun:test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { setAdapter } from '../../storage/adapter';
import { createMemoryAdapter } from '../../storage/memoryAdapter';
import { getAll, resetCache } from '../../storage/repository';

import {
  parseCSVBackup,
  parseCSVBackupFile,
  parseCSVRecords,
  validateCSVOwnership,
  importCSVToIndexedDB,
} from './csvRestore';

const FIXTURE = readFileSync(
  fileURLToPath(new URL('../../../test-fixtures/legacy-android-backup.csv', import.meta.url)),
  'utf8',
);

const USER_ID = 'local-user-1';

beforeEach(() => {
  setAdapter(createMemoryAdapter());
  resetCache();
});

afterEach(() => {
  resetCache();
  setAdapter(null);
});

// ── 1. SEV-0: transactions ───────────────────────────────────────────────────

describe('transactions — the column-order regression', () => {
  test('all six amounts and types survive the round trip', () => {
    const data = parseCSVBackup(FIXTURE);

    expect(data.transactionRows.map(t => t.amount)).toEqual([
      2450.5, 899, 85000, 1200, 15000, 349,
    ]);
    expect(data.transactionRows.map(t => t.type)).toEqual([
      'expense', 'expense', 'income', 'expense', 'expense', 'expense',
    ]);
  });

  test('the remaining columns are not shifted either', () => {
    const [first] = parseCSVBackup(FIXTURE).transactionRows;

    expect(first.category).toBe('Groceries');
    expect(first.account).toBe('upi');
    // Quoted field with an embedded comma.
    expect(first.description).toBe('Big Bazaar, Andheri West');
    expect(first.transaction_date.slice(0, 10)).toBe('2026-07-05');
  });

  test('an empty description stays null rather than swallowing the next column', () => {
    const rows = parseCSVBackup(FIXTURE).transactionRows;
    const cash = rows.find(t => t.account === 'cash')!;
    expect(cash.description).toBeNull();
    expect(cash.amount).toBe(1200);
  });

  test('a doubled quote inside a description is unescaped', () => {
    const rows = parseCSVBackup(FIXTURE).transactionRows;
    expect(rows[1].description).toBe('Dinner at "The Bombay Canteen"');
  });
});

// ── 2. SEV-1: income_details ─────────────────────────────────────────────────

describe('timestamps are UTC, not device-local', () => {
  // Confirmed against a real user backup: an entry the user made on
  // 1 Dec 2025 at 01:35 IST is written to the CSV as "2025-11-30 20:05".
  // The value is therefore UTC. Reading it without an explicit zone makes
  // JavaScript treat it as device-local, which on an IST phone drags every
  // timestamp back 5h30m and — worse — moves anything near a month boundary
  // into the wrong month (this is what put a 31 Mar annual bonus in April).
  //
  // These assertions compare against a fixed UTC instant, so they hold
  // regardless of the timezone the test machine happens to be in.

  test('a wall-clock timestamp is pinned to UTC', () => {
    const data = parseCSVBackup(FIXTURE);
    for (const t of data.transactionRows) {
      // Every stored value must be the CSV text with a 'Z' — never shifted.
      expect(t.transaction_date.endsWith('Z')).toBe(true);
      expect(t.created_at.endsWith('Z')).toBe(true);
    }
  });

  test('the reader does not shift by the machine offset', () => {
    const csv = [
      'section,transactions',
      'columns,id,user_id,created_at,updated_at,type,amount,category,account,description,transaction_date',
      'TRANSACTIONS,tz-1,u1,2025-11-30 20:05,2025-11-30 20:05,expense,10000,household,upi,Puraini Home Renovation,2025-11-30 20:05',
    ].join('\n');

    const row = parseCSVBackup(csv).transactionRows[0];
    // 20:05 UTC — the same instant the user knows as 1 Dec 01:35 IST.
    expect(row.transaction_date).toBe('2025-11-30T20:05:00.000Z');
    expect(new Date(row.transaction_date).getTime()).toBe(Date.UTC(2025, 10, 30, 20, 5));
  });

  test('date-only fields are not corrupted by the UTC pinning', () => {
    // Appending 'Z' to a bare `yyyy-MM-dd` yields an invalid date, which would
    // silently reset the field to "now". Recall purchase dates are date-only.
    const csv = [
      'section,recall_products',
      'columns,id,user_id,name,category,brand,model_number,serial_number,purchase_date',
      'RECALL_PRODUCTS,r1,u1,Fridge,appliance,Samsung,M1,S1,2025-05-21',
    ].join('\n');

    const row = parseCSVBackup(csv).recallRows[0];
    expect(row.purchase_date).toBe('2025-05-21T00:00:00.000Z');
  });
});

describe('income_details — divergence past column 7', () => {
  test('salary figures, form_data and the identity columns all survive', () => {
    const [income] = parseCSVBackup(FIXTURE).incomRows;

    expect(income.income_type).toBe('salaried');
    expect(income.monthly_salary).toBe(85000);
    expect(income.basic_salary).toBe(42500);
    expect(income.other_allowances).toBe(12750);
    expect(income.monthly_other_income).toBe(5000);

    // form_data used to be destroyed entirely — cols[10] held created_at.
    expect(typeof income.form_data).toBe('object');
    expect(income.form_data).toEqual({
      regime: 'new',
      employerName: 'Infosys Ltd',
      hraClaimed: true,
      cityTier: 'metro',
    });

    // These four used to be hard-coded to null in importCSVToIndexedDB.
    expect(income.full_name).toBe('Rahul Sharma');
    expect(income.pan).toBe('ABCDE1234F');
    expect(income.hra).toBe(17000);
    expect(income.standard_deduction).toBe(75000);
  });

  test('created_at is a real timestamp, not the year 5000', () => {
    const [income] = parseCSVBackup(FIXTURE).incomRows;
    // cols[7] is monthly_other_income (5000); new Date("5000") parses as a year.
    expect(new Date(income.created_at).getUTCFullYear()).toBe(2025);
  });
});

// ── 3. Udhar ─────────────────────────────────────────────────────────────────

describe('udhar_entries', () => {
  test("the 'given' entry keeps both payments and its amount_paid", () => {
    const rows = parseCSVBackup(FIXTURE).udharRows;
    const given = rows.find(u => u.type === 'given')!;

    expect(given.person_name).toBe('Amit Verma');
    expect(given.amount).toBe(12000);
    expect(given.payments).toHaveLength(2);
    expect(given.payments[0].amount).toBe(4000);
    expect(given.payments[1].amount).toBe(2000);
    expect(given.amount_paid).toBe(6000);
  });

  test("the 'taken' entry has a null person_name and an empty payments array", () => {
    const taken = parseCSVBackup(FIXTURE).udharRows.find(u => u.type === 'taken')!;
    expect(taken.person_name).toBeNull();
    expect(taken.lender_name).toBe('Priya Nair');
    expect(taken.payments).toEqual([]);
    expect(taken.amount_paid).toBe(0);
  });
});

// ── 4. Recall — quoting edge cases ───────────────────────────────────────────

describe('recall_products quoting', () => {
  test('an embedded double quote and an embedded comma both survive', () => {
    const [product] = parseCSVBackup(FIXTURE).recallRows;
    expect(product.name).toBe('Samsung 55" QLED TV');
    expect(product.purchased_from).toBe('Croma, Phoenix Marketcity');
    expect(product.purchase_price).toBe(74990);
    expect(product.emi_enabled).toBe(true);
    expect(product.emi_tenure_months).toBe(12);
    expect(product.last_service_date).toBeNull();
  });
});

// ── 5. Previously-dropped sections ───────────────────────────────────────────

describe('sections the old reader dropped on the floor', () => {
  test('savings_goals is imported, with empty spend amounts kept as null', () => {
    const [goal] = parseCSVBackup(FIXTURE).savingsGoalRows;
    expect(goal.goal_name).toBe('Goa trip with family');
    expect(goal.goal_amount).toBe(60000);
    expect(goal.target_months).toBe(12);
    expect(goal.weekly_save_amount).toBe(1153.85);
    expect(goal.monthly_spend_amount).toBeNull();
    expect(goal.weekly_spend_amount).toBeNull();
  });

  test('income_sources is imported', () => {
    const [source] = parseCSVBackup(FIXTURE).incomeSourceRows;
    expect(source.source_name).toBe('Freelance design work');
    expect(source.amount).toBe(5000);
    expect(source.frequency).toBe('monthly');
  });

  test('the header-only tax/lendr sections parse to zero rows, not errors', () => {
    const data = parseCSVBackup(FIXTURE);
    expect(data.variableBudgetEntryRows).toEqual([]);
    expect(data.lendrGroupRows).toEqual([]);
    expect(data.tdsEntryRows).toEqual([]);
    expect(data.itrChecklistRows).toEqual([]);
    expect(data.skipped).toEqual({});
  });
});

// ── 6. Unknown sections are counted, never lost ──────────────────────────────

describe('unknown sections', () => {
  test('a section this reader has never heard of lands in skipped', () => {
    const withFuture = FIXTURE +
      'section,crypto_holdings\n' +
      'columns,id,user_id,symbol,units\n' +
      'CRYPTO_HOLDINGS,c1,3f2a91c4-7b6d-4e58-9a01-2c5d8e7f4b10,BTC,0.25\n' +
      'CRYPTO_HOLDINGS,c2,3f2a91c4-7b6d-4e58-9a01-2c5d8e7f4b10,ETH,3\n\n';

    const data = parseCSVBackup(withFuture);
    expect(data.skipped).toEqual({ crypto_holdings: 2 });
    // …and the sections it does know are untouched.
    expect(data.transactionRows).toHaveLength(6);
  });
});

describe('payment merchant memory', () => {
  test('restores remembered category defaults from a backup section', () => {
    const csv = FIXTURE +
      'section,payment_merchant_mappings\n' +
      'columns,id,user_id,merchant_key,display_name,source_package,category,account,note,confirmations,last_amount,created_at,updated_at\n' +
      'PAYMENT_MERCHANT_MAPPINGS,u1::vpa::78***@ybl,u1,vpa::78***@ybl,Office Canteen,net.one97.paytm,food,upi,Lunch,2,141,2026-11-15 10:00,2026-11-16 10:00\n\n';

    const [mapping] = parseCSVBackup(csv).paymentMerchantMappingRows;
    expect(mapping.merchant_key).toBe('vpa::78***@ybl');
    expect(mapping.category).toBe('food');
    expect(mapping.account).toBe('upi');
    expect(mapping.confirmations).toBe(2);
  });
});

// ── 7. Record-aware parsing ──────────────────────────────────────────────────

describe('record-aware parser', () => {
  test('accepts a valid backup regardless of BOM or filename metadata', () => {
    const data = parseCSVBackupFile(`\uFEFF${FIXTURE}`);
    expect(data.profileRows).toHaveLength(1);
    expect(data.transactionRows).toHaveLength(6);
  });

  test('rejects a generic CSV after selection', () => {
    expect(() => parseCSVBackupFile('name,amount\nCoffee,100\n')).toThrow(
      'not in Acounted backup format',
    );
  });

  test('rejects malformed quoted CSV', () => {
    expect(() => parseCSVBackupFile('section,profiles\n"unfinished')).toThrow(
      'unterminated quoted field',
    );
  });

  test('a newline inside a quoted field does not split the record', () => {
    const csv =
      'section,transactions\n' +
      'columns,id,user_id,created_at,updated_at,type,amount,category,account,description,transaction_date\n' +
      'TRANSACTIONS,x1,u1,2026-07-05 19:24,2026-07-05 19:24,expense,500,Groceries,upi,' +
      '"line one\nline two",2026-07-05 19:22\n';

    const records = parseCSVRecords(csv);
    expect(records).toHaveLength(3);
    expect(records[2]).toHaveLength(11);

    const [txn] = parseCSVBackup(csv).transactionRows;
    expect(txn.amount).toBe(500);
    expect(txn.description).toContain('line two');
  });

  test('CRLF endings are normalised', () => {
    const data = parseCSVBackup(FIXTURE.replace(/\n/g, '\r\n'));
    expect(data.transactionRows.map(t => t.amount)).toEqual([
      2450.5, 899, 85000, 1200, 15000, 349,
    ]);
  });

  test('a file with no columns row falls back to the legacy positional layout', () => {
    // The pre-header web-era layout: id,user_id,transaction_date,type,category,
    // account,description,amount,created_at,updated_at
    const legacy =
      'TRANSACTIONS,x1,u1,2026-07-05 19:22,expense,Groceries,upi,Legacy row,777,' +
      '2026-07-05 19:24,2026-07-05 19:24\n';
    const [txn] = parseCSVBackup(legacy).transactionRows;
    expect(txn.amount).toBe(777);
    expect(txn.type).toBe('expense');
    expect(txn.category).toBe('Groceries');
  });
});

// ── 8. Ownership check (the gate MobileHeader now uses) ──────────────────────

describe('validateCSVOwnership', () => {
  test('matching email + phone assigns csvData.profile', async () => {
    const data = parseCSVBackup(FIXTURE);
    expect(data.profile).toBeNull();

    const { valid } = await validateCSVOwnership(data, 'Rahul.Sharma@gmail.com', '+91 98765 43210');
    expect(valid).toBe(true);
    expect(data.profile?.email).toBe('rahul.sharma@gmail.com');
  });

  test('a wrong email is rejected', async () => {
    const data = parseCSVBackup(FIXTURE);
    const { valid, error } = await validateCSVOwnership(data, 'someone.else@gmail.com', '9876543210');
    expect(valid).toBe(false);
    expect(error).toContain('was not found');
  });
});

// ── 9. End-to-end: parse → import → read back out of storage ─────────────────

describe('importCSVToIndexedDB', () => {
  test('a fixture transaction lands in storage with its real amount', async () => {
    const data = parseCSVBackup(FIXTURE);
    const result = await importCSVToIndexedDB(USER_ID, data);

    expect(result.errors).toEqual([]);

    const stored = await getAll<{ amount: number; type: string; user_id: string; category: string }>('transactions');
    expect(stored).toHaveLength(6);
    expect(stored.every(t => t.user_id === USER_ID)).toBe(true);

    const groceries = stored.find(t => t.category === 'Groceries')!;
    expect(groceries.amount).toBe(2450.5);
    expect(groceries.type).toBe('expense');

    const salary = stored.find(t => t.category === 'Salary')!;
    expect(salary.amount).toBe(85000);
    expect(salary.type).toBe('income');
  });

  test('income_details keeps pan/full_name/hra instead of hard-coded nulls', async () => {
    await importCSVToIndexedDB(USER_ID, parseCSVBackup(FIXTURE));

    const [income] = await getAll<Record<string, unknown>>('income_details');
    expect(income.pan).toBe('ABCDE1234F');
    expect(income.full_name).toBe('Rahul Sharma');
    expect(income.hra).toBe(17000);
    expect(income.standard_deduction).toBe(75000);
    expect(income.form_data).toEqual({
      regime: 'new',
      employerName: 'Infosys Ltd',
      hraClaimed: true,
      cityTier: 'metro',
    });
  });

  test('previously-dropped sections actually reach storage', async () => {
    await importCSVToIndexedDB(USER_ID, parseCSVBackup(FIXTURE));

    expect(await getAll('savings_goals')).toHaveLength(1);
    expect(await getAll('income_sources')).toHaveLength(1);
    expect(await getAll('udhar_entries')).toHaveLength(2);
    expect(await getAll('recall_products')).toHaveLength(1);
    expect(await getAll('user_notifications')).toHaveLength(1);
    expect(await getAll('monthly_budgets')).toHaveLength(1);
  });

  test('nullable numerics stay null instead of collapsing to 0', async () => {
    await importCSVToIndexedDB(USER_ID, parseCSVBackup(FIXTURE));

    const [goal] = await getAll<Record<string, unknown>>('savings_goals');
    expect(goal.monthly_spend_amount).toBeNull();
    expect(goal.weekly_spend_amount).toBeNull();

    const [budget] = await getAll<Record<string, unknown>>('monthly_budgets');
    expect(budget.total_budget).toBe(40000);
    // budget_start_date / budget_end_date go through safeDate now.
    expect(String(budget.budget_start_date)).toContain('T');
  });

  test('re-importing replaces this user\'s rows rather than duplicating them', async () => {
    await importCSVToIndexedDB(USER_ID, parseCSVBackup(FIXTURE));
    await importCSVToIndexedDB(USER_ID, parseCSVBackup(FIXTURE));

    expect(await getAll('transactions')).toHaveLength(6);
    expect(await getAll('savings_goals')).toHaveLength(1);
  });

  test('the skipped tally is passed through to the caller', async () => {
    const withFuture = FIXTURE + 'section,crypto_holdings\ncolumns,id,symbol\nCRYPTO_HOLDINGS,c1,BTC\n\n';
    const result = await importCSVToIndexedDB(USER_ID, parseCSVBackup(withFuture));
    expect(result.skipped).toEqual({ crypto_holdings: 1 });
    expect(result.imported).toBeGreaterThan(0);
  });
});
