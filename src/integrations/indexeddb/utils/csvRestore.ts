/**
 * csvRestore.ts — reader for the CSV backup written by the legacy native
 * Android app (`acounted-android`).
 *
 * This is the ONLY migration route real users have: export CSV from the old
 * app → install this one → Restore. Every bug in here is silent financial data
 * loss, so two rules govern the design:
 *
 *  1. HEADER-DRIVEN, NEVER POSITIONAL.
 *     Each section in the file is preceded by a `columns,<name>,<name>,…` row.
 *     We build a name→index map from it and read every field BY NAME. The old
 *     reader hard-coded positions and had drifted out of sync with the Kotlin
 *     writer — `transactions` alone restored with `amount: 0` on every row
 *     because the writer emits `created_at,updated_at,type,amount,…` while the
 *     reader assumed `transaction_date,type,category,…`. Reading by name makes
 *     the reader immune to column reordering for good. The legacy positional
 *     map survives only as a fallback for a file with no `columns,` row.
 *
 *  2. NOTHING IS DROPPED SILENTLY.
 *     Every one of the 22 sections the writer emits is handled. Anything this
 *     reader does not recognise is COUNTED into `skipped` and surfaced to the
 *     UI, so a future writer-side section shows up as "N records could not be
 *     imported" instead of vanishing.
 *
 * Format contract: `src/test-fixtures/README.md` (authoritative).
 * Regression gate:  `csvRestore.test.ts`.
 */

import { v4 as uuidv4 } from 'uuid';
import {
  getAllByIndex,
  bulkPut,
  remove,
  flush,
} from '@/integrations/storage/repository';
import { keyFieldFor, type StoreName } from '@/integrations/storage/stores';

// ─── CSV Parser ───────────────────────────────────────────────────────────────
// Record-aware: a quoted field may contain commas, doubled quotes AND newlines.
// The old parser split the text on '\n' *before* parsing, so a single newline
// inside a quoted note shredded the rest of the file. We scan the whole text
// once and only end a record on a newline that is outside quotes.

export function parseCSVRecords(csvText: string): string[][] {
  const text = csvText.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const records: string[][] = [];

  let record: string[] = [];
  let current = '';
  let inQuotes = false;

  const endField = () => { record.push(current.trim()); current = ''; };
  const endRecord = () => {
    endField();
    // A blank physical line parses as a single empty field — that is the
    // section separator, not a record.
    if (!(record.length === 1 && record[0] === '')) records.push(record);
    record = [];
  };

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '"') {
      if (inQuotes && text[i + 1] === '"') { current += '"'; i++; }  // escaped ""
      else inQuotes = !inQuotes;
    } else if (ch === ',' && !inQuotes) {
      endField();
    } else if (ch === '\n' && !inQuotes) {
      endRecord();
    } else {
      current += ch;
    }
  }
  // Trailing record with no final newline (and an unterminated quote lands here
  // too — better a truncated last row than a discarded file).
  if (current !== '' || record.length > 0) endRecord();

  return records;
}

// ─── Safe parsers ─────────────────────────────────────────────────────────────

function safeFloat(v: string): number {
  const n = parseFloat(v);
  return isNaN(n) ? 0 : n;
}
/** Nullable numeric: an empty CSV field means NULL, not 0. */
function safeNullFloat(v: string): number | null {
  if (!v || v.trim() === '') return null;
  const n = parseFloat(v);
  return isNaN(n) ? null : n;
}
function safeInt(v: string): number {
  const n = parseInt(v, 10);
  return isNaN(n) ? 0 : n;
}
function safeBool(v: string): boolean {
  return v === 'true' || v === '1' || v === 'yes';
}
function safeJSON<T>(v: string, fallback: T): T {
  if (!v || v === '' || v === 'null') return fallback;
  try { return JSON.parse(v) as T; } catch { return fallback; }
}
/**
 * For columns the writer treats as opaque strings (`form_data`,
 * `recommendations_json`). Parse when it is JSON, otherwise keep the raw text —
 * throwing the string away is how `form_data` used to get destroyed.
 */
function safeJSONOrRaw(v: string): any {
  if (!v || v.trim() === '' || v === 'null') return null;
  try { return JSON.parse(v); } catch { return v; }
}
/** Parse any timestamp the CSV might contain → ISO string. */
function safeDate(v: string): string {
  if (!v || v.trim() === '') return new Date().toISOString();
  const raw = v.trim();

  // ── Backup timestamps are UTC ──────────────────────────────────────────────
  // The backup writes `yyyy-MM-dd HH:mm` with NO offset marker, and those
  // values are UTC. Parsing them without an explicit zone makes JavaScript
  // read them as *device-local* time, which silently drags every timestamp by
  // the device's offset. On an IST device that shifted entries back 5h30m —
  // an entry made on 1 Dec at 01:35 restored as 30 Nov 20:05, and worse, any
  // entry near a month boundary landed in the wrong month entirely (the
  // 31 Mar / 1 Apr annual-bonus case). Pinning to UTC makes the restore
  // produce identical results on every device, in any timezone.
  const withT = raw.replace(' ', 'T');
  const hasTime = /T\d{2}:\d{2}/.test(withT);
  const hasZone = /(?:[Zz]|[+-]\d{2}:?\d{2})$/.test(withT);

  // Date-only values (`yyyy-MM-dd`, used by due_date / purchase_date and the
  // other plain recall dates) are ALREADY parsed as UTC midnight per spec.
  // Appending 'Z' to those produces an invalid date, so leave them alone.
  const normalised = hasTime && !hasZone ? `${withT}Z` : withT;

  const iso = new Date(normalised);
  if (!isNaN(iso.getTime())) return iso.toISOString();

  // DD-MM-YYYY HH:MM fallback — same UTC treatment.
  const m = raw.match(/^(\d{2})-(\d{2})-(\d{4})(?:\s+(\d{2}):(\d{2}))?/);
  if (m) {
    const [, d, mo, y, h = '00', mi = '00'] = m;
    return new Date(`${y}-${mo}-${d}T${h}:${mi}:00Z`).toISOString();
  }
  return new Date().toISOString();
}
/** Same, but an empty field stays NULL instead of becoming "now". */
function safeDateOrNull(v: string): string | null {
  if (!v || v.trim() === '') return null;
  return safeDate(v);
}
function safeStr(v: string | undefined): string {
  return v ?? '';
}
function safeNullStr(v: string | undefined): string | null {
  return (!v || v.trim() === '') ? null : v.trim();
}

// ─── Exported interfaces ──────────────────────────────────────────────────────

