/**
 * csvBackup.ts — WRITER for the multi-section CSV backup.
 *
 * This is the exact inverse of `csvRestore.ts`. The old native Android app
 * (`acounted-android`) wrote this format and real users move files in both
 * directions, so a file this module produces must be readable by
 * `BackupRepository.importCsv` in Kotlin, and a file the Kotlin app produces
 * must survive `parseCSVBackup` → `importCSVToIndexedDB` → `buildCSVBackup`
 * unchanged. `csvBackup.test.ts` proves that against a real user's file.
 *
 * Source of truth for the envelope and the per-section column order:
 *   acounted-android/app/src/main/java/com/acounted/app/data/backup/
 *     ├── BackupRepository.kt  — exportCsv() / appendSection()
 *     ├── BackupCodecs.kt      — object BackupSections: COLUMNS + encode()
 *     └── Csv.kt               — escape(), numToStr(), boolToStr(), isoToBackup()
 *
 * ── Envelope (BackupRepository.appendSection) ────────────────────────────────
 *
 *   section,<lowercase_name>
 *   columns,<col0>,<col1>,…
 *   <UPPERCASE_NAME>,<val0>,<val1>,…
 *   <blank line>
 *
 * LF endings, no BOM, no header comment. All 22 sections are emitted even when
 * empty; only `profiles` may be absent (it is when the user has no profile row).
 *
 * ── Timestamps are UTC ───────────────────────────────────────────────────────
 *
 * Timestamp columns are written `yyyy-MM-dd HH:mm` with no seconds and no
 * offset marker, and the value is UTC. `safeDate()` in csvRestore.ts parses
 * them by appending `Z`; `fmtTimestamp()` below is its exact inverse, so a
 * round trip is lossless on any device in any timezone. Formatting with local
 * getters instead would drag every timestamp by the device offset — on an IST
 * phone that moved a 1 Dec 01:35 entry to 30 Nov, i.e. into the wrong month.
 *
 * ── Two kinds of date column ─────────────────────────────────────────────────
 *
 * The writer mirrors the reader field-for-field, because the reader is what
 * decides what is in the store:
 *
 *   • reader used `safeDate` / `safeDateOrNull` → the store holds an ISO
 *     instant → written through `fmtTimestamp` (`created_at`, `updated_at`,
 *     `transaction_date`, `seen_at`, `budget_start_date`, `budget_end_date`,
 *     and `udhar_entries.due_date`, which the real file carries as a full
 *     `yyyy-MM-dd HH:mm` value, e.g. `2026-08-15 13:00`).
 *   • reader used `safeStr` / `safeNullStr` → the store holds the file's text
 *     verbatim → written back verbatim (`warranty_expiry`,
 *     `last_service_date`, `emi_start_date`, `insurance_renewal_date`,
 *     `lendr_expenses.date`, `advance_tax_payments.due_date` / `paid_date`,
 *     `capital_gains_entries.purchase_date` / `sale_date`, …).
 *   • `recall_products.purchase_date` is the one hybrid: the file carries a
 *     plain `yyyy-MM-dd` (the Kotlin entity field is a raw String) but the
 *     reader runs it through `safeDate`, so the store holds UTC midnight and
 *     the writer has to render the UTC date part back out — `fmtDateOnly`.
 *
 * ── Row order ────────────────────────────────────────────────────────────────
 *
 * Rows are sorted by the store's primary key, which is what the Kotlin DAO
 * queries produce and what a real backup file shows. It also makes the output
 * deterministic, so two exports of unchanged data are byte-identical.
 */

import { getAllByIndex, get } from '@/integrations/storage/repository';
import { keyFieldFor, type StoreName } from '@/integrations/storage/stores';

/** Any record coming back out of the repository. */
type Row = Record<string, unknown>;

// ─── Low-level CSV primitives (Csv.kt) ───────────────────────────────────────

/**
 * Quote only when the field contains `,` `"` `\n` or `\r`; inner quotes doubled.
 * Byte-for-byte `Csv.escape`.
 */
