"use client";

/**
 * TaxCopilot — the single tax surface.
 *
 * Merges what used to be two pages: the conversational co-pilot
 * (/tax-assistant) and the Tax hub (/tax-optimization). Chat is the front
 * door; the tools sit underneath.
 *
 * The conversation is tax-only by design. When an LLM key is configured it
 * handles comprehension (see lib/assistant/taxCopilot.ts); the deterministic
 * engine always computes the numbers, whether or not a key is present.
 */

import { useState, useRef, useEffect, useMemo, useCallback } from "react";
import { AppLayout } from "@/components/layout/AppLayout";
import { GlassCard } from "@/components/ui/glass-card";
import { useTaxState } from "@/hooks/useTaxState";
import { getTaxWhispers, itrDraftToJSON, inr, type Whisper } from "@/lib/tax";
import { answerTaxQuestion, type CopilotAnswer } from "@/lib/assistant/taxCopilot";
import { getLLMConfig } from "@/lib/assistant/settings";
import { exportTextFile } from "@/lib/fileExport";
import {
  Sparkles, Send, TrendingDown, Clock, AlertCircle, Mic, FileDown,
  BarChart3, Briefcase, ClipboardCheck, ChevronRight, ArrowRight,
  Building2, Home, User as UserIcon, Loader2, WifiOff,
} from "lucide-react";
import { getISTDate, getCurrentFinancialYear } from "@/lib/date-utils";
import { useSpeechRecognition } from "@/hooks/useSpeechRecognition";
import { useAuth } from "@/contexts/AuthContext";
import { useNavigate } from "react-router-dom";
import { formatFullINR } from "@/lib/currency";
import { cn } from "@/lib/utils";
import {
  getTaxPlannerOutput,
  getTaxPlannerInput,
} from "@/integrations/indexeddb/services/taxPlannerService";
import type { IncomeStream } from "@/pages/TaxPlannerAI";

const WHISPER_ICON: Record<Whisper["severity"], typeof Clock> = {
  deadline: Clock,
  opportunity: TrendingDown,
  info: AlertCircle,
};

const STREAM_META: Record<IncomeStream, { label: string; icon: React.ComponentType<{ className?: string }> }> = {
  salary:        { label: "Salary / Pension",    icon: Briefcase },
  business:      { label: "Business (44AD)",      icon: Building2 },
  professional:  { label: "Professional (44ADA)", icon: UserIcon  },
  rental:        { label: "Rental Income",        icon: Home      },
  capital_gains: { label: "Capital Gains",        icon: BarChart3 },
};

interface TaxModule {
  title: string;
  description: string;
  route: string;
  icon: React.ComponentType<{ className?: string }>;
  colorBg: string;
  colorIcon: string;
}

const SECONDARY_MODULES: TaxModule[] = [
  {
    title: "Capital Gains",
    description: "Buy/sell tracker with LTCG & STCG tax calculation",
    route: "/capital-gains",
    icon: BarChart3,
    colorBg: "bg-amber-100",
    colorIcon: "text-amber-600",
  },
  {
    title: "Salary Restructuring",
    description: "Optimise CTC components to reduce taxable income",
    route: "/salary-restructuring",
    icon: Briefcase,
    colorBg: "bg-indigo-100",
    colorIcon: "text-indigo-600",
  },
];

const COMPLIANCE_MODULE: TaxModule = {
  title: "Tax Compliance",
  description: "Deadlines, advance tax tracker & ITR readiness checklist",
  route: "/tax-compliance",
  icon: ClipboardCheck,
  colorBg: "bg-emerald-100",
  colorIcon: "text-emerald-600",
};

interface ChatMessage {
  role: "user" | "assistant";
  text: string;
  suggestions?: string[];
  offline?: boolean;
}

const GREETING: ChatMessage = {
  role: "assistant",
  text:
    "I'm your tax co-pilot. I read what you've logged this year and answer in plain English. Ask me anything about your tax — or tap a question below.",
  suggestions: [
    "Where do I stand?",
    "How can I save more tax?",
    "Which regime should I pick?",
    "What is 80C?",
  ],
};