export interface CSVBackupData {
  // Parsed rows per section — all 22 the native writer emits.
  profileRows:              ProfileCSVRow[];
  transactionRows:          TransactionCSVRow[];
  incomRows:                IncomeCSVRow[];
  incomeSourceRows:         IncomeSourceCSVRow[];
  expenseCategoryRows:      ExpenseCategoryCSVRow[];
  investmentRows:           InvestmentCSVRow[];
  monthlyBudgetRows:        MonthlyBudgetCSVRow[];
  variableBudgetEntryRows:  VariableBudgetEntryCSVRow[];
  savingsGoalRows:          SavingsGoalCSVRow[];
  udharRows:                UdharCSVRow[];
  recallRows:               RecallCSVRow[];
  userNotificationRows:     UserNotificationCSVRow[];
  lendrGroupRows:           LendrGroupCSVRow[];
  lendrExpenseRows:         LendrExpenseCSVRow[];
  aiTaxPlannerInputRows:    AiTaxPlannerInputCSVRow[];
  aiTaxPlannerOutputRows:   AiTaxPlannerOutputCSVRow[];
  advanceTaxPaymentRows:    AdvanceTaxPaymentCSVRow[];
  capitalGainsEntryRows:    CapitalGainsEntryCSVRow[];
  taxCalendarStateRows:     TaxCalendarStateCSVRow[];
  salaryRestructuringRows:  SalaryRestructuringCSVRow[];
  tdsEntryRows:             TdsEntryCSVRow[];
  itrChecklistRows:         ItrChecklistCSVRow[];

  /**
   * Rows this reader did not recognise, keyed by section name. Never silently
   * discarded — the UI reports the total so a user knows something was left
   * behind rather than assuming a clean restore.
   */
  skipped: Record<string, number>;

  // Set during validateCSVOwnership
  profile: ProfileCSVRow | null;
  // Kept for backward compat with CSVImportScreen summary counts
  profiles:          ProfileCSVRow[];
  transactions:      TransactionCSVRow[];
  income:            IncomeCSVRow[];
  expenseCategories: ExpenseCategoryCSVRow[];
  investments:       InvestmentCSVRow[];
  savingsGoals:      SavingsGoalCSVRow[];
}

export interface ProfileCSVRow {
  id:                   string;
  email:                string;
  phone:                string;
  pin_hash:             string;
  display_name:         string;
  onboarding_completed: boolean;
  created_at:           string;
  updated_at:           string;
}

export interface TransactionCSVRow {
  id:               string;
  user_id:          string;
  transaction_date: string;
  type:             string;
  category:         string;
  account:          string;
  description:      string | null;
  amount:           number;
  created_at:       string;
  updated_at:       string;
}

export interface IncomeCSVRow {
  id:                   string;
  user_id:              string;
  income_type:          string;
  monthly_salary:       number | null;
  basic_salary:         number | null;
  other_allowances:     number | null;
  monthly_other_income: number | null;
  form_data:            any;
  full_name:            string | null;
  pan:                  string | null;
  hra:                  number | null;
  standard_deduction:   number | null;
  created_at:           string;
  updated_at:           string;
}

export interface IncomeSourceCSVRow {
  id:          string;
  user_id:     string;
  source_name: string;
  amount:      number;
  frequency:   string;
  created_at:  string;
  updated_at:  string;
}

export interface ExpenseCategoryCSVRow {
  id:            string;
  user_id:       string;
  category_name: string;
  category_type: string;
  frequency:     string;
  amount:        number;
  created_at:    string;
  updated_at:    string;
}

export interface InvestmentCSVRow {
  id:              string;
  user_id:         string;
  investment_name: string;
  investment_type: string;
  amount:          number;
  risk_level:      string;
  interest_rate:   number | null;
  created_at:      string;
  updated_at:      string;
}

export interface MonthlyBudgetCSVRow {
  id:                string;
  user_id:           string;
  budget_month:      string;
  budget_start_date: string | null;
  budget_end_date:   string | null;
  fixed_budget:      number;
  variable_budget:   number;
  total_budget:      number | null;
  created_at:        string;
  updated_at:        string;
}

export interface VariableBudgetEntryCSVRow {
  id:               string;
  user_id:          string;
  budget_month:     string;
  category_name:    string;
  allocated_amount: number;
  notes:            string | null;
  created_at:       string;
  updated_at:       string;
}

export interface SavingsGoalCSVRow {
  id:                   string;
  user_id:              string;
  goal_name:            string;
  goal_amount:          number;
  target_months:        number;
  monthly_save_amount:  number | null;
  weekly_save_amount:   number | null;
  monthly_spend_amount: number | null;
  weekly_spend_amount:  number | null;
  created_at:           string;
  updated_at:           string;
}

export interface UdharCSVRow {
  id:           string;
  user_id:      string;
  created_at:   string;
  updated_at:   string;
  type:         'given' | 'taken';
  person_name:  string | null;
  lender_name:  string | null;
  amount:       number;
  due_date:     string;
  is_settled:   boolean;
  phone_number: string;
  description:  string | null;
  payments:     Array<{ id: string; amount: number; date: string; note: string }>;
  amount_paid:  number;
}

export interface RecallCSVRow {
  id:                        string;
  user_id:                   string;
  name:                      string;
  category:                  string;
  brand:                     string;
  model_number:              string;
  serial_number:             string;
  purchase_date:             string;
  purchase_price:            number;
  purchased_from:            string;
  warranty_months:           number;
  warranty_expiry:           string | null;
  extended_warranty:         boolean;
  extended_warranty_provider:string;
  extended_warranty_expiry:  string | null;
  service_interval_months:   number;
  last_service_date:         string | null;
  next_service_date:         string | null;
  service_centre_name:       string;
  service_centre_phone:      string;
  service_history:           any[];
  service_notes:             string;
  notes:                     string;
  warranty_note:             string;
  extended_warranty_note:    string;
  additional_warranties:     any[];
  payment_mode:              string;
  amount_paid_upfront:       number;
  emi_enabled:               boolean;
  emi_amount:                number;
  emi_tenure_months:         number;
  emi_start_date:            string | null;
  emi_interest_rate:         number;
  emi_bank_or_provider:      string;
  emi_account_last4:         string;
  down_payment:              number;
  insurance_provider:        string;
  insurance_policy_number:   string;
  insurance_renewal_date:    string | null;
  insurance_premium:         number;
  emi_budget_added:          boolean;
  created_at:                string;
  updated_at:                string;
}

export interface UserNotificationCSVRow {
  user_id:         string;
  notification_id: string;
  seen_at:         string;
}

export interface LendrGroupCSVRow {
  id:         string;
  user_id:    string;
  name:       string;
  emoji:      string;
  members:    Array<{ id: string; name: string; phone: string }>;
  created_at: string;
  updated_at: string;
}

