// This page is a legacy Supabase-based onboarding flow that is no longer used.
// The active onboarding experience is handled by OnboardingModal.tsx which
// triggers automatically after signup via the dashboard (Index.tsx).
// This file redirects to the dashboard to prevent any accidental access.

import { useEffect } from "react";
import { useNavigate } from "react-router-dom";

const Onboarding = () => {
  const navigate = useNavigate();

  useEffect(() => {
    navigate("/dashboard", { replace: true });
  }, [navigate]);

  return null;
};

export default Onboarding;
