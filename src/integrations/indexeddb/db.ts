import { openDB, IDBPDatabase, DBSchema } from 'idb';

// Define your database schema
export interface MyDB extends DBSchema {
  profiles: {
    key: string; // user_id
    value: {
      id: string;
      email: string;
      phone: string;
      pin_hash: string;         // bcrypt hash of 4-digit PIN
      display_name: string;     // optional — set during onboarding
      onboarding_completed: boolean;
      created_at: string;
      updated_at: string;
    };
    indexes: { 'email': string; 'phone': string };
  };
  income_details: {
    key: string; // id
    value: {
      id: string;
      user_id: string;
      income_type: string; // Comma-separated string
      monthly_salary: number | null;
      basic_salary: number | null;
      other_allowances: number | null;
      monthly_other_income: number | null;
      form_data: any | null; // JSON object
      full_name: string | null;
      pan: string | null;
      hra: number | null;
      standard_deduction: number | null;
      created_at: string;
      updated_at: string;
    };
    indexes: { 'user_id': string };
  };
  income_sources: {
    key: string; // id
    value: {
      id: string;
      user_id: string;
      source_name: string;
      amount: number;
      frequency: string;
      created_at: string;
      updated_at: string;
    };
    indexes: { 'user_id': string };
  };
  expense_categories: {
    key: string; // id
    value: {
      id: string;
      user_id: string;
      category_name: string;
      amount: number;
      frequency: string;
      category_type: string;
      created_at: string;
      updated_at: string;
    };
    indexes: { 'user_id': string; 'category_name': string };
  };
  investment_types: {
    key: string; // id
    value: {
      id: string;
      user_id: string;
      investment_name: string;
      amount: number;
      investment_type: string;
      risk_level: string;
      interest_rate: number | null;
      created_at: string;
      updated_at: string;
    };
    indexes: { 'user_id': string };
  };
  monthly_budgets: {
    key: string; // id
    value: {
      id: string;
      user_id: string;
      budget_month: string; // YYYY-MM format
      budget_start_date: string | null;
      budget_end_date: string | null;
      fixed_budget: number;
      variable_budget: number;
      total_budget: number | null;
      created_at: string;
      updated_at: string;
    };
    indexes: { 'user_id': string; 'budget_month': string };
  };
  savings_goals: {
    key: string; // id
    value: {
      id: string;
      user_id: string;
      goal_name: string;
      goal_amount: number;
      target_months: number;
      monthly_save_amount: number | null;
      weekly_save_amount: number | null;
      monthly_spend_amount: number | null;
      weekly_spend_amount: number | null;
      created_at: string;
      updated_at: string;
    };
    indexes: { 'user_id': string };
  };
  transactions: {
    key: string; // id
    value: {
      id: string;
      user_id: string;
      type: string; // 'income' or 'expense'
      amount: number;
      category: string;
      account: string;
      description: string | null;
      transaction_date: string; // ISO string
      // Present only for expenses created from Android payment capture. These
      // fields make reconciliation idempotent across retries and app/SMS input.
      capture_payment_id?: string;
      capture_reference?: string | null;
      capture_merchant?: string | null;
      capture_source?: string;
      created_at: string;
      updated_at: string;
    };
    indexes: { 'user_id': string; 'transaction_date': string; 'type': string };
  };
  variable_budget_entries: {
    key: string; // id
    value: {
      id: string;
      user_id: string;
      budget_month: string; // YYYY-MM-DD_YYYY-MM-DD format
      category_name: string;
      allocated_amount: number;
      notes: string | null;
      created_at: string;
      updated_at: string;
    };
    indexes: { 'user_id': string; 'budget_month': string };
  };
  ai_tax_planner_input: {
    key: string; // id
    value: {
      id: string;
      user_id: string;

      // ── Personal ──────────────────────────────────────────────
      age_category: string;
      resident_status: string;
      city_of_residence: string;

      // ── Income stream flags (which streams are active) ────────
      // Stored as a JSON string: e.g. '["salary","business"]'
      active_income_streams: string;

      // ── Salary / Pension stream ───────────────────────────────
      employment_type: string;            // salaried | pensioner | none
      annual_gross_income: number;        // gross salary / pension
      annual_rent_paid: number;           // for HRA exemption

      // ── Business stream (Section 44AD) ────────────────────────
      business_turnover: number;          // annual turnover
      business_digital_percent: number;   // % receipts via digital (>=95% → 6% rate, else 8%)

      // ── Professional / Freelancer stream (Section 44ADA) ──────
      professional_receipts: number;      // gross receipts
      profession_type: string;            // doctor | lawyer | engineer | architect | ca | consultant | other

      // ── Rental income stream ──────────────────────────────────
      rental_gross_receipts: number;      // gross annual rent received
      rental_municipal_taxes: number;     // municipal taxes paid on let-out property
      rental_home_loan_interest: number;  // home loan interest on let-out property (no cap)

      // ── Capital gains stream ──────────────────────────────────
      equity_stcg: number;                // equity STCG (taxed @20%)
      equity_ltcg: number;                // equity LTCG above ₹1.25L (taxed @12.5%)
      other_ltcg: number;                 // other LTCG (property, gold etc. @12.5%)
      other_stcg: number;                 // other STCG (added to slab income)

      // ── Other income ──────────────────────────────────────────
      other_income: number;               // FD interest, savings interest, dividends etc.

      // ── Deductions (Old Regime) ───────────────────────────────
      home_loan_principal: number;        // principal (u/s 80C / Sec 123)
      home_loan_interest: number;         // interest on self-occupied property (u/s 24b)
      tax_saving_investments: string;     // PPF, ELSS, NPS etc. as "PPF:50000, ELSS:20000"
      health_insurance_premiums: number;  // u/s 80D
      education_loan_interest: number;    // u/s 80E
      donations_80g: number;              // u/s 80G

      // ── Preferences ───────────────────────────────────────────
      risk_appetite: string;
      liquidity_needs: string;

      created_at: string;
      updated_at: string;
    };
    indexes: { 'user_id': string };
  };
  ai_tax_planner_output: {
    key: string; // id
    value: {
      id: string;
      user_id: string;
      recommendations_json: any; // JSON object
      created_at: string;
      updated_at: string;
    };
    indexes: { 'user_id': string };
  };
  user_notifications: {
    key: string; // notification_id
    value: {
      user_id: string;
      notification_id: string;
      seen_at: string; // ISO string
    };
    indexes: { 'user_id': string; 'notification_id': string };
  };
  udhar_entries: {
    key: string; // id
    value: {
      id: string;
      user_id: string;
      type: 'given' | 'taken';
      person_name: string | null;
      lender_name: string | null;
      amount: number;
      due_date: string;
      is_settled: boolean;
      phone_number: string;
      description: string | null;
      // ── Partial payment tracking ──────────────────────────────
      payments: Array<{
        id: string;
        amount: number;
        date: string;
        note: string;
      }>;
      amount_paid: number;   // sum of all payments — outstanding = amount - amount_paid
      created_at: string;
      updated_at: string;
    };
    indexes: { 'user_id': string; 'type': string; 'due_date': string };
  };
  lendr_groups: {
    key: string;
    value: {
      id: string;
      user_id: string;
      name: string;
      emoji: string;
      members: Array<{ id: string; name: string; phone: string }>;
      created_at: string;
      updated_at: string;
    };
    indexes: { 'user_id': string };
  };
  lendr_expenses: {
    key: string;
    value: {
      id: string;
      group_id: string;
      user_id: string;
      description: string;
      total_amount: number;
      paid_by_member_id: string;
      date: string;
      splits: Array<{ member_id: string; amount: number; is_settled: boolean }>;
      created_at: string;
      updated_at: string;
    };
    indexes: { 'group_id': string; 'user_id': string };
  };
  recall_products: {
    key: string;
    value: {
      id: string;
      user_id: string;
      name: string;
      category: 'electronics' | 'appliance' | 'vehicle' | 'furniture' | 'other';
      brand: string;
      model_number: string;
      serial_number: string;
      purchase_date: string;
      purchase_price: number;
      purchased_from: string;
      warranty_months: number;          // 0 = no warranty
      warranty_expiry: string | null;   // auto-calculated
      extended_warranty: boolean;
      extended_warranty_provider: string;
      extended_warranty_expiry: string | null;
      service_interval_months: number;  // 0 = no service tracking
      last_service_date: string | null;
      next_service_date: string | null;
      service_centre_name: string;
      service_centre_phone: string;
      service_history: Array<{
        id: string;
        date: string;
        description: string;
        cost: number;
      }>;
      service_notes: string;           // free notes for service step
      notes: string;                   // general product notes
      warranty_note: string;           // notes for main warranty
      extended_warranty_note: string;  // notes for extended warranty
      additional_warranties: Array<{   // part-specific warranties
        id: string;
        name: string;                  // e.g. "Compressor", "Panel"
        months: number;
        expiry: string | null;
        note: string;
      }>;

      // ── Payment & EMI ───────────────────────────────────────────────────
      payment_mode: 'full' | 'emi' | 'loan' | 'bnpl';
      amount_paid_upfront: number;        // full payment or down payment
      emi_enabled: boolean;
      emi_amount: number;                 // per month instalment
      emi_tenure_months: number;          // total number of EMIs
      emi_start_date: string | null;      // date of first EMI
      emi_interest_rate: number;          // annual % (0 = zero-cost EMI)
      emi_bank_or_provider: string;       // e.g. "HDFC Credit Card"
      emi_account_last4: string;          // last 4 digits of card/account
      down_payment: number;               // upfront amount before EMIs

      // ── Insurance ──────────────────────────────────────────────────────
      insurance_provider: string;
      insurance_policy_number: string;
      insurance_renewal_date: string | null;
      insurance_premium: number;
      emi_budget_added: boolean;   // true once user has been prompted to add EMI to budget

      created_at: string;
      updated_at: string;
    };
    indexes: { 'user_id': string };
  };
  advance_tax_payments: {
    key: string;
    value: {
      id: string;
      user_id: string;
      financial_year: string;
      installment: 'Q1' | 'Q2' | 'Q3' | 'Q4';
      due_date: string;
      estimated_amount: number;
      paid_amount: number;
      paid_date: string | null;
      is_paid: boolean;
      created_at: string;
      updated_at: string;
    };
    indexes: { 'user_id': string; 'financial_year': string };
  };
  capital_gains_entries: {
    key: string;
    value: {
      id: string;
      user_id: string;
      asset_type: string;
      asset_name: string;
      purchase_date: string;
      sale_date: string | null;
      purchase_price: number;
      sale_price: number | null;
      quantity: number;
      financial_year: string;
      created_at: string;
      updated_at: string;
    };
    indexes: { 'user_id': string; 'financial_year': string };
  };
  tax_calendar_state: {
    key: string;
    value: {
      id: string;
      user_id: string;
      financial_year: string;
      checked_event_ids: string[];  // array of ticked deadline IDs
      updated_at: string;
    };
    indexes: { 'user_id': string; 'financial_year': string };
  };
  salary_restructuring: {
    key: string;
    value: {
      id: string;
      user_id: string;
      // Salary components
      gross_ctc: number;
      basic: number;
      hra: number;
      lta: number;
      special_allowance: number;
      nps_employer: number;
      other_allowances: number;
      // Tax inputs
      regime: 'old' | 'new';
      rent_paid_annual: number;
      city: 'metro' | 'non-metro';
      sec80c: number;
      sec80d: number;
      sec80ccd1b: number;
      home_loan_interest: number;
      other_deductions: number;
      updated_at: string;
    };
    indexes: { 'user_id': string };
  };
  tds_entries: {
    key: string;
    value: {
      id: string;
      user_id: string;
      financial_year: string;
      deductor_name: string;
      tds_section: string;
      income_type: string;
      tds_amount: number;
      income_amount: number;
      quarter: 'Q1' | 'Q2' | 'Q3' | 'Q4';
      form_type: string;
      is_verified: boolean;
      created_at: string;
      updated_at: string;
    };
    indexes: { 'user_id': string; 'financial_year': string };
  };
  itr_checklist: {
    key: string;
    value: {
      id: string;
      user_id: string;
      financial_year: string;
      item_key: string;
      category: string;
      is_completed: boolean;
      notes: string | null;
      updated_at: string;
    };
    indexes: { 'user_id': string; 'financial_year': string };
  };
  // Remembered tax classifications — once a user confirms "LIC → 80C" we
  // store it so the classifier never has to ask again. Keyed by normalised
  // text so the same phrasing routes instantly on the next entry.
  learned_tax_mappings: {
    key: string; // `${user_id}::${text_key}`
    value: {
      id: string;
      user_id: string;
      text_key: string;   // normalised description/keyword the user mapped
      bucket_id: string;  // tax-bucket id from the taxonomy
      created_at: string;
      updated_at: string;
    };
    indexes: { 'user_id': string };
  };
  payment_merchant_mappings: {
    key: string; // `${user_id}::${source_package}::${merchant_key}`
    value: {
      id: string;
      user_id: string;
      merchant_key: string;
      display_name: string;
      source_package: string;
      category: string;
      account: string;
      note: string;
      confirmations: number;
      last_amount: number;
      created_at: string;
      updated_at: string;
    };
    indexes: { 'user_id': string };
  };
}