export interface LendrExpenseCSVRow {
  id:                string;
  group_id:          string;
  user_id:           string;
  description:       string;
  total_amount:      number;
  paid_by_member_id: string;
  date:              string;
  splits:            Array<{ member_id: string; amount: number; is_settled: boolean }>;
  created_at:        string;
  updated_at:        string;
}

export interface AiTaxPlannerInputCSVRow {
  id:                        string;
  user_id:                   string;
  age_category:              string;
  resident_status:           string;
  city_of_residence:         string;
  active_income_streams:     string;
  employment_type:           string;
  annual_gross_income:       number;
  annual_rent_paid:          number;
  business_turnover:         number;
  business_digital_percent:  number;
  professional_receipts:     number;
  profession_type:           string;
  rental_gross_receipts:     number;
  rental_municipal_taxes:    number;
  rental_home_loan_interest: number;
  equity_stcg:               number;
  equity_ltcg:               number;
  other_ltcg:                number;
  other_stcg:                number;
  other_income:              number;
  home_loan_principal:       number;
  home_loan_interest:        number;
  tax_saving_investments:    string;
  health_insurance_premiums: number;
  education_loan_interest:   number;
  donations_80g:             number;
  risk_appetite:             string;
  liquidity_needs:           string;
  created_at:                string;
  updated_at:                string;
}

export interface AiTaxPlannerOutputCSVRow {
  id:                   string;
  user_id:              string;
  recommendations_json: any;
  created_at:           string;
  updated_at:           string;
}

export interface AdvanceTaxPaymentCSVRow {
  id:               string;
  user_id:          string;
  financial_year:   string;
  installment:      string;
  due_date:         string;
  estimated_amount: number;
  paid_amount:      number;
  paid_date:        string | null;
  is_paid:          boolean;
  created_at:       string;
  updated_at:       string;
}

export interface CapitalGainsEntryCSVRow {
  id:             string;
  user_id:        string;
  asset_type:     string;
  asset_name:     string;
  purchase_date:  string;
  sale_date:      string | null;
  purchase_price: number;
  sale_price:     number | null;
  quantity:       number;
  financial_year: string;
  created_at:     string;
  updated_at:     string;
}

export interface TaxCalendarStateCSVRow {
  id:                string;
  user_id:           string;
  financial_year:    string;
  checked_event_ids: string[];
  updated_at:        string;
}

export interface SalaryRestructuringCSVRow {
  id:                 string;
  user_id:            string;
  gross_ctc:          number;
  basic:              number;
  hra:                number;
  lta:                number;
  special_allowance:  number;
  nps_employer:       number;
  other_allowances:   number;
  regime:             string;
  rent_paid_annual:   number;
  city:               string;
  sec80c:             number;
  sec80d:             number;
  sec80ccd1b:         number;
  home_loan_interest: number;
  other_deductions:   number;
  updated_at:         string;
}

export interface TdsEntryCSVRow {
  id:             string;
  user_id:        string;
  financial_year: string;
  deductor_name:  string;
  tds_section:    string;
  income_type:    string;
  tds_amount:     number;
  income_amount:  number;
  quarter:        string;
  form_type:      string;
  is_verified:    boolean;
  created_at:     string;
  updated_at:     string;
}

export interface ItrChecklistCSVRow {
  id:             string;
  user_id:        string;
  financial_year: string;
  item_key:       string;
  category:       string;
  is_completed:   boolean;
  notes:          string | null;
  updated_at:     string;
}

// ─── Field access ─────────────────────────────────────────────────────────────
/**
 * A field reader for one data row.
 *
 * `g('amount', 8)` means: read the column literally named `amount` when the
 * section declared a `columns,` header (the normal case), otherwise fall back
 * to `cols[8]` — the layout the pre-header reader assumed. Pass a legacy index
 * of `-1` for columns that simply did not exist before headers.
 */
type FieldGetter = (name: string, legacyIndex: number) => string;

function makeGetter(cols: string[], columns: string[] | null): FieldGetter {
  if (columns && columns.length > 0) {
    const index = new Map<string, number>();
    // cols[0] is the row tag, so column i of the header maps to cols[i + 1].
    columns.forEach((c, i) => { if (!index.has(c)) index.set(c, i + 1); });
    return (name) => {
      const i = index.get(name);
      return i === undefined ? '' : (cols[i] ?? '');
    };
  }
  return (_name, legacyIndex) =>
    legacyIndex < 0 ? '' : (cols[legacyIndex] ?? '');
}

// ─── Main parser ──────────────────────────────────────────────────────────────

function emptyBackupData(): CSVBackupData {
  return {
    profileRows:             [],
    transactionRows:         [],
    incomRows:               [],
    incomeSourceRows:        [],
    expenseCategoryRows:     [],
    investmentRows:          [],
    monthlyBudgetRows:       [],
    variableBudgetEntryRows: [],
    savingsGoalRows:         [],
    udharRows:               [],
    recallRows:              [],
    userNotificationRows:    [],
    lendrGroupRows:          [],
    lendrExpenseRows:        [],
    aiTaxPlannerInputRows:   [],
    aiTaxPlannerOutputRows:  [],
    advanceTaxPaymentRows:   [],
    capitalGainsEntryRows:   [],
    taxCalendarStateRows:    [],
    salaryRestructuringRows: [],
    tdsEntryRows:            [],
    itrChecklistRows:        [],
    skipped:                 {},
    profile:                 null,
    // backward compat aliases
    profiles:                [],
    transactions:            [],
    income:                  [],
    expenseCategories:       [],
    investments:             [],
    savingsGoals:            [],
  };
}

