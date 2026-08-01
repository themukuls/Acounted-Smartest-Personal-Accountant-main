import type { MyDB } from '../db';
import { getAllByIndex, put } from '@/integrations/storage/repository';
import { v4 as uuidv4 } from 'uuid';

// ─── Types ────────────────────────────────────────────────────────────────────

type TaxPlannerInputValue = MyDB['ai_tax_planner_input']['value'];

// All numeric fields in the schema (used for safe-parsing)
const NUMERIC_FIELDS: Array<keyof TaxPlannerInputValue> = [
  'annual_gross_income',
  'other_income',
  'annual_rent_paid',
  'home_loan_principal',
  'home_loan_interest',
  'health_insurance_premiums',
  'education_loan_interest',
  'donations_80g',
  // New fields
  'business_turnover',
  'business_digital_percent',
  'professional_receipts',
  'rental_gross_receipts',
  'rental_municipal_taxes',
  'rental_home_loan_interest',
  'equity_stcg',
  'equity_ltcg',
  'other_ltcg',
  'other_stcg',
];

function safeParseNumeric(input: Partial<TaxPlannerInputValue>): Partial<TaxPlannerInputValue> {
  const safe = { ...input };
  NUMERIC_FIELDS.forEach((field) => {
    const val = safe[field];
    if (typeof val === 'string') {
      const parsed = parseFloat(val as string);
      (safe as any)[field] = isNaN(parsed) ? 0 : parsed;
    } else if (typeof val === 'number' && isNaN(val)) {
      (safe as any)[field] = 0;
    }
  });
  return safe;
}

/** Default record shape — every field has a safe zero/empty default.
 *  This ensures old records (pre-v5) still deserialise cleanly. */
function buildDefaultRecord(userId: string, now: string): TaxPlannerInputValue {
  return {
    id: uuidv4(),
    user_id: userId,
    created_at: now,
    updated_at: now,

    // Personal
    age_category: '',
    resident_status: '',
    city_of_residence: '',

    // Income stream flags
    active_income_streams: '["salary"]',

    // Salary
    employment_type: '',
    annual_gross_income: 0,
    annual_rent_paid: 0,

    // Business 44AD
    business_turnover: 0,
    business_digital_percent: 0,

    // Professional 44ADA
    professional_receipts: 0,
    profession_type: '',

    // Rental
    rental_gross_receipts: 0,
    rental_municipal_taxes: 0,
    rental_home_loan_interest: 0,

    // Capital gains
    equity_stcg: 0,
    equity_ltcg: 0,
    other_ltcg: 0,
    other_stcg: 0,

    // Other income
    other_income: 0,

    // Deductions
    home_loan_principal: 0,
    home_loan_interest: 0,
    tax_saving_investments: '',
    health_insurance_premiums: 0,
    education_loan_interest: 0,
    donations_80g: 0,

    // Preferences
    risk_appetite: '',
    liquidity_needs: '',
  };
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Fetches the AI Tax Planner input for a user.
 * Returns null if no record exists.
 * Old records missing new fields are back-filled with safe defaults.
 */
export async function getTaxPlannerInput(userId: string): Promise<TaxPlannerInputValue | null> {
  // Get ALL records for this user and find the one without a simulation_id
  // (simulation records have simulation_id set; the working record does not)
  const allRecords = await getAllByIndex<TaxPlannerInputValue>('ai_tax_planner_input', 'user_id', userId);
  const record = allRecords.find((r: any) => !r.simulation_id) ?? allRecords[0] ?? null;
  if (!record) return null;

  // Back-fill any fields that didn't exist in pre-v5 records
  const now = new Date().toISOString();
  const defaults = buildDefaultRecord(userId, now);
  return { ...defaults, ...record } as TaxPlannerInputValue;
}

/**
 * Saves or updates the AI Tax Planner input for a user.
 */
export async function saveTaxPlannerInput(
  userId: string,
  inputData: Partial<TaxPlannerInputValue>,
): Promise<TaxPlannerInputValue> {
  const now = new Date().toISOString();
  const safe = safeParseNumeric(inputData);

  // The old code used `index('user_id').get(userId)`, i.e. the first record on
  // the index for this user — mirrored here as the first match.
  const existing = (await getAllByIndex<TaxPlannerInputValue>('ai_tax_planner_input', 'user_id', userId))[0];
  let recordToSave: TaxPlannerInputValue;

  if (existing) {
    recordToSave = {
      ...buildDefaultRecord(userId, existing.created_at ?? now), // ensure all fields present
      ...existing,
      ...safe,
      user_id: userId,
      updated_at: now,
    };
  } else {
    recordToSave = {
      ...buildDefaultRecord(userId, now),
      ...safe,
      user_id: userId,
    };
  }

  await put('ai_tax_planner_input', recordToSave);
  return recordToSave;
}

// ─── Output (unchanged) ───────────────────────────────────────────────────────

export async function getTaxPlannerOutput(
  userId: string,
): Promise<MyDB['ai_tax_planner_output']['value'] | null> {
  // Get ALL records and return only the working record (no simulation_id)
  const allRecords = await getAllByIndex<MyDB['ai_tax_planner_output']['value']>(
    'ai_tax_planner_output', 'user_id', userId,
  );
  const record = allRecords.find((r: any) => !r.simulation_id) ?? null;
  // If no non-simulation record exists, return null (don't return a simulation record)
  return record || null;
}

export async function saveTaxPlannerOutput(
  userId: string,
  recommendationsJson: any,
): Promise<MyDB['ai_tax_planner_output']['value']> {
  const now = new Date().toISOString();
  // Only find the working record (no simulation_id)
  const allRecords = await getAllByIndex<MyDB['ai_tax_planner_output']['value']>(
    'ai_tax_planner_output', 'user_id', userId,
  );
  const existing = allRecords.find((r: any) => !r.simulation_id) ?? null;
  let recordToSave: MyDB['ai_tax_planner_output']['value'];

  if (existing) {
    recordToSave = { ...existing, recommendations_json: recommendationsJson, user_id: userId, updated_at: now };
  } else {
    recordToSave = { id: uuidv4(), user_id: userId, created_at: now, updated_at: now, recommendations_json: recommendationsJson };
  }

  await put('ai_tax_planner_output', recordToSave);
  return recordToSave;
}