const DB_NAME = 'vidhence-db';
const DB_VERSION = 12; // Bumped: remembered payment-merchant defaults

let db: IDBPDatabase<MyDB>;

export async function getDb(): Promise<IDBPDatabase<MyDB>> {
  if (!db) {
    db = await openDB<MyDB>(DB_NAME, DB_VERSION, {
      upgrade(db, oldVersion, newVersion, transaction) {
        console.log(`IndexedDB upgrade from version ${oldVersion} to ${newVersion}`);

        if (oldVersion < 1) {
          const profilesStore = db.createObjectStore('profiles', { keyPath: 'id' });
          profilesStore.createIndex('email', 'email', { unique: true });
          profilesStore.createIndex('phone', 'phone', { unique: false });

          const incomeDetailsStore = db.createObjectStore('income_details', { keyPath: 'id' });
          incomeDetailsStore.createIndex('user_id', 'user_id', { unique: false });

          const incomeSourcesStore = db.createObjectStore('income_sources', { keyPath: 'id' });
          incomeSourcesStore.createIndex('user_id', 'user_id', { unique: false });

          const expenseCategoriesStore = db.createObjectStore('expense_categories', { keyPath: 'id' });
          expenseCategoriesStore.createIndex('user_id', 'user_id', { unique: false });
          expenseCategoriesStore.createIndex('category_name', 'category_name', { unique: false });

          const investmentTypesStore = db.createObjectStore('investment_types', { keyPath: 'id' });
          investmentTypesStore.createIndex('user_id', 'user_id', { unique: false });

          const monthlyBudgetsStore = db.createObjectStore('monthly_budgets', { keyPath: 'id' });
          monthlyBudgetsStore.createIndex('user_id', 'user_id', { unique: false });
          monthlyBudgetsStore.createIndex('budget_month', 'budget_month', { unique: false });

          const savingsGoalsStore = db.createObjectStore('savings_goals', { keyPath: 'id' });
          savingsGoalsStore.createIndex('user_id', 'user_id', { unique: false });

          const transactionsStore = db.createObjectStore('transactions', { keyPath: 'id' });
          transactionsStore.createIndex('user_id', 'user_id', { unique: false });
          transactionsStore.createIndex('transaction_date', 'transaction_date', { unique: false });
          transactionsStore.createIndex('type', 'type', { unique: false });

          const variableBudgetEntriesStore = db.createObjectStore('variable_budget_entries', { keyPath: 'id' });
          variableBudgetEntriesStore.createIndex('user_id', 'user_id', { unique: false });
          variableBudgetEntriesStore.createIndex('budget_month', 'budget_month', { unique: false });

          const aiTaxPlannerInputStore = db.createObjectStore('ai_tax_planner_input', { keyPath: 'id' });
          aiTaxPlannerInputStore.createIndex('user_id', 'user_id', { unique: false });

          const aiTaxPlannerOutputStore = db.createObjectStore('ai_tax_planner_output', { keyPath: 'id' });
          aiTaxPlannerOutputStore.createIndex('user_id', 'user_id', { unique: false });
        }
        if (oldVersion < 2) {
          const userNotificationsStore = db.createObjectStore('user_notifications', { keyPath: 'notification_id' });
          userNotificationsStore.createIndex('user_id', 'user_id', { unique: false });
        }
        if (oldVersion < 3) {
          const udharEntriesStore = db.createObjectStore('udhar_entries', { keyPath: 'id' });
          udharEntriesStore.createIndex('user_id', 'user_id', { unique: false });
          udharEntriesStore.createIndex('type', 'type', { unique: false });
          udharEntriesStore.createIndex('due_date', 'due_date', { unique: false });
        }
        if (oldVersion < 4) {
          const advanceTaxStore = db.createObjectStore('advance_tax_payments', { keyPath: 'id' });
          advanceTaxStore.createIndex('user_id', 'user_id', { unique: false });
          advanceTaxStore.createIndex('financial_year', 'financial_year', { unique: false });

          const capitalGainsStore = db.createObjectStore('capital_gains_entries', { keyPath: 'id' });
          capitalGainsStore.createIndex('user_id', 'user_id', { unique: false });
          capitalGainsStore.createIndex('financial_year', 'financial_year', { unique: false });

          const tdsEntriesStore = db.createObjectStore('tds_entries', { keyPath: 'id' });
          tdsEntriesStore.createIndex('user_id', 'user_id', { unique: false });
          tdsEntriesStore.createIndex('financial_year', 'financial_year', { unique: false });

          const itrChecklistStore = db.createObjectStore('itr_checklist', { keyPath: 'id' });
          itrChecklistStore.createIndex('user_id', 'user_id', { unique: false });
          itrChecklistStore.createIndex('financial_year', 'financial_year', { unique: false });
        }
        if (oldVersion < 5) {
          console.log('[DB v5] ai_tax_planner_input expanded — new fields handled by service layer defaults.');
        }
        if (oldVersion < 6) {
          console.log('[DB v6] profiles migrated to PIN auth — pin_hash/display_name replace password/name fields.');
        }
        if (oldVersion < 7) {
          const lendrGroupsStore = db.createObjectStore('lendr_groups', { keyPath: 'id' });
          lendrGroupsStore.createIndex('user_id', 'user_id', { unique: false });

          const lendrExpensesStore = db.createObjectStore('lendr_expenses', { keyPath: 'id' });
          lendrExpensesStore.createIndex('group_id', 'group_id', { unique: false });
          lendrExpensesStore.createIndex('user_id', 'user_id', { unique: false });

          console.log('[DB v7] lendr_groups + lendr_expenses stores created.');
        }
        if (oldVersion < 8) {
          const recallStore = db.createObjectStore('recall_products', { keyPath: 'id' });
          recallStore.createIndex('user_id', 'user_id', { unique: false });
          console.log('[DB v8] recall_products store created.');
        }
        if (oldVersion < 9) {
          console.log('[DB v9] udhar_entries payment tracking fields added (schema-level only).');
        }
        if (oldVersion < 10) {
          const calStore = db.createObjectStore('tax_calendar_state', { keyPath: 'id' });
          calStore.createIndex('user_id', 'user_id', { unique: false });
          calStore.createIndex('financial_year', 'financial_year', { unique: false });

          const salaryStore = db.createObjectStore('salary_restructuring', { keyPath: 'id' });
          salaryStore.createIndex('user_id', 'user_id', { unique: false });

          console.log('[DB v10] tax_calendar_state + salary_restructuring stores created.');
        }
        if (oldVersion < 11) {
          const learnedStore = db.createObjectStore('learned_tax_mappings', { keyPath: 'id' });
          learnedStore.createIndex('user_id', 'user_id', { unique: false });
          console.log('[DB v11] learned_tax_mappings store created.');
        }
        if (oldVersion < 12) {
          const merchantStore = db.createObjectStore('payment_merchant_mappings', { keyPath: 'id' });
          merchantStore.createIndex('user_id', 'user_id', { unique: false });
          console.log('[DB v12] payment_merchant_mappings store created.');
        }
      },
    });
  }
  return db;
}
