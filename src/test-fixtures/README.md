# Legacy Android backup CSV — format contract

`legacy-android-backup.csv` is a synthetic but **format-exact** reproduction of what the
old native Kotlin app (`acounted-android`) writes when the user taps *Backup*. It is the
file real users bring with them when migrating to this web/PWA app.

Source of truth for everything below:

- `app/src/main/java/com/acounted/app/data/backup/Csv.kt` — escaping, number/bool/date encoders
- `app/src/main/java/com/acounted/app/data/backup/BackupCodecs.kt` — `object BackupSections`, per-section `COLUMNS` + `encode()`
- `app/src/main/java/com/acounted/app/data/backup/BackupRepository.kt` — `exportCsv()` / `appendSection()`
- `app/src/main/java/com/acounted/app/data/entity/*.kt` — column types

The reader in this repo is `src/integrations/indexeddb/utils/csvRestore.ts`.

---

## 1. File structure

There is **no header comment, no BOM, no preamble.** The file starts immediately with
`section,profiles`. From `BackupRepository.appendSection`:

```kotlin
private fun appendSection(sb: StringBuilder, name: String, columns: List<String>, rows: List<List<String>>) {
    sb.append("section,").append(name).append('\n')
    sb.append(Csv.encodeRow(listOf("columns") + columns)).append('\n')
    val tag = name.uppercase()
    for (row in rows) sb.append(Csv.encodeRow(listOf(tag) + row)).append('\n')
    sb.append('\n')
}
```

So each section is:

```
section,<lowercase_section_name>
columns,<col0>,<col1>,...
<UPPERCASE_SECTION_NAME>,<val0>,<val1>,...
<UPPERCASE_SECTION_NAME>,<val0>,<val1>,...
<blank line>
```

- Line separator is `\n` (LF). Both parsers normalise `\r\n` and `\r`.
- **All 22 sections are always emitted**, even when they have zero rows — you still get the
  `section,` and `columns,` lines followed by a blank line. Only `profiles` can be absent
  entirely (`profileDao.getById(userId)?.let { ... }`).
- Data-row tag is always `name.uppercase()`, e.g. `income_details` → `INCOME_DETAILS`.
- Sections are written in a fixed order (see §3).

## 2. Value encoding (`Csv.kt`)

| Concern | Rule | Code |
|---|---|---|
| Quoting | Field is quoted **only if** it contains `,` `"` `\n` or `\r`. Inner `"` doubled. | `Csv.escape` |
| Nulls / empties | Written as the **empty string** (zero-length field), never `null`, never `NULL`. | `e.description ?: ""`, `numN()` |
| Booleans | Literally `true` / `false`. | `Csv.boolToStr` |
| Numbers | Integral doubles → no decimal point (`2500`); non-integral → plain decimal, trailing zeros stripped (`2450.5`). No thousands separators, no `₹`. Nullable numbers that are null → `""`. | `Csv.numToStr`, `numN` |
| Ints | `Int.toString()` (`warranty_months`, `emi_tenure_months`, `service_interval_months`, `target_months`). | |
| Nested arrays | kotlinx JSON, `encodeDefaults = true` (so default fields like `note: ""` are always present), doubles rendered as `4000.0`. Empty list → `[]`. Contains `,` and `"` so it is always quoted+escaped. | `encodeJson`, `Converters.json` |
| Raw JSON strings | `income_details.form_data` and `ai_tax_planner_output.recommendations_json` are stored as opaque strings and written verbatim. | |

### Dates — two distinct kinds

**(a) Timestamp columns** go through `Csv.isoToBackup`, which emits
**`yyyy-MM-dd HH:mm`** — local wall-clock in the **device timezone** (IST for these users),
**with no offset, no seconds, no `Z`**:

```kotlin
private val shortStamp: DateTimeFormatter = DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm")
fun isoToBackup(v: String?): String {
    if (v.isNullOrBlank()) return ""
    val instant = parseFlexible(v) ?: return v.trim()
    return shortStamp.format(LocalDateTime.ofInstant(instant, zone))
}
```

