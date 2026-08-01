"use client";

import { useState, useEffect, useCallback } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { formatFullINR } from "@/lib/currency";

interface Investment {
  id: string;
  investment_name: string;
  amount: number;
  investment_type: string;
  risk_level: string;
  interest_rate: number;
}

interface Recommendation {
  id: string;
  type: 'reallocation' | 'additional_investment' | 'diversification';
  title: string;
  description: string;
  action: string;
  impact: string;
  priority: number; // Lower number means higher priority
}

interface UseInvestmentRecommendationsProps {
  investments: Investment[];
  riskAppetite: string; // From Tax Planner AI output
  totalCurrentValue: number;
  averageAnnualInterestRate: number;
  diversificationCount: number;
}

const getYearsToDouble = (annualRate: number) => {
  if (annualRate <= 0) return Infinity;
  return 72 / annualRate;
};

const INVESTMENT_TYPE_MAPPING: Record<string, string> = {
  'Savings Account': 'Savings',
  'Fixed Deposit': 'Fixed Deposit',
  'Recurring Deposit': 'Fixed Deposit',
  'Mutual Funds': 'Equity',
  'Stock Market': 'Equity',
  'PPF': 'Debt',
  'NSC': 'Debt',
  'ELSS': 'Equity',
  'Gold': 'Gold',
  'Real Estate': 'Real Estate',
  'Bonds': 'Debt',
  'Other': 'Other',
};

export const useInvestmentRecommendations = ({
  investments,
  riskAppetite,
  totalCurrentValue,
  averageAnnualInterestRate,
  diversificationCount,
}: UseInvestmentRecommendationsProps) => {
  const { user } = useAuth();
  const [recommendations, setRecommendations] = useState<Recommendation[]>([]);
  const [loading, setLoading] = useState(true);

  const generateRecommendations = useCallback(async () => {
    setLoading(true);
    const newRecommendations: Recommendation[] = [];

    if (!user || investments.length === 0) {
      setLoading(false);
      return;
    }

    const currentYearsToDouble = getYearsToDouble(averageAnnualInterestRate);

    // --- 1. Reallocation Suggestions (Low-yield to High-yield) ---
    const lowYieldInvestments = investments.filter(inv =>
      ['Savings Account', 'Fixed Deposit', 'Recurring Deposit'].includes(inv.investment_name) && inv.amount > 0
    );

    const totalLowYieldAmount = lowYieldInvestments.reduce((sum, inv) => sum + inv.amount, 0);
    const reallocationThreshold = 0.15 * totalCurrentValue; // 15% of total portfolio
    const minReallocateAmount = 50000; // Minimum amount to suggest reallocation

    if (
      totalLowYieldAmount > Math.max(reallocationThreshold, minReallocateAmount) &&
      (riskAppetite === 'moderate' || riskAppetite === 'aggressive')
    ) {
      const amountToReallocate = Math.min(totalLowYieldAmount * 0.25, 200000); // Suggest moving 25% of low yield, up to 2 Lakhs
      const targetInvestmentType = riskAppetite === 'aggressive' ? 'Stock Market' : 'Mutual Funds';
      const targetInterestRate = riskAppetite === 'aggressive' ? 15 : 12; // Higher rate for aggressive

      // Calculate hypothetical new average rate
      const hypotheticalTotalValue = totalCurrentValue; // Value remains same
      const hypotheticalNewTotalInterest =
        (totalCurrentValue * averageAnnualInterestRate / 100) -
        (amountToReallocate * lowYieldInvestments[0].interest_rate / 100) + // Subtract from low yield
        (amountToReallocate * targetInterestRate / 100); // Add to high yield

      const hypotheticalNewAverageRate = (hypotheticalNewTotalInterest / hypotheticalTotalValue) * 100;
      const hypotheticalNewYearsToDouble = getYearsToDouble(hypotheticalNewAverageRate);

      if (hypotheticalNewYearsToDouble < currentYearsToDouble) {
        newRecommendations.push({
          id: 'reallocate-low-yield',
          type: 'reallocation',
          title: 'Optimize Low-Yield Assets',
          description: `You have ${formatFullINR(totalLowYieldAmount)} in low-yield investments. Consider reallocating a portion to higher-growth options.`,
          action: `Move ${formatFullINR(amountToReallocate)} from Fixed Deposits/Savings to ${targetInvestmentType}.`,
          impact: `Potentially reduce doubling time from ${currentYearsToDouble.toFixed(1)} to ${hypotheticalNewYearsToDouble.toFixed(1)} years.`,
          priority: 1,
        });
      }
    }

    // --- 2. Additional Investment (SIP) Suggestions ---
    const targetDoublingYears = (riskAppetite === 'aggressive' ? 3 : (riskAppetite === 'moderate' ? 5 : 7));
    if (currentYearsToDouble > targetDoublingYears) {
      // Estimate required SIP to achieve target doubling time
      // This is a simplified estimation. A more complex calculation would involve future value of annuity.
      // For now, let's suggest a fixed SIP and show its potential impact.
      const suggestedSIP = 5000; // Suggest a base SIP of ₹5,000
      const sipInvestmentType = riskAppetite === 'aggressive' ? 'ELSS Mutual Funds' : 'Diversified Equity Mutual Funds';
      const sipInterestRate = riskAppetite === 'aggressive' ? 15 : 12; // Assumed return for SIP

      // To calculate impact, we'd need to project future value with SIP.
      // For simplicity, let's state the benefit of consistent investment.
      newRecommendations.push({
        id: 'additional-sip',
        type: 'additional_investment',
        title: 'Boost Growth with Regular Investments',
        description: `Your current portfolio might take ${currentYearsToDouble.toFixed(1)} years to double. Regular investments can significantly accelerate this.`,
        action: `Start a monthly SIP of ${formatFullINR(suggestedSIP)} in ${sipInvestmentType}.`,
        impact: `Consistent SIPs can drastically reduce your doubling time and build substantial wealth over time.`,
        priority: 2,
      });
    }

    // --- 3. Diversification Improvement ---
    if (diversificationCount < 3) { // If less than 3 distinct investment types
      newRecommendations.push({
        id: 'improve-diversification',
        type: 'diversification',
        title: 'Enhance Portfolio Diversification',
        description: 'Your portfolio could benefit from broader diversification to mitigate risk.',
        action: 'Consider exploring asset classes like Gold ETFs or Debt Funds to balance your portfolio.',
        impact: 'Reduces overall portfolio risk and can provide stability during market volatility.',
        priority: 3,
      });
    }

    // Sort recommendations by priority
    newRecommendations.sort((a, b) => a.priority - b.priority);
    setRecommendations(newRecommendations);
    setLoading(false);
  }, [user, investments, riskAppetite, totalCurrentValue, averageAnnualInterestRate, diversificationCount]);

  useEffect(() => {
    generateRecommendations();
  }, [generateRecommendations]);

  return { recommendations, loading };
};