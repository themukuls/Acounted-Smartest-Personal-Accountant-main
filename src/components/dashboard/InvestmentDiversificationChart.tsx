"use client";

import React from 'react';
import { formatCompactINR } from '@/lib/currency';

interface DiversificationData {
  name: string;
  value: number;
  color: string;
}

interface InvestmentDiversificationChartProps {
  data: DiversificationData[];
  totalValue: number;
}

const cleanName = (raw: string) =>
  raw.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());

const InvestmentDiversificationChart = ({ data, totalValue }: InvestmentDiversificationChartProps) => {
  if (!data || data.length === 0) {
    return (
      <div className="text-center py-4 text-muted-foreground text-sm">
        No diversification data available.
      </div>
    );
  }

  const sorted = [...data].sort((a, b) => b.value - a.value);

  return (
    <div className="space-y-3">
      {sorted.map((item, index) => {
        const pct = totalValue > 0 ? (item.value / totalValue) * 100 : 0;
        return (
          <div key={index} className="space-y-1.5">
            {/* Label row */}
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 min-w-0">
                <span
                  className="h-2.5 w-2.5 rounded-full shrink-0"
                  style={{ backgroundColor: item.color }}
                />
                <span className="text-xs font-semibold text-foreground truncate">
                  {cleanName(item.name)}
                </span>
              </div>
              <div className="flex items-center gap-3 shrink-0">
                <span className="text-xs font-bold text-foreground">
                  {formatCompactINR(item.value)}
                </span>
                <span
                  className="text-[10px] font-bold w-10 text-right"
                  style={{ color: item.color }}
                >
                  {pct.toFixed(1)}%
                </span>
              </div>
            </div>

            {/* Bar */}
            <div className="h-2 w-full rounded-full bg-muted overflow-hidden">
              <div
                className="h-full rounded-full transition-all duration-700"
                style={{
                  width: `${Math.max(pct, 1)}%`,
                  backgroundColor: item.color,
                }}
              />
            </div>
          </div>
        );
      })}

      {/* Total row */}
      {data.length > 1 && (
        <div className="flex items-center justify-between pt-2 border-t border-border/40 mt-1">
          <span className="text-xs font-bold text-muted-foreground">Total</span>
          <span className="text-xs font-black text-foreground">{formatCompactINR(totalValue)}</span>
        </div>
      )}
    </div>
  );
};

export default InvestmentDiversificationChart;
