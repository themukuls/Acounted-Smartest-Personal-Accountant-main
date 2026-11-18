"use client";

/**
 * WhatYouGet — screen 3 of 6.
 *
 * Three concrete things, not a feature list. The rule applied to each entry:
 * it names a thing that happens on a date, to a rupee figure, or to a person.
 * "Powerful insights" and "smart tracking" are exactly what this screen is
 * for avoiding.
 *
 * The tax block leads because it is the one with a deadline and a number
 * attached, and a deadline with a number is what people actually pay for.
 * The two dates are real: 31 July is the usual ITR filing deadline for
 * individuals without an audit, and 31 March closes the financial year for
 * 80C claims. ₹46,800 is ₹1,50,000 × 31.2% (30% slab + 4% cess) — the most a
 * fully-used 80C limit is worth to a top-slab payer under the old regime.
 * If those figures change, change them here.
 *
 * Copy lives in VALUE_BLOCKS.
 */

import { ReceiptIndianRupee, HandCoins, FileDown } from 'lucide-react';
import { TAX_FEATURE_ENABLED } from '@/lib/features';

export const VALUE_BLOCKS = [
  ...(TAX_FEATURE_ENABLED ? [{
    Icon: ReceiptIndianRupee,
    eyebrow: 'Two dates that cost money',
    title: 'The tax suite, running all year instead of every March',
    body: '31 July is the filing deadline. 31 March is the last day 80C counts for this year. Between them Acounted keeps a live estimate of what you owe under both regimes, logs the TDS already cut from your salary, and shows how much of the ₹1.5 lakh 80C limit is still unused — worth up to ₹46,800 at the top slab.',
  }] : [{
    Icon: ReceiptIndianRupee,
    eyebrow: 'Payments that do not get lost',
    title: 'Expenses captured and ready to reconcile',
    body: 'Acounted detects supported payment notifications, prepares the amount and payee, and remembers the category you confirmed last time. You review it once and your ledger stays current.',
  }]),
  {
    Icon: HandCoins,
    eyebrow: 'The money that never gets written down',
    title: 'Udhar, tracked by name and by date',
    body: 'What you lent your cousin in April, what you still owe a friend, part-payments as they come back, and the date each one was due. It stops being a thing you half-remember and start avoiding.',
  },
  {
    Icon: FileDown,
    eyebrow: 'No lock-in',
    title: 'Every record back out as a file, whenever you want',
    body: 'One tap writes your whole ledger to CSV — transactions, budgets and udhar — into a folder on your device. If you ever stop paying, you keep reading and exporting everything you put in. That does not expire.',
  },
] as const;

export const WhatYouGet = () => (
  <div className="space-y-4">
    <p className="text-sm leading-relaxed text-muted-foreground">
      Three things this does that are worth the money. Not the full list —
      the ones people stay for.
    </p>

    <div className="space-y-3">
      {VALUE_BLOCKS.map(({ Icon, eyebrow, title, body }) => (
        <div
          key={title}
          className="space-y-2 rounded-xl border border-border/50 bg-background/60 p-4"
        >
          <div className="flex items-center gap-2">
            <Icon className="h-4 w-4 shrink-0 text-primary" />
            <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
              {eyebrow}
            </span>
          </div>
          <p className="text-sm font-bold leading-snug text-foreground">{title}</p>
          <p className="text-xs leading-relaxed text-muted-foreground">{body}</p>
        </div>
      ))}
    </div>
  </div>
);
