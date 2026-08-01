"use client";

import { useState } from "react";
import { format } from "date-fns";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { formatFullINR } from "@/lib/currency";
import { categoryEmoji, categoryLabel } from "@/lib/categories";
import { cn } from "@/lib/utils";
import { ArrowUpRight, Clock, EyeOff, TrendingUp } from "lucide-react";
import { daysUntilNext, type Cadence, type RecurringSeries } from "@/lib/recurring/detect";

const CADENCE_LABEL: Record<Cadence, string> = {
  weekly: "every week",
  monthly: "every month",
  quarterly: "every 3 months",
};

/** Under a week away is worth reacting to; anything further is just a date. */
const DUE_SOON_DAYS = 7;

interface SubscriptionCardProps {
  series: RecurringSeries;
  onDismiss: (key: string) => void;
  /** Reference "today" — injected so the whole list agrees on one clock. */
  now?: Date;
}

/**
 * One detected subscription.
 *
 * Ordered by what a person actually does with this card: what is it, what does
 * it cost me a YEAR (the number that provokes a cancellation — nobody cancels
 * over ₹149), when is it next taking money, and did it quietly get dearer.
 */
export const SubscriptionCard = ({ series, onDismiss, now = new Date() }: SubscriptionCardProps) => {
  const daysAway = daysUntilNext(series, now);
  const dueSoon = daysAway >= 0 && daysAway <= DUE_SOON_DAYS;
  const overdue = daysAway < 0;
  const rise = series.priceChange;

  const dueCopy = overdue
    ? `Expected ${Math.abs(daysAway)} day${Math.abs(daysAway) === 1 ? "" : "s"} ago`
    : daysAway === 0
      ? "Due today"
      : daysAway === 1
        ? "Due tomorrow"
        : `Due in ${daysAway} days`;

  return (
    <div
      className={cn(
        "rounded-2xl border p-3.5 space-y-3 relative overflow-hidden transition-colors",
        rise
          ? "bg-amber-50/60 border-amber-200"
          : dueSoon
            ? "bg-primary/[0.04] border-primary/25"
            : "bg-background/60 border-border/60",
      )}
    >
      {/* Top row: identity + annual cost */}
      <div className="flex items-start gap-3">
        <div className="h-10 w-10 rounded-xl bg-muted/60 flex items-center justify-center text-lg shrink-0">
          {categoryEmoji(series.category)}
        </div>

        <div className="flex-1 min-w-0">
          <p className="text-sm font-bold text-foreground leading-tight truncate">{series.label}</p>
          <p className="text-[11px] text-muted-foreground mt-0.5">
            {formatFullINR(series.amount)} {CADENCE_LABEL[series.cadence]}
            {" · "}
            {categoryLabel(series.category)}
          </p>
        </div>

        <div className="text-right shrink-0">
          <p className="text-sm font-black text-foreground leading-none">
            {formatFullINR(series.annualCost)}
          </p>
          <p className="text-[10px] text-muted-foreground mt-1">a year</p>
        </div>
      </div>

      {/* The price rise — the single most valuable thing this screen can say */}
      {rise && (
        <div className="flex items-start gap-2 rounded-xl bg-amber-100/70 border border-amber-200 px-2.5 py-2">
          <TrendingUp className="h-3.5 w-3.5 text-amber-700 shrink-0 mt-0.5" />
          <p className="text-[11px] text-amber-900 leading-relaxed">
            <span className="font-bold">Price went up.</span>{" "}
            {formatFullINR(rise.from)} → {formatFullINR(rise.to)} ({rise.pctChange.toFixed(0)}% more)
            {" since "}
            {format(new Date(rise.changedOn), "d MMM yyyy")}. That's{" "}
            <span className="font-bold">{formatFullINR(rise.annualImpact)}</span> extra a year.
          </p>
        </div>
      )}

      {/* Bottom row: next charge, evidence, dismiss */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 min-w-0">
          <Clock
            className={cn(
              "h-3 w-3 shrink-0",
              overdue ? "text-muted-foreground" : dueSoon ? "text-primary" : "text-muted-foreground",
            )}
          />
          <span
            className={cn(
              "text-[11px] font-semibold truncate",
              dueSoon && !overdue ? "text-primary" : "text-muted-foreground",
            )}
          >
            {dueCopy}
            <span className="font-normal"> · {format(new Date(series.nextExpected), "d MMM")}</span>
          </span>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <span
            className="text-[10px] text-muted-foreground"
            title={`${series.occurrences} matching charges, last on ${format(new Date(series.lastSeen), "d MMM yyyy")}`}
          >
            {series.occurrences}× seen
            {series.confidence < 0.6 && " · unsure"}
          </span>

          <DismissButton label={series.label} onConfirm={() => onDismiss(series.key)} />
        </div>
      </div>
    </div>
  );
};

/**
 * Dismissal is confirmed rather than instant.
 *
 * It is a sticky, cross-session decision — an accidental tap that permanently
 * hides a real ₹25,000/yr commitment is a much worse outcome than one extra
 * tap. The confirmation also says where the entry goes, so it doesn't read as
 * deleting the transactions themselves.
 */
const DismissButton = ({ label, onConfirm }: { label: string; onConfirm: () => void }) => {
  const [open, setOpen] = useState(false);

  return (
    <AlertDialog open={open} onOpenChange={setOpen}>
      <AlertDialogTrigger asChild>
        <Button
          size="sm"
          variant="ghost"
          className="h-7 w-7 p-0 text-muted-foreground hover:text-foreground pointer-events-auto"
          aria-label={`Not a subscription: ${label}`}
          title="Not a subscription"
        >
          <EyeOff className="h-3.5 w-3.5" />
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent className="pointer-events-auto">
        <AlertDialogHeader>
          <AlertDialogTitle>Not a subscription?</AlertDialogTitle>
          <AlertDialogDescription>
            "{label}" will be hidden from this screen for good. Your transactions aren't touched —
            only the pattern is ignored. You can bring it back from "Hidden" at the bottom of this
            page.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel className="pointer-events-auto">Keep it</AlertDialogCancel>
          <AlertDialogAction onClick={onConfirm} className="pointer-events-auto">
            Hide it
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
};

/** A compact row for a series the user has already hidden. */
export const DismissedRow = ({
  series,
  onRestore,
}: {
  series: RecurringSeries;
  onRestore: (key: string) => void;
}) => (
  <div className="flex items-center gap-2 rounded-xl border border-border/50 bg-muted/20 px-3 py-2">
    <span className="text-sm shrink-0">{categoryEmoji(series.category)}</span>
    <span className="text-xs text-muted-foreground truncate flex-1">{series.label}</span>
    <span className="text-[10px] text-muted-foreground shrink-0">
      {formatFullINR(series.annualCost)}/yr
    </span>
    <Button
      size="sm"
      variant="ghost"
      className="h-6 px-2 text-[10px] pointer-events-auto shrink-0"
      onClick={() => onRestore(series.key)}
    >
      <ArrowUpRight className="h-3 w-3 mr-0.5" />
      Restore
    </Button>
  </div>
);
