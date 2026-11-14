/**
 * stores.ts — the store catalogue, derived 1:1 from
 * `src/integrations/indexeddb/db.ts` (schema version 12).
 *
 * Nothing here is invented. If a store is added to db.ts it must be added here
 * too, otherwise `StoreName` will reject it at compile time — which is the
 * point: a typo in a store name used to create a silent second IndexedDB
 * object store; here it is a build error.
 */

/**
 * Every object store in the IndexedDB schema, in db.ts declaration order.
 * 24 stores as of DB_VERSION 12.
 */
export const STORE_NAMES = [
  'profiles',
  'income_details',
  'income_sources',
  'expense_categories',
  'investment_types',
  'monthly_budgets',
  'savings_goals',
  'transactions',
  'variable_budget_entries',
  'ai_tax_planner_input',
  'ai_tax_planner_output',
  'user_notifications',
  'udhar_entries',
  'lendr_groups',
  'lendr_expenses',
  'recall_products',
  'advance_tax_payments',
  'capital_gains_entries',
  'tax_calendar_state',
  'salary_restructuring',
  'tds_entries',
  'itr_checklist',
  'learned_tax_mappings',
  'payment_merchant_mappings',
] as const;

export type StoreName = (typeof STORE_NAMES)[number];

/**
 * The primary-key field for each store — the old `createObjectStore(..., { keyPath })`.
 *
 * Every store keys on `id` except `user_notifications`, which keys on
 * `notification_id` (it has no `id` field at all — see db.ts line ~214).
 */
export const STORE_KEY_FIELDS: Record<StoreName, string> = {
  profiles: 'id',
  income_details: 'id',
  income_sources: 'id',
  expense_categories: 'id',
  investment_types: 'id',
  monthly_budgets: 'id',
  savings_goals: 'id',
  transactions: 'id',
  variable_budget_entries: 'id',
  ai_tax_planner_input: 'id',
  ai_tax_planner_output: 'id',
  user_notifications: 'notification_id',
  udhar_entries: 'id',
  lendr_groups: 'id',
  lendr_expenses: 'id',
  recall_products: 'id',
  advance_tax_payments: 'id',
  capital_gains_entries: 'id',
  tax_calendar_state: 'id',
  salary_restructuring: 'id',
  tds_entries: 'id',
  itr_checklist: 'id',
  learned_tax_mappings: 'id',
  payment_merchant_mappings: 'id',
};

/** The key field for a store. */
export function keyFieldFor(store: StoreName): string {
  return STORE_KEY_FIELDS[store];
}

/** Runtime guard, for the few places that receive a store name as a string. */
export function isStoreName(value: string): value is StoreName {
  return (STORE_NAMES as readonly string[]).includes(value);
}
