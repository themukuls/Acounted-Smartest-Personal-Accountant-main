/**
 * categories.ts — the canonical expense-category and payment-method lists.
 *
 * These used to live inside TransactionFormDialog. They now live here because
 * the AI assistant needs the same slugs to build its prompt, and a second copy
 * would drift. Pure data only — no React, no icons — so both the UI layer and
 * the prompt builder can import it.
 *
 * NOTE: `category_name` is the SLUG that gets written to
 * `transactions.category` (e.g. "tech-products"). The label is display-only.
 */

export interface CategoryDef {
  category_name: string;
  emoji: string;
  label: string;
}

export const DEFAULT_CATEGORIES: CategoryDef[] = [
  { category_name: "food",             emoji: "🍽️", label: "Food & Dining"    },
  { category_name: "fuel",             emoji: "⛽", label: "Transport"         },
  { category_name: "entertainment",    emoji: "🎬", label: "Entertainment"     },
  { category_name: "investment",       emoji: "💰", label: "Investment"        },
  { category_name: "health",           emoji: "🏥", label: "Health"            },
  { category_name: "medicine",         emoji: "💊", label: "Medicine"          },
  { category_name: "clothing",         emoji: "👕", label: "Clothing"          },
  { category_name: "household",        emoji: "🏠", label: "Household"         },
  { category_name: "books",            emoji: "📚", label: "Books"             },
  { category_name: "education",        emoji: "🎓", label: "Education"         },
  { category_name: "recharge",         emoji: "📱", label: "Bills"             },
  { category_name: "rent",             emoji: "🏘️", label: "Rent"             },
  { category_name: "vehicle",          emoji: "🚗", label: "Vehicle"           },
  { category_name: "tech-products",    emoji: "💻", label: "Tech"              },
  { category_name: "professional-fee", emoji: "💼", label: "Professional"      },
  { category_name: "trips-outings",    emoji: "✈️", label: "Trips"            },
  { category_name: "emis",             emoji: "💳", label: "EMIs"              },
  { category_name: "others",           emoji: "📦", label: "Others"            },
];

/**
 * Valid `transactions.account` values. Only 'credit-card' is load-bearing —
 * it's excluded from budget/weekly math in dataService and the summary hooks.
 */
export const PAYMENT_METHODS: { value: string; label: string }[] = [
  { value: "upi",           label: "UPI"   },
  { value: "cash",          label: "Cash"  },
  { value: "bank-transfer", label: "Bank"  },
  { value: "credit-card",   label: "Card"  },
  { value: "debit-card",    label: "Debit" },
];

/**
 * The payment method to assume when nobody said otherwise and there is no
 * history to learn from.
 *
 * This is data, not taste. In a real 447-transaction ledger the split was
 * 436 upi / 4 cash / 3 bank-transfer / 3 credit-card / 1 debit-card — UPI is
 * not merely the most common Indian payment method, it is very nearly the only
 * one. Defaulting to 'cash' (as this app used to) meant the user corrected the
 * same field on almost every single entry.
 */
export const DEFAULT_ACCOUNT = "upi";

/** The pseudo-category written for every income transaction. */
export const INCOME_CATEGORY = "income";

const DEFAULT_BY_SLUG = new Map(DEFAULT_CATEGORIES.map((c) => [c.category_name, c]));

/** Slug -> display label, falling back to a title-cased slug for custom categories. */
export function categoryLabel(slug: string): string {
  const known = DEFAULT_BY_SLUG.get(slug);
  if (known) return known.label;
  return slug
    .replace(/-/g, " ")
    .replace(/\b\w/g, (ch) => ch.toUpperCase());
}

/** Slug -> emoji, with the generic tag emoji for custom categories. */
export function categoryEmoji(slug: string): string {
  return DEFAULT_BY_SLUG.get(slug)?.emoji ?? "🏷️";
}

/** The app's slug convention for a user-typed category name. */
export function slugifyCategory(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, "-");
}