export function parseCSVBackup(csvText: string): CSVBackupData {
  const result = emptyBackupData();

  let currentSection: string | null = null;
  let currentColumns: string[] | null = null;

  for (const cols of parseCSVRecords(csvText)) {
    if (cols.length === 0 || !cols[0]) continue;

    const tag = cols[0];
    const lowerTag = tag.toLowerCase();

    if (lowerTag === 'section') {
      currentSection = (cols[1] ?? '').trim().toLowerCase();
      currentColumns = null;               // header belonging to the previous section is dead
      continue;
    }
    if (lowerTag === 'columns') {
      currentColumns = cols.slice(1).map(c => c.trim().toLowerCase());
      continue;
    }

    // A data row. Its tag is the section name uppercased; trust the tag over
    // the `section,` line, and only use the captured header when the two agree.
    const section = lowerTag;
    const columns = currentSection === section ? currentColumns : null;
    const g = makeGetter(cols, columns);

    switch (section) {

      case 'profiles': {
        const row: ProfileCSVRow = {
          id:                   safeStr(g('id', 1)),
          email:                safeStr(g('email', 2)).trim().toLowerCase(),
          phone:                safeStr(g('phone', 3)).replace(/\D/g, ''),
          pin_hash:             safeStr(g('pin_hash', 4)),
          display_name:         safeStr(g('display_name', 5)),
          onboarding_completed: safeBool(g('onboarding_completed', 6)),
          created_at:           safeDate(g('created_at', 7)),
          updated_at:           safeDate(g('updated_at', 8)),
        };
        result.profileRows.push(row);
        result.profiles.push(row);
        break;
      }

      case 'transactions': {
        const row: TransactionCSVRow = {
          id:               safeStr(g('id', 1)) || uuidv4(),
          user_id:          safeStr(g('user_id', 2)),
          transaction_date: safeDate(g('transaction_date', 3)),
          type:             safeStr(g('type', 4)),
          category:         safeStr(g('category', 5)),
          account:          safeStr(g('account', 6)) || 'upi',
          description:      safeNullStr(g('description', 7)),
          amount:           safeFloat(g('amount', 8)),
          created_at:       safeDate(g('created_at', 9)),
          updated_at:       safeDate(g('updated_at', 10)),
        };
        result.transactionRows.push(row);
        result.transactions.push(row);
        break;
      }

      case 'income_details': {
        const row: IncomeCSVRow = {
          id:                   safeStr(g('id', 1)) || uuidv4(),
          user_id:              safeStr(g('user_id', 2)),
          income_type:          safeStr(g('income_type', 3)),
          monthly_salary:       safeNullFloat(g('monthly_salary', 4)),
          basic_salary:         safeNullFloat(g('basic_salary', 5)),
          other_allowances:     safeNullFloat(g('other_allowances', 6)),
          monthly_other_income: safeNullFloat(g('monthly_other_income', 9)),
          form_data:            safeJSONOrRaw(g('form_data', 10)),
          full_name:            safeNullStr(g('full_name', -1)),
          pan:                  safeNullStr(g('pan', -1)),
          hra:                  safeNullFloat(g('hra', -1)),
          standard_deduction:   safeNullFloat(g('standard_deduction', -1)),
          created_at:           safeDate(g('created_at', 7)),
          updated_at:           safeDate(g('updated_at', 8)),
        };
        result.incomRows.push(row);
        result.income.push(row);
        break;
      }

      case 'income_sources': {
        result.incomeSourceRows.push({
          id:          safeStr(g('id', 1)) || uuidv4(),
          user_id:     safeStr(g('user_id', 2)),
          source_name: safeStr(g('source_name', 3)),
          amount:      safeFloat(g('amount', 4)),
          frequency:   safeStr(g('frequency', 5)),
          created_at:  safeDate(g('created_at', 6)),
          updated_at:  safeDate(g('updated_at', 7)),
        });
        break;
      }

      case 'expense_categories': {
        const row: ExpenseCategoryCSVRow = {
          id:            safeStr(g('id', 1)) || uuidv4(),
          user_id:       safeStr(g('user_id', 2)),
          category_name: safeStr(g('category_name', 3)),
          category_type: safeStr(g('category_type', 4)),
          frequency:     safeStr(g('frequency', 5)),
          amount:        safeFloat(g('amount', 6)),
          created_at:    safeDate(g('created_at', 7)),
          updated_at:    safeDate(g('updated_at', 8)),
        };
        result.expenseCategoryRows.push(row);
        result.expenseCategories.push(row);
        break;
      }

      case 'investment_types': {
        const row: InvestmentCSVRow = {
          id:              safeStr(g('id', 1)) || uuidv4(),
          user_id:         safeStr(g('user_id', 2)),
          investment_name: safeStr(g('investment_name', 3)),
          investment_type: safeStr(g('investment_type', 4)),
          amount:          safeFloat(g('amount', 5)),
          risk_level:      safeStr(g('risk_level', 6)),
          interest_rate:   safeNullFloat(g('interest_rate', 7)),
          created_at:      safeDate(g('created_at', 8)),
          updated_at:      safeDate(g('updated_at', 9)),
        };
        result.investmentRows.push(row);
        result.investments.push(row);
        break;
      }

      case 'monthly_budgets': {
        result.monthlyBudgetRows.push({
          id:                safeStr(g('id', 1)) || uuidv4(),
          user_id:           safeStr(g('user_id', 2)),
          budget_month:      safeStr(g('budget_month', 3)),
          budget_start_date: safeDateOrNull(g('budget_start_date', 4)),
          budget_end_date:   safeDateOrNull(g('budget_end_date', 5)),
          fixed_budget:      safeFloat(g('fixed_budget', 6)),
          variable_budget:   safeFloat(g('variable_budget', 7)),
          total_budget:      safeNullFloat(g('total_budget', 8)),
          created_at:        safeDate(g('created_at', 9)),
          updated_at:        safeDate(g('updated_at', 10)),
        });
        break;
      }

      case 'variable_budget_entries': {
        result.variableBudgetEntryRows.push({
          id:               safeStr(g('id', 1)) || uuidv4(),
          user_id:          safeStr(g('user_id', 2)),
          created_at:       safeDate(g('created_at', 3)),
          updated_at:       safeDate(g('updated_at', 4)),
          budget_month:     safeStr(g('budget_month', 5)),
          category_name:    safeStr(g('category_name', 6)),
          allocated_amount: safeFloat(g('allocated_amount', 7)),
          notes:            safeNullStr(g('notes', 8)),
        });
        break;
      }

      case 'savings_goals': {
        const row: SavingsGoalCSVRow = {
          id:                   safeStr(g('id', 1)) || uuidv4(),
          user_id:              safeStr(g('user_id', 2)),
          goal_name:            safeStr(g('goal_name', 3)),
          goal_amount:          safeFloat(g('goal_amount', 4)),
          target_months:        safeInt(g('target_months', 5)),
          monthly_save_amount:  safeNullFloat(g('monthly_save_amount', 6)),
          weekly_save_amount:   safeNullFloat(g('weekly_save_amount', 7)),
          monthly_spend_amount: safeNullFloat(g('monthly_spend_amount', 8)),
          weekly_spend_amount:  safeNullFloat(g('weekly_spend_amount', 9)),
          created_at:           safeDate(g('created_at', 10)),
          updated_at:           safeDate(g('updated_at', 11)),
        };
        result.savingsGoalRows.push(row);
        result.savingsGoals.push(row);
        break;
      }

      case 'udhar_entries': {
        result.udharRows.push({
          id:           safeStr(g('id', 1)) || uuidv4(),
          user_id:      safeStr(g('user_id', 2)),
          created_at:   safeDate(g('created_at', 3)),
          updated_at:   safeDate(g('updated_at', 4)),
          type:         (g('type', 5) === 'taken' ? 'taken' : 'given') as 'given' | 'taken',
          person_name:  safeNullStr(g('person_name', 6)),
          lender_name:  safeNullStr(g('lender_name', 7)),
          amount:       safeFloat(g('amount', 8)),
          due_date:     safeDate(g('due_date', 9)),
          is_settled:   safeBool(g('is_settled', 10)),
          phone_number: safeStr(g('phone_number', 11)),
          description:  safeNullStr(g('description', 12)),
          payments:     safeJSON(safeStr(g('payments', 13)), []),
          amount_paid:  safeFloat(g('amount_paid', 14)),
        });
        break;
      }

      case 'recall_products': {
        result.recallRows.push({
          id:                         safeStr(g('id', 1)) || uuidv4(),
          user_id:                    safeStr(g('user_id', 2)),
          name:                       safeStr(g('name', 3)),
          category:                   safeStr(g('category', 4)),
          brand:                      safeStr(g('brand', 5)),
          model_number:               safeStr(g('model_number', 6)),
          serial_number:              safeStr(g('serial_number', 7)),
          purchase_date:              safeDate(g('purchase_date', 8)),
          purchase_price:             safeFloat(g('purchase_price', 9)),
          purchased_from:             safeStr(g('purchased_from', 10)),
          warranty_months:            safeInt(g('warranty_months', 11)),
          warranty_expiry:            safeNullStr(g('warranty_expiry', 12)),
          extended_warranty:          safeBool(g('extended_warranty', 13)),
          extended_warranty_provider: safeStr(g('extended_warranty_provider', 14)),
          extended_warranty_expiry:   safeNullStr(g('extended_warranty_expiry', 15)),
          service_interval_months:    safeInt(g('service_interval_months', 16)),
          last_service_date:          safeNullStr(g('last_service_date', 17)),
          next_service_date:          safeNullStr(g('next_service_date', 18)),
          service_centre_name:        safeStr(g('service_centre_name', 19)),
          service_centre_phone:       safeStr(g('service_centre_phone', 20)),
          service_history:            safeJSON(safeStr(g('service_history', 21)), []),
          service_notes:              safeStr(g('service_notes', 22)),
          notes:                      safeStr(g('notes', 23)),
          warranty_note:              safeStr(g('warranty_note', 24)),
          extended_warranty_note:     safeStr(g('extended_warranty_note', 25)),
          additional_warranties:      safeJSON(safeStr(g('additional_warranties', 26)), []),
          payment_mode:               safeStr(g('payment_mode', 27)) || 'full',
          amount_paid_upfront:        safeFloat(g('amount_paid_upfront', 28)),
          emi_enabled:                safeBool(g('emi_enabled', 29)),
          emi_amount:                 safeFloat(g('emi_amount', 30)),
          emi_tenure_months:          safeInt(g('emi_tenure_months', 31)),
          emi_start_date:             safeNullStr(g('emi_start_date', 32)),
          emi_interest_rate:          safeFloat(g('emi_interest_rate', 33)),
          emi_bank_or_provider:       safeStr(g('emi_bank_or_provider', 34)),
          emi_account_last4:          safeStr(g('emi_account_last4', 35)),
          down_payment:               safeFloat(g('down_payment', 36)),
          insurance_provider:         safeStr(g('insurance_provider', 37)),
          insurance_policy_number:    safeStr(g('insurance_policy_number', 38)),
          insurance_renewal_date:     safeNullStr(g('insurance_renewal_date', 39)),
          insurance_premium:          safeFloat(g('insurance_premium', 40)),
          emi_budget_added:           safeBool(g('emi_budget_added', 41)),
          created_at:                 safeDate(g('created_at', 42)),
          updated_at:                 safeDate(g('updated_at', 43)),
        });
        break;
      }

      case 'user_notifications': {
        result.userNotificationRows.push({
          user_id:         safeStr(g('user_id', 1)),
          notification_id: safeStr(g('notification_id', 2)),
          seen_at:         safeDate(g('seen_at', 3)),
        });
        break;
      }

      case 'lendr_groups': {
        result.lendrGroupRows.push({
          id:         safeStr(g('id', 1)) || uuidv4(),
          user_id:    safeStr(g('user_id', 2)),
          name:       safeStr(g('name', 3)),
          emoji:      safeStr(g('emoji', 4)),
          members:    safeJSON(safeStr(g('members', 5)), []),
          created_at: safeDate(g('created_at', 6)),
          updated_at: safeDate(g('updated_at', 7)),
        });
        break;
      }

      case 'lendr_expenses': {
        result.lendrExpenseRows.push({
          id:                safeStr(g('id', 1)) || uuidv4(),
          group_id:          safeStr(g('group_id', 2)),
          user_id:           safeStr(g('user_id', 3)),
          description:       safeStr(g('description', 4)),
          total_amount:      safeFloat(g('total_amount', 5)),
          paid_by_member_id: safeStr(g('paid_by_member_id', 6)),
          date:              safeStr(g('date', 7)),
          splits:            safeJSON(safeStr(g('splits', 8)), []),
          created_at:        safeDate(g('created_at', 9)),
          updated_at:        safeDate(g('updated_at', 10)),
        });
        break;
      }

      case 'ai_tax_planner_input': {
        result.aiTaxPlannerInputRows.push({
          id:                        safeStr(g('id', 1)) || uuidv4(),
          user_id:                   safeStr(g('user_id', 2)),
          age_category:              safeStr(g('age_category', 3)),
          resident_status:           safeStr(g('resident_status', 4)),
          city_of_residence:         safeStr(g('city_of_residence', 5)),
          active_income_streams:     safeStr(g('active_income_streams', 6)),
          employment_type:           safeStr(g('employment_type', 7)),
          annual_gross_income:       safeFloat(g('annual_gross_income', 8)),
          annual_rent_paid:          safeFloat(g('annual_rent_paid', 9)),
          business_turnover:         safeFloat(g('business_turnover', 10)),
          business_digital_percent:  safeFloat(g('business_digital_percent', 11)),
          professional_receipts:     safeFloat(g('professional_receipts', 12)),
          profession_type:           safeStr(g('profession_type', 13)),
          rental_gross_receipts:     safeFloat(g('rental_gross_receipts', 14)),
          rental_municipal_taxes:    safeFloat(g('rental_municipal_taxes', 15)),
          rental_home_loan_interest: safeFloat(g('rental_home_loan_interest', 16)),
          equity_stcg:               safeFloat(g('equity_stcg', 17)),
          equity_ltcg:               safeFloat(g('equity_ltcg', 18)),
          other_ltcg:                safeFloat(g('other_ltcg', 19)),
          other_stcg:                safeFloat(g('other_stcg', 20)),
          other_income:              safeFloat(g('other_income', 21)),
          home_loan_principal:       safeFloat(g('home_loan_principal', 22)),
          home_loan_interest:        safeFloat(g('home_loan_interest', 23)),
          tax_saving_investments:    safeStr(g('tax_saving_investments', 24)),
          health_insurance_premiums: safeFloat(g('health_insurance_premiums', 25)),
          education_loan_interest:   safeFloat(g('education_loan_interest', 26)),
          donations_80g:             safeFloat(g('donations_80g', 27)),
          risk_appetite:             safeStr(g('risk_appetite', 28)),
          liquidity_needs:           safeStr(g('liquidity_needs', 29)),
          created_at:                safeDate(g('created_at', 30)),
          updated_at:                safeDate(g('updated_at', 31)),
        });
        break;
      }

      case 'ai_tax_planner_output': {
        result.aiTaxPlannerOutputRows.push({
          id:                   safeStr(g('id', 1)) || uuidv4(),
          user_id:              safeStr(g('user_id', 2)),
          recommendations_json: safeJSONOrRaw(g('recommendations_json', 3)),
          created_at:           safeDate(g('created_at', 4)),
          updated_at:           safeDate(g('updated_at', 5)),
        });
        break;
      }

      case 'advance_tax_payments': {
        result.advanceTaxPaymentRows.push({
          id:               safeStr(g('id', 1)) || uuidv4(),
          user_id:          safeStr(g('user_id', 2)),
          financial_year:   safeStr(g('financial_year', 3)),
          installment:      safeStr(g('installment', 4)),
          due_date:         safeStr(g('due_date', 5)),
          estimated_amount: safeFloat(g('estimated_amount', 6)),
          paid_amount:      safeFloat(g('paid_amount', 7)),
          paid_date:        safeNullStr(g('paid_date', 8)),
          is_paid:          safeBool(g('is_paid', 9)),
          created_at:       safeDate(g('created_at', 10)),
          updated_at:       safeDate(g('updated_at', 11)),
        });
        break;
      }

      case 'capital_gains_entries': {
        result.capitalGainsEntryRows.push({
          id:             safeStr(g('id', 1)) || uuidv4(),
          user_id:        safeStr(g('user_id', 2)),
          asset_type:     safeStr(g('asset_type', 3)),
          asset_name:     safeStr(g('asset_name', 4)),
          purchase_date:  safeStr(g('purchase_date', 5)),
          sale_date:      safeNullStr(g('sale_date', 6)),
          purchase_price: safeFloat(g('purchase_price', 7)),
          sale_price:     safeNullFloat(g('sale_price', 8)),
          quantity:       safeFloat(g('quantity', 9)),
          financial_year: safeStr(g('financial_year', 10)),
          created_at:     safeDate(g('created_at', 11)),
          updated_at:     safeDate(g('updated_at', 12)),
        });
        break;
      }

      case 'tax_calendar_state': {
        result.taxCalendarStateRows.push({
          id:                safeStr(g('id', 1)) || uuidv4(),
          user_id:           safeStr(g('user_id', 2)),
          financial_year:    safeStr(g('financial_year', 3)),
          checked_event_ids: safeJSON(safeStr(g('checked_event_ids', 4)), [] as string[]),
          updated_at:        safeDate(g('updated_at', 5)),
        });
        break;
      }

      case 'salary_restructuring': {
        result.salaryRestructuringRows.push({
          id:                 safeStr(g('id', 1)) || uuidv4(),
          user_id:            safeStr(g('user_id', 2)),
          gross_ctc:          safeFloat(g('gross_ctc', 3)),
          basic:              safeFloat(g('basic', 4)),
          hra:                safeFloat(g('hra', 5)),
          lta:                safeFloat(g('lta', 6)),
          special_allowance:  safeFloat(g('special_allowance', 7)),
          nps_employer:       safeFloat(g('nps_employer', 8)),
          other_allowances:   safeFloat(g('other_allowances', 9)),
          regime:             safeStr(g('regime', 10)) || 'new',
          rent_paid_annual:   safeFloat(g('rent_paid_annual', 11)),
          city:               safeStr(g('city', 12)) || 'metro',
          sec80c:             safeFloat(g('sec80c', 13)),
          sec80d:             safeFloat(g('sec80d', 14)),
          sec80ccd1b:         safeFloat(g('sec80ccd1b', 15)),
          home_loan_interest: safeFloat(g('home_loan_interest', 16)),
          other_deductions:   safeFloat(g('other_deductions', 17)),
          updated_at:         safeDate(g('updated_at', 18)),
        });
        break;
      }

      case 'tds_entries': {
        result.tdsEntryRows.push({
          id:             safeStr(g('id', 1)) || uuidv4(),
          user_id:        safeStr(g('user_id', 2)),
          financial_year: safeStr(g('financial_year', 3)),
          deductor_name:  safeStr(g('deductor_name', 4)),
          tds_section:    safeStr(g('tds_section', 5)),
          income_type:    safeStr(g('income_type', 6)),
          tds_amount:     safeFloat(g('tds_amount', 7)),
          income_amount:  safeFloat(g('income_amount', 8)),
          quarter:        safeStr(g('quarter', 9)) || 'Q1',
          form_type:      safeStr(g('form_type', 10)),
          is_verified:    safeBool(g('is_verified', 11)),
          created_at:     safeDate(g('created_at', 12)),
          updated_at:     safeDate(g('updated_at', 13)),
        });
        break;
      }

      case 'itr_checklist': {
        result.itrChecklistRows.push({
          id:             safeStr(g('id', 1)) || uuidv4(),
          user_id:        safeStr(g('user_id', 2)),
          financial_year: safeStr(g('financial_year', 3)),
          item_key:       safeStr(g('item_key', 4)),
          category:       safeStr(g('category', 5)),
          is_completed:   safeBool(g('is_completed', 6)),
          notes:          safeNullStr(g('notes', 7)),
          updated_at:     safeDate(g('updated_at', 8)),
        });
        break;
      }

      // Anything else is COUNTED, never dropped on the floor.
      default:
        result.skipped[section] = (result.skipped[section] ?? 0) + 1;
        break;
    }
  }

  return result;
}

