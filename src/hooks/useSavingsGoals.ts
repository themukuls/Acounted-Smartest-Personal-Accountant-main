"use client";

import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthContext";
import { getSavingsGoals } from "@/integrations/indexeddb/services/savingsGoalService";

interface SavingsGoal {
  id: string;
  goal_name: string;
  goal_amount: number;
  target_months: number;
  created_at: string;
  monthly_save_amount: number | null;
  weekly_save_amount: number | null;
  monthly_spend_amount: number | null;
  weekly_spend_amount: number | null;
}

export const useSavingsGoals = (onboardingCompleted: boolean) => {
  const { user } = useAuth();

  return useQuery<SavingsGoal[], Error>({
    queryKey: ['savingsGoals', user?.id],
    queryFn: async () => {
      if (!user || !onboardingCompleted) {
        return [];
      }
      const goals = await getSavingsGoals(user.id);
      return goals || [];
    },
    enabled: !!user && onboardingCompleted,
    staleTime: 1000 * 60 * 2, // Data considered fresh for 2 minutes
    refetchOnWindowFocus: true,
  });
};