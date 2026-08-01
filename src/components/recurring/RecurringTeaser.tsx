"use client";

import { Link } from "react-router-dom";
import { ChevronRight, Repeat, TrendingUp } from "lucide-react";
import { formatFullINR } from "@/lib/currency";
import { cn } from "@/lib/utils";
import { useRecurringSubscriptions } from "./useRecurringSubscriptions";
import { daysUntilNext } from "@/lib/recurring/detect";

/**
 * The entry point to /subscriptions, sitting on the Expenses page.
 *
 * This exists instead of a seventh mobile-nav item. The nav is already six
 * items and horizontally scrolling; a seventh would push the last one off
 * screen on a small phone. More usefully, a nav label reading "Subs" persuades
 * nobody to tap it, whereas "₹47,388 a year on autopilot" does — the annualised
 * number is the entire pitch for the feature, so the entry point carries it.
 *
 * Renders NOTHING when there is nothing to say. A permanent zero-state card on
 * the busiest screen in the app is clutter, and users with under three months
 * of history would see it forever.
 */
export const RecurringTeaser = () => {
  const { series, summary, isLoading } = useRecurringSubscriptions();

  if (isLoading || series.length === 0) return null;

  const risesCount = summary.priceRises.length;
  const dueSoon = series.filter((s) => {
    const d = daysUntilNext(s);
    return d >= 0 && d <= 7;
  });

  return (
    <Link
      to="/subscriptions"
      className={cn(
        "flex items-center gap-3 rounded-2xl border p-3.5 pointer-events-auto transition-colors",
        risesCount > 0
          ? "bg-amber-50/60 border-amber-200 hover:border-amber-300"
          : "bg-background/60 border-border/60 hover:border-primary/40",
      )}
    >
      <div
        className={cn(
          "h-10 w-10 rounded-xl flex items-center justify-center shrink-0",
          risesCount > 0 ? "bg-amber-100" : "bg-primary/10",
        )}
      >
        {risesCount > 0 ? (
          <TrendingUp className="h-4.5 w-4.5 text-amber-700" />
        ) : (
          <Repeat className="h-4.5 w-4.5 text-primary" />
        )}
      </div>

      <div className="flex-1 min-w-0">
        <p className="text-sm font-bold text-foreground leading-tight">
          {formatFullINR(summary.annualTotal)} a year on autopilot
        </p>
        <p className="text-[11px] text-muted-foreground mt-0.5 truncate">
          {series.length} recurring {series.length === 1 ? "charge" : "charges"}
          {risesCount > 0
            ? ` · ${risesCount} got more expensive`
            : dueSoon.length > 0
              ? ` · ${dueSoon.length} due this week`
              : ` · ${formatFullINR(summary.monthlyTotal)} a month`}
        </p>
      </div>

      <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
    </Link>
  );
};
