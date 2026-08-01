import React, { useState, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { GlassCard } from "@/components/ui/glass-card";
import { useToast } from "@/hooks/use-toast";
import { auth } from "@/integrations/indexeddb/auth";
import { useAuth } from "@/contexts/AuthContext";
import { cn } from "@/lib/utils";
import {
  Upload, CheckCircle2, ArrowLeft, User, CreditCard,
  TrendingUp, Target, Layers, AlertTriangle, Delete,
} from "lucide-react";
import {
  parseCSVBackup, validateCSVOwnership, importCSVToIndexedDB,
  CSVBackupData, CSVImportResult,
} from "@/integrations/indexeddb/utils/csvRestore";

// ─── PIN Pad (inline, reused from Auth) ───────────────────────────────────────

const PIN_KEYS = ["1","2","3","4","5","6","7","8","9","","0","⌫"];

const MiniPinPad = ({
  pin, onChange, onSubmit, label, sublabel, error, loading, submitLabel = "Continue", footerSlot,
}: {
  pin: string; onChange: (p: string) => void; onSubmit: () => void;
  label: string; sublabel?: string; error?: string; loading?: boolean;
  submitLabel?: string; footerSlot?: React.ReactNode;
}) => {
  const handleKey = (k: string) => {
    if (k === "⌫") { onChange(pin.slice(0, -1)); return; }
    if (k === "") return;
    if (pin.length < 4) onChange(pin + k);
  };

  return (
    <div className="flex flex-col items-center gap-4 w-full">
      <div className="text-center space-y-0.5">
        <p className="text-lg font-bold text-foreground">{label}</p>
        {sublabel && <p className="text-xs text-muted-foreground">{sublabel}</p>}
      </div>
      <div className="flex gap-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className={cn(
            "h-3.5 w-3.5 rounded-full border-2 transition-all",
            i < pin.length ? "bg-primary border-primary scale-110" : "bg-background border-muted-foreground/40"
          )} />
        ))}
      </div>
      {error && <p className="text-destructive text-xs text-center -mt-2">{error}</p>}
      <div className="grid grid-cols-3 gap-2 w-full">
        {PIN_KEYS.map((k, i) => (
          <button key={i} type="button" onClick={() => handleKey(k)}
            disabled={k === "" || loading}
            className={cn(
              "h-12 rounded-xl text-lg font-semibold transition-all pointer-events-auto",
              k === "" ? "invisible" :
              k === "⌫" ? "bg-muted/50 hover:bg-muted active:scale-95" :
              "bg-muted/30 hover:bg-muted/60 active:scale-95 active:bg-primary/20"
            )}>
            {k === "⌫" ? <Delete className="h-4 w-4 mx-auto" /> : k}
          </button>
        ))}
      </div>
      <Button onClick={onSubmit} disabled={pin.length < 4 || loading}
        className="w-full h-11 bg-gradient-primary text-primary-foreground rounded-xl font-semibold pointer-events-auto">
        {loading ? "Please wait…" : submitLabel}
      </Button>
      {footerSlot}
    </div>
  );
};

// ─── Import Summary Card ──────────────────────────────────────────────────────

