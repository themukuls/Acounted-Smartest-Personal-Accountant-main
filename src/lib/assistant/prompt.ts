/**
 * prompt.ts — builds the extraction prompt.
 *
 * What gets sent to the provider is deliberately minimal: today's date, the
 * list of category slugs, the list of payment methods, and the user's one
 * sentence. No balances, no transaction history, no name, email, phone or PAN.
 * If you add anything here, you are widening what leaves the device.
 *
 * In particular: the assistant DOES personalise itself to the user — it learns
 * which category a merchant belongs to and which account they usually pay with
 * — but every bit of that happens locally, after the model has replied. See
 * `learning.ts`. None of it may be moved into this file to "help the model".
 * The settings screen promises the user in writing that only their sentence
 * leaves the device, and `learning.test.ts` holds this file to that promise.
 */

import { format } from 'date-fns';
import { DEFAULT_ACCOUNT, PAYMENT_METHODS } from '@/lib/categories';

export interface PromptContext {
  /** Today, in IST — from getISTDate(). */
  today: Date;
  /** Every category slug the user can file against: defaults + their own. */
  categorySlugs: string[];
}

const ACCOUNT_VALUES = PAYMENT_METHODS.map((p) => p.value).join(', ');

/**
 * Few-shot examples. These use a FIXED reference date so the model learns the
 * relative-date arithmetic without getting confused about the real today.
 */
const EXAMPLES = `
Examples (for these examples only, assume today is Sunday 2026-03-15):

"spent 450 on groceries yesterday"
{"kind":"add_transaction","type":"expense","amount":450,"category":"food","account":"upi","description":"Groceries","transaction_date":"2026-03-14","assumed":["account"]}

"paid 1200 for petrol on my credit card"
{"kind":"add_transaction","type":"expense","amount":1200,"category":"fuel","account":"credit-card","description":"Petrol","transaction_date":"2026-03-15","assumed":["transaction_date"]}

"got my salary of 85000"
{"kind":"add_transaction","type":"income","amount":85000,"category":"income","account":"bank-transfer","description":"Salary","transaction_date":"2026-03-15","assumed":["account","transaction_date"]}

"2.5k on a shirt last Friday over upi"
{"kind":"add_transaction","type":"expense","amount":2500,"category":"clothing","account":"upi","description":"Shirt","transaction_date":"2026-03-13","assumed":[]}

"Rahul owes me 2000, due next month"
{"kind":"add_udhar","type":"given","person":"Rahul","amount":2000,"due_date":"2026-04-15","description":"","assumed":["due_date"]}

"I borrowed 15000 from Priya, returning on the 30th"
{"kind":"add_udhar","type":"taken","person":"Priya","amount":15000,"due_date":"2026-03-30","description":"","assumed":[]}

"Rahul paid me back 500 today"
{"kind":"log_udhar_payment","person":"Rahul","amount":500,"date":"2026-03-15","assumed":[]}

"what's the weather like"
{"kind":"unclear","reason":"That doesn't look like something I can record. Try telling me an amount and what it was for."}
`.trim();

export function buildSystemPrompt(ctx: PromptContext): string {
  const todayIso = format(ctx.today, 'yyyy-MM-dd');
  const todayDay = format(ctx.today, 'EEEE');

  return `You extract structured financial records from one short sentence spoken by a user of an Indian personal-finance app. You reply with JSON and nothing else.

Today is ${todayDay} ${todayIso}. All dates you output must be in YYYY-MM-DD format. Resolve relative dates ("yesterday", "last Friday", "next month", "the 30th") against today. Never output a date more than 2 years from today.

Return exactly one JSON object, matching one of these four shapes:

1. A money movement in or out of the user's own accounts:
{"kind":"add_transaction","type":"income"|"expense","amount":<number>,"category":<slug>,"account":<slug>,"description":<short string>,"transaction_date":"YYYY-MM-DD","assumed":[<field names>]}

2. Informal lending between the user and a person ("udhar"):
{"kind":"add_udhar","type":"given"|"taken","person":<name>,"amount":<number>,"due_date":"YYYY-MM-DD","description":<short string>,"assumed":[<field names>]}
   - "given" means the user lent money out and is owed it back.
   - "taken" means the user borrowed and owes it.

3. A repayment against an existing loan:
{"kind":"log_udhar_payment","person":<name>,"amount":<number>,"date":"YYYY-MM-DD","assumed":[]}

4. Anything you cannot confidently turn into one of the above:
{"kind":"unclear","reason":<one friendly sentence explaining what you need>}

Rules:
- amount must be a plain positive number in rupees. Convert spoken forms yourself: "2.5k" -> 2500, "1 lakh" -> 100000, "fifteen hundred" -> 1500. Never include currency symbols or commas.
- category must be one of these exact slugs: ${ctx.categorySlugs.join(', ')}
  Use "others" for an expense that fits nothing else. For type "income" always use the category "income".
- account must be one of: ${ACCOUNT_VALUES}
  If the user did not say how they paid, use "${DEFAULT_ACCOUNT}" and put "account" in assumed. Do not guess "cash" — in India almost everything is UPI, and the app refines this default locally from the user's own habits once you have answered.
- description is a short human label (2-4 words), not the whole sentence. Use "" if there is nothing useful to say.
- "assumed" lists the field names you filled in by default rather than from what the user actually said. Be honest here — the app highlights these so the user can correct them. If the user did not state a payment method, put "account" in assumed. If they did not state a date, put "transaction_date" (or "due_date") in assumed.
- If the amount is missing or you cannot tell what it was for, return kind "unclear" rather than guessing an amount. Never invent an amount.
- Output raw JSON. No markdown fences, no commentary before or after.

${EXAMPLES}`;
}

/** The user turn is just their sentence — kept separate so it's obvious what leaves the device. */
export function buildUserPrompt(utterance: string): string {
  return utterance.trim();
}
