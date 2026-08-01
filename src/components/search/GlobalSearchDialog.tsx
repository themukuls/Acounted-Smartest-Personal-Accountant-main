"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { formatFullINR } from "@/lib/currency";
import { PAYMENT_METHODS } from "@/lib/categories";
import { cn } from "@/lib/utils";
import { format } from "date-fns";
import { Search, X, SlidersHorizontal, ArrowDownLeft, ArrowUpRight } from "lucide-react";
import { useSearchCorpus } from "./useSearchCorpus";
import {
  buildIndex,
  categoriesIn,
  EMPTY_FILTERS,
  hasActiveFilters,
  runSearch,
  type SearchFilters,
  type SearchRecord,
} from "./searchCore";

/**
 * How long to sit on a keystroke before searching.
 *
 * 180ms is under the ~200ms that reads as "instant" but long enough that typing
 * a word at speed produces one search instead of eight. The alternative — no
 * debounce — re-runs Fuse and re-renders the list on every character, which at
 * 450 rows is visible stutter on a mid-range Android device.
 */
const DEBOUNCE_MS = 180;

/**
 * Results rendered before "show more".
 *
 * A cap rather than a virtualiser: virtualising costs a dependency and a
 * measured scroll container, and nobody reads past the first page of a search.
 * The TOTALS are always computed over every match, not over the visible page —
 * that distinction is the whole point, and getting it wrong would silently
 * under-report what the user has spent.
 */
const PAGE_SIZE = 40;

interface GlobalSearchDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export const GlobalSearchDialog = ({ open, onOpenChange }: GlobalSearchDialogProps) => {
  const [rawQuery, setRawQuery] = useState("");
  const [query, setQuery] = useState("");
  const [filters, setFilters] = useState<SearchFilters>(EMPTY_FILTERS);
  const [showFilters, setShowFilters] = useState(false);
  const [limit, setLimit] = useState(PAGE_SIZE);
  const inputRef = useRef<HTMLInputElement>(null);

  const { data: corpus, isLoading } = useSearchCorpus(open);