Applies to: every `created_at` / `updated_at`, `transactions.transaction_date`,
`user_notifications.seen_at`, `monthly_budgets.budget_start_date` / `budget_end_date`.
Seconds are **truncated** — sub-minute ordering is not recoverable.

**(b) Plain date columns** are entity `String`s written **verbatim, unformatted** —
in practice `YYYY-MM-DD` from the pickers:
`udhar_entries.due_date`, `recall_products.purchase_date` / `warranty_expiry` /
`extended_warranty_expiry` / `last_service_date` / `next_service_date` / `emi_start_date` /
`insurance_renewal_date`, `lendr_expenses.date`, `advance_tax_payments.due_date` /
`paid_date`, `capital_gains_entries.purchase_date` / `sale_date`.

JS `new Date("2026-07-05T19:24")` treats an offset-less date-time as **local time**, so a
restore in IST round-trips correctly; restoring in a different timezone shifts every
timestamp.

### Known limitation shared by both sides

`Csv.escape` will quote a field containing `\n`, but **neither** `Csv.parseLine` (Kotlin)
nor `parseCSVLine` (TS) supports records spanning physical lines — both split on `\n`
*before* parsing. A multi-line `notes` / `description` corrupts the file for both apps.

Both parsers also `.trim()` every field after unquoting, so leading/trailing spaces inside
values are lost.

## 3. Section order and column order (exact)

Order as written by `exportCsv()`. `[!]` marks a section `csvRestore.ts` does **not** handle.

| # | `section,` name | Row tag | Columns (in order) |
|---|---|---|---|
| 1 | `profiles` | `PROFILES` | id, email, phone, pin_hash, display_name, onboarding_completed, created_at, updated_at |
| 2 | `transactions` | `TRANSACTIONS` | id, user_id, **created_at, updated_at, type, amount, category, account, description, transaction_date** |
| 3 | `income_details` | `INCOME_DETAILS` | id, user_id, income_type, monthly_salary, basic_salary, other_allowances, **monthly_other_income, form_data, full_name, pan, hra, standard_deduction, created_at, updated_at** |
| 4 | `income_sources` `[!]` | `INCOME_SOURCES` | id, user_id, source_name, amount, frequency, created_at, updated_at |
| 5 | `expense_categories` | `EXPENSE_CATEGORIES` | id, user_id, category_name, category_type, frequency, amount, created_at, updated_at |
| 6 | `investment_types` | `INVESTMENT_TYPES` | id, user_id, investment_name, investment_type, amount, risk_level, interest_rate, created_at, updated_at |
| 7 | `monthly_budgets` | `MONTHLY_BUDGETS` | id, user_id, budget_month, budget_start_date, budget_end_date, fixed_budget, variable_budget, total_budget, created_at, updated_at |
| 8 | `variable_budget_entries` `[!]` | `VARIABLE_BUDGET_ENTRIES` | id, user_id, created_at, updated_at, budget_month, category_name, allocated_amount, notes |
| 9 | `savings_goals` `[!]` | `SAVINGS_GOALS` | id, user_id, goal_name, goal_amount, target_months, monthly_save_amount, weekly_save_amount, monthly_spend_amount, weekly_spend_amount, created_at, updated_at |
| 10 | `udhar_entries` | `UDHAR_ENTRIES` | id, user_id, created_at, updated_at, type, person_name, lender_name, amount, due_date, is_settled, phone_number, description, payments, amount_paid |
| 11 | `recall_products` | `RECALL_PRODUCTS` | 44 columns — see below |
| 12 | `user_notifications` | `USER_NOTIFICATIONS` | user_id, notification_id, seen_at |
| 13 | `lendr_groups` `[!]` | `LENDR_GROUPS` | id, user_id, name, emoji, members, created_at, updated_at |
| 14 | `lendr_expenses` `[!]` | `LENDR_EXPENSES` | id, group_id, user_id, description, total_amount, paid_by_member_id, date, splits, created_at, updated_at |
| 15 | `ai_tax_planner_input` `[!]` | `AI_TAX_PLANNER_INPUT` | 31 columns (see `BackupCodecs.kt`) |
| 16 | `ai_tax_planner_output` `[!]` | `AI_TAX_PLANNER_OUTPUT` | id, user_id, recommendations_json, created_at, updated_at |
| 17 | `advance_tax_payments` `[!]` | `ADVANCE_TAX_PAYMENTS` | id, user_id, financial_year, installment, due_date, estimated_amount, paid_amount, paid_date, is_paid, created_at, updated_at |
| 18 | `capital_gains_entries` `[!]` | `CAPITAL_GAINS_ENTRIES` | id, user_id, asset_type, asset_name, purchase_date, sale_date, purchase_price, sale_price, quantity, financial_year, created_at, updated_at |
| 19 | `tax_calendar_state` `[!]` | `TAX_CALENDAR_STATE` | id, user_id, financial_year, checked_event_ids, updated_at |
| 20 | `salary_restructuring` `[!]` | `SALARY_RESTRUCTURING` | id, user_id, gross_ctc, basic, hra, lta, special_allowance, nps_employer, other_allowances, regime, rent_paid_annual, city, sec80c, sec80d, sec80ccd1b, home_loan_interest, other_deductions, updated_at |
| 21 | `tds_entries` `[!]` | `TDS_ENTRIES` | id, user_id, financial_year, deductor_name, tds_section, income_type, tds_amount, income_amount, quarter, form_type, is_verified, created_at, updated_at |
| 22 | `itr_checklist` `[!]` | `ITR_CHECKLIST` | id, user_id, financial_year, item_key, category, is_completed, notes, updated_at |

