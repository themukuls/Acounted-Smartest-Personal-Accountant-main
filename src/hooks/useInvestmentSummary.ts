"use client";

import { useState, useEffect, useCallback } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { getInvestmentTypes } from "@/integrations/indexeddb/services/onboardingService"; // Import IndexedDB service
import { getIncomeDetails } from "@/integrations/indexeddb/services/onboardingService"; // Import IndexedDB service for risk appetite

interface Investment {
  id: string;
  investment_name: string;
  amount: number;
  investment_type: string;
  risk_level: string;
  interest_rate: number;
}

interface DiversificationData {
  name: string;
  value: number;
  color: string;
}

// Colors for diversification chart
const DIVERSIFICATION_COLORS: Record<string, string> = {
  'Savings': '#8884d8', // Purple
  'Equity': '#82ca9d',  // Green
  'Fixed Deposit': '#ffc658', // Yellow
  'Debt': '#ff7300',   // Orange
  'Gold': '#0088FE',   // Blue
  'Real Estate': '#00C49F', // Teal
  'Other': '#FFBB28',  // Gold
};

interface UseInvestmentSummaryReturn {
  loading: boolean;
  investments: Investment[];
  totalCurrentValue: number;
  totalMonthlyGrowth: number;
  averageAnnualInterestRate: number;
  diversificationData: DiversificationData[];
  diversificationCount: number;
  userRiskAppetite: string;
  refreshSummary: () => void;
}

export const useInvestmentSummary = (onboardingCompleted: boolean): UseInvestmentSummaryReturn => {
  const { user } = useAuth();
  const [loading, setLoading] = useState(true);
  const [investments, setInvestments] = useState<Investment[]>([]);
  const [totalCurrentValue, setTotalCurrentValue] = useState(0);
  const [totalMonthlyGrowth, setTotalMonthlyGrowth] = useState(0);
  const [averageAnnualInterestRate, setAverageAnnualInterestRate] = useState(0);
  const [diversificationData, setDiversificationData] = useState<DiversificationData[]>([]);
  const [diversificationCount, setDiversificationCount] = useState(0);
  const [userRiskAppetite, setUserRiskAppetite] = useState('moderate');
  const [refreshTrigger, setRefreshTrigger] = useState(0);

  const refreshSummary = useCallback(() => {
    setRefreshTrigger(prev => prev + 1);
  }, []);

  const fetchInvestmentData = useCallback(async () => {
    if (!user || !onboardingCompleted) {
      setLoading(false);
      console.log('useInvestmentSummary: Skipping fetch. User or onboarding not ready.');
      return;
    }

    setLoading(true);
    console.log('useInvestmentSummary: fetchInvestmentData called. onboardingCompleted:', onboardingCompleted);
    try {
      // Fetch investments from IndexedDB
      const investmentsData = await getInvestmentTypes(user.id);
      setInvestments(investmentsData || []);
      console.log('useInvestmentSummary: Fetched investments from IndexedDB:', investmentsData);

      // Fetch risk appetite from income_details (where tax planner input is stored in IndexedDB)
      const incomeDetails = await getIncomeDetails(user.id);
      
      if (incomeDetails && incomeDetails.form_data && typeof incomeDetails.form_data === 'object' && 'risk_appetite' in incomeDetails.form_data) {
        setUserRiskAppetite((incomeDetails.form_data as any).risk_appetite);
      } else {
        setUserRiskAppetite('moderate'); // Default if not found
      }

      // Calculate summary metrics
      const calculatedTotalCurrentValue = (investmentsData || []).reduce((total, investment) => total + investment.amount, 0);
      setTotalCurrentValue(calculatedTotalCurrentValue);
      console.log('useInvestmentSummary: Calculated totalCurrentValue:', calculatedTotalCurrentValue);

      const calculatedTotalMonthlyGrowth = (investmentsData || []).reduce((total, investment) => {
        const monthlyRate = (investment.interest_rate || 0) / 12 / 100; // Handle null interest_rate
        return total + (investment.amount * monthlyRate);
      }, 0);
      setTotalMonthlyGrowth(calculatedTotalMonthlyGrowth);

      const calculatedAverageAnnualInterestRate = calculatedTotalCurrentValue > 0
        ? (investmentsData || []).reduce((sum, inv) => sum + (inv.amount * (inv.interest_rate || 0)), 0) / calculatedTotalCurrentValue
        : 0;
      setAverageAnnualInterestRate(calculatedAverageAnnualInterestRate);

      const diversificationMap: Record<string, number> = {};
      (investmentsData || []).forEach(inv => {
        const type = inv.investment_type.charAt(0).toUpperCase() + inv.investment_type.slice(1);
        diversificationMap[type] = (diversificationMap[type] || 0) + inv.amount;
      });

      const calculatedDiversificationData = Object.entries(diversificationMap).map(([name, value]) => ({
        name,
        value,
        color: DIVERSIFICATION_COLORS[name] || DIVERSIFICATION_COLORS['Other'],
      }));
      setDiversificationData(calculatedDiversificationData);
      setDiversificationCount(calculatedDiversificationData.length);

    } catch (error) {
      console.error('Error fetching investment summary:', error);
      // Reset states on error
      setInvestments([]);
      setTotalCurrentValue(0);
      setTotalMonthlyGrowth(0);
      setAverageAnnualInterestRate(0);
      setDiversificationData([]);
      setDiversificationCount(0);
      setUserRiskAppetite('moderate');
    } finally {
      setLoading(false);
    }
  }, [user, onboardingCompleted, refreshTrigger]);

  useEffect(() => {
    fetchInvestmentData();
  }, [fetchInvestmentData]);

  return {
    loading,
    investments,
    totalCurrentValue,
    totalMonthlyGrowth,
    averageAnnualInterestRate,
    diversificationData,
    diversificationCount,
    userRiskAppetite,
    refreshSummary,
  };
};