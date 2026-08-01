"use client";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import {
  PAYMENT_METHODS, categoryLabel, categoryEmoji, INCOME_CATEGORY,
} from "@/lib/categories";
import { formatFullINR } from "@/lib/currency";
import { getAmountNotice, type AmountNotice } from "@/lib/assistant/learning";
import type { WritableAction } from "@/lib/assistant/types";
import { TrendingDown, TrendingUp, ArrowDownLeft, ArrowUpRight, AlertTriangle } from "lucide-react";

interface ActionReviewCardProps {
  action: WritableAction;
  onChange: (next: WritableAction) => void;
  categorySlugs: string[];
  /**
   * Optional. A hint from the local learning layer that this amount is far
   * outside what the user normally spends in this category — usually a misheard
   * "four thousand" for "four hundred". Purely informational: the amount is
   * never rewritten, only questioned.
   *
   * Omit it and the card asks the learning layer directly, so the hint shows up
   * without every caller having to thread it through.
   */
  amountNotice?: AmountNotice | null;
}

/** Amber "assumed" chip for fields the model filled in rather than heard. */
const AssumedTag = () => (
  <span className="ml-1.5 rounded-full bg-amber-500/15 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-amber-700">
    assumed
  </span>
);

const FieldLabel = ({
  htmlFor, children, assumed,
}: { htmlFor: string; children: React.ReactNode; assumed: boolean }) => (
  <Label htmlFor={htmlFor} className="flex items-center text-xs">
    {children}
    {assumed && <AssumedTag />}
  </Label>
);

/** Two-option segmented toggle, used for income/expense and given/taken. */
const Segmented = <T extends string>({
  value, options, onSelect,
}: {
  value: T;
  options: { value: T; label: string; Icon: typeof TrendingUp; activeClass: string }[];
  onSelect: (v: T) => void;
}) => (
  <div className="grid grid-cols-2 gap-2">
    {options.map(({ value: v, label, Icon, activeClass }) => (
      <button
        key={v}
        type="button"
        onClick={() => onSelect(v)}
        className={cn(
          "flex items-center justify-center gap-1.5 rounded-xl border px-3 py-2 text-xs font-semibold transition-colors pointer-events-auto",
          value === v
            ? activeClass
            : "border-border/60 bg-background/60 text-muted-foreground hover:text-foreground",
        )}
      >
        <Icon className="h-3.5 w-3.5" />
        {label}
      </button>
    ))}
  </div>
);

