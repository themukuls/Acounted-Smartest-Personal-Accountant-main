"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  Sheet, SheetContent, SheetHeader, SheetTitle,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthContext";
import { useSpeechRecognition } from "@/hooks/useSpeechRecognition";
import { useIsMobile } from "@/hooks/use-mobile";
import { cn } from "@/lib/utils";
import { Send, Sparkles, Loader2, AlertCircle, Settings2, RotateCcw } from "lucide-react";
import { DEFAULT_CATEGORIES } from "@/lib/categories";
import { getLLMConfig } from "@/lib/assistant/settings";
import { createExtractDeps, extractAction } from "@/lib/assistant/extract";
import { applyAction, ApplyError } from "@/lib/assistant/apply";
import { ProviderError } from "@/lib/assistant/providers";
import { isWritable, type AssistantAction, type WritableAction } from "@/lib/assistant/types";
import { ActionReviewCard } from "./ActionReviewCard";
import { VoiceOrb, type VoiceOrbState } from "./VoiceOrb";

interface AssistantSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Opens the settings modal — used by the "not configured" CTA. */
  onOpenSettings: () => void;
}

type Phase = "idle" | "thinking" | "review" | "saving";

const EXAMPLES = [
  "Spent 450 on groceries yesterday",
  "Paid 1200 for petrol on my credit card",
  "Rahul owes me 2000, due next month",
];