// ─── Validate ownership — email + phone must match a profile in the file ──────

export async function validateCSVOwnership(
  csvData: CSVBackupData,
  email: string,
  phone: string,
): Promise<{ valid: boolean; error: string | null }> {
  if (!csvData.profileRows || csvData.profileRows.length === 0) {
    return { valid: false, error: 'No profile found in this backup file.' };
  }

  const inputEmail = email.trim().toLowerCase();
  // Compare on the national number: the same user may be stored as
  // "9876543210" here and typed as "+91 98765 43210" (or vice versa), and
  // rejecting them over a country code would block the only migration route.
  const nationalNumber = (v: string) => {
    const digits = v.replace(/\D/g, '');
    return digits.length > 10 ? digits.slice(-10) : digits;
  };
  const inputPhone = nationalNumber(phone);

  const matched = csvData.profileRows.find(p =>
    p.email.toLowerCase() === inputEmail
  );

  if (!matched) {
    return { valid: false, error: `Email "${email}" was not found in this backup file.` };
  }

  if (inputPhone && matched.phone && nationalNumber(matched.phone) !== inputPhone) {
    return { valid: false, error: 'Phone number does not match this email in the backup file.' };
  }

  csvData.profile = matched;
  return { valid: true, error: null };
}

// ─── Import CSV data into local storage ──────────────────────────────────────
// Every store is cleared for the userId before writing — a clean restore, not a
// merge. Original IDs from the CSV are preserved so cross-references (e.g.
// lendr_expenses.group_id → lendr_groups.id) stay intact.

