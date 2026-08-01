import { cn } from "@/lib/utils";
import { formatFullINR } from "@/lib/currency";
import { LendrGroup, GroupSummary } from "@/integrations/indexeddb/services/lendrService";
import { ChevronRight, Users } from "lucide-react";

interface Props {
  group: LendrGroup;
  summary: GroupSummary;
  onClick: () => void;
}

export const GroupCard = ({ group, summary, onClick }: Props) => {
  const net = summary.you_receive - summary.you_owe;

  return (
    <button
      type="button"
      onClick={onClick}
      className="w-full text-left rounded-xl border border-border/50 bg-background/70 hover:border-border hover:shadow-sm transition-all duration-200 p-4 pointer-events-auto"
    >
      <div className="flex items-center gap-3">
        {/* Emoji avatar */}
        <div className="h-11 w-11 rounded-2xl bg-primary/8 flex items-center justify-center text-2xl shrink-0">
          {group.emoji}
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-2">
            <div>
              <p className="font-semibold text-foreground text-sm truncate">{group.name}</p>
              <div className="flex items-center gap-1 mt-0.5">
                <Users className="h-3 w-3 text-muted-foreground" />
                <p className="text-xs text-muted-foreground">
                  {group.members.length} member{group.members.length !== 1 ? "s" : ""}
                  {summary.expense_count > 0 && ` · ${summary.expense_count} expense${summary.expense_count !== 1 ? "s" : ""}`}
                </p>
              </div>
            </div>
            <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0 mt-0.5" />
          </div>

          {/* Balance summary */}
          {summary.expense_count > 0 && (
            <div className="mt-2 flex items-center gap-2">
              {net === 0 ? (
                <span className="text-xs bg-emerald-50 text-emerald-700 border border-emerald-200 px-2 py-0.5 rounded-full font-medium">
                  All settled ✓
                </span>
              ) : net > 0 ? (
                <span className="text-xs bg-blue-50 text-blue-700 border border-blue-200 px-2 py-0.5 rounded-full font-medium">
                  You receive {formatFullINR(net)}
                </span>
              ) : (
                <span className="text-xs bg-rose-50 text-rose-700 border border-rose-200 px-2 py-0.5 rounded-full font-medium">
                  You owe {formatFullINR(Math.abs(net))}
                </span>
              )}
              <span className="text-[10px] text-muted-foreground">
                Total {formatFullINR(summary.total_spend)}
              </span>
            </div>
          )}
        </div>
      </div>
    </button>
  );
};
