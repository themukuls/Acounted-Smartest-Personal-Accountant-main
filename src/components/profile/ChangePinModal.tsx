"use client";

import React, { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { auth } from "@/integrations/indexeddb/auth";
import { Lock, Delete } from "lucide-react";
import { cn } from "@/lib/utils";

interface ChangePinModalProps {
  open: boolean;
  onClose: () => void;
}

const PIN_KEYS = ["1","2","3","4","5","6","7","8","9","","0","⌫"];

const MiniPinPad = ({
  pin, onChange, label, error,
}: { pin: string; onChange: (p: string) => void; label: string; error?: string }) => {
  const handleKey = (k: string) => {
    if (k === "⌫") { onChange(pin.slice(0, -1)); return; }
    if (k === "") return;
    if (pin.length < 4) onChange(pin + k);
  };

  return (
    <div className="space-y-3">
      <p className="text-sm font-medium text-foreground text-center">{label}</p>
      <div className="flex justify-center gap-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className={cn(
            "h-3 w-3 rounded-full border-2 transition-all",
            i < pin.length ? "bg-primary border-primary" : "bg-background border-muted-foreground/40"
          )} />
        ))}
      </div>
      {error && <p className="text-destructive text-xs text-center">{error}</p>}
      <div className="grid grid-cols-3 gap-2">
        {PIN_KEYS.map((k, i) => (
          <button key={i} type="button" onClick={() => handleKey(k)}
            disabled={k === ""}
            className={cn(
              "h-12 rounded-xl text-lg font-semibold transition-all pointer-events-auto",
              k === "" ? "invisible" :
              k === "⌫" ? "bg-muted/50 hover:bg-muted text-foreground active:scale-95" :
              "bg-muted/30 hover:bg-muted/60 text-foreground active:scale-95"
            )}>
            {k === "⌫" ? <Delete className="h-4 w-4 mx-auto" /> : k}
          </button>
        ))}
      </div>
    </div>
  );
};

export const ChangePinModal = ({ open, onClose }: ChangePinModalProps) => {
  const { user, refreshUser } = useAuth();
  const { toast }             = useToast();
  const [step,    setStep]    = useState<"current" | "new" | "confirm">("current");
  const [current, setCurrent] = useState("");
  const [newPin,  setNewPin]  = useState("");
  const [confirm, setConfirm] = useState("");
  const [error,   setError]   = useState("");
  const [loading, setLoading] = useState(false);

  // Reset on close
  useEffect(() => {
    if (!open) {
      setStep("current"); setCurrent(""); setNewPin(""); setConfirm(""); setError("");
    }
  }, [open]);

  const handleCurrentNext = async () => {
    if (!user) return;
    setLoading(true);
    setError("");
    try {
      const { user: verified, error: e } = await auth.signInWithPin(current);
      if (e || !verified) { setError("Incorrect current PIN."); setCurrent(""); return; }
      setStep("new");
    } catch (err: any) {
      setError(err.message);
      setCurrent("");
    } finally {
      setLoading(false);
    }
  };

  const handleNewNext = () => {
    if (newPin === current) { setError("New PIN must be different from current PIN."); setNewPin(""); return; }
    setStep("confirm");
    setConfirm("");
    setError("");
  };

  const handleConfirm = async () => {
    if (confirm !== newPin) { setError("PINs don't match."); setConfirm(""); return; }
    if (!user) return;
    setLoading(true);
    try {
      const { error: e } = await auth.updateUserPinLocal(user.id, newPin);
      if (e) throw new Error(e);
      await refreshUser();
      toast({ title: "PIN changed", description: "Your new PIN is active." });
      onClose();
    } catch (err: any) {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  const handleStepSubmit = () => {
    if (step === "current" && current.length === 4) handleCurrentNext();
    if (step === "new"     && newPin.length === 4)  handleNewNext();
    if (step === "confirm" && confirm.length === 4)  handleConfirm();
  };

  const currentPin = step === "current" ? current : step === "new" ? newPin : confirm;
  const setCurrentPin = step === "current" ? setCurrent : step === "new" ? setNewPin : setConfirm;
  const stepLabel = step === "current" ? "Enter current PIN"
                  : step === "new"     ? "Enter new PIN"
                  : "Confirm new PIN";

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-sm bg-gradient-to-br from-white via-white to-primary/5 border border-white/20 shadow-xl pointer-events-auto">
        <DialogHeader>
          <DialogTitle className="text-xl font-semibold bg-gradient-to-r from-primary to-primary/70 bg-clip-text text-transparent flex items-center gap-2">
            <Lock className="h-5 w-5" /> Change PIN
          </DialogTitle>
        </DialogHeader>

        <div className="py-4 space-y-4">
          <MiniPinPad
            pin={currentPin}
            onChange={p => { setCurrentPin(p); setError(""); }}
            label={stepLabel}
            error={error}
          />

          <div className="flex gap-2 pt-2">
            {step !== "current" && (
              <Button variant="outline" onClick={() => {
                if (step === "new")     { setStep("current"); setCurrent(""); }
                if (step === "confirm") { setStep("new");     setConfirm(""); }
                setError("");
              }} className="flex-1 pointer-events-auto">
                Back
              </Button>
            )}
            <Button
              onClick={handleStepSubmit}
              disabled={currentPin.length < 4 || loading}
              className="flex-1 bg-gradient-primary text-primary-foreground pointer-events-auto"
            >
              {loading ? "Please wait…" : step === "confirm" ? "Change PIN" : "Next"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};