const ImportSummary = ({
  csvData, profile,
}: { csvData: CSVBackupData; profile: { email: string; phone: string } }) => {
  const sections = [
    { icon: CreditCard, label: "Transactions",      count: csvData.transactions.length,      color: "text-blue-600",   bg: "bg-blue-50" },
    { icon: TrendingUp, label: "Income records",    count: csvData.income.length,            color: "text-emerald-600", bg: "bg-emerald-50" },
    { icon: Layers,     label: "Expense categories",count: csvData.expenseCategories.length, color: "text-amber-600",  bg: "bg-amber-50" },
    { icon: Target,     label: "Savings goals",     count: csvData.savingsGoals.length,      color: "text-purple-600", bg: "bg-purple-50" },
    { icon: TrendingUp, label: "Investments",        count: csvData.investments.length,       color: "text-rose-600",   bg: "bg-rose-50"  },
  ];

  return (
    <div className="w-full space-y-3">
      {/* Profile row */}
      <div className="flex items-center gap-3 bg-primary/6 border border-primary/15 rounded-xl px-4 py-3">
        <div className="h-9 w-9 rounded-full bg-primary/15 flex items-center justify-center shrink-0">
          <User className="h-4 w-4 text-primary" />
        </div>
        <div>
          <p className="text-xs font-semibold text-foreground">{profile.email}</p>
          <p className="text-[10px] text-muted-foreground">+91 {profile.phone}</p>
        </div>
        <CheckCircle2 className="h-4 w-4 text-emerald-500 ml-auto" />
      </div>

      {/* Data counts */}
      <div className="grid grid-cols-2 gap-2">
        {sections.filter(s => s.count > 0).map(s => (
          <div key={s.label} className={cn("rounded-xl px-3 py-2.5 border border-border/30", s.bg)}>
            <div className="flex items-center gap-1.5">
              <s.icon className={cn("h-3.5 w-3.5", s.color)} />
              <span className={cn("text-lg font-bold", s.color)}>{s.count}</span>
            </div>
            <p className="text-[10px] text-muted-foreground mt-0.5">{s.label}</p>
          </div>
        ))}
      </div>
    </div>
  );
};

// ─── Progress Step Indicator ─────────────────────────────────────────────────

const ProgressSteps = ({ current }: { current: number }) => {
  const steps = ["Verify", "Preview", "Import", "Done"];
  return (
    <div className="flex items-center gap-1 w-full mb-2">
      {steps.map((s, i) => (
        <React.Fragment key={s}>
          <div className="flex flex-col items-center gap-1">
            <div className={cn(
              "h-6 w-6 rounded-full flex items-center justify-center text-[10px] font-bold transition-all",
              i < current  ? "bg-primary text-primary-foreground" :
              i === current ? "bg-primary/20 text-primary border-2 border-primary" :
              "bg-muted text-muted-foreground"
            )}>
              {i < current ? "✓" : i + 1}
            </div>
            <p className={cn("text-[9px] whitespace-nowrap",
              i <= current ? "text-primary font-medium" : "text-muted-foreground"
            )}>{s}</p>
          </div>
          {i < steps.length - 1 && (
            <div className={cn("flex-1 h-0.5 mb-4 transition-all",
              i < current ? "bg-primary" : "bg-muted"
            )} />
          )}
        </React.Fragment>
      ))}
    </div>
  );
};

// ─── Main Component ───────────────────────────────────────────────────────────

type Step = "verify" | "preview" | "pin" | "confirm_pin" | "importing" | "done";

interface CSVImportScreenProps {
  onCancel: () => void;
}

