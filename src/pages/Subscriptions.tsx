import { useMemo, useState } from "react";
import { AppLayout } from "@/components/layout/AppLayout";
import { GlassCard } from "@/components/ui/glass-card";
import { Button } from "@/components/ui/button";
import { formatFullINR } from "@/lib/currency";
import { cn } from "@/lib/utils";
import { ChevronLeft, Repeat, TrendingUp, Clock, Search } from "lucide-react";
import { Link } from "react-router-dom";
import { useRecurringSubscriptions } from "@/components/recurring/useRecurringSubscriptions";
import { DismissedRow, SubscriptionCard } from "@/components/recurring/SubscriptionCard";
import { daysUntilNext } from "@/lib/recurring/detect";
import { GlobalSearchDialog } from "@/components/search/GlobalSearchDialog";

type SortMode = "cost" | "next" | "recent";

const SORTS: { id: SortMode; label: string }[] = [
  { id: "cost", label: "Costliest" },
  { id: "next", label: "Due next" },
  { id: "recent", label: "Recently charged" },
];

/**
 * The Subscriptions screen.
 *
 * Its own route rather than a block on the Expenses page, because the two
 * answer different questions. Expenses answers "what did I spend this week" —
 * it is scoped to a month and a week, and everything on it is filtered by that
 * scope. Recurring detection is the opposite: it needs the WHOLE ledger, is
 * scope-free, and is something you look at every few months rather than every
 * day. Bolting a full-ledger list onto a month-scoped screen would have meant
 * two contradictory time contexts on one page.
 *
 * It is deliberately NOT a seventh item in the mobile bottom nav — that nav is
 * already scrolling at six. Instead `/subscriptions` joins the `/expenses`
 * route family (so the Expenses tab stays lit while you're here), and the entry
 * point is a summary card at the top of Expenses showing the annual total. That
 * card carries the number that makes people tap; a nav label never would.
 */