export function escapeField(field: string): string {
  return /[",\n\r]/.test(field) ? `"${field.replace(/"/g, '""')}"` : field;
}

/** `Csv.encodeRow` — escape each field and join with commas. */
export function encodeRow(values: string[]): string {
  return values.map(escapeField).join(',');
}

// ─── Value encoders ──────────────────────────────────────────────────────────

/**
 * `Csv.numToStr`: integral values lose the decimal point (`2500`), non-integral
 * keep it with trailing zeros stripped (`2450.5`). No separators, no exponent.
 */
function fmtNumber(n: number): string {
  if (!Number.isFinite(n)) return '0';
  const s = String(n);
  if (!s.includes('e') && !s.includes('E')) return s;
  // Only reachable for absurd magnitudes; render plainly rather than in
  // exponent form, which neither parser understands.
  return n.toFixed(20).replace(/0+$/, '').replace(/\.$/, '');
}

/** Non-null number column. Missing/unparseable → `0`, matching `Csv.toNum`. */
function num(v: unknown): string {
  if (typeof v === 'number') return fmtNumber(v);
  if (typeof v === 'string' && v.trim() !== '') {
    const parsed = Number(v);
    return Number.isNaN(parsed) ? '0' : fmtNumber(parsed);
  }
  return '0';
}

/** Nullable number column (`numN` in BackupCodecs): null/blank → empty field. */
function numN(v: unknown): string {
  if (v === null || v === undefined || v === '') return '';
  if (typeof v === 'number') return Number.isFinite(v) ? fmtNumber(v) : '';
  const parsed = Number(v);
  return Number.isNaN(parsed) ? '' : fmtNumber(parsed);
}

/** Integer column (`Int.toString()`). */
function int(v: unknown): string {
  const n = typeof v === 'number' ? v : parseInt(String(v ?? ''), 10);
  return Number.isFinite(n) ? String(Math.trunc(n)) : '0';
}

/** `Csv.boolToStr` — literally `true` / `false`, never `1`/`0`. */
function bool(v: unknown): string {
  return v === true || v === 'true' || v === 1 || v === '1' || v === 'yes'
    ? 'true'
    : 'false';
}

/**
 * Plain string column. `null`/`undefined` become a zero-length field (never the
 * text "null"). An object here means the store holds structured data for a
 * column the file models as text — serialise it rather than emit `[object
 * Object]`.
 */
function str(v: unknown): string {
  if (v === null || v === undefined) return '';
  if (typeof v === 'string') return v;
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
}

/**
 * Array column serialised as JSON (`payments`, `service_history`,
 * `additional_warranties`, `members`, `splits`, `checked_event_ids`). Absent →
 * `[]`, exactly like Kotlin's `encodeJson(emptyList())`.
 */
function json(v: unknown): string {
  if (v === null || v === undefined) return '[]';
  if (typeof v === 'string') return v.trim() === '' ? '[]' : v;
  return JSON.stringify(v);
}

/**
 * Opaque JSON-or-text column (`form_data`, `recommendations_json`). The reader
 * keeps whichever it found; give it back in the same shape.
 */
function raw(v: unknown): string {
  if (v === null || v === undefined) return '';
  if (typeof v === 'string') return v;
  return JSON.stringify(v);
}

// ─── Dates ───────────────────────────────────────────────────────────────────

const pad2 = (n: number): string => String(n).padStart(2, '0');

/**
 * The exact parsing rule `safeDate()` in csvRestore.ts uses: an offset-less
 * date-time is UTC, a date-only value is UTC midnight. Keeping the two in step
 * is what makes the round trip lossless.
 */
function toInstant(rawValue: string): Date | null {
  const withT = rawValue.replace(' ', 'T');
  const hasTime = /T\d{2}:\d{2}/.test(withT);
  const hasZone = /(?:[Zz]|[+-]\d{2}:?\d{2})$/.test(withT);
  const normalised = hasTime && !hasZone ? `${withT}Z` : withT;

  const parsed = new Date(normalised);
  if (!Number.isNaN(parsed.getTime())) return parsed;

  const m = rawValue.match(/^(\d{2})-(\d{2})-(\d{4})(?:\s+(\d{2}):(\d{2}))?/);
  if (m) {
    const [, d, mo, y, h = '00', mi = '00'] = m;
    const fallback = new Date(`${y}-${mo}-${d}T${h}:${mi}:00Z`);
    if (!Number.isNaN(fallback.getTime())) return fallback;
  }
  return null;
}

/**
 * Timestamp column → `yyyy-MM-dd HH:mm` in **UTC**. Blank stays blank; anything
 * unparseable passes through untouched (`Csv.isoToBackup` does the same rather
 * than destroy a value it does not understand).
 */
export function fmtTimestamp(v: unknown): string {
  const s = str(v).trim();
  if (s === '') return '';
  const d = toInstant(s);
  if (!d) return s;
  return (
    `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}` +
    ` ${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())}`
  );
}

/**
 * Date-only column → `yyyy-MM-dd` in UTC. An already-plain date is returned
 * untouched so nothing is re-derived; an ISO instant contributes its UTC date.
 */
export function fmtDateOnly(v: unknown): string {
  const s = str(v).trim();
  if (s === '') return '';
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const d = toInstant(s);
  if (!d) return s;
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
}

// ─── Section definitions ─────────────────────────────────────────────────────

interface Section {
  /** `section,<name>` and, uppercased, the data-row tag. */
  name: string;
  /** Where the rows come from. `null` for `profiles`, fetched by key. */
  store: StoreName;
  /** The `columns,` row, in the file's exact order. */
  columns: string[];
  /** One record → one data row, aligned to `columns`. */
  encode: (r: Row) => string[];
}

/**
 * The 22 sections, in `BackupRepository.exportCsv()` order.
 *
 * The column lists are the writer's half of the contract with
 * `csvRestore.ts` — every name here is a name the reader looks up with
 * `g('<name>', …)`. `csvBackup.test.ts` pins them against a real backup file so
 * the two halves cannot drift apart silently.
 */
export const BACKUP_SECTIONS: Section[] = [
  {
    name: 'profiles',
    store: 'profiles',
    columns: [
      'id', 'email', 'phone', 'pin_hash', 'display_name',
      'onboarding_completed', 'created_at', 'updated_at',
    ],
    encode: r => [
      str(r.id), str(r.email), str(r.phone), str(r.pin_hash), str(r.display_name),
      bool(r.onboarding_completed), fmtTimestamp(r.created_at), fmtTimestamp(r.updated_at),
    ],
  },
  {
    name: 'transactions',
    store: 'transactions',
    columns: [
      'id', 'user_id', 'created_at', 'updated_at', 'type',
      'amount', 'category', 'account', 'description', 'transaction_date',
      'capture_payment_id', 'capture_reference', 'capture_merchant', 'capture_source',
    ],
    encode: r => [
      str(r.id), str(r.user_id), fmtTimestamp(r.created_at), fmtTimestamp(r.updated_at), str(r.type),
      num(r.amount), str(r.category), str(r.account), str(r.description), fmtTimestamp(r.transaction_date),
      str(r.capture_payment_id), str(r.capture_reference), str(r.capture_merchant), str(r.capture_source),
    ],
  },
  {
    name: 'income_details',
    store: 'income_details',
    columns: [
      'id', 'user_id', 'income_type', 'monthly_salary', 'basic_salary',
      'other_allowances', 'monthly_other_income', 'form_data', 'full_name', 'pan',
      'hra', 'standard_deduction', 'created_at', 'updated_at',
    ],
    encode: r => [
      str(r.id), str(r.user_id), str(r.income_type), numN(r.monthly_salary), numN(r.basic_salary),
      numN(r.other_allowances), numN(r.monthly_other_income), raw(r.form_data), str(r.full_name), str(r.pan),
      numN(r.hra), numN(r.standard_deduction), fmtTimestamp(r.created_at), fmtTimestamp(r.updated_at),
    ],
  },
  {
    name: 'income_sources',
    store: 'income_sources',
    columns: ['id', 'user_id', 'source_name', 'amount', 'frequency', 'created_at', 'updated_at'],
    encode: r => [
      str(r.id), str(r.user_id), str(r.source_name), num(r.amount), str(r.frequency),
      fmtTimestamp(r.created_at), fmtTimestamp(r.updated_at),
    ],
  },
  {
    name: 'expense_categories',
    store: 'expense_categories',
    columns: [
      'id', 'user_id', 'category_name', 'category_type', 'frequency',
      'amount', 'created_at', 'updated_at',
    ],
    encode: r => [
      str(r.id), str(r.user_id), str(r.category_name), str(r.category_type), str(r.frequency),
      num(r.amount), fmtTimestamp(r.created_at), fmtTimestamp(r.updated_at),
    ],
  },
  {
    name: 'investment_types',
    store: 'investment_types',
    columns: [
      'id', 'user_id', 'investment_name', 'investment_type', 'amount',
      'risk_level', 'interest_rate', 'created_at', 'updated_at',
    ],
    encode: r => [
      str(r.id), str(r.user_id), str(r.investment_name), str(r.investment_type), num(r.amount),
      str(r.risk_level), numN(r.interest_rate), fmtTimestamp(r.created_at), fmtTimestamp(r.updated_at),
    ],
  },
  {
    name: 'monthly_budgets',
    store: 'monthly_budgets',
    columns: [
      'id', 'user_id', 'budget_month', 'budget_start_date', 'budget_end_date',
      'fixed_budget', 'variable_budget', 'total_budget', 'created_at', 'updated_at',
    ],
    encode: r => [
      str(r.id), str(r.user_id), str(r.budget_month),
      fmtTimestamp(r.budget_start_date), fmtTimestamp(r.budget_end_date),
      num(r.fixed_budget), num(r.variable_budget), numN(r.total_budget),
      fmtTimestamp(r.created_at), fmtTimestamp(r.updated_at),
    ],
  },
  {
    name: 'variable_budget_entries',
    store: 'variable_budget_entries',
    columns: [
      'id', 'user_id', 'created_at', 'updated_at', 'budget_month',
      'category_name', 'allocated_amount', 'notes',
    ],
    encode: r => [
      str(r.id), str(r.user_id), fmtTimestamp(r.created_at), fmtTimestamp(r.updated_at), str(r.budget_month),
      str(r.category_name), num(r.allocated_amount), str(r.notes),
    ],
  },
  {
    name: 'savings_goals',
    store: 'savings_goals',
    columns: [
      'id', 'user_id', 'goal_name', 'goal_amount', 'target_months', 'monthly_save_amount',
      'weekly_save_amount', 'monthly_spend_amount', 'weekly_spend_amount', 'created_at', 'updated_at',
    ],
    encode: r => [
      str(r.id), str(r.user_id), str(r.goal_name), num(r.goal_amount), int(r.target_months),
      numN(r.monthly_save_amount), numN(r.weekly_save_amount), numN(r.monthly_spend_amount),
      numN(r.weekly_spend_amount), fmtTimestamp(r.created_at), fmtTimestamp(r.updated_at),
    ],
  },
  {
    name: 'udhar_entries',
    store: 'udhar_entries',
    columns: [
      'id', 'user_id', 'created_at', 'updated_at', 'type', 'person_name', 'lender_name',
      'amount', 'due_date', 'is_settled', 'phone_number', 'description', 'payments', 'amount_paid',
    ],
    encode: r => [
      str(r.id), str(r.user_id), fmtTimestamp(r.created_at), fmtTimestamp(r.updated_at), str(r.type),
      str(r.person_name), str(r.lender_name), num(r.amount), fmtTimestamp(r.due_date), bool(r.is_settled),
      str(r.phone_number), str(r.description), json(r.payments), num(r.amount_paid),
    ],
  },
  {
    name: 'recall_products',
    store: 'recall_products',
    columns: [
      'id', 'user_id', 'name', 'category', 'brand', 'model_number', 'serial_number',
      'purchase_date', 'purchase_price', 'purchased_from', 'warranty_months', 'warranty_expiry',
      'extended_warranty', 'extended_warranty_provider', 'extended_warranty_expiry',
      'service_interval_months', 'last_service_date', 'next_service_date', 'service_centre_name',
      'service_centre_phone', 'service_history', 'service_notes', 'notes', 'warranty_note',
      'extended_warranty_note', 'additional_warranties', 'payment_mode', 'amount_paid_upfront',
      'emi_enabled', 'emi_amount', 'emi_tenure_months', 'emi_start_date', 'emi_interest_rate',
      'emi_bank_or_provider', 'emi_account_last4', 'down_payment', 'insurance_provider',
      'insurance_policy_number', 'insurance_renewal_date', 'insurance_premium', 'emi_budget_added',
      'created_at', 'updated_at', 'extended_warranty_months',
    ],
    encode: r => [
      str(r.id), str(r.user_id), str(r.name), str(r.category), str(r.brand), str(r.model_number),
      str(r.serial_number), fmtDateOnly(r.purchase_date), num(r.purchase_price), str(r.purchased_from),
      int(r.warranty_months), str(r.warranty_expiry), bool(r.extended_warranty),
      str(r.extended_warranty_provider), str(r.extended_warranty_expiry),
      int(r.service_interval_months), str(r.last_service_date), str(r.next_service_date),
      str(r.service_centre_name), str(r.service_centre_phone), json(r.service_history),
      str(r.service_notes), str(r.notes), str(r.warranty_note), str(r.extended_warranty_note),
      json(r.additional_warranties), str(r.payment_mode), num(r.amount_paid_upfront),
      bool(r.emi_enabled), num(r.emi_amount), int(r.emi_tenure_months), str(r.emi_start_date),
      num(r.emi_interest_rate), str(r.emi_bank_or_provider), str(r.emi_account_last4),
      num(r.down_payment), str(r.insurance_provider), str(r.insurance_policy_number),
      str(r.insurance_renewal_date), num(r.insurance_premium), bool(r.emi_budget_added),
      fmtTimestamp(r.created_at), fmtTimestamp(r.updated_at),
      // extended_warranty_months is a write-only pad: the native entity does not
      // model it and `csvRestore.ts` ignores it. Kept so the field count matches.
      str(r.extended_warranty_months),
    ],
  },
  {
    name: 'user_notifications',
    store: 'user_notifications',
    columns: ['user_id', 'notification_id', 'seen_at'],
    encode: r => [str(r.user_id), str(r.notification_id), fmtTimestamp(r.seen_at)],
  },
  {
    name: 'lendr_groups',
    store: 'lendr_groups',
    columns: ['id', 'user_id', 'name', 'emoji', 'members', 'created_at', 'updated_at'],
    encode: r => [
      str(r.id), str(r.user_id), str(r.name), str(r.emoji), json(r.members),
      fmtTimestamp(r.created_at), fmtTimestamp(r.updated_at),
    ],
  },
  {
    name: 'lendr_expenses',
    store: 'lendr_expenses',
    columns: [
      'id', 'group_id', 'user_id', 'description', 'total_amount', 'paid_by_member_id',
      'date', 'splits', 'created_at', 'updated_at',
    ],
    encode: r => [
      str(r.id), str(r.group_id), str(r.user_id), str(r.description), num(r.total_amount),
      str(r.paid_by_member_id), str(r.date), json(r.splits),
      fmtTimestamp(r.created_at), fmtTimestamp(r.updated_at),
    ],
  },
  {
    name: 'ai_tax_planner_input',
    store: 'ai_tax_planner_input',
    columns: [
      'id', 'user_id', 'age_category', 'resident_status', 'city_of_residence', 'active_income_streams',
      'employment_type', 'annual_gross_income', 'annual_rent_paid', 'business_turnover',
      'business_digital_percent', 'professional_receipts', 'profession_type', 'rental_gross_receipts',
      'rental_municipal_taxes', 'rental_home_loan_interest', 'equity_stcg', 'equity_ltcg', 'other_ltcg',
      'other_stcg', 'other_income', 'home_loan_principal', 'home_loan_interest', 'tax_saving_investments',
      'health_insurance_premiums', 'education_loan_interest', 'donations_80g', 'risk_appetite',
      'liquidity_needs', 'created_at', 'updated_at',
    ],
    encode: r => [
      str(r.id), str(r.user_id), str(r.age_category), str(r.resident_status), str(r.city_of_residence),
      str(r.active_income_streams), str(r.employment_type), num(r.annual_gross_income),
      num(r.annual_rent_paid), num(r.business_turnover), num(r.business_digital_percent),
      num(r.professional_receipts), str(r.profession_type), num(r.rental_gross_receipts),
      num(r.rental_municipal_taxes), num(r.rental_home_loan_interest), num(r.equity_stcg),
      num(r.equity_ltcg), num(r.other_ltcg), num(r.other_stcg), num(r.other_income),
      num(r.home_loan_principal), num(r.home_loan_interest), str(r.tax_saving_investments),
      num(r.health_insurance_premiums), num(r.education_loan_interest), num(r.donations_80g),
      str(r.risk_appetite), str(r.liquidity_needs),
      fmtTimestamp(r.created_at), fmtTimestamp(r.updated_at),
    ],
  },
  {
    name: 'ai_tax_planner_output',
    store: 'ai_tax_planner_output',
    columns: ['id', 'user_id', 'recommendations_json', 'created_at', 'updated_at'],
    encode: r => [
      str(r.id), str(r.user_id), raw(r.recommendations_json),
      fmtTimestamp(r.created_at), fmtTimestamp(r.updated_at),
    ],
  },
  {
    name: 'advance_tax_payments',
    store: 'advance_tax_payments',
    columns: [
      'id', 'user_id', 'financial_year', 'installment', 'due_date', 'estimated_amount',
      'paid_amount', 'paid_date', 'is_paid', 'created_at', 'updated_at',
    ],
    encode: r => [
      str(r.id), str(r.user_id), str(r.financial_year), str(r.installment), str(r.due_date),
      num(r.estimated_amount), num(r.paid_amount), str(r.paid_date), bool(r.is_paid),
      fmtTimestamp(r.created_at), fmtTimestamp(r.updated_at),
    ],
  },
  {
    name: 'capital_gains_entries',
    store: 'capital_gains_entries',
    columns: [
      'id', 'user_id', 'asset_type', 'asset_name', 'purchase_date', 'sale_date',
      'purchase_price', 'sale_price', 'quantity', 'financial_year', 'created_at', 'updated_at',
    ],
    encode: r => [
      str(r.id), str(r.user_id), str(r.asset_type), str(r.asset_name), str(r.purchase_date),
      str(r.sale_date), num(r.purchase_price), numN(r.sale_price), num(r.quantity),
      str(r.financial_year), fmtTimestamp(r.created_at), fmtTimestamp(r.updated_at),
    ],
  },
  {
    name: 'tax_calendar_state',
    store: 'tax_calendar_state',
    columns: ['id', 'user_id', 'financial_year', 'checked_event_ids', 'updated_at'],
    encode: r => [
      str(r.id), str(r.user_id), str(r.financial_year), json(r.checked_event_ids),
      fmtTimestamp(r.updated_at),
    ],
  },
  {
    name: 'salary_restructuring',
    store: 'salary_restructuring',
    columns: [
      'id', 'user_id', 'gross_ctc', 'basic', 'hra', 'lta', 'special_allowance', 'nps_employer',
      'other_allowances', 'regime', 'rent_paid_annual', 'city', 'sec80c', 'sec80d', 'sec80ccd1b',
      'home_loan_interest', 'other_deductions', 'updated_at',
    ],
    encode: r => [
      str(r.id), str(r.user_id), num(r.gross_ctc), num(r.basic), num(r.hra), num(r.lta),
      num(r.special_allowance), num(r.nps_employer), num(r.other_allowances), str(r.regime),
      num(r.rent_paid_annual), str(r.city), num(r.sec80c), num(r.sec80d), num(r.sec80ccd1b),
      num(r.home_loan_interest), num(r.other_deductions), fmtTimestamp(r.updated_at),
    ],
  },
  {
    name: 'tds_entries',
    store: 'tds_entries',
    columns: [
      'id', 'user_id', 'financial_year', 'deductor_name', 'tds_section', 'income_type',
      'tds_amount', 'income_amount', 'quarter', 'form_type', 'is_verified', 'created_at', 'updated_at',
    ],
    encode: r => [
      str(r.id), str(r.user_id), str(r.financial_year), str(r.deductor_name), str(r.tds_section),
      str(r.income_type), num(r.tds_amount), num(r.income_amount), str(r.quarter), str(r.form_type),
      bool(r.is_verified), fmtTimestamp(r.created_at), fmtTimestamp(r.updated_at),
    ],
  },
  {
    name: 'itr_checklist',
    store: 'itr_checklist',
    columns: [
      'id', 'user_id', 'financial_year', 'item_key', 'category', 'is_completed', 'notes', 'updated_at',
    ],
    encode: r => [
      str(r.id), str(r.user_id), str(r.financial_year), str(r.item_key), str(r.category),
      bool(r.is_completed), str(r.notes), fmtTimestamp(r.updated_at),
    ],
  },
  {
    name: 'payment_merchant_mappings',
    store: 'payment_merchant_mappings',
    columns: [
      'id', 'user_id', 'merchant_key', 'display_name', 'source_package',
      'category', 'account', 'note', 'confirmations', 'last_amount',
      'created_at', 'updated_at',
    ],
    encode: r => [
      str(r.id), str(r.user_id), str(r.merchant_key), str(r.display_name), str(r.source_package),
      str(r.category), str(r.account), str(r.note), num(r.confirmations), num(r.last_amount),
      fmtTimestamp(r.created_at), fmtTimestamp(r.updated_at),
    ],
  },
];

// ─── Assembly ────────────────────────────────────────────────────────────────

/** One section's block, including the trailing blank line. */
function appendSection(section: Section, rows: Row[]): string {
  const tag = section.name.toUpperCase();
  const lines = [
    `section,${section.name}`,
    encodeRow(['columns', ...section.columns]),
    ...rows.map(r => encodeRow([tag, ...section.encode(r)])),
  ];
  return `${lines.join('\n')}\n\n`;
}

/** Stable order: ascending primary key, as the native DAOs return them. */
function sortByKey(store: StoreName, rows: Row[]): Row[] {
  const field = keyFieldFor(store);
  return [...rows].sort((a, b) => String(a[field] ?? '').localeCompare(String(b[field] ?? '')));
}

/**
 * Build the complete CSV backup for one user.
 *
 * Emits every section — a section with no rows still contributes its
 * `section,` / `columns,` pair and its blank line, so the shape of the file
 * never depends on what the user happens to have entered. `profiles` is the
 * sole exception: it is omitted when the user has no profile record, matching
 * `profileDao.getById(userId)?.let { … }` in the Kotlin writer.
 */
export async function buildCSVBackup(userId: string): Promise<string> {
  let out = '';

  for (const section of BACKUP_SECTIONS) {
    let rows: Row[];

    if (section.store === 'profiles') {
      // `profiles` is keyed by the user id itself and carries no `user_id`.
      const profile = await get<Row>('profiles', userId);
      if (!profile) continue;
      rows = [profile];
    } else {
      rows = sortByKey(section.store, await getAllByIndex<Row>(section.store, 'user_id', userId));
    }

    out += appendSection(section, rows);
  }

  return out;
}

// ─── Filename ────────────────────────────────────────────────────────────────

/**
 * `acounted_backup_yyyy-MM-dd_HH-mm-ss.csv` in **local** time — the pattern the
 * native app suggested to the file picker:
 *
 *   fun suggestedFileName(): String =
 *       "acounted_backup_${LocalDateTime.now().format(FILE_STAMP)}.csv"
 *   val FILE_STAMP = DateTimeFormatter.ofPattern("yyyy-MM-dd_HH-mm-ss")
 *
 * `LocalDateTime.now()` is device-local, so this one is deliberately NOT UTC —
 * unlike the timestamps inside the file. A user sorting their backups by name
 * should see them in the order they made them, in their own wall clock.
 */
export function backupFileName(now: Date = new Date()): string {
  const stamp =
    `${now.getFullYear()}-${pad2(now.getMonth() + 1)}-${pad2(now.getDate())}` +
    `_${pad2(now.getHours())}-${pad2(now.getMinutes())}-${pad2(now.getSeconds())}`;
  return `acounted_backup_${stamp}.csv`;
}