export interface CSVImportResult {
  imported: number;
  errors:   string[];
  /** Rows the reader could not place, by section. Total > 0 → tell the user. */
  skipped:  Record<string, number>;
}

export async function importCSVToIndexedDB(
  userId: string,
  csvData: CSVBackupData,
): Promise<CSVImportResult> {
  const errors: string[] = [];
  let imported = 0;
  const now = new Date().toISOString();

  /** Drop this user's existing rows in `store`, then write the CSV's rows. */
  async function replaceStore<T>(
    store: StoreName,
    rows: T[],
    builder: (row: T) => Record<string, unknown>,
  ): Promise<void> {
    if (rows.length === 0) return;
    try {
      const keyField = keyFieldFor(store);
      const existing = await getAllByIndex<Record<string, unknown>>(store, 'user_id', userId);
      for (const e of existing) {
        const key = e[keyField];
        if (typeof key === 'string') await remove(store, key);
      }
      await bulkPut(store, rows.map(builder));
      imported += rows.length;
    } catch (e: any) {
      errors.push(`${store}: ${e?.message ?? String(e)}`);
    }
  }

  // ── Transactions ─────────────────────────────────────────────────────────
  await replaceStore('transactions', csvData.transactionRows, r => ({
    id:               r.id || uuidv4(),
    user_id:          userId,
    transaction_date: r.transaction_date,
    type:             r.type || 'expense',
    category:         r.category,
    account:          r.account || 'upi',
    description:      r.description,
    amount:           r.amount,
    created_at:       r.created_at || now,
    updated_at:       r.updated_at || now,
  }));

  // ── Income details ────────────────────────────────────────────────────────
  // full_name / pan / hra / standard_deduction used to be hard-coded to null
  // here even though the file carries them. They are real columns now.
  await replaceStore('income_details', csvData.incomRows, r => ({
    id:                   r.id || uuidv4(),
    user_id:              userId,
    income_type:          r.income_type,
    monthly_salary:       r.monthly_salary,
    basic_salary:         r.basic_salary,
    other_allowances:     r.other_allowances,
    monthly_other_income: r.monthly_other_income,
    form_data:            r.form_data,
    full_name:            r.full_name,
    pan:                  r.pan,
    hra:                  r.hra,
    standard_deduction:   r.standard_deduction,
    created_at:           r.created_at || now,
    updated_at:           r.updated_at || now,
  }));

  // ── Income sources ────────────────────────────────────────────────────────
  await replaceStore('income_sources', csvData.incomeSourceRows, r => ({
    id:          r.id || uuidv4(),
    user_id:     userId,
    source_name: r.source_name,
    amount:      r.amount,
    frequency:   r.frequency,
    created_at:  r.created_at || now,
    updated_at:  r.updated_at || now,
  }));

  // ── Expense categories ────────────────────────────────────────────────────
  await replaceStore('expense_categories', csvData.expenseCategoryRows, r => ({
    id:            r.id || uuidv4(),
    user_id:       userId,
    category_name: r.category_name,
    category_type: r.category_type,
    frequency:     r.frequency,
    amount:        r.amount,
    created_at:    r.created_at || now,
    updated_at:    r.updated_at || now,
  }));

  // ── Investments ───────────────────────────────────────────────────────────
  await replaceStore('investment_types', csvData.investmentRows, r => ({
    id:              r.id || uuidv4(),
    user_id:         userId,
    investment_name: r.investment_name,
    investment_type: r.investment_type,
    amount:          r.amount,
    risk_level:      r.risk_level,
    interest_rate:   r.interest_rate,
    created_at:      r.created_at || now,
    updated_at:      r.updated_at || now,
  }));

  // ── Monthly budgets ───────────────────────────────────────────────────────
  await replaceStore('monthly_budgets', csvData.monthlyBudgetRows, r => ({
    id:                r.id || uuidv4(),
    user_id:           userId,
    budget_month:      r.budget_month,
    budget_start_date: r.budget_start_date,
    budget_end_date:   r.budget_end_date,
    fixed_budget:      r.fixed_budget,
    variable_budget:   r.variable_budget,
    total_budget:      r.total_budget,
    created_at:        r.created_at || now,
    updated_at:        r.updated_at || now,
  }));

  // ── Variable budget entries ───────────────────────────────────────────────
  await replaceStore('variable_budget_entries', csvData.variableBudgetEntryRows, r => ({
    id:               r.id || uuidv4(),
    user_id:          userId,
    budget_month:     r.budget_month,
    category_name:    r.category_name,
    allocated_amount: r.allocated_amount,
    notes:            r.notes,
    created_at:       r.created_at || now,
    updated_at:       r.updated_at || now,
  }));

  // ── Savings goals ─────────────────────────────────────────────────────────
  await replaceStore('savings_goals', csvData.savingsGoalRows, r => ({
    id:                   r.id || uuidv4(),
    user_id:              userId,
    goal_name:            r.goal_name,
    goal_amount:          r.goal_amount,
    target_months:        r.target_months,
    monthly_save_amount:  r.monthly_save_amount,
    weekly_save_amount:   r.weekly_save_amount,
    monthly_spend_amount: r.monthly_spend_amount,
    weekly_spend_amount:  r.weekly_spend_amount,
    created_at:           r.created_at || now,
    updated_at:           r.updated_at || now,
  }));

  // ── Udhar entries ─────────────────────────────────────────────────────────
  await replaceStore('udhar_entries', csvData.udharRows, r => ({
    id:           r.id || uuidv4(),
    user_id:      userId,
    type:         r.type,
    person_name:  r.person_name,
    lender_name:  r.lender_name,
    amount:       r.amount,
    due_date:     r.due_date,
    is_settled:   r.is_settled,
    phone_number: r.phone_number,
    description:  r.description,
    payments:     r.payments || [],
    amount_paid:  r.amount_paid,
    created_at:   r.created_at || now,
    updated_at:   r.updated_at || now,
  }));

  // ── Recall products ───────────────────────────────────────────────────────
  await replaceStore('recall_products', csvData.recallRows, r => ({
    id:                         r.id || uuidv4(),
    user_id:                    userId,
    name:                       r.name,
    category:                   r.category || 'other',
    brand:                      r.brand,
    model_number:               r.model_number,
    serial_number:              r.serial_number,
    purchase_date:              r.purchase_date,
    purchase_price:             r.purchase_price,
    purchased_from:             r.purchased_from,
    warranty_months:            r.warranty_months,
    warranty_expiry:            r.warranty_expiry,
    extended_warranty:          r.extended_warranty,
    extended_warranty_provider: r.extended_warranty_provider,
    extended_warranty_expiry:   r.extended_warranty_expiry,
    service_interval_months:    r.service_interval_months,
    last_service_date:          r.last_service_date,
    next_service_date:          r.next_service_date,
    service_centre_name:        r.service_centre_name,
    service_centre_phone:       r.service_centre_phone,
    service_history:            r.service_history || [],
    service_notes:              r.service_notes,
    notes:                      r.notes,
    warranty_note:              r.warranty_note,
    extended_warranty_note:     r.extended_warranty_note,
    additional_warranties:      r.additional_warranties || [],
    payment_mode:               r.payment_mode || 'full',
    amount_paid_upfront:        r.amount_paid_upfront,
    emi_enabled:                r.emi_enabled,
    emi_amount:                 r.emi_amount,
    emi_tenure_months:          r.emi_tenure_months,
    emi_start_date:             r.emi_start_date,
    emi_interest_rate:          r.emi_interest_rate,
    emi_bank_or_provider:       r.emi_bank_or_provider,
    emi_account_last4:          r.emi_account_last4,
    down_payment:               r.down_payment,
    insurance_provider:         r.insurance_provider,
    insurance_policy_number:    r.insurance_policy_number,
    insurance_renewal_date:     r.insurance_renewal_date,
    insurance_premium:          r.insurance_premium,
    emi_budget_added:           r.emi_budget_added,
    created_at:                 r.created_at || now,
    updated_at:                 r.updated_at || now,
  }));

  // ── User notifications (keyed on notification_id, not id) ─────────────────
  await replaceStore('user_notifications', csvData.userNotificationRows, r => ({
    user_id:         userId,
    notification_id: r.notification_id,
    seen_at:         r.seen_at || now,
  }));

  // ── Lendr groups & expenses ───────────────────────────────────────────────
  await replaceStore('lendr_groups', csvData.lendrGroupRows, r => ({
    id:         r.id || uuidv4(),
    user_id:    userId,
    name:       r.name,
    emoji:      r.emoji,
    members:    r.members || [],
    created_at: r.created_at || now,
    updated_at: r.updated_at || now,
  }));

  await replaceStore('lendr_expenses', csvData.lendrExpenseRows, r => ({
    id:                r.id || uuidv4(),
    group_id:          r.group_id,
    user_id:           userId,
    description:       r.description,
    total_amount:      r.total_amount,
    paid_by_member_id: r.paid_by_member_id,
    date:              r.date,
    splits:            r.splits || [],
    created_at:        r.created_at || now,
    updated_at:        r.updated_at || now,
  }));

  // ── AI tax planner ────────────────────────────────────────────────────────
  await replaceStore('ai_tax_planner_input', csvData.aiTaxPlannerInputRows, r => ({
    ...r,
    user_id:    userId,
    id:         r.id || uuidv4(),
    created_at: r.created_at || now,
    updated_at: r.updated_at || now,
  }));

  await replaceStore('ai_tax_planner_output', csvData.aiTaxPlannerOutputRows, r => ({
    id:                   r.id || uuidv4(),
    user_id:              userId,
    recommendations_json: r.recommendations_json,
    created_at:           r.created_at || now,
    updated_at:           r.updated_at || now,
  }));

  // ── Tax records ───────────────────────────────────────────────────────────
  await replaceStore('advance_tax_payments', csvData.advanceTaxPaymentRows, r => ({
    id:               r.id || uuidv4(),
    user_id:          userId,
    financial_year:   r.financial_year,
    installment:      r.installment,
    due_date:         r.due_date,
    estimated_amount: r.estimated_amount,
    paid_amount:      r.paid_amount,
    paid_date:        r.paid_date,
    is_paid:          r.is_paid,
    created_at:       r.created_at || now,
    updated_at:       r.updated_at || now,
  }));

  await replaceStore('capital_gains_entries', csvData.capitalGainsEntryRows, r => ({
    id:             r.id || uuidv4(),
    user_id:        userId,
    asset_type:     r.asset_type,
    asset_name:     r.asset_name,
    purchase_date:  r.purchase_date,
    sale_date:      r.sale_date,
    purchase_price: r.purchase_price,
    sale_price:     r.sale_price,
    quantity:       r.quantity,
    financial_year: r.financial_year,
    created_at:     r.created_at || now,
    updated_at:     r.updated_at || now,
  }));

  await replaceStore('tax_calendar_state', csvData.taxCalendarStateRows, r => ({
    id:                r.id || uuidv4(),
    user_id:           userId,
    financial_year:    r.financial_year,
    checked_event_ids: r.checked_event_ids || [],
    updated_at:        r.updated_at || now,
  }));

  await replaceStore('salary_restructuring', csvData.salaryRestructuringRows, r => ({
    ...r,
    id:         r.id || uuidv4(),
    user_id:    userId,
    updated_at: r.updated_at || now,
  }));

  await replaceStore('tds_entries', csvData.tdsEntryRows, r => ({
    id:             r.id || uuidv4(),
    user_id:        userId,
    financial_year: r.financial_year,
    deductor_name:  r.deductor_name,
    tds_section:    r.tds_section,
    income_type:    r.income_type,
    tds_amount:     r.tds_amount,
    income_amount:  r.income_amount,
    quarter:        r.quarter,
    form_type:      r.form_type,
    is_verified:    r.is_verified,
    created_at:     r.created_at || now,
    updated_at:     r.updated_at || now,
  }));

  await replaceStore('itr_checklist', csvData.itrChecklistRows, r => ({
    id:             r.id || uuidv4(),
    user_id:        userId,
    financial_year: r.financial_year,
    item_key:       r.item_key,
    category:       r.category,
    is_completed:   r.is_completed,
    notes:          r.notes,
    updated_at:     r.updated_at || now,
  }));

  // Writes are debounced. The UI navigates away the moment this resolves, so
  // force everything to disk before returning — otherwise a process kill in the
  // next 400ms loses the entire restore.
  try {
    await flush();
  } catch (e: any) {
    errors.push(`flush: ${e?.message ?? String(e)}`);
  }

  return { imported, errors, skipped: csvData.skipped };
}