export const ActionReviewCard = ({
  action, onChange, categorySlugs, amountNotice,
}: ActionReviewCardProps) => {
  const assumed = (field: string) => action.assumed?.includes(field) ?? false;

  // `undefined` means "not supplied" — ask the learning layer. `null` means the
  // caller checked and there is nothing to show.
  const notice = amountNotice === undefined ? getAmountNotice(action) : amountNotice;

  // Typed patch helper — keeps the discriminated union intact.
  const patch = <A extends WritableAction>(changes: Partial<A>) =>
    onChange({ ...action, ...changes } as WritableAction);

  const amountField = (
    <div className="space-y-1.5">
      <FieldLabel htmlFor="rv-amount" assumed={assumed("amount")}>Amount (₹)</FieldLabel>
      <Input
        id="rv-amount"
        type="number"
        inputMode="decimal"
        min="0"
        step="0.01"
        value={Number.isFinite(action.amount) ? action.amount : ""}
        onChange={(e) => patch({ amount: parseFloat(e.target.value) })}
        className="pointer-events-auto text-lg font-bold"
      />
      {notice && (
        <p className="flex items-start gap-1.5 text-[11px] leading-relaxed text-amber-700">
          <AlertTriangle className="h-3 w-3 shrink-0 mt-0.5" />
          <span>
            That's unusually {notice.direction} for {categoryLabel(notice.category)} — you
            normally spend about {formatFullINR(notice.typical)}. Worth a look before you save.
          </span>
        </p>
      )}
    </div>
  );

  return (
    <div className="space-y-3.5 rounded-2xl border border-border/60 bg-background/60 p-4">
      {action.kind === "add_transaction" && (
        <>
          <Segmented
            value={action.type}
            onSelect={(type) =>
              patch({
                type,
                // Income always files under the 'income' pseudo-category; going
                // back to expense needs a real slug again.
                category: type === "income" ? INCOME_CATEGORY : (action.category === INCOME_CATEGORY ? "others" : action.category),
              })
            }
            options={[
              { value: "expense", label: "Expense", Icon: TrendingDown, activeClass: "border-rose-500/40 bg-rose-500/10 text-rose-700" },
              { value: "income",  label: "Income",  Icon: TrendingUp,   activeClass: "border-emerald-500/40 bg-emerald-500/10 text-emerald-700" },
            ]}
          />

          {amountField}

          {action.type === "expense" && (
            <div className="space-y-1.5">
              <FieldLabel htmlFor="rv-category" assumed={assumed("category")}>Category</FieldLabel>
              <Select value={action.category} onValueChange={(category) => patch({ category })}>
                <SelectTrigger id="rv-category" className="pointer-events-auto">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="pointer-events-auto max-h-64">
                  {categorySlugs.map((slug) => (
                    <SelectItem key={slug} value={slug}>
                      {categoryEmoji(slug)} {categoryLabel(slug)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          <div className="space-y-1.5">
            <FieldLabel htmlFor="rv-account" assumed={assumed("account")}>Paid with</FieldLabel>
            <Select value={action.account} onValueChange={(account) => patch({ account })}>
              <SelectTrigger id="rv-account" className="pointer-events-auto">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="pointer-events-auto">
                {PAYMENT_METHODS.map((m) => (
                  <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <FieldLabel htmlFor="rv-date" assumed={assumed("transaction_date")}>Date</FieldLabel>
            <Input
              id="rv-date"
              type="date"
              value={action.transaction_date}
              onChange={(e) => patch({ transaction_date: e.target.value })}
              className="pointer-events-auto"
            />
          </div>

          <div className="space-y-1.5">
            <FieldLabel htmlFor="rv-note" assumed={false}>Note</FieldLabel>
            <Input
              id="rv-note"
              value={action.description}
              onChange={(e) => patch({ description: e.target.value })}
              placeholder="Optional"
              className="pointer-events-auto"
            />
          </div>
        </>
      )}

      {action.kind === "add_udhar" && (
        <>
          <Segmented
            value={action.type}
            onSelect={(type) => patch({ type })}
            options={[
              { value: "given", label: "They owe me", Icon: ArrowDownLeft, activeClass: "border-emerald-500/40 bg-emerald-500/10 text-emerald-700" },
              { value: "taken", label: "I owe them",  Icon: ArrowUpRight,  activeClass: "border-rose-500/40 bg-rose-500/10 text-rose-700" },
            ]}
          />

          <div className="space-y-1.5">
            <FieldLabel htmlFor="rv-person" assumed={assumed("person")}>Person</FieldLabel>
            <Input
              id="rv-person"
              value={action.person}
              onChange={(e) => patch({ person: e.target.value })}
              className="pointer-events-auto"
            />
          </div>

          {amountField}

          <div className="space-y-1.5">
            <FieldLabel htmlFor="rv-due" assumed={assumed("due_date")}>Due date</FieldLabel>
            <Input
              id="rv-due"
              type="date"
              value={action.due_date}
              onChange={(e) => patch({ due_date: e.target.value })}
              className="pointer-events-auto"
            />
          </div>

          <div className="space-y-1.5">
            <FieldLabel htmlFor="rv-udhar-note" assumed={false}>Note</FieldLabel>
            <Input
              id="rv-udhar-note"
              value={action.description}
              onChange={(e) => patch({ description: e.target.value })}
              placeholder="Optional"
              className="pointer-events-auto"
            />
          </div>
        </>
      )}

      {action.kind === "log_udhar_payment" && (
        <>
          <p className="text-xs text-muted-foreground">
            Logging a repayment against the open entry for this person.
          </p>

          <div className="space-y-1.5">
            <FieldLabel htmlFor="rv-pay-person" assumed={assumed("person")}>Person</FieldLabel>
            <Input
              id="rv-pay-person"
              value={action.person}
              onChange={(e) => patch({ person: e.target.value })}
              className="pointer-events-auto"
            />
          </div>

          {amountField}

          <div className="space-y-1.5">
            <FieldLabel htmlFor="rv-pay-date" assumed={assumed("date")}>Date</FieldLabel>
            <Input
              id="rv-pay-date"
              type="date"
              value={action.date}
              onChange={(e) => patch({ date: e.target.value })}
              className="pointer-events-auto"
            />
          </div>
        </>
      )}
    </div>
  );
};
