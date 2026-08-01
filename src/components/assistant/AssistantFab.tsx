"use client";

import { Mic } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";

interface AssistantFabProps {
  onClick: () => void;
}

/**
 * The always-available quick-add button.
 *
 * Tapping it opens the assistant sheet *and* starts listening in one go — the
 * sheet auto-starts capture on open — which is why the label promises
 * listening rather than just naming the panel.
 *
 * Positioning matches the in-page FAB on the Expenses screen: 6rem (bottom-24)
 * on mobile so it clears the bottom nav, 1.5rem (bottom-6) on desktop.
 * Deliberately z-40, not z-50 — the PWA and APK install prompts both sit at
 * bottom-4 right-4 with z-50, so this stays out of their way while still
 * floating above content.
 *
 * The offset is driven by a --fab-bottom custom property rather than the
 * bottom-24 / md:bottom-6 utilities directly, because under Android 15
 * edge-to-edge the FAB also has to clear the gesture bar. An inline
 * `bottom` would beat the md: breakpoint override, so the responsive part
 * stays in Tailwind and the inset is added on top in calc(). The var()
 * fallback keeps the mobile offset correct even if the utility is ever
 * dropped from the JIT output.
 */
export const AssistantFab = ({ onClick }: AssistantFabProps) => {
  const { user } = useAuth();

  // Nothing to log against until someone is signed in.
  if (!user) return null;

  return (
    <button
      type="button"
      onClick={onClick}
      aria-label="Start voice quick add — begins listening"
      className="pointer-events-auto fixed right-4 [--fab-bottom:6rem] md:[--fab-bottom:1.5rem] h-14 w-14 rounded-full z-40 flex items-center justify-center text-white transition-transform hover:scale-105 active:scale-95"
      style={{
        bottom: "calc(var(--fab-bottom, 6rem) + env(safe-area-inset-bottom, 0px))",
        background: "linear-gradient(135deg, #1E3A8A, #2563EB)",
        boxShadow: "0 8px 24px rgba(37, 99, 235, 0.35)",
      }}
    >
      <Mic className="h-6 w-6" />
    </button>
  );
};