const Subscriptions = () => {
  const { series, summary, dismissed, isLoading, dismiss, restore } = useRecurringSubscriptions();
  const [sort, setSort] = useState<SortMode>("cost");
  const [showHidden, setShowHidden] = useState(false);
  const [showSearch, setShowSearch] = useState(false);

  // One clock for the whole screen — cards computing their own `new Date()`
  // could disagree across a midnight boundary mid-render.
  const now = useMemo(() => new Date(), []);

  const sorted = useMemo(() => {
    const list = [...series];
    if (sort === "next") {
      return list.sort(
        (a, b) => new Date(a.nextExpected).getTime() - new Date(b.nextExpected).getTime(),
      );
    }
    if (sort === "recent") {
      return list.sort((a, b) => new Date(b.lastSeen).getTime() - new Date(a.lastSeen).getTime());
    }
    return list.sort((a, b) => b.annualCost - a.annualCost);
  }, [series, sort]);

  const dueSoon = useMemo(
    () => series.filter((s) => {
      const d = daysUntilNext(s, now);
      return d >= 0 && d <= 7;
    }),
    [series, now],
  );

  const dueSoonTotal = dueSoon.reduce((sum, s) => sum + s.amount, 0);

  return (
    <AppLayout>
      <div className="space-y-4 pb-24">

        {/* ── Header ───────────────────────────────────────────────────── */}
        <div className="flex items-center justify-between gap-3 mt-4 md:mt-0">
          <div className="flex items-center gap-2 min-w-0">
            <Link
              to="/expenses"
              className="h-9 w-9 rounded-xl border border-border/60 flex items-center justify-center pointer-events-auto shrink-0 md:hidden"
              aria-label="Back to expenses"
            >
              <ChevronLeft className="h-4 w-4 text-muted-foreground" />
            </Link>
            <div className="min-w-0">
              <h1 className="text-xl font-bold text-foreground tracking-tight truncate">
                Subscriptions
              </h1>
              <p className="text-[11px] text-muted-foreground">
                What renews without you deciding again
              </p>
            </div>
          </div>
          <Button
            variant="outline"
            size="sm"
            className="h-9 w-9 p-0 rounded-xl border-border/60 pointer-events-auto shrink-0"
            onClick={() => setShowSearch(true)}
            aria-label="Search transactions"
          >
            <Search className="h-4 w-4" />
          </Button>
        </div>

        {/* ── Hero: the annualised number ──────────────────────────────── */}
        <GlassCard className="p-4 space-y-3" hover={false}>
          <div className="flex items-center justify-between">
            <div className="min-w-0">
              <p className="text-xs text-muted-foreground font-medium">Committed every year</p>
              <p className="text-2xl font-black mt-0.5 tracking-tight text-foreground">
                {formatFullINR(summary.annualTotal)}
              </p>
              <p className="text-[11px] text-muted-foreground mt-1">
                {formatFullINR(summary.monthlyTotal)} a month across{" "}
                {series.length} recurring {series.length === 1 ? "charge" : "charges"}
              </p>
            </div>
            <div className="h-12 w-12 rounded-2xl bg-primary/10 flex items-center justify-center shrink-0">
              <Repeat className="h-5 w-5 text-primary" />
            </div>
          </div>

          {(dueSoon.length > 0 || summary.priceRises.length > 0) && (
            <div className="flex gap-2">
              {dueSoon.length > 0 && (
                <div className="flex-1 rounded-xl bg-primary/5 border border-primary/15 px-3 py-2">
                  <div className="flex items-center gap-1">
                    <Clock className="h-3 w-3 text-primary" />
                    <p className="text-[10px] text-muted-foreground font-medium">Next 7 days</p>
                  </div>
                  <p className="text-xs font-bold text-primary mt-0.5">
                    {formatFullINR(dueSoonTotal)}
                  </p>
                </div>
              )}
              {summary.priceRises.length > 0 && (
                <div className="flex-1 rounded-xl bg-amber-50 border border-amber-200 px-3 py-2">
                  <div className="flex items-center gap-1">
                    <TrendingUp className="h-3 w-3 text-amber-600" />
                    <p className="text-[10px] text-muted-foreground font-medium">Price rises</p>
                  </div>
                  <p className="text-xs font-bold text-amber-600 mt-0.5">
                    +{formatFullINR(summary.priceRiseAnnualImpact)}/yr
                  </p>
                </div>
              )}
            </div>
          )}
        </GlassCard>

        {/* ── Sort ─────────────────────────────────────────────────────── */}
        {series.length > 1 && (
          <div className="flex gap-1 p-1 rounded-xl bg-muted/40 border border-border/40">
            {SORTS.map((s) => (
              <button
                key={s.id}
                onClick={() => setSort(s.id)}
                className={cn(
                  "flex-1 py-1.5 rounded-lg text-[11px] font-semibold transition-all pointer-events-auto",
                  sort === s.id
                    ? "bg-white shadow-sm text-primary border border-border/40"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {s.label}
              </button>
            ))}
          </div>
        )}

        {/* ── The list ─────────────────────────────────────────────────── */}
        {isLoading ? (
          <div className="space-y-2">
            {[...Array(4)].map((_, i) => (
              <div key={i} className="h-24 bg-muted rounded-2xl animate-pulse" />
            ))}
          </div>
        ) : sorted.length > 0 ? (
          <div className="space-y-2">
            {sorted.map((s) => (
              <SubscriptionCard key={s.key} series={s} onDismiss={dismiss} now={now} />
            ))}
          </div>
        ) : (
          <EmptyState hasHidden={dismissed.length > 0} />
        )}

        {/* ── Hidden ───────────────────────────────────────────────────── */}
        {dismissed.length > 0 && (
          <div className="space-y-2">
            <button
              onClick={() => setShowHidden((v) => !v)}
              className="text-[11px] text-muted-foreground hover:text-foreground font-medium pointer-events-auto"
            >
              {showHidden ? "Hide" : "Show"} {dismissed.length} hidden{" "}
              {dismissed.length === 1 ? "pattern" : "patterns"}
            </button>
            {showHidden && (
              <div className="space-y-1.5">
                {dismissed.map((s) => (
                  <DismissedRow key={s.key} series={s} onRestore={restore} />
                ))}
              </div>
            )}
          </div>
        )}

        {/* ── How this works ───────────────────────────────────────────── */}
        {sorted.length > 0 && (
          <p className="text-[10px] text-muted-foreground/80 leading-relaxed px-1">
            Found by matching your own transactions — nothing is read from your bank. A charge needs
            at least three occurrences on a regular schedule before it shows up here, so a brand-new
            subscription takes a few months to appear.
          </p>
        )}
      </div>

      <GlobalSearchDialog open={showSearch} onOpenChange={setShowSearch} />
    </AppLayout>
  );
};

/**
 * Empty state.
 *
 * Two genuinely different situations, and conflating them would be a lie: a new
 * user has no history for the detector to work with, and an established user
 * with no detections has actually learned something good about themselves.
 */
const EmptyState = ({ hasHidden }: { hasHidden: boolean }) => (
  <GlassCard className="p-8 text-center space-y-2" hover={false}>
    <p className="text-3xl">🔍</p>
    <p className="text-sm font-semibold text-foreground">No recurring charges found yet</p>
    <p className="text-xs text-muted-foreground max-w-xs mx-auto leading-relaxed">
      {hasHidden
        ? "Everything we spotted has been hidden. Restore one below if you changed your mind."
        : "Subscriptions show up here once the same charge appears three times on a regular schedule. If you've been logging for less than three months, there simply isn't enough history yet."}
    </p>
    <Link
      to="/expenses"
      className="inline-block text-xs font-semibold text-primary pointer-events-auto pt-1"
    >
      Back to expenses
    </Link>
  </GlassCard>
);

export default Subscriptions;
