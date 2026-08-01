"use client";

import { useEffect, useMemo, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { Sparkles, Eye, EyeOff, ShieldAlert, ExternalLink, Check, Loader2 } from "lucide-react";
import { PROVIDER_LIST, getProvider, ProviderError } from "@/lib/assistant/providers";
import { testConnection } from "@/lib/assistant/extract";
import {
  getLLMConfig, saveLLMConfig, clearLLMConfig, maskApiKey, type ProviderId,
} from "@/lib/assistant/settings";

interface AssistantSettingsModalProps {
  open: boolean;
  onClose: () => void;
}

/** Sentinel for "I'll type my own model ID". */
const CUSTOM_MODEL = "__custom__";

export const AssistantSettingsModal = ({ open, onClose }: AssistantSettingsModalProps) => {
  const { toast } = useToast();

  const [provider, setProvider]       = useState<ProviderId>("gemini");
  const [apiKey, setApiKey]           = useState("");
  const [baseUrl, setBaseUrl]         = useState("");
  const [modelChoice, setModelChoice] = useState<string>("");
  const [customModel, setCustomModel] = useState("");
  const [savedKeyMask, setSavedKeyMask] = useState<string | null>(null);
  const [showKey, setShowKey]   = useState(false);
  const [testing, setTesting]   = useState(false);
  const [tested, setTested]     = useState(false);

  const activeProvider = getProvider(provider);
  const usingCustomModel = modelChoice === CUSTOM_MODEL || activeProvider.models.length === 0;

  const effectiveModel = useMemo(
    () => (usingCustomModel ? customModel.trim() : modelChoice),
    [usingCustomModel, customModel, modelChoice],
  );

  // Load saved config each time the modal opens.
  useEffect(() => {
    if (!open) return;
    const cfg = getLLMConfig();

    if (cfg) {
      const p = getProvider(cfg.provider);
      setProvider(cfg.provider);
      setApiKey(cfg.apiKey);
      setBaseUrl(cfg.baseUrl ?? "");
      setSavedKeyMask(maskApiKey(cfg.apiKey));

      // A saved model that isn't in the suggestion list is still perfectly
      // valid — vendors rename models constantly — so it reopens in the
      // free-text field rather than being silently swapped for the default.
      const known = p.models.some((m) => m.id === cfg.model);
      setModelChoice(known ? cfg.model : CUSTOM_MODEL);
      setCustomModel(known ? "" : cfg.model);
    } else {
      setProvider("gemini");
      setApiKey("");
      setBaseUrl("");
      setSavedKeyMask(null);
      setModelChoice(getProvider("gemini").defaultModel);
      setCustomModel("");
    }
    setShowKey(false);
    setTested(false);
  }, [open]);

  useEffect(() => {
    if (!open) { setTesting(false); setTested(false); setShowKey(false); }
  }, [open]);

  const handleProviderChange = (next: string) => {
    const id = next as ProviderId;
    const p = getProvider(id);
    setProvider(id);
    // Model IDs are provider-specific — carrying one across would guarantee a 404.
    setModelChoice(p.models.length > 0 ? p.defaultModel : CUSTOM_MODEL);
    setCustomModel("");
    setTested(false);
  };

  const buildConfig = () => ({
    provider,
    apiKey: apiKey.trim(),
    model: effectiveModel,
    baseUrl: baseUrl.trim() || undefined,
  });

  /** Shared validation for both Test and Save. Returns an error string or null. */
  const validate = (): string | null => {
    if (!apiKey.trim()) return "Paste your API key first.";
    if (activeProvider.requiresBaseUrl && !baseUrl.trim()) {
      return "This provider needs an API endpoint, e.g. https://my-host/v1";
    }
    if (usingCustomModel && !customModel.trim()) return "Enter a model ID.";
    return null;
  };

  const handleTest = async () => {
    const problem = validate();
    if (problem) {
      toast({ title: "Not quite ready", description: problem, variant: "destructive" });
      return;
    }
    setTesting(true);
    setTested(false);
    try {
      await testConnection(buildConfig());
      setTested(true);
      toast({ title: "Connection works", description: `${activeProvider.label} responded successfully.` });
    } catch (err) {
      const message = err instanceof ProviderError ? err.friendlyMessage : (err as Error).message;
      toast({ title: "Connection failed", description: message, variant: "destructive" });
    } finally {
      setTesting(false);
    }
  };

  const handleSave = () => {
    const problem = validate();
    if (problem) {
      toast({ title: "Not quite ready", description: problem, variant: "destructive" });
      return;
    }
    saveLLMConfig(buildConfig());
    toast({ title: "AI Assistant enabled", description: "Tap the mic button to log something by voice." });
    onClose();
  };

  const handleRemove = () => {
    clearLLMConfig();
    setApiKey("");
    setBaseUrl("");
    setSavedKeyMask(null);
    setTested(false);
    toast({ title: "Key removed", description: "The assistant is switched off and nothing is stored." });
  };

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="sm:max-w-md max-h-[90vh] overflow-y-auto bg-gradient-to-br from-white via-white to-primary/5 border border-white/20 shadow-xl pointer-events-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-xl font-semibold bg-gradient-to-r from-primary to-primary/70 bg-clip-text text-transparent">
            <Sparkles className="h-5 w-5 text-primary" />
            AI Assistant
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          {/* Privacy disclosure — before the key field, on purpose. */}
          <div className="flex gap-2.5 rounded-xl border border-amber-500/25 bg-amber-500/5 p-3">
            <ShieldAlert className="h-4 w-4 shrink-0 text-amber-600 mt-0.5" />
            <div className="text-[11px] leading-relaxed text-muted-foreground">
              <p className="font-semibold text-foreground mb-0.5">This one feature goes online.</p>
              The rest of Acounted stays entirely on your device. When you use the
              assistant, <strong>only the sentence you speak or type</strong> is sent to the
              provider you choose below — never your balances, transactions, name or
              contact details. Your key is stored on this device only and is deliberately
              left out of backup files.
            </div>
          </div>

          {/* Provider */}
          <div className="space-y-2">
            <Label htmlFor="assistant-provider">Provider</Label>
            <Select value={provider} onValueChange={handleProviderChange}>
              <SelectTrigger id="assistant-provider" className="pointer-events-auto">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="pointer-events-auto max-h-72">
                {PROVIDER_LIST.map((p) => (
                  <SelectItem key={p.id} value={p.id}>{p.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-[11px] text-muted-foreground">{activeProvider.blurb}</p>
            <a
              href={activeProvider.keysUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-[11px] text-primary hover:underline pointer-events-auto"
            >
              Get a {activeProvider.label} key <ExternalLink className="h-3 w-3" />
            </a>
          </div>

          {/* Endpoint — only where the user supplies it */}
          {activeProvider.requiresBaseUrl && (
            <div className="space-y-2">
              <Label htmlFor="assistant-baseurl">API endpoint</Label>
              <Input
                id="assistant-baseurl"
                value={baseUrl}
                onChange={(e) => { setBaseUrl(e.target.value); setTested(false); }}
                placeholder="https://my-host/v1"
                autoComplete="off"
                spellCheck={false}
                className="pointer-events-auto font-mono text-xs"
              />
              <p className="text-[11px] text-muted-foreground">
                Anything that speaks OpenAI's <code>/chat/completions</code>. Don't include the path.
              </p>
            </div>
          )}

          {/* Model */}
          <div className="space-y-2">
            <Label htmlFor="assistant-model">Model</Label>
            {activeProvider.models.length > 0 && (
              <Select
                value={modelChoice}
                onValueChange={(v) => { setModelChoice(v); setTested(false); }}
              >
                <SelectTrigger id="assistant-model" className="pointer-events-auto">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="pointer-events-auto max-h-72">
                  {activeProvider.models.map((m) => (
                    <SelectItem key={m.id} value={m.id}>
                      {m.label}{m.note ? ` · ${m.note}` : ""}
                    </SelectItem>
                  ))}
                  <SelectItem value={CUSTOM_MODEL}>Other — type a model ID</SelectItem>
                </SelectContent>
              </Select>
            )}

            {usingCustomModel && (
              <Input
                value={customModel}
                onChange={(e) => { setCustomModel(e.target.value); setTested(false); }}
                placeholder={activeProvider.defaultModel || "model-id"}
                autoComplete="off"
                spellCheck={false}
                className="pointer-events-auto font-mono text-xs"
                aria-label="Model ID"
              />
            )}

            <p className="text-[11px] text-muted-foreground">
              These are suggestions — providers rename models often. If one stops
              working, type the current ID and hit Test.
            </p>
          </div>

          {/* API key */}
          <div className="space-y-2">
            <Label htmlFor="assistant-key">API key</Label>
            <div className="relative">
              <Input
                id="assistant-key"
                type={showKey ? "text" : "password"}
                value={apiKey}
                onChange={(e) => { setApiKey(e.target.value); setTested(false); }}
                placeholder={activeProvider.keyPlaceholder}
                autoComplete="off"
                spellCheck={false}
                className="pr-10 pointer-events-auto font-mono text-xs"
              />
              <button
                type="button"
                onClick={() => setShowKey((v) => !v)}
                aria-label={showKey ? "Hide key" : "Show key"}
                className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-muted-foreground hover:text-foreground pointer-events-auto"
              >
                {showKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
            {savedKeyMask && (
              <p className="text-[11px] text-muted-foreground">
                Currently saved: <span className="font-mono">{savedKeyMask}</span>
              </p>
            )}
          </div>

          {/* Test */}
          <Button
            type="button"
            variant="outline"
            onClick={handleTest}
            disabled={testing || !apiKey.trim()}
            className="w-full pointer-events-auto"
          >
            {testing ? (
              <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Testing…</>
            ) : tested ? (
              <><Check className="h-4 w-4 mr-2 text-emerald-600" /> Connection works</>
            ) : (
              "Test connection"
            )}
          </Button>

          {/* Actions */}
          <div className="flex justify-between gap-3 pt-2">
            {savedKeyMask ? (
              <Button type="button" variant="ghost" onClick={handleRemove}
                className="text-destructive hover:bg-destructive/10 pointer-events-auto">
                Remove key
              </Button>
            ) : <span />}
            <div className="flex gap-3">
              <Button type="button" variant="outline" onClick={onClose} className="pointer-events-auto">
                Cancel
              </Button>
              <Button type="button" onClick={handleSave} className="pointer-events-auto">
                Save
              </Button>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};