const TaxCopilot = () => {
  const { state, loading } = useTaxState();
  const { user } = useAuth();
  const navigate = useNavigate();
  const currentFY = getCurrentFinancialYear();

  const [messages, setMessages] = useState<ChatMessage[]>([GREETING]);
  const [input, setInput] = useState("");
  const [thinking, setThinking] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  // ── Tax hub data (from the old Tax page) ────────────────────────────────
  const [hubLoading,        setHubLoading]        = useState(true);
  const [estimatedTax,      setEstimatedTax]      = useState<number | null>(null);
  const [oldRegimeTax,      setOldRegimeTax]      = useState<number | null>(null);
  const [newRegimeTax,      setNewRegimeTax]      = useState<number | null>(null);
  const [potentialSavings,  setPotentialSavings]  = useState<number | null>(null);
  const [recommendedRegime, setRecommendedRegime] = useState<string | null>(null);
  const [activeStreams,     setActiveStreams]     = useState<IncomeStream[]>([]);
  const [hasData,           setHasData]           = useState(false);
  const [simulationName,    setSimulationName]    = useState<string | null>(null);

  useEffect(() => {
    const load = async () => {
      if (!user) { setHubLoading(false); return; }
      try {
        const inputData = await getTaxPlannerInput(user.id);
        if (inputData?.active_income_streams) {
          try {
            setActiveStreams(JSON.parse(inputData.active_income_streams) as IncomeStream[]);
          } catch { /* malformed stream list — show none */ }
        }
        if ((inputData as any)?.simulation_name) {
          setSimulationName((inputData as any).simulation_name);
        }

        const data = await getTaxPlannerOutput(user.id);
        if (data?.recommendations_json) {
          const rec = data.recommendations_json as any;
          const oldTax = rec.taxLiabilityOld || 0;
          const newTax = rec.taxLiabilityNew || 0;
          setEstimatedTax(Math.min(oldTax, newTax));
          setOldRegimeTax(oldTax);
          setNewRegimeTax(newTax);
          setPotentialSavings(rec.potentialSavings || 0);
          setRecommendedRegime(rec.recommendedRegime || null);
          setHasData(true);
        }
      } catch { /* hub is supplementary — chat still works without it */ }
      finally { setHubLoading(false); }
    };
    load();
  }, [user]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, thinking]);

  useEffect(() => () => abortRef.current?.abort(), []);

  const ask = useCallback(
    async (question: string) => {
      const q = question.trim();
      if (!q || thinking) return;

      setMessages((prev) => [...prev, { role: "user", text: q }]);
      setInput("");

      if (!state) {
        setMessages((prev) => [...prev, {
          role: "assistant",
          text: "I don't have your numbers yet. Add your income and a few expenses first, then ask me again.",
        }]);
        return;
      }

      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      setThinking(true);

      try {
        const answer: CopilotAnswer = await answerTaxQuestion(
          q, state, getLLMConfig(), controller.signal,
        );
        if (controller.signal.aborted) return;
        setMessages((prev) => [...prev, {
          role: "assistant",
          text: answer.text,
          suggestions: answer.suggestions,
          // Flag only when a key exists but we still had to fall back.
          offline: !answer.usedLLM && getLLMConfig() !== null,
        }]);
      } catch {
        // answerTaxQuestion only throws when the request was cancelled — which
        // means a newer question is already in flight. Nothing to show.
      } finally {
        if (!controller.signal.aborted) setThinking(false);
      }
    },
    [state, thinking],
  );

  const {
    supported: micSupported,
    listening,
    start: startListening,
    stop: stopListening,
  } = useSpeechRecognition({ onResult: (text) => void ask(text) });

  const projected = state?.computation;
  const recTax =
    projected &&
    (projected.recommendedRegime === "new" ? projected.new.totalTax : projected.old.totalTax);

  const whispers = useMemo(
    () => (state ? getTaxWhispers({ state, today: getISTDate() }) : []),
    [state],
  );

  // Routed through exportTextFile because an anchor `download` is a silent
  // no-op inside the Android WebView — on native this writes the file and
  // opens the share sheet instead.
  const downloadITRDraft = async () => {
    if (!state) return;
    try {
      await exportTextFile(
        `ITR-draft-${state.financialYear}.json`,
        itrDraftToJSON(state),
        "application/json",
      );
    } catch {
      /* user dismissed the share sheet, or storage refused */
    }
  };

  return (
    <AppLayout>
      <div className="max-w-2xl mx-auto space-y-6 mt-2 pb-6">

        {/* ── Header / tax pulse ──────────────────────────────────────── */}
        <div className="flex items-center gap-3 px-1">
          <div className="h-10 w-10 rounded-2xl bg-primary/10 flex items-center justify-center shrink-0">
            <Sparkles className="h-5 w-5 text-primary" />
          </div>
          <div className="min-w-0 flex-1">
            <h1 className="text-base font-bold text-foreground leading-tight">Tax Copilot</h1>
            {loading ? (
              <p className="text-xs text-muted-foreground">Reading your numbers…</p>
            ) : recTax != null ? (
              <p className="text-xs text-muted-foreground">
                Projected tax:{" "}
                <span className="font-semibold text-foreground">{inr(recTax)}</span>{" "}
                <span className="uppercase text-[10px]">({projected!.recommendedRegime} regime)</span>
              </p>
            ) : (
              <p className="text-xs text-muted-foreground">Add income & expenses to see your position</p>
            )}
          </div>
          {state && (
            <button
              type="button"
              onClick={() => void downloadITRDraft()}
              title="Download ITR draft (JSON)"
              className="flex items-center gap-1 rounded-full border border-border/60 bg-background/60 px-2.5 py-1.5 text-[11px] font-medium text-muted-foreground hover:text-foreground hover:border-primary/40 pointer-events-auto shrink-0"
            >
              <FileDown className="h-3.5 w-3.5" /> ITR draft
            </button>
          )}
        </div>

        {/* ── Proactive whispers ──────────────────────────────────────── */}
        {whispers.length > 0 && (
          <div className="space-y-2">
            {whispers.map((w) => {
              const Icon = WHISPER_ICON[w.severity];
              const tappable = !!w.ask;
              return (
                <button
                  key={w.id}
                  type="button"
                  disabled={!tappable}
                  onClick={() => w.ask && void ask(w.ask)}
                  className={cn(
                    "w-full flex items-start gap-2 rounded-xl border px-3 py-2 text-left",
                    tappable && "pointer-events-auto",
                    w.severity === "deadline"
                      ? "border-amber-500/25 bg-amber-500/5"
                      : "border-primary/20 bg-primary/5",
                  )}
                >
                  <Icon className={cn(
                    "h-4 w-4 shrink-0 mt-0.5",
                    w.severity === "deadline" ? "text-amber-500" : "text-primary",
                  )} />
                  <div className="min-w-0">
                    <p className="text-[11px] font-semibold text-foreground leading-tight">{w.title}</p>
                    <p className="text-[10px] text-muted-foreground leading-snug mt-0.5">{w.detail}</p>
                  </div>
                </button>
              );
            })}
          </div>
        )}

        {/* ── Conversation ────────────────────────────────────────────── */}
        <div className="flex flex-col rounded-2xl border border-border/50 bg-background/40 p-3">
          <div ref={scrollRef} className="flex-1 overflow-y-auto space-y-3 pb-2 max-h-[45vh] min-h-[220px]">
            {messages.map((m, i) => (
              <div key={i} className={cn("flex", m.role === "user" ? "justify-end" : "justify-start")}>
                <div className="max-w-[85%] space-y-2">
                  <div
                    className={cn(
                      "rounded-2xl px-3.5 py-2.5 text-sm whitespace-pre-line",
                      m.role === "user"
                        ? "bg-primary text-white rounded-br-md"
                        : "bg-muted/70 text-foreground rounded-bl-md",
                    )}
                  >
                    {m.text}
                  </div>
                  {m.offline && (
                    <p className="flex items-center gap-1 text-[10px] text-muted-foreground">
                      <WifiOff className="h-3 w-3" />
                      Answered offline — couldn’t reach your AI provider.
                    </p>
                  )}
                  {m.role === "assistant" && m.suggestions && m.suggestions.length > 0 && (
                    <div className="flex flex-wrap gap-1.5">
                      {m.suggestions.map((s) => (
                        <button
                          key={s}
                          type="button"
                          onClick={() => void ask(s)}
                          className="px-2.5 py-1 rounded-full border border-border/60 bg-background/60 text-[11px] font-medium text-foreground hover:border-primary/40 pointer-events-auto"
                        >
                          {s}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            ))}

            {thinking && (
              <div className="flex justify-start">
                <div className="flex items-center gap-2 rounded-2xl rounded-bl-md bg-muted/70 px-3.5 py-2.5">
                  <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
                  <span className="text-xs text-muted-foreground">Thinking…</span>
                </div>
              </div>
            )}
          </div>

          {/* Composer */}
          <form
            onSubmit={(e) => { e.preventDefault(); void ask(input); }}
            className="flex items-center gap-2 pt-2 border-t border-border/50"
          >
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder={listening ? "Listening…" : "Ask about your tax…"}
              className="flex-1 bg-muted/50 rounded-full px-4 py-2.5 text-sm text-foreground outline-none placeholder:text-muted-foreground/50 focus:ring-1 focus:ring-primary/40 pointer-events-auto"
            />
            {micSupported && (
              <button
                type="button"
                onClick={() => (listening ? stopListening() : startListening())}
                aria-label={listening ? "Stop listening" : "Ask by voice"}
                className={cn(
                  "h-10 w-10 rounded-full flex items-center justify-center pointer-events-auto shrink-0 transition-colors",
                  listening
                    ? "bg-destructive text-white animate-pulse"
                    : "bg-muted/60 text-muted-foreground hover:text-foreground",
                )}
              >
                <Mic className="h-4 w-4" />
              </button>
            )}
            <button
              type="submit"
              disabled={!input.trim() || thinking}
              className="h-10 w-10 rounded-full bg-primary text-white flex items-center justify-center disabled:opacity-40 pointer-events-auto shrink-0"
            >
              <Send className="h-4 w-4" />
            </button>
          </form>
        </div>

        {/* ── Tax tools ───────────────────────────────────────────────── */}
        <div className="space-y-3">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground px-1">
            Tax tools · FY {currentFY}
          </p>

          {/* Featured: AI Tax Planner */}
          <div
            onClick={() => navigate("/tax-planner-ai")}
            className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-amber-500 via-amber-600 to-orange-600 p-5 cursor-pointer active:scale-98 transition-transform pointer-events-auto shadow-lg"
          >
            <div className="absolute top-0 right-0 w-32 h-32 rounded-full bg-white/10 -translate-y-8 translate-x-8" />
            <div className="absolute bottom-0 right-8 w-16 h-16 rounded-full bg-white/10 translate-y-6" />

            <div className="relative">
              <div className="flex items-start justify-between mb-3">
                <div className="flex items-center gap-2.5">
                  <div className="h-10 w-10 rounded-xl bg-white/20 flex items-center justify-center">
                    <Sparkles className="h-5 w-5 text-white" />
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <p className="text-white font-bold text-base">AI Tax Planner</p>
                      <span className="text-[9px] font-bold bg-white/25 text-white px-1.5 py-0.5 rounded-full">
                        CA-Grade
                      </span>
                    </div>
                    <p className="text-white/70 text-[11px]">Full simulation across every income stream</p>
                  </div>
                </div>
                <ChevronRight className="h-5 w-5 text-white/60 mt-0.5" />
              </div>

              {hasData && estimatedTax !== null ? (
                <div className="space-y-3">
                  {simulationName && (
                    <p className="text-white/60 text-[10px] uppercase tracking-wide font-semibold">
                      Simulation: {simulationName}
                    </p>
                  )}
                  <div className="grid grid-cols-2 gap-3">
                    <div className="bg-white/15 rounded-xl px-3 py-2.5">
                      <p className="text-white/60 text-[10px]">Estimated Tax</p>
                      <p className="text-white font-bold text-lg leading-tight">
                        {formatFullINR(estimatedTax)}
                      </p>
                      {recommendedRegime && (
                        <p className="text-white/70 text-[10px] mt-0.5">{recommendedRegime}</p>
                      )}
                    </div>
                    {potentialSavings !== null && potentialSavings > 0 && (
                      <div className="bg-white/15 rounded-xl px-3 py-2.5">
                        <p className="text-white/60 text-[10px]">You can save</p>
                        <p className="text-white font-bold text-lg leading-tight">
                          {formatFullINR(potentialSavings)}
                        </p>
                        <p className="text-white/70 text-[10px] mt-0.5">with optimisation</p>
                      </div>
                    )}
                  </div>

                  {oldRegimeTax !== null && newRegimeTax !== null && (
                    <div className="space-y-1.5">
                      {[
                        { label: "Old Regime", value: oldRegimeTax, isRec: recommendedRegime === "Old Regime" },
                        { label: "New Regime", value: newRegimeTax, isRec: recommendedRegime === "New Regime" },
                      ].map(({ label, value, isRec }) => {
                        const max = Math.max(oldRegimeTax, newRegimeTax, 1);
                        const pct = Math.round((value / max) * 100);
                        return (
                          <div key={label}>
                            <div className="flex items-center justify-between mb-0.5">
                              <span className="text-[10px] text-white/70 flex items-center gap-1">
                                {label}
                                {isRec && <span className="text-[9px] bg-white/20 text-white px-1 rounded-full">Best ✓</span>}
                              </span>
                              <span className="text-[10px] font-semibold text-white">{formatFullINR(value)}</span>
                            </div>
                            <div className="h-1 bg-white/20 rounded-full overflow-hidden">
                              <div
                                className={cn("h-full rounded-full", isRec ? "bg-white" : "bg-white/40")}
                                style={{ width: `${pct}%` }}
                              />
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}

                  {activeStreams.length > 0 && (
                    <div className="flex flex-wrap gap-1.5 pt-1">
                      {activeStreams.map((s) => {
                        const meta = STREAM_META[s];
                        if (!meta) return null;
                        const Icon = meta.icon;
                        return (
                          <div key={s} className="flex items-center gap-1 bg-white/15 rounded-lg px-2 py-0.5">
                            <Icon className="h-2.5 w-2.5 text-white/70" />
                            <span className="text-[9px] text-white/80 font-medium">{meta.label}</span>
                          </div>
                        );
                      })}
                    </div>
                  )}

                  <button className="w-full flex items-center justify-center gap-1.5 bg-white/20 hover:bg-white/30 text-white text-xs font-semibold h-9 rounded-xl transition-colors pointer-events-auto">
                    Update Simulation <ArrowRight className="h-3.5 w-3.5" />
                  </button>
                </div>
              ) : !hubLoading ? (
                <div className="space-y-2">
                  <p className="text-white/80 text-xs leading-relaxed">
                    Get a CA-grade tax analysis — regime comparison, investment recommendations, and your exact tax liability across all income sources.
                  </p>
                  <button className="w-full flex items-center justify-center gap-1.5 bg-white text-amber-700 text-xs font-bold h-10 rounded-xl hover:bg-white/90 transition-colors pointer-events-auto">
                    <Sparkles className="h-3.5 w-3.5" /> Get My Tax Plan
                  </button>
                </div>
              ) : (
                <div className="h-16 bg-white/10 rounded-xl animate-pulse" />
              )}
            </div>
          </div>

          {/* Secondary modules */}
          <div className="grid grid-cols-2 gap-3">
            {SECONDARY_MODULES.map((mod) => {
              const Icon = mod.icon;
              return (
                <GlassCard
                  key={mod.route}
                  className="p-3.5 cursor-pointer hover:shadow-md hover:-translate-y-0.5 transition-all active:scale-95 pointer-events-auto"
                  onClick={() => navigate(mod.route)}
                >
                  <div className="flex items-start justify-between mb-2.5">
                    <div className={cn("h-8 w-8 rounded-lg flex items-center justify-center", mod.colorBg)}>
                      <Icon className={cn("h-4 w-4", mod.colorIcon)} />
                    </div>
                    <ChevronRight className="h-3.5 w-3.5 text-muted-foreground/50" />
                  </div>
                  <p className="text-xs font-bold text-foreground leading-tight">{mod.title}</p>
                  <p className="text-[11px] text-muted-foreground mt-0.5 leading-relaxed line-clamp-2">
                    {mod.description}
                  </p>
                </GlassCard>
              );
            })}
          </div>

          {/* Compliance */}
          <GlassCard
            className="p-4 cursor-pointer hover:shadow-md transition-all active:scale-98 pointer-events-auto"
            onClick={() => navigate(COMPLIANCE_MODULE.route)}
          >
            <div className="flex items-center gap-3">
              <div className={cn("h-10 w-10 rounded-xl flex items-center justify-center shrink-0", COMPLIANCE_MODULE.colorBg)}>
                <ClipboardCheck className={cn("h-5 w-5", COMPLIANCE_MODULE.colorIcon)} />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-bold text-foreground">{COMPLIANCE_MODULE.title}</p>
                <p className="text-xs text-muted-foreground mt-0.5">{COMPLIANCE_MODULE.description}</p>
              </div>
              <ChevronRight className="h-4 w-4 text-muted-foreground/50 shrink-0" />
            </div>
          </GlassCard>
        </div>

      </div>
    </AppLayout>
  );
};

export default TaxCopilot;