  // Debounce the query, not the input — the field itself stays fully responsive.
  useEffect(() => {
    const timer = setTimeout(() => setQuery(rawQuery), DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [rawQuery]);

  // Reset the page whenever what's being searched changes, otherwise a narrower
  // query inherits a scrolled-open list.
  useEffect(() => setLimit(PAGE_SIZE), [query, filters]);

  // Fresh state each time it opens: a search dialog that reopens holding the
  // last query is confusing, and the totals from a stale query are worse.
  useEffect(() => {
    if (!open) return;
    setRawQuery("");
    setQuery("");
    setFilters(EMPTY_FILTERS);
    setShowFilters(false);
    const timer = setTimeout(() => inputRef.current?.focus(), 80);
    return () => clearTimeout(timer);
  }, [open]);

  // The one genuinely expensive operation. Keyed on the corpus alone so it
  // survives every keystroke and every filter change.
  const index = useMemo(() => buildIndex(corpus ?? []), [corpus]);

  const { results, totals } = useMemo(
    () => runSearch(corpus ?? [], index, query, filters),
    [corpus, index, query, filters],
  );

  const categories = useMemo(() => categoriesIn(corpus ?? []), [corpus]);
  const visible = results.slice(0, limit);
  const filtersActive = hasActiveFilters(filters);
  const searching = query.trim().length > 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg max-h-[92vh] p-0 gap-0 rounded-2xl border-border/50 pointer-events-auto flex flex-col [grid-template-columns:minmax(0,1fr)] [&>button:first-child]:hidden">

        {/* ── Search field ─────────────────────────────────────────────── */}
        <DialogHeader className="px-4 pt-4 pb-3 border-b border-border/40 space-y-3 shrink-0">
          <DialogTitle className="sr-only">Search your money</DialogTitle>

          <div className="flex items-center gap-2">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
              <Input
                ref={inputRef}
                value={rawQuery}
                onChange={(e) => setRawQuery(e.target.value)}
                placeholder="Search anything — blinkit, 2450, rent…"
                className="pl-9 pr-9 h-10 rounded-xl pointer-events-auto"
                autoComplete="off"
                enterKeyHint="search"
              />
              {rawQuery && (
                <button
                  onClick={() => setRawQuery("")}
                  className="absolute right-2 top-1/2 -translate-y-1/2 h-6 w-6 rounded-lg flex items-center justify-center text-muted-foreground hover:text-foreground pointer-events-auto"
                  aria-label="Clear search"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </div>

            <Button
              variant={filtersActive ? "default" : "outline"}
              size="sm"
              className="h-10 w-10 p-0 rounded-xl pointer-events-auto shrink-0"
              onClick={() => setShowFilters((v) => !v)}
              aria-label="Filters"
            >
              <SlidersHorizontal className="h-4 w-4" />
            </Button>

            <button
              onClick={() => onOpenChange(false)}
              className="h-10 w-10 rounded-xl flex items-center justify-center bg-muted/50 hover:bg-muted transition-colors pointer-events-auto shrink-0"
              aria-label="Close search"
            >
              <X className="h-4 w-4 text-muted-foreground" />
            </button>
          </div>

          {showFilters && (
            <FilterPanel
              filters={filters}
              categories={categories}
              onChange={setFilters}
              onClear={() => setFilters(EMPTY_FILTERS)}
            />
          )}

          {/* The running total — in a finance app the sum IS the answer. */}
          {(searching || filtersActive) && !isLoading && (
            <div className="flex items-center justify-between gap-2 rounded-xl bg-muted/40 border border-border/40 px-3 py-2">
              <span className="text-xs font-semibold text-foreground">
                {totals.count} {totals.count === 1 ? "result" : "results"}
              </span>
              {totals.count > 0 && (
                <span className="text-xs text-muted-foreground truncate">
                  {totals.mixed ? (
                    <>
                      <span className="text-primary font-semibold">
                        +{formatFullINR(totals.incomeTotal)}
                      </span>
                      {" · "}
                      <span className="text-destructive font-semibold">
                        -{formatFullINR(totals.expenseTotal)}
                      </span>
                    </>
                  ) : (
                    <span className="font-bold text-foreground">
                      {formatFullINR(totals.headline)}
                    </span>
                  )}
                </span>
              )}
            </div>
          )}
        </DialogHeader>

        {/* ── Results ──────────────────────────────────────────────────── */}
        <div className="flex-1 overflow-y-auto px-4 py-3">
          {isLoading ? (
            <div className="space-y-2">
              {[...Array(5)].map((_, i) => (
                <div key={i} className="h-14 bg-muted rounded-xl animate-pulse" />
              ))}
            </div>
          ) : !searching && !filtersActive ? (
            <IdleState count={corpus?.length ?? 0} onPick={setRawQuery} />
          ) : results.length === 0 ? (
            <NoResults query={query} filtersActive={filtersActive} onClear={() => setFilters(EMPTY_FILTERS)} />
          ) : (
            <div className="space-y-1.5">
              {visible.map((record) => (
                <ResultRow key={record.id} record={record} />
              ))}

              {results.length > visible.length && (
                <Button
                  variant="outline"
                  size="sm"
                  className="w-full h-9 rounded-xl mt-2 pointer-events-auto text-xs"
                  onClick={() => setLimit((n) => n + PAGE_SIZE)}
                >
                  Show {Math.min(PAGE_SIZE, results.length - visible.length)} more
                  <span className="text-muted-foreground ml-1">
                    ({results.length - visible.length} left)
                  </span>
                </Button>
              )}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
};

// ── Filters ──────────────────────────────────────────────────────────────────

const TYPE_OPTIONS: { value: NonNullable<SearchFilters["type"]>; label: string }[] = [
  { value: "all", label: "All" },
  { value: "expense", label: "Spent" },
  { value: "income", label: "Earned" },
];

const FilterPanel = ({
  filters,
  categories,
  onChange,
  onClear,
}: {
  filters: SearchFilters;
  categories: { value: string; label: string }[];
  onChange: (f: SearchFilters) => void;
  onClear: () => void;
}) => {
  const set = (patch: Partial<SearchFilters>) => onChange({ ...filters, ...patch });

  return (
    <div className="space-y-2.5 rounded-xl border border-border/50 bg-muted/20 p-3">
      {/* Type */}
      <div className="flex gap-1 p-0.5 rounded-lg bg-background border border-border/40">
        {TYPE_OPTIONS.map((t) => (
          <button
            key={t.value}
            onClick={() => set({ type: t.value })}
            className={cn(
              "flex-1 py-1 rounded-md text-[11px] font-semibold transition-all pointer-events-auto",
              (filters.type ?? "all") === t.value
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Date range */}
      <div className="flex items-center gap-2">
        <input
          type="date"
          value={filters.from ?? ""}
          onChange={(e) => set({ from: e.target.value || null })}
          className="flex-1 min-w-0 h-8 rounded-lg border border-border/50 bg-background px-2 text-[11px] text-foreground pointer-events-auto"
          aria-label="From date"
        />
        <span className="text-[10px] text-muted-foreground shrink-0">to</span>
        <input
          type="date"
          value={filters.to ?? ""}
          onChange={(e) => set({ to: e.target.value || null })}
          className="flex-1 min-w-0 h-8 rounded-lg border border-border/50 bg-background px-2 text-[11px] text-foreground pointer-events-auto"
          aria-label="To date"
        />
      </div>

      {/* Category + payment method */}
      <div className="flex gap-2">
        <select
          value={filters.category ?? ""}
          onChange={(e) => set({ category: e.target.value || null })}
          className="flex-1 min-w-0 h-8 rounded-lg border border-border/50 bg-background px-2 text-[11px] text-foreground pointer-events-auto"
          aria-label="Category"
        >
          <option value="">All categories</option>
          {categories.map((c) => (
            <option key={c.value} value={c.value}>{c.label}</option>
          ))}
        </select>

        <select
          value={filters.account ?? ""}
          onChange={(e) => set({ account: e.target.value || null })}
          className="flex-1 min-w-0 h-8 rounded-lg border border-border/50 bg-background px-2 text-[11px] text-foreground pointer-events-auto"
          aria-label="Payment method"
        >
          <option value="">Any method</option>
          {PAYMENT_METHODS.map((m) => (
            <option key={m.value} value={m.value}>{m.label}</option>
          ))}
        </select>
      </div>

      {hasActiveFilters(filters) && (
        <button
          onClick={onClear}
          className="text-[11px] font-semibold text-primary pointer-events-auto"
        >
          Clear filters
        </button>
      )}
    </div>
  );
};

// ── Result row ───────────────────────────────────────────────────────────────

const KIND_BADGE: Record<SearchRecord["kind"], string> = {
  transaction: "",
  udhar: "Lendr",
  recall: "Recall",
};

const ResultRow = ({ record }: { record: SearchRecord }) => {
  const isIncome = record.type === "income";
  const isTxn = record.kind === "transaction";

  return (
    <div className="flex items-center gap-3 rounded-xl border border-border/50 bg-background/60 px-3 py-2.5">
      <div
        className={cn(
          "h-8 w-8 rounded-lg flex items-center justify-center shrink-0",
          !isTxn
            ? "bg-muted text-muted-foreground"
            : isIncome
              ? "bg-primary/15 text-primary"
              : "bg-destructive/10 text-destructive",
        )}
      >
        {isTxn ? (
          isIncome ? <ArrowDownLeft className="h-4 w-4" /> : <ArrowUpRight className="h-4 w-4" />
        ) : (
          <Search className="h-3.5 w-3.5" />
        )}
      </div>

      <div className="flex-1 min-w-0">
        <p className="text-xs font-semibold text-foreground truncate capitalize">{record.title}</p>
        <p className="text-[10px] text-muted-foreground truncate">
          {format(new Date(record.date), "d MMM yyyy")}
          {record.subtitle && ` · ${record.subtitle}`}
          {KIND_BADGE[record.kind] && ` · ${KIND_BADGE[record.kind]}`}
        </p>
      </div>

      <p
        className={cn(
          "text-xs font-bold shrink-0",
          !isTxn ? "text-foreground" : isIncome ? "text-primary" : "text-destructive",
        )}
      >
        {isTxn && (isIncome ? "+" : "-")}
        {formatFullINR(record.amount)}
      </p>
    </div>
  );
};

// ── Empty states ─────────────────────────────────────────────────────────────

/**
 * The pre-search state. Not a shrug: it says what is searchable, and offers the
 * two query shapes people don't think to try (an amount, a payment method).
 */
const IdleState = ({ count, onPick }: { count: number; onPick: (q: string) => void }) => (
  <div className="text-center py-8 space-y-3">
    <p className="text-3xl">🔎</p>
    <div className="space-y-1">
      <p className="text-sm font-semibold text-foreground">
        {count > 0
          ? `Search ${count.toLocaleString("en-IN")} records`
          : "Nothing to search yet"}
      </p>
      <p className="text-xs text-muted-foreground max-w-[17rem] mx-auto leading-relaxed">
        {count > 0
          ? "Merchant names, categories, payment methods — or type an amount to find that one charge you can't place."
          : "Log a few transactions and they'll all be searchable from here."}
      </p>
    </div>

    {count > 0 && (
      <div className="flex flex-wrap justify-center gap-1.5 pt-1">
        {["rent", "upi", "food"].map((suggestion) => (
          <button
            key={suggestion}
            onClick={() => onPick(suggestion)}
            className="px-2.5 py-1 rounded-full border border-border/60 text-[11px] text-muted-foreground hover:text-foreground hover:border-primary/40 transition-colors pointer-events-auto"
          >
            {suggestion}
          </button>
        ))}
      </div>
    )}
  </div>
);

/**
 * No results. Distinguishes "nothing matches that word" from "your filters ate
 * it" — the second is recoverable in one tap and the user should be told so.
 */
const NoResults = ({
  query,
  filtersActive,
  onClear,
}: {
  query: string;
  filtersActive: boolean;
  onClear: () => void;
}) => (
  <div className="text-center py-10 space-y-2">
    <p className="text-3xl">🫙</p>
    <p className="text-sm font-semibold text-foreground">
      {query ? `Nothing matches "${query.trim()}"` : "Nothing matches these filters"}
    </p>
    <p className="text-xs text-muted-foreground max-w-[17rem] mx-auto leading-relaxed">
      {filtersActive
        ? "Your filters may be hiding it — try widening the date range or clearing them."
        : "Try a shorter word, part of the merchant name, or the exact amount."}
    </p>
    {filtersActive && (
      <Button
        variant="outline"
        size="sm"
        className="h-8 rounded-xl text-xs pointer-events-auto mt-1"
        onClick={onClear}
      >
        Clear filters
      </Button>
    )}
  </div>
);