`recall_products` columns (1-indexed relative to `cols[]` in `csvRestore.ts`, where
`cols[0]` is the row tag):

```
1 id                          16 service_interval_months     31 emi_tenure_months
2 user_id                     17 last_service_date           32 emi_start_date
3 name                        18 next_service_date           33 emi_interest_rate
4 category                    19 service_centre_name         34 emi_bank_or_provider
5 brand                       20 service_centre_phone        35 emi_account_last4
6 model_number                21 service_history (JSON)      36 down_payment
7 serial_number               22 service_notes               37 insurance_provider
8 purchase_date               23 notes                       38 insurance_policy_number
9 purchase_price              24 warranty_note               39 insurance_renewal_date
10 purchased_from             25 extended_warranty_note      40 insurance_premium
11 warranty_months            26 additional_warranties (JSON)41 emi_budget_added
12 warranty_expiry            27 payment_mode                42 created_at
13 extended_warranty          28 amount_paid_upfront         43 updated_at
14 extended_warranty_provider 29 emi_enabled                 44 extended_warranty_months
15 extended_warranty_expiry   30 emi_amount                     (always "" — write-only pad)
```

`csvRestore.ts` reads 1–43 and correctly ignores 44.

## 4. Nested JSON shapes (`JsonModels.kt`)

```kotlin
UdharPayment(id: String, amount: Double, date: String, note: String = "")
RecallServiceRecord(id: String, date: String, description: String = "", cost: Double = 0.0)
RecallAdditionalWarranty(id: String, name: String, months: Int = 0, expiry: String? = null, note: String = "")
LendrMember(id, name, phone = "")
LendrSplit(member_id, amount, is_settled = false)
```

`udhar_entries.payments` matches `UdharCSVRow.payments` in `csvRestore.ts` exactly.

## 5. What this fixture exercises

- Quoting: `Big Bazaar, Andheri West` (comma), `Dinner at "The Bombay Canteen"` and
  `Samsung 55" QLED TV` (embedded double quotes), `Croma, Phoenix Marketcity` (comma).
- Empty-string nulls: `transactions.description` (row 4), `udhar.lender_name`,
  `recall.last_service_date` / insurance block, `savings_goals.*_spend_amount`.
- JSON columns: 2-element `udhar.payments`, empty `[]` for `service_history`,
  `additional_warranties`, and the second udhar's `payments`.
- Header-only sections with no data rows (`variable_budget_entries` and the tax/lendr block).
- Native-only sections that `csvRestore.ts` silently drops (`income_sources`, `savings_goals`).

Every data row's field count matches its `columns,` header exactly.