export const CSVImportScreen = ({ onCancel }: CSVImportScreenProps) => {
  const { toast }  = useToast();
  const navigate   = useNavigate();
  const { refreshUser } = useAuth();
  const fileRef    = useRef<HTMLInputElement>(null);

  const [step,        setStep]        = useState<Step>("verify");
  const [form,        setForm]        = useState({ email: "", phone: "" });
  const [csvData,     setCsvData]     = useState<CSVBackupData | null>(null);
  const [userId,      setUserId]      = useState<string | null>(null);
  const [accountExists, setAccountExists] = useState(false);
  const [pin,         setPin]         = useState("");
  const [confirmPin,  setConfirmPin]  = useState("");
  const [pinError,    setPinError]    = useState("");
  const [loading,     setLoading]     = useState(false);
  const [error,       setError]       = useState("");
  const [progress,    setProgress]    = useState(0);   // 0-100 during import
  const [importResult, setImportResult] = useState<CSVImportResult | null>(null);

  const stepIndex = { verify: 0, preview: 1, pin: 1, confirm_pin: 1, importing: 2, done: 3 }[step];

  // ── File selection ─────────────────────────────────────────────────────────
  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.name.endsWith(".csv")) {
      setError("Please select a CSV backup file (.csv)");
      return;
    }
    setLoading(true);
    setError("");
    try {
      const text   = await file.text();
      const parsed = parseCSVBackup(text);
      if (!parsed.profiles || parsed.profiles.length === 0) {
        setError("No profile found in this file. Are you sure this is an Acounted backup?");
        return;
      }
      setCsvData(parsed);
    } catch {
      setError("Could not read the file. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  // ── Step 1: Verify email + phone ───────────────────────────────────────────
  const handleVerify = async () => {
    if (!form.email.trim() || !form.phone.trim()) { setError("Both fields are required."); return; }
    if (!csvData) { setError("Please select your backup CSV file first."); return; }
    setLoading(true);
    setError("");
    try {
      const { valid, error: ve } = await validateCSVOwnership(csvData, form.email, form.phone);
      if (!valid) { setError(ve ?? "Verification failed."); return; }

      // Check if account exists by email only (phone format variations shouldn't block this).
      // The repository has no unique `email` index, so match explicitly.
      const { getAllByIndex } = await import("@/integrations/storage/repository");
      const typed  = form.email.trim();
      const lower  = typed.toLowerCase();
      const existing =
        (await getAllByIndex<{ id: string }>("profiles", "email", lower))[0] ??
        (await getAllByIndex<{ id: string }>("profiles", "email", typed))[0];
      if (existing) {
        setUserId(existing.id);
        setAccountExists(true);
      } else {
        setAccountExists(false);
      }
      setStep("preview");
    } catch (e: any) {
      setError(e.message ?? "Verification failed.");
    } finally {
      setLoading(false);
    }
  };

  // ── Step 2 → 3: PIN entry (only for new accounts) ─────────────────────────
  const handlePinNext = () => {
    if (pin.length === 4) { setStep("confirm_pin"); setConfirmPin(""); setPinError(""); }
  };

  const handleConfirmPin = () => {
    if (confirmPin !== pin) { setPinError("PINs don't match. Try again."); setConfirmPin(""); return; }
    handleImport(pin);
  };

  // ── Step 3: Import ─────────────────────────────────────────────────────────
  const handleImport = async (newPin?: string) => {
    if (!csvData || !form.email) return;
    setStep("importing");
    setProgress(10);
    setError("");

    try {
      let uid = userId;

      // Simulate progress stages
      const tick = async (pct: number) => {
        setProgress(pct);
        await new Promise(r => setTimeout(r, 80));
      };

      await tick(20);
      if (!uid) {
        if (!newPin) throw new Error("PIN is required for new account.");
        const { user: newUser, error: signupError } = await auth.signUpLocal(
          form.email.trim(), form.phone.trim(), newPin
        );
        if (signupError || !newUser) throw new Error(signupError ?? "Failed to create account.");
        uid = newUser.id;
        setUserId(uid);
      }

      await tick(40);
      const result = await importCSVToIndexedDB(uid!, csvData);
      await tick(90);

      setImportResult(result);
      await tick(95);

      // Create an active session so ProtectedRoute lets them through
      await auth.createSessionForUser(uid!);
      // Sync AuthContext so the whole app knows the user is logged in
      await refreshUser();
      await tick(100);

      // Short delay so user sees 100%
      await new Promise(r => setTimeout(r, 400));
      setStep("done");
    } catch (e: any) {
      setError(e.message ?? "Import failed.");
      setStep("preview");
    }
  };

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div className="flex flex-col items-center gap-5 w-full max-w-xs mx-auto">

      {/* Back button */}
      {step !== "importing" && step !== "done" && (
        <div className="w-full">
          <button type="button" onClick={onCancel}
            className="inline-flex items-center text-sm text-muted-foreground hover:text-primary pointer-events-auto">
            <ArrowLeft className="h-4 w-4 mr-1.5" /> Back to login
          </button>
        </div>
      )}

      {/* Progress steps */}
      <ProgressSteps current={stepIndex} />

      {/* ── Step: Verify ── */}
      {step === "verify" && (
        <div className="w-full space-y-4">
          <div className="text-center space-y-1">
            <p className="text-xl font-bold text-foreground">Restore from Backup</p>
            <p className="text-xs text-muted-foreground leading-relaxed">
              Enter your registered email and phone, then upload your CSV backup.
            </p>
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs">Registered Email</Label>
            <Input type="email" value={form.email}
              onChange={e => { setForm(p => ({ ...p, email: e.target.value })); setError(""); }}
              placeholder="your@email.com" className="h-9 text-sm pointer-events-auto" />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Registered Phone</Label>
            <Input type="tel" value={form.phone}
              onChange={e => { setForm(p => ({ ...p, phone: e.target.value })); setError(""); }}
              placeholder="10-digit number" className="h-9 text-sm pointer-events-auto" />
          </div>

          {/* File picker */}
          <div className="space-y-1.5">
            <Label className="text-xs">CSV Backup File</Label>
            <button type="button" onClick={() => fileRef.current?.click()}
              className={cn(
                "w-full h-16 border-2 border-dashed rounded-xl flex flex-col items-center justify-center gap-1 transition-all pointer-events-auto",
                csvData ? "border-emerald-400 bg-emerald-50/40" : "border-border/40 hover:border-primary/40"
              )}>
              {csvData ? (
                <>
                  <CheckCircle2 className="h-5 w-5 text-emerald-500" />
                  <p className="text-xs font-medium text-emerald-700">
                    {csvData.transactions.length} transactions · {csvData.expenseCategories.length} categories · {csvData.profiles.length} profile{csvData.profiles.length !== 1 ? "s" : ""} ✓
                  </p>
                </>
              ) : (
                <>
                  <Upload className="h-5 w-5 text-muted-foreground" />
                  <p className="text-xs text-muted-foreground">
                    {loading ? "Reading file…" : "Tap to select backup CSV"}
                  </p>
                </>
              )}
            </button>
            <input ref={fileRef} type="file" accept=".csv"
              onChange={handleFileSelect} className="hidden" />
          </div>

          {error && (
            <div className="flex items-start gap-2 bg-red-50 border border-red-200 rounded-xl px-3 py-2.5">
              <AlertTriangle className="h-4 w-4 text-red-500 shrink-0 mt-0.5" />
              <p className="text-xs text-red-700">{error}</p>
            </div>
          )}

          <Button onClick={handleVerify}
            disabled={loading || !csvData || !form.email.trim() || !form.phone.trim()}
            className="w-full h-11 bg-gradient-primary text-primary-foreground rounded-xl pointer-events-auto">
            {loading ? "Verifying…" : "Verify & Preview"}
          </Button>
        </div>
      )}

      {/* ── Step: Preview ── */}
      {step === "preview" && csvData && (
        <div className="w-full space-y-4">
          <div className="text-center space-y-1">
            <p className="text-xl font-bold text-foreground">Ready to Import</p>
            <p className="text-xs text-muted-foreground">
              {accountExists
                ? "Your account was found. The data below will be imported."
                : "No existing account found. We'll create one with your details."}
            </p>
          </div>

          <ImportSummary csvData={csvData} profile={{ email: form.email, phone: form.phone }} />

          {!accountExists && (
            <div className="bg-amber-50/60 border border-amber-200/60 rounded-xl px-3 py-2.5">
              <p className="text-xs text-amber-700">
                <span className="font-semibold">New account will be created</span> — you'll set a PIN in the next step.
              </p>
            </div>
          )}

          {error && (
            <div className="flex items-start gap-2 bg-red-50 border border-red-200 rounded-xl px-3 py-2.5">
              <AlertTriangle className="h-4 w-4 text-red-500 shrink-0 mt-0.5" />
              <p className="text-xs text-red-700">{error}</p>
            </div>
          )}

          <Button
            onClick={() => accountExists ? handleImport() : setStep("pin")}
            className="w-full h-11 bg-gradient-primary text-primary-foreground rounded-xl pointer-events-auto">
            {accountExists ? "Import Data" : "Set PIN & Import"}
          </Button>
        </div>
      )}

      {/* ── Step: Set PIN (new account only) ── */}
      {step === "pin" && (
        <MiniPinPad
          pin={pin} onChange={p => { setPin(p); setPinError(""); }}
          onSubmit={handlePinNext}
          label="Set your PIN"
          sublabel="Choose a 4-digit PIN for your restored account"
          submitLabel="Next"
        />
      )}

      {/* ── Step: Confirm PIN ── */}
      {step === "confirm_pin" && (
        <MiniPinPad
          pin={confirmPin} onChange={p => { setConfirmPin(p); setPinError(""); }}
          onSubmit={handleConfirmPin}
          label="Confirm your PIN"
          error={pinError}
          submitLabel="Import Data"
          footerSlot={
            <button type="button" onClick={() => { setStep("pin"); setConfirmPin(""); setPinError(""); }}
              className="text-sm text-muted-foreground hover:text-foreground pointer-events-auto">
              ← Change PIN
            </button>
          }
        />
      )}

      {/* ── Step: Importing (progress bar) ── */}
      {step === "importing" && (
        <div className="w-full space-y-6 text-center py-4">
          <div className="h-16 w-16 rounded-2xl bg-primary/10 flex items-center justify-center mx-auto">
            <Upload className="h-8 w-8 text-primary animate-pulse" />
          </div>
          <div className="space-y-1">
            <p className="font-semibold text-foreground">Importing your data…</p>
            <p className="text-xs text-muted-foreground">Please don't close the app</p>
          </div>
          <div className="w-full space-y-2">
            <div className="h-3 bg-muted/40 rounded-full overflow-hidden">
              <div
                className="h-full bg-gradient-primary rounded-full transition-all duration-500"
                style={{ width: `${progress}%` }}
              />
            </div>
            <p className="text-xs text-muted-foreground text-right">{progress}%</p>
          </div>
          <div className="grid grid-cols-2 gap-2 text-xs text-left">
            {[
              { label: "Transactions",    count: csvData?.transactions.length ?? 0,       done: progress >= 60 },
              { label: "Income",          count: csvData?.income.length ?? 0,             done: progress >= 70 },
              { label: "Categories",      count: csvData?.expenseCategories.length ?? 0,  done: progress >= 80 },
              { label: "Investments",     count: csvData?.investments.length ?? 0,        done: progress >= 90 },
              { label: "Savings goals",   count: csvData?.savingsGoals.length ?? 0,       done: progress >= 95 },
            ].map(item => (
              <div key={item.label} className={cn(
                "flex items-center gap-1.5 px-2 py-1.5 rounded-lg transition-all",
                item.done ? "bg-emerald-50 text-emerald-700" : "bg-muted/30 text-muted-foreground"
              )}>
                {item.done
                  ? <CheckCircle2 className="h-3 w-3 shrink-0" />
                  : <div className="h-3 w-3 rounded-full border border-current shrink-0 opacity-40" />
                }
                <span>{item.label} ({item.count})</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Step: Done ── */}
      {step === "done" && importResult && csvData && (
        <div className="w-full space-y-5 text-center">
          <div className="h-16 w-16 rounded-2xl bg-emerald-100 flex items-center justify-center mx-auto">
            <CheckCircle2 className="h-9 w-9 text-emerald-500" />
          </div>

          <div>
            <p className="text-xl font-bold text-foreground">All done!</p>
            <p className="text-xs text-muted-foreground mt-1">
              {importResult.imported} records restored successfully
            </p>
          </div>

          {/* Full import summary */}
          <div className="w-full space-y-2 text-left">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">What was imported</p>

            <ImportSummary csvData={csvData} profile={{ email: form.email, phone: form.phone }} />

            {(() => {
              const skippedCount = Object.values(importResult.skipped ?? {}).reduce((a, b) => a + b, 0);
              if (skippedCount === 0) return null;
              return (
                <div className="bg-amber-50 border border-amber-200 rounded-xl px-3 py-2.5">
                  <p className="text-xs text-amber-700">
                    {skippedCount} record{skippedCount === 1 ? "" : "s"} could not be imported
                    {" "}({Object.keys(importResult.skipped).join(", ")}).
                  </p>
                </div>
              );
            })()}

            {importResult.errors.length > 0 && (
              <div className="bg-amber-50 border border-amber-200 rounded-xl px-3 py-2.5 space-y-1">
                <p className="text-xs font-semibold text-amber-700">Some sections had issues:</p>
                {importResult.errors.map((e, i) => (
                  <p key={i} className="text-[10px] text-amber-600">{e}</p>
                ))}
              </div>
            )}
          </div>

          <Button
            onClick={() => navigate("/dashboard")}
            className="w-full h-12 bg-gradient-primary text-primary-foreground rounded-xl font-semibold pointer-events-auto">
            Go to Dashboard
          </Button>
        </div>
      )}
    </div>
  );
};