export const AssistantSheet = ({ open, onOpenChange, onOpenSettings }: AssistantSheetProps) => {
  const { user } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const isMobile = useIsMobile();

  const [phase, setPhase]       = useState<Phase>("idle");
  const [text, setText]         = useState("");
  const [action, setAction]     = useState<WritableAction | null>(null);
  const [message, setMessage]   = useState<string | null>(null);
  const [categorySlugs, setCategorySlugs] = useState<string[]>(
    DEFAULT_CATEGORIES.map((c) => c.category_name),
  );

  const configured = getLLMConfig() !== null;
  const abortRef = useRef<AbortController | null>(null);

  // Read inside the speech callback, which can fire a beat after the sheet has
  // already been dismissed. Kept as a ref so the callback never goes stale.
  const openRef = useRef(open);
  openRef.current = open;

  const runExtraction = useCallback(
    async (utterance: string) => {
      const trimmed = utterance.trim();
      if (!trimmed || !user) return;

      const config = getLLMConfig();
      if (!config) {
        setMessage("Add an API key in AI Assistant settings to use this.");
        return;
      }

      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      setPhase("thinking");
      setMessage(null);
      setAction(null);

      try {
        const deps = await createExtractDeps(config, user.id, controller.signal);
        setCategorySlugs(deps.categorySlugs);

        const result: AssistantAction = await extractAction(trimmed, deps);
        if (controller.signal.aborted) return;

        if (!isWritable(result)) {
          setPhase("idle");
          setMessage(result.reason);
          return;
        }

        setAction(result);
        setPhase("review");
      } catch (err) {
        if (controller.signal.aborted) return;
        setPhase("idle");
        setMessage(
          err instanceof ProviderError ? err.friendlyMessage : (err as Error).message,
        );
      }
    },
    [user],
  );

  // Voice input feeds the same path as typing.
  const {
    supported: micSupported,
    listening,
    starting: micStarting,
    denied: micDenied,
    start: startListening,
    stop: stopListening,
    abort: abortListening,
  } = useSpeechRecognition({
    onResult: (heard) => {
      // A native recogniser can resolve just after dismissal; don't reanimate a
      // sheet the user has closed.
      if (!openRef.current) return;
      setText(heard);
      void runExtraction(heard);
    },
  });

  // Reset everything when the sheet closes, and cancel any in-flight work.
  // abort() rather than stop(): stop() finalises the utterance and would still
  // deliver a transcript for a sheet nobody is looking at.
  useEffect(() => {
    if (open) return;
    abortRef.current?.abort();
    abortRef.current = null;
    abortListening();
    setPhase("idle");
    setText("");
    setAction(null);
    setMessage(null);
  }, [open, abortListening]);

  /**
   * Listen the moment the sheet opens — the whole point of the FAB is that one
   * tap starts capture. Latched on a ref so it fires exactly once per opening
   * and never restarts when the phase cycles back to idle.
   *
   * Deliberately skipped when the mic was refused: re-firing the request on
   * every open would nag, and on web it would throw an instant error that
   * flickers the orb. The user can still tap the orb to retry by hand.
   * `micSupported` is a dependency because on native it only flips true after
   * the plugin's async availability probe answers.
   */
  const autoStartedRef = useRef(false);
  useEffect(() => {
    if (!open) {
      autoStartedRef.current = false;
      return;
    }
    if (autoStartedRef.current) return;
    if (!configured || !micSupported || micDenied) return;
    autoStartedRef.current = true;
    void startListening();
  }, [open, configured, micSupported, micDenied, startListening]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    void runExtraction(text);
  };

  const handleSave = async () => {
    if (!action || !user) return;

    if (!Number.isFinite(action.amount) || action.amount <= 0) {
      toast({ title: "Check the amount", description: "Enter an amount greater than zero.", variant: "destructive" });
      return;
    }

    setPhase("saving");
    try {
      const { summary, invalidate } = await applyAction(user.id, action);
      invalidate.forEach((queryKey) => queryClient.invalidateQueries({ queryKey }));
      toast({ title: "Saved", description: summary });
      onOpenChange(false);
    } catch (err) {
      setPhase("review");
      toast({
        title: "Could not save",
        description: err instanceof ApplyError ? err.message : (err as Error).message,
        variant: "destructive",
      });
    }
  };

  /** Tapping the orb: stop a live capture, otherwise (re)start one. */
  const handleOrbTap = () => {
    if (phase === "thinking") return;
    if (listening || micStarting) {
      stopListening();
      return;
    }
    void startListening();
  };

  const orbState: VoiceOrbState =
    phase === "thinking" ? "thinking"
      : micDenied      ? "denied"
      : listening      ? "listening"
      : micStarting    ? "waking"
      : "idle";

  const orbCaption =
    phase === "thinking" ? "Working it out…"
      : micDenied     ? "Microphone access is off. Allow it in your browser or system settings, or just type it below."
      : micStarting   ? "Waiting for microphone access…"
      : listening     ? "Listening — say it naturally"
      : "Tap to speak, or type below";

  const startOver = () => {
    setAction(null);
    setMessage(null);
    setPhase("idle");
    setText("");
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side={isMobile ? "bottom" : "right"}
        className={cn(
          "pointer-events-auto overflow-y-auto",
          isMobile ? "h-[85vh] rounded-t-3xl" : "w-full sm:max-w-md",
        )}
      >
        <SheetHeader className="text-left">
          <SheetTitle className="flex items-center gap-2 text-base">
            <Sparkles className="h-5 w-5 text-primary" />
            Quick add
          </SheetTitle>
        </SheetHeader>

        {/* ── Not configured ─────────────────────────────────────────── */}
        {!configured ? (
          <div className="mt-8 flex flex-col items-center gap-4 text-center">
            <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/10">
              <Sparkles className="h-6 w-6 text-primary" />
            </div>
            <div className="space-y-1.5">
              <p className="text-sm font-semibold text-foreground">Set up the assistant</p>
              <p className="text-xs leading-relaxed text-muted-foreground">
                Add your own AI provider key and you can log expenses just by
                saying them. Only the sentence you speak is sent — never your
                financial data.
              </p>
            </div>
            <Button onClick={onOpenSettings} className="pointer-events-auto">
              <Settings2 className="h-4 w-4 mr-2" />
              Open settings
            </Button>
          </div>
        ) : (
          <div className="mt-4 space-y-4">
            {/* ── Review ───────────────────────────────────────────── */}
            {phase === "review" || phase === "saving" ? (
              <>
                {text && (
                  <p className="rounded-xl bg-muted/60 px-3 py-2 text-xs italic text-muted-foreground">
                    “{text}”
                  </p>
                )}

                {action && (
                  <ActionReviewCard
                    action={action}
                    onChange={setAction}
                    categorySlugs={categorySlugs}
                  />
                )}

                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    onClick={startOver}
                    disabled={phase === "saving"}
                    className="flex-1 pointer-events-auto"
                  >
                    <RotateCcw className="h-4 w-4 mr-2" />
                    Redo
                  </Button>
                  <Button
                    onClick={handleSave}
                    disabled={phase === "saving"}
                    className="flex-1 bg-gradient-primary text-primary-foreground pointer-events-auto"
                  >
                    {phase === "saving"
                      ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Saving…</>
                      : "Save"}
                  </Button>
                </div>

                <p className="text-center text-[11px] text-muted-foreground">
                  Nothing is written until you tap Save.
                </p>
              </>
            ) : (
              <>
                {/* ── Capture ────────────────────────────────────────── */}
                {/* The orb is only mounted while the sheet is open, and
                    `active={open}` freezes it for the exit animation Radix
                    plays before unmounting — so nothing composites unseen. */}
                <div className="flex flex-col items-center gap-4 py-3">
                  {micSupported ? (
                    <>
                      <VoiceOrb
                        state={orbState}
                        onClick={handleOrbTap}
                        disabled={phase === "thinking"}
                        active={open}
                        size={160}
                        label={
                          micDenied
                            ? "Retry microphone access"
                            : listening || micStarting
                            ? "Stop listening"
                            : "Start listening"
                        }
                      />
                      <p className="max-w-[16rem] text-center text-xs leading-relaxed text-muted-foreground">
                        {orbCaption}
                      </p>
                    </>
                  ) : (
                    // No speech backend at all: never show a listening state
                    // that can't resolve — go straight to typing.
                    <p className="text-xs text-muted-foreground text-center">
                      Voice input isn’t available here — type what you want to log.
                    </p>
                  )}
                </div>

                <form onSubmit={handleSubmit} className="flex items-center gap-2">
                  <Input
                    value={text}
                    onChange={(e) => setText(e.target.value)}
                    placeholder="Spent 450 on groceries yesterday"
                    disabled={phase === "thinking"}
                    className="flex-1 pointer-events-auto"
                  />
                  <Button
                    type="submit"
                    size="icon"
                    disabled={!text.trim() || phase === "thinking"}
                    className="shrink-0 pointer-events-auto"
                  >
                    <Send className="h-4 w-4" />
                  </Button>
                </form>

                {message && (
                  <div className="flex gap-2 rounded-xl border border-amber-500/25 bg-amber-500/5 p-3">
                    <AlertCircle className="h-4 w-4 shrink-0 text-amber-600 mt-0.5" />
                    <p className="text-xs leading-relaxed text-foreground">{message}</p>
                  </div>
                )}

                {phase === "idle" && !message && (
                  <div className="space-y-1.5 pt-2">
                    <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                      Try saying
                    </p>
                    {EXAMPLES.map((ex) => (
                      <button
                        key={ex}
                        type="button"
                        onClick={() => { setText(ex); void runExtraction(ex); }}
                        className="block w-full rounded-lg border border-border/50 bg-background/50 px-3 py-2 text-left text-xs text-muted-foreground hover:border-primary/40 hover:text-foreground pointer-events-auto"
                      >
                        {ex}
                      </button>
                    ))}
                  </div>
                )}
              </>
            )}
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
};
