"use client";

import React from 'react';
import { Progress } from "@/components/ui/progress";
import { formatFullINR } from "@/lib/currency";
import { cn } from "@/lib/utils";
import { LucideIcon } from 'lucide-react';

interface BudgetCategoryProgressProps {
  label: string;
  value: number;
  percentage: number;
  colorClass: string;
  icon: LucideIcon;
  targetPercentage?: number;
}

export const BudgetCategoryProgress = ({
  label,
  value,
  percentage,
  colorClass,
  icon: Icon,
  targetPercentage,
}: BudgetCategoryProgressProps) => {
  const isOver  = targetPercentage !== undefined && percentage > targetPercentage + 5;
  const isUnder = targetPercentage !== undefined && percentage < targetPercentage - 5;
  const isOk    = targetPercentage !== undefined && !isOver && !isUnder;

  const textColor = colorClass.replace('bg-', 'text-');

  return (
    <div className="p-3 rounded-xl bg-background/60 border border-border/50 space-y-2">
      {/* Top row: icon + label + % */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          <Icon className={cn("h-3.5 w-3.5", textColor)} />
          <span className="text-xs font-semibold text-foreground">{label}</span>
        </div>
        <div className="flex items-center gap-1">
          <span className="text-xs font-bold text-foreground">{percentage.toFixed(0)}%</span>
          {targetPercentage !== undefined && (
            <span className={cn(
              "text-[9px] font-semibold rounded-full px-1.5 py-px",
              isOver  ? "bg-red-100 text-red-600"    :
              isUnder ? "bg-amber-100 text-amber-600" :
                        "bg-emerald-100 text-emerald-600"
            )}>
              {isOver ? "↑" : isUnder ? "↓" : "✓"}{targetPercentage}%
            </span>
          )}
        </div>
      </div>

      {/* Progress bar */}
      <Progress
        value={Math.min(percentage, 100)}
        className="h-1.5"
        indicatorColor={colorClass}
      />

      {/* Amount */}
      <p className="text-xs text-muted-foreground font-medium">{formatFullINR(value)}</p>
    </div>
  );
};
