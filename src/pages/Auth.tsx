import { useState, useEffect, useRef, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { useQueryClient } from "@tanstack/react-query";
import { auth } from "@/integrations/indexeddb/auth";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ArrowLeft, Delete, Upload, Shield, ChevronRight } from "lucide-react";
import { Link } from "react-router-dom";
import { CSVImportScreen } from "@/components/auth/CSVImportScreen";

const LAST_LOGIN_EMAIL_KEY = "vidhence_last_login_email";

// ─── Micro-copy ───────────────────────────────────────────────────────────────
// Every string the user reads is warm, personal, never corporate.

const COPY = {
  signup: {
    headline: "Let's get you set up",
    sub: "Takes less than a minute. No bank links, no nonsense.",
    name: { label: "What should we call you?", placeholder: "e.g. Priya, Rohan, Neha…" },
    email: { label: "Your email", placeholder: "you@example.com" },
    phone: { label: "Phone number", placeholder: "10-digit mobile", hint: "Only for PIN recovery. Never shared, never sold." },
    cta: "Looks good →",
    errors: {
      name: "We'd love to know your name.",
      email: "Double-check that email — something looks off.",
      phone: "A 10-digit mobile number works best.",
    },
  },
  pin_set: {
    headline: "Pick your secret PIN",
    sub: "4 digits you'll remember. This locks your data on this device.",
    cta: "That's my PIN →",
  },
  pin_confirm: {
    headline: "One more time",
    sub: "Just to make sure we got it right.",
    cta: "Create my account",
    error: "Those don't match — give it another try.",
  },
  login: {
    headline: (name: string) => name ? `Hey ${name} 👋` : "Welcome back 👋",
    sub: "Enter your PIN to pick up where you left off.",
    cta: "Unlock",
    error_generic: "That PIN doesn't seem right.",
    error_lockout: "Too many tries. Use Forgot PIN to reset.",
  },
  set_pin_migrate: {
    headline: "One quick upgrade",
    sub: "We've switched to PIN-based login — faster and more secure. Set yours now.",
    cta: "Set PIN →",
  },
  reset: {
    headline: "Let's verify it's you",
    sub: "Enter the email and phone you signed up with.",
    cta: "Verify →",
    new_pin: "Choose a new PIN",
    confirm_pin: "Confirm new PIN",
    cta_final: "Reset PIN",
  },
  success: {
    headline: "You're in. 🎉",
    sub: "Your financial clarity starts now.",
    cta: "Take me to my dashboard →",
  },
};

// ─── Confetti burst ───────────────────────────────────────────────────────────

const useConfetti = () => {
  const ref = useRef<HTMLCanvasElement>(null);

  const burst = useCallback(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    canvas.width = canvas.offsetWidth;
    canvas.height = canvas.offsetHeight;

    const pieces: { x: number; y: number; vx: number; vy: number; r: number; color: string; alpha: number; spin: number; spinV: number }[] = [];
    const colors = ["#3b82f6", "#8b5cf6", "#10b981", "#f59e0b", "#ef4444", "#06b6d4"];

    for (let i = 0; i < 80; i++) {
      pieces.push({
        x: canvas.width / 2,
        y: canvas.height * 0.45,
        vx: (Math.random() - 0.5) * 14,
        vy: -Math.random() * 14 - 4,
        r: Math.random() * 5 + 2,
        color: colors[Math.floor(Math.random() * colors.length)],
        alpha: 1,
        spin: Math.random() * Math.PI * 2,
        spinV: (Math.random() - 0.5) * 0.3,
      });
    }

    let frame = 0;
    const animate = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      pieces.forEach((p) => {
        p.x += p.vx;
        p.vy += 0.4;
        p.y += p.vy;
        p.alpha -= 0.013;
        p.spin += p.spinV;
        if (p.alpha <= 0) return;
        ctx.save();
        ctx.globalAlpha = Math.max(0, p.alpha);
        ctx.fillStyle = p.color;
        ctx.translate(p.x, p.y);
        ctx.rotate(p.spin);
        ctx.fillRect(-p.r, -p.r / 2, p.r * 2, p.r);
        ctx.restore();
      });
      frame++;
      if (frame < 120) requestAnimationFrame(animate);
      else ctx.clearRect(0, 0, canvas.width, canvas.height);
    };
    animate();
  }, []);

  return { ref, burst };
};

// ─── PIN dot with bounce animation ───────────────────────────────────────────

const PinDots = ({ filled, total = 4, shake = false }: { filled: number; total?: number; shake?: boolean }) => (
  <div className={cn("flex gap-4 justify-center my-1", shake && "animate-[shake_0.35s_ease-in-out]")}>
    {Array.from({ length: total }).map((_, i) => (
      <div
        key={i}
        className={cn(
          "h-4 w-4 rounded-full border-2 transition-all duration-200",
          i < filled
            ? "bg-primary border-primary scale-110 shadow-sm shadow-primary/40"
            : "bg-background border-muted-foreground/30"
        )}
        style={{
          transform: i < filled ? "scale(1.15)" : "scale(1)",
          transition: "transform 0.15s cubic-bezier(0.34,1.56,0.64,1), background 0.15s, border-color 0.15s",
        }}
      />
    ))}
  </div>
);

// ─── Number pad ───────────────────────────────────────────────────────────────

const PIN_KEYS = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "", "0", "⌫"];

interface NumPadProps {
  onKey: (k: string) => void;
  disabled?: boolean;
}

const NumPad = ({ onKey, disabled }: NumPadProps) => (
  <div className="grid grid-cols-3 gap-3 w-full max-w-[260px] mx-auto">
    {PIN_KEYS.map((k, i) => (
      <button
        key={i}
        type="button"
        onClick={() => onKey(k)}
        disabled={k === "" || disabled}
        aria-label={k === "⌫" ? "Backspace" : k === "" ? undefined : k}
        className={cn(
          "h-[60px] rounded-2xl text-xl font-semibold select-none pointer-events-auto",
          "transition-all duration-100 active:scale-90",
          k === "" ? "invisible" :
          k === "⌫"
            ? "bg-muted/50 hover:bg-muted text-foreground active:bg-muted"
            : "bg-muted/30 hover:bg-muted/60 text-foreground active:bg-primary/20 active:text-primary"
        )}
        style={{ WebkitTapHighlightColor: "transparent" }}
      >
        {k === "⌫" ? <Delete className="h-5 w-5 mx-auto" /> : k}
      </button>
    ))}
  </div>
);

// ─── Privacy badge — appears on sensitive inputs ──────────────────────────────

const PrivacyBadge = () => (
  <div className="flex items-center gap-1.5 mt-1.5">
    <Shield className="h-3 w-3 text-emerald-500 shrink-0" />
    <span className="text-[11px] text-emerald-600 font-medium">Stored only on this device. Never uploaded.</span>
  </div>
);

// ─── Step progress dots ───────────────────────────────────────────────────────

const StepDots = ({ total, current }: { total: number; current: number }) => (
  <div className="flex gap-2 justify-center mb-6">
    {Array.from({ length: total }).map((_, i) => (
      <div
        key={i}
        className={cn(
          "rounded-full transition-all duration-300",
          i < current ? "bg-primary w-6 h-2" :
          i === current ? "bg-primary w-4 h-2" :
          "bg-muted-foreground/20 w-2 h-2"
        )}
      />
    ))}
  </div>
);

// ─── Animated card wrapper — slides up on mount ───────────────────────────────

const SlideCard = ({ children, className }: { children: React.ReactNode; className?: string }) => (
  <div
    className={cn("w-full animate-[slideUp_0.35s_cubic-bezier(0.22,1,0.36,1)]", className)}
    style={{ animationFillMode: "both" }}
  >
    {children}
  </div>
);

// ─── Sign Up ──────────────────────────────────────────────────────────────────

const SignUpScreen = ({ onSuccess }: { onSuccess: () => void }) => {
  const { signUp } = useAuth();
  const { toast } = useToast();
  const [step, setStep] = useState<"details" | "pin" | "confirm" | "done">("details");
  const [details, setDetails] = useState({ name: "", email: "", phone: "" });
  const [pin, setPin] = useState("");
  const [confirm, setConfirm] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);
  const [shake, setShake] = useState(false);
  const { ref: canvasRef, burst } = useConfetti();

  const nameRef = useRef<HTMLInputElement>(null);
  useEffect(() => { nameRef.current?.focus(); }, []);

  const triggerShake = () => {
    setShake(true);
    setTimeout(() => setShake(false), 400);
  };

  const validateDetails = () => {
    const e: Record<string, string> = {};
    if (!details.name.trim()) e.name = COPY.signup.errors.name;
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(details.email.trim())) e.email = COPY.signup.errors.email;
    if (!/^\d{10}$/.test(details.phone.trim())) e.phone = COPY.signup.errors.phone;
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const handleDetailsNext = () => {
    if (validateDetails()) { setStep("pin"); setPin(""); }
  };

  const handleKeyDetails = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") handleDetailsNext();
  };

  const handlePinKey = (k: string) => {
    if (k === "⌫") { setPin(p => p.slice(0, -1)); return; }
    if (k === "" || pin.length >= 4) return;
    const next = pin + k;
    setPin(next);
    if (next.length === 4) setTimeout(() => setStep("confirm"), 250);
  };

  const handleConfirmKey = (k: string) => {
    if (k === "⌫") { setConfirm(p => p.slice(0, -1)); setErrors({}); return; }
    if (k === "" || confirm.length >= 4) return;
    const next = confirm + k;
    setConfirm(next);
    if (next.length === 4) {
      setTimeout(() => handleConfirmSubmit(next), 150);
    }
  };

  const handleConfirmSubmit = async (confirmValue?: string) => {
    const val = confirmValue ?? confirm;
    if (val !== pin) {
      triggerShake();
      setErrors({ confirm: COPY.pin_confirm.error });
      setTimeout(() => setConfirm(""), 350);
      return;
    }
    setLoading(true);
    try {
      const { user: newUser } = await signUp(details.email, details.phone, pin);
      if (details.name.trim() && newUser) {
        await auth.updateUserProfileLocal(newUser.id, { display_name: details.name.trim() });
      }
      setStep("done");
      setTimeout(() => burst(), 100);
    } catch (err: any) {
      toast({ title: "Couldn't create account", description: err.message, variant: "destructive" });
      setStep("details");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (step !== "pin" && step !== "confirm") return;
      if (e.key >= "0" && e.key <= "9") {
        step === "pin" ? handlePinKey(e.key) : handleConfirmKey(e.key);
      }
      if (e.key === "Backspace") {
        step === "pin" ? handlePinKey("⌫") : handleConfirmKey("⌫");
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [step, pin, confirm]);

  // ── STEP: details ──
  if (step === "details") return (
    <SlideCard>
      <StepDots total={3} current={0} />
      <div className="text-center mb-6">
        <h1 className="text-2xl font-bold text-foreground">{COPY.signup.headline}</h1>
        <p className="text-sm text-muted-foreground mt-1">{COPY.signup.sub}</p>
      </div>

      <div className="space-y-4">
        <div className="space-y-1.5">
          <label className="text-sm font-medium text-foreground">{COPY.signup.name.label}</label>
          <Input
            ref={nameRef}
            type="text"
            placeholder={COPY.signup.name.placeholder}
            value={details.name}
            onChange={e => { setDetails(p => ({ ...p, name: e.target.value })); setErrors({}); }}
            onKeyDown={handleKeyDetails}
            className={cn("h-12 text-base rounded-xl pointer-events-auto", errors.name && "border-destructive focus-visible:ring-destructive/30")}
            autoComplete="name"
          />
          {errors.name && (
            <p className="text-destructive text-xs animate-[fadeIn_0.2s_ease]">{errors.name}</p>
          )}
        </div>

        <div className="space-y-1.5">
          <label className="text-sm font-medium text-foreground">{COPY.signup.email.label}</label>
          <Input
            type="email"
            placeholder={COPY.signup.email.placeholder}
            value={details.email}
            onChange={e => { setDetails(p => ({ ...p, email: e.target.value })); setErrors({}); }}
            onKeyDown={handleKeyDetails}
            className={cn("h-12 text-base rounded-xl pointer-events-auto", errors.email && "border-destructive focus-visible:ring-destructive/30")}
            autoComplete="email"
          />
          {errors.email && (
            <p className="text-destructive text-xs animate-[fadeIn_0.2s_ease]">{errors.email}</p>
          )}
        </div>

        <div className="space-y-1.5">
          <label className="text-sm font-medium text-foreground">{COPY.signup.phone.label}</label>
          <Input
            type="tel"
            placeholder={COPY.signup.phone.placeholder}
            value={details.phone}
            onChange={e => { setDetails(p => ({ ...p, phone: e.target.value })); setErrors({}); }}
            onKeyDown={handleKeyDetails}
            className={cn("h-12 text-base rounded-xl pointer-events-auto", errors.phone && "border-destructive focus-visible:ring-destructive/30")}
            autoComplete="tel"
            maxLength={10}
          />
          {errors.phone
            ? <p className="text-destructive text-xs animate-[fadeIn_0.2s_ease]">{errors.phone}</p>
            : <PrivacyBadge />
          }
        </div>
      </div>

      <Button
        onClick={handleDetailsNext}
        className="w-full h-12 bg-gradient-primary text-primary-foreground rounded-2xl font-semibold text-base mt-6 pointer-events-auto group"
      >
        {COPY.signup.cta}
        <ChevronRight className="h-4 w-4 ml-1 transition-transform group-hover:translate-x-0.5" />
      </Button>
    </SlideCard>
  );

  // ── STEP: pin ──
  if (step === "pin") return (
    <SlideCard>
      <StepDots total={3} current={1} />
      <div className="text-center mb-6">
        <h1 className="text-2xl font-bold text-foreground">{COPY.pin_set.headline}</h1>
        <p className="text-sm text-muted-foreground mt-1">{COPY.pin_set.sub}</p>
      </div>

      <PinDots filled={pin.length} />

      <div className="mt-6">
        <NumPad onKey={handlePinKey} />
      </div>

      {pin.length === 4 && (
        <Button
          onClick={() => { setStep("confirm"); setConfirm(""); }}
          className="w-full h-12 bg-gradient-primary text-primary-foreground rounded-2xl font-semibold mt-5 pointer-events-auto animate-[fadeIn_0.2s_ease]"
        >
          {COPY.pin_set.cta}
        </Button>
      )}

      <button
        type="button"
        onClick={() => setStep("details")}
        className="w-full mt-3 text-sm text-muted-foreground hover:text-foreground transition-colors text-center pointer-events-auto"
      >
        ← Back
      </button>
    </SlideCard>
  );

  // ── STEP: confirm ──
  if (step === "confirm") return (
    <SlideCard>
      <StepDots total={3} current={2} />
      <div className="text-center mb-6">
        <h1 className="text-2xl font-bold text-foreground">{COPY.pin_confirm.headline}</h1>
        <p className="text-sm text-muted-foreground mt-1">{COPY.pin_confirm.sub}</p>
      </div>

      <PinDots filled={confirm.length} shake={shake} />

      {errors.confirm && (
        <p className="text-destructive text-xs text-center mt-2 animate-[fadeIn_0.2s_ease]">
          {errors.confirm}
        </p>
      )}

      <div className="mt-6">
        <NumPad onKey={handleConfirmKey} disabled={loading} />
      </div>

      {loading && (
        <div className="flex items-center justify-center gap-2 mt-5 text-sm text-muted-foreground animate-[fadeIn_0.2s_ease]">
          <div className="h-4 w-4 rounded-full border-2 border-primary border-t-transparent animate-spin" />
          Creating your account…
        </div>
      )}

      <button
        type="button"
        onClick={() => { setStep("pin"); setConfirm(""); setErrors({}); }}
        className="w-full mt-4 text-sm text-muted-foreground hover:text-foreground transition-colors text-center pointer-events-auto"
      >
        ← Change PIN
      </button>
    </SlideCard>
  );

  // ── STEP: done (celebration) ──
  return (
    <div className="relative w-full flex flex-col items-center">
      {/* Canvas for confetti — fills parent */}
      <canvas
        ref={canvasRef}
        className="pointer-events-none absolute inset-0 w-full h-full z-10"
        style={{ minHeight: 320 }}
      />

      <SlideCard className="flex flex-col items-center text-center gap-4 relative z-20">
        <div className="w-20 h-20 rounded-full bg-primary/10 flex items-center justify-center mb-2 animate-[popIn_0.4s_cubic-bezier(0.34,1.56,0.64,1)]">
          <span className="text-4xl" role="img" aria-label="celebration">🎉</span>
        </div>

        <div>
          <h1 className="text-3xl font-bold text-foreground">{COPY.success.headline}</h1>
          <p className="text-muted-foreground mt-1.5 text-base">{COPY.success.sub}</p>
        </div>

        <div className="bg-muted/40 rounded-2xl p-4 w-full text-left space-y-2 mt-1">
          <div className="flex items-center gap-2 text-sm text-foreground">
            <Shield className="h-4 w-4 text-emerald-500 shrink-0" />
            <span>Your data lives only on this device</span>
          </div>
          <div className="flex items-center gap-2 text-sm text-foreground">
            <span className="text-base">📊</span>
            <span>Ready to calculate your tax savings</span>
          </div>
          <div className="flex items-center gap-2 text-sm text-foreground">
            <span className="text-base">🔒</span>
            <span>PIN-protected, no passwords needed</span>
          </div>
        </div>

        <Button
          onClick={onSuccess}
          className="w-full h-12 bg-gradient-primary text-primary-foreground rounded-2xl font-semibold text-base mt-1 pointer-events-auto"
        >
          {COPY.success.cta}
        </Button>
      </SlideCard>
    </div>
  );
};

// ─── Time-of-day helpers ──────────────────────────────────────────────────────

const getGreeting = (name: string) => {
  const h = new Date().getHours();
  const first = name ? name.split(" ")[0] : "";
  if (h < 5)  return { line1: first ? `Up late, ${first}?` : "Up late?",        line2: "Your money never sleeps either 🌙" };
  if (h < 12) return { line1: first ? `Good morning, ${first} ☀️` : "Good morning ☀️", line2: "Let's see how your finances are looking." };
  if (h < 17) return { line1: first ? `Hey ${first} 👋` : "Hey there 👋",       line2: "Good to have you back. Enter your PIN." };
  if (h < 21) return { line1: first ? `Good evening, ${first} 🌆` : "Good evening 🌆", line2: "Your dashboard is ready for you." };
  return       { line1: first ? `Night owl, ${first}? 🦉` : "Night owl? 🦉",    line2: "Your finances are safe. Enter PIN to continue." };
};

// ─── Login (Enter PIN) ────────────────────────────────────────────────────────

const EnterPinScreen = ({ onForgot }: { onForgot: () => void }) => {
  const { signIn } = useAuth();
  const navigate   = useNavigate();
  const queryClient = useQueryClient();

  const [email,       setEmail]       = useState(() => localStorage.getItem(LAST_LOGIN_EMAIL_KEY) || "");
  const [displayName, setDisplayName] = useState("");
  const [avatarReady, setAvatarReady] = useState(false);
  const [pin,         setPin]         = useState("");
  const [error,       setError]       = useState("");
  const [loading,     setLoading]     = useState(false);
  const [unlocking,   setUnlocking]   = useState(false); // success animation state
  const [attempts,    setAttempts]    = useState(0);
  const [shake,       setShake]       = useState(false);
  const [showEmail,   setShowEmail]   = useState(false); // email field hidden by default

  // Prefill email from the stored profile on first load
  useEffect(() => {
    const prefill = async () => {
      if (email.trim()) return;
      try {
        const repo = await import("@/integrations/storage/repository");
        const all  = await repo.getAll("profiles");
        if (all.length > 0 && (all[0] as any).email) setEmail((all[0] as any).email);
      } catch { /* silent */ }
    };
    prefill();
  }, []);

  // Resolve display name from the stored profile
  useEffect(() => {
    const resolve = async () => {
      const trimmed = email.trim();
      if (!trimmed) { setDisplayName(""); setAvatarReady(false); return; }
      try {
        const repo    = await import("@/integrations/storage/repository");
        const profile = (await repo.getAllByIndex("profiles", "email", trimmed))[0] as any;
        const name    = profile?.display_name?.trim();
        setDisplayName(name || trimmed.split("@")[0]);
        // Small delay so avatar entrance feels deliberate
        setTimeout(() => setAvatarReady(true), 80);
      } catch {
        setDisplayName(trimmed.split("@")[0]);
        setAvatarReady(true);
      }
    };
    resolve();
  }, [email]);

  const triggerShake = () => { setShake(true); setTimeout(() => setShake(false), 400); };

  const handleKey = (k: string) => {
    if (loading || unlocking) return;
    if (k === "⌫") { setPin(p => p.slice(0, -1)); setError(""); return; }
    if (k === "" || pin.length >= 4) return;
    const next = pin + k;
    setPin(next);
    if (next.length === 4) setTimeout(() => handleSubmit(next), 180);
  };

  const handleSubmit = async (pinValue?: string) => {
    const val = pinValue ?? pin;
    if (!email.trim() || val.length < 4) return;
    setLoading(true);
    setError("");
    try {
      await signIn(val, email.trim());
      localStorage.setItem(LAST_LOGIN_EMAIL_KEY, email.trim());
      queryClient.invalidateQueries({ queryKey: ["activeNotifications"] });
      queryClient.invalidateQueries({ queryKey: ["seenNotificationIds"] });
      // Brief "unlocking" celebration before navigation
      setUnlocking(true);
      setTimeout(() => navigate("/dashboard"), 700);
    } catch (err: any) {
      const next = attempts + 1;
      setAttempts(next);
      triggerShake();
      setTimeout(() => setPin(""), 350);
      setError(next >= 5 ? COPY.login.error_lockout : COPY.login.error_generic);
      setLoading(false);
    }
  };

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key >= "0" && e.key <= "9") handleKey(e.key);
      if (e.key === "Backspace") handleKey("⌫");
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [pin, email, loading, unlocking]);

  const greeting   = getGreeting(displayName);
  const initials   = displayName ? displayName.slice(0, 2).toUpperCase() : "?";

  // ── Unlock success state ──
  if (unlocking) return (
    <div className="flex flex-col items-center gap-5 py-8 animate-[fadeIn_0.25s_ease]">
      <div className="w-20 h-20 rounded-full bg-primary/10 flex items-center justify-center animate-[popIn_0.4s_cubic-bezier(0.34,1.56,0.64,1)]">
        <span className="text-4xl" role="img" aria-label="unlocked">🔓</span>
      </div>
      <div className="text-center space-y-1">
        <p className="text-xl font-bold text-foreground">You're in!</p>
        <p className="text-sm text-muted-foreground">Taking you to your dashboard…</p>
      </div>
    </div>
  );

  return (
    <SlideCard>

      {/* Avatar + greeting — the personal moment */}
      <div className="flex flex-col items-center gap-3 mb-7">
        <div
          className={cn(
            "w-16 h-16 rounded-full flex items-center justify-center text-xl font-bold text-white shadow-lg",
            "bg-gradient-to-br from-primary to-primary/70",
            "transition-all duration-500",
            avatarReady
              ? "scale-100 opacity-100 animate-[popIn_0.4s_cubic-bezier(0.34,1.56,0.64,1)]"
              : "scale-75 opacity-0"
          )}
        >
          {initials}
        </div>

        <div className="text-center space-y-0.5">
          <h1 className="text-2xl font-bold text-foreground leading-tight">
            {greeting.line1}
          </h1>
          <p className="text-sm text-muted-foreground">{greeting.line2}</p>
        </div>
      </div>

      {/* PIN dots */}
      <PinDots filled={pin.length} shake={shake} />

      {/* Error */}
      {error && (
        <p className="text-destructive text-xs text-center mt-2 animate-[fadeIn_0.2s_ease]">
          {error}
        </p>
      )}

      {/* Number pad */}
      <div className="mt-6">
        <NumPad onKey={handleKey} disabled={loading} />
      </div>

      {/* Loading */}
      {loading && !unlocking && (
        <div className="flex items-center justify-center gap-2 mt-4 text-sm text-muted-foreground animate-[fadeIn_0.2s_ease]">
          <div className="h-4 w-4 rounded-full border-2 border-primary border-t-transparent animate-spin" />
          Checking…
        </div>
      )}

      {/* Bottom actions */}
      <div className="mt-5 flex flex-col items-center gap-3">
        <button
          type="button"
          onClick={onForgot}
          className="text-xs text-primary hover:underline pointer-events-auto"
        >
          Forgot PIN?
        </button>

        {/* Not you? — toggle email field */}
        <button
          type="button"
          onClick={() => setShowEmail(v => !v)}
          className="text-xs text-muted-foreground hover:text-foreground pointer-events-auto transition-colors"
        >
          {showEmail ? "Hide" : `Not ${displayName || "you"}? Change account`}
        </button>

        {showEmail && (
          <div className="w-full space-y-1 animate-[slideUp_0.25s_ease]">
            <Input
              type="email"
              placeholder="your@email.com"
              value={email}
              onChange={e => { setEmail(e.target.value); setError(""); setPin(""); setAvatarReady(false); }}
              className="h-10 text-sm rounded-xl pointer-events-auto"
              autoComplete="email"
              autoFocus
            />
          </div>
        )}
      </div>

    </SlideCard>
  );
};

// ─── Set PIN (migration screen for existing users) ────────────────────────────

const SetPinScreen = ({ onSuccess }: { onSuccess: () => void }) => {
  const { user, refreshUser } = useAuth();
  const { toast } = useToast();
  const [step, setStep] = useState<"set" | "confirm">("set");
  const [pin, setPin] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [shake, setShake] = useState(false);

  const triggerShake = () => { setShake(true); setTimeout(() => setShake(false), 400); };

  const handleSetKey = (k: string) => {
    if (k === "⌫") { setPin(p => p.slice(0, -1)); return; }
    if (k === "" || pin.length >= 4) return;
    const next = pin + k;
    setPin(next);
    if (next.length === 4) setTimeout(() => setStep("confirm"), 250);
  };

  const handleConfirmKey = (k: string) => {
    if (k === "⌫") { setConfirm(p => p.slice(0, -1)); setError(""); return; }
    if (k === "" || confirm.length >= 4) return;
    const next = confirm + k;
    setConfirm(next);
    if (next.length === 4) setTimeout(() => handleConfirm(next), 150);
  };

  const handleConfirm = async (val?: string) => {
    const value = val ?? confirm;
    if (value !== pin) {
      triggerShake();
      setError(COPY.pin_confirm.error);
      setTimeout(() => setConfirm(""), 350);
      return;
    }
    setLoading(true);
    try {
      let userId = user?.id;
      if (!userId) {
        const repo = await import("@/integrations/storage/repository");
        const all = await repo.getAll<{ id: string }>("profiles");
        if (all.length === 0) throw new Error("No account found. Please sign up.");
        userId = all[0].id;
      }
      const { error: e } = await auth.updateUserPinLocal(userId, pin);
      if (e) throw new Error(e);
      await refreshUser();
      toast({ title: "PIN set!", description: "You're all set." });
      onSuccess();
    } catch (err: any) {
      toast({ title: "Something went wrong", description: err.message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key >= "0" && e.key <= "9") step === "set" ? handleSetKey(e.key) : handleConfirmKey(e.key);
      if (e.key === "Backspace") step === "set" ? handleSetKey("⌫") : handleConfirmKey("⌫");
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [step, pin, confirm]);

  return (
    <SlideCard>
      <div className="text-center mb-6">
        <h1 className="text-2xl font-bold text-foreground">
          {step === "set" ? COPY.set_pin_migrate.headline : COPY.pin_confirm.headline}
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          {step === "set" ? COPY.set_pin_migrate.sub : COPY.pin_confirm.sub}
        </p>
      </div>

      <PinDots filled={step === "set" ? pin.length : confirm.length} shake={shake} />

      {error && (
        <p className="text-destructive text-xs text-center mt-2 animate-[fadeIn_0.2s_ease]">{error}</p>
      )}

      <div className="mt-6">
        <NumPad onKey={step === "set" ? handleSetKey : handleConfirmKey} disabled={loading} />
      </div>

      {loading && (
        <div className="flex items-center justify-center gap-2 mt-5 text-sm text-muted-foreground">
          <div className="h-4 w-4 rounded-full border-2 border-primary border-t-transparent animate-spin" />
          Saving your PIN…
        </div>
      )}

      {step === "confirm" && (
        <button
          type="button"
          onClick={() => { setStep("set"); setConfirm(""); setError(""); }}
          className="w-full mt-4 text-sm text-muted-foreground hover:text-foreground text-center pointer-events-auto"
        >
          ← Change PIN
        </button>
      )}
    </SlideCard>
  );
};

// ─── Reset PIN ────────────────────────────────────────────────────────────────

const ResetPinScreen = ({ onCancel }: { onCancel: () => void }) => {
  const { refreshUser } = useAuth();
  const { toast } = useToast();
  const [step, setStep] = useState<"verify" | "newpin" | "confirm">("verify");
  const [form, setForm] = useState({ email: "", phone: "" });
  const [verifiedId, setVerifiedId] = useState<string | null>(null);
  const [pin, setPin] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [shake, setShake] = useState(false);

  const triggerShake = () => { setShake(true); setTimeout(() => setShake(false), 400); };

  const handleVerify = async () => {
    if (!form.email.trim() || !form.phone.trim()) { setError("Both fields are required."); return; }
    setLoading(true); setError("");
    try {
      const { user, error: e } = await auth.verifyUserByEmailAndPhone(form.email, form.phone);
      if (e || !user) { setError(e || "We couldn't find that account."); return; }
      setVerifiedId(user.id);
      setStep("newpin");
    } catch (err: any) {
      setError(err.message);
    } finally { setLoading(false); }
  };

  const handleNewPinKey = (k: string) => {
    if (k === "⌫") { setPin(p => p.slice(0, -1)); return; }
    if (k === "" || pin.length >= 4) return;
    const next = pin + k;
    setPin(next);
    if (next.length === 4) setTimeout(() => setStep("confirm"), 250);
  };

  const handleConfirmKey = (k: string) => {
    if (k === "⌫") { setConfirm(p => p.slice(0, -1)); setError(""); return; }
    if (k === "" || confirm.length >= 4) return;
    const next = confirm + k;
    setConfirm(next);
    if (next.length === 4) setTimeout(() => handleConfirm(next), 150);
  };

  const handleConfirm = async (val?: string) => {
    const value = val ?? confirm;
    if (value !== pin) {
      triggerShake();
      setError(COPY.pin_confirm.error);
      setTimeout(() => setConfirm(""), 350);
      return;
    }
    if (!verifiedId) return;
    setLoading(true);
    try {
      const { error: e } = await auth.updateUserPinLocal(verifiedId, pin);
      if (e) throw new Error(e);
      await refreshUser();
      toast({ title: "PIN reset!", description: "Your new PIN is active." });
      onCancel();
    } catch (err: any) {
      toast({ title: "Something went wrong", description: err.message, variant: "destructive" });
    } finally { setLoading(false); }
  };

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (step === "newpin" || step === "confirm") {
        if (e.key >= "0" && e.key <= "9") step === "newpin" ? handleNewPinKey(e.key) : handleConfirmKey(e.key);
        if (e.key === "Backspace") step === "newpin" ? handleNewPinKey("⌫") : handleConfirmKey("⌫");
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [step, pin, confirm]);

  if (step === "verify") return (
    <SlideCard>
      <div className="text-center mb-6">
        <h1 className="text-2xl font-bold text-foreground">{COPY.reset.headline}</h1>
        <p className="text-sm text-muted-foreground mt-1">{COPY.reset.sub}</p>
      </div>

      <div className="space-y-4">
        <div className="space-y-1.5">
          <label className="text-sm font-medium text-foreground">Registered email</label>
          <Input
            type="email"
            value={form.email}
            onChange={e => { setForm(p => ({ ...p, email: e.target.value })); setError(""); }}
            className="h-12 rounded-xl pointer-events-auto"
            autoFocus
          />
        </div>
        <div className="space-y-1.5">
          <label className="text-sm font-medium text-foreground">Registered phone</label>
          <Input
            type="tel"
            value={form.phone}
            onChange={e => { setForm(p => ({ ...p, phone: e.target.value })); setError(""); }}
            className="h-12 rounded-xl pointer-events-auto"
            maxLength={10}
          />
        </div>
      </div>

      {error && <p className="text-destructive text-xs mt-2 animate-[fadeIn_0.2s_ease]">{error}</p>}

      <Button
        onClick={handleVerify}
        disabled={loading}
        className="w-full h-12 bg-gradient-primary text-primary-foreground rounded-2xl font-semibold mt-5 pointer-events-auto"
      >
        {loading ? (
          <span className="flex items-center gap-2">
            <span className="h-4 w-4 rounded-full border-2 border-white border-t-transparent animate-spin" />
            Checking…
          </span>
        ) : COPY.reset.cta}
      </Button>

      <button
        type="button"
        onClick={onCancel}
        className="w-full mt-3 text-sm text-muted-foreground hover:text-foreground text-center pointer-events-auto"
      >
        ← Back to login
      </button>
    </SlideCard>
  );

  return (
    <SlideCard>
      <div className="text-center mb-6">
        <h1 className="text-2xl font-bold text-foreground">
          {step === "newpin" ? COPY.reset.new_pin : COPY.reset.confirm_pin}
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          {step === "newpin" ? "Make it something you'll remember." : COPY.pin_confirm.sub}
        </p>
      </div>

      <PinDots filled={step === "newpin" ? pin.length : confirm.length} shake={shake} />

      {error && (
        <p className="text-destructive text-xs text-center mt-2 animate-[fadeIn_0.2s_ease]">{error}</p>
      )}

      <div className="mt-6">
        <NumPad onKey={step === "newpin" ? handleNewPinKey : handleConfirmKey} disabled={loading} />
      </div>

      {loading && (
        <div className="flex items-center justify-center gap-2 mt-4 text-sm text-muted-foreground">
          <div className="h-4 w-4 rounded-full border-2 border-primary border-t-transparent animate-spin" />
          Saving…
        </div>
      )}
    </SlideCard>
  );
};

// ─── Main Auth Page ───────────────────────────────────────────────────────────

type AuthView = "enter_pin" | "signup" | "set_pin" | "reset_pin" | "csv_import";

const Auth = () => {
  const { user, loading, hasPinSet, hasAccount } = useAuth();
  const navigate = useNavigate();
  const [view, setView] = useState<AuthView>("enter_pin");

  useEffect(() => {
    if (loading) return;
    if (user) { navigate("/dashboard"); return; }
    if (!hasAccount)     setView("signup");
    else if (!hasPinSet) setView("set_pin");
    else                 setView("enter_pin");
  }, [loading, user, hasAccount, hasPinSet]);

  if (loading) return (
    <div className="min-h-screen flex items-center justify-center">
      <div className="h-10 w-10 rounded-full border-2 border-primary border-t-transparent animate-spin" />
    </div>
  );

  return (
    <>
      {/* Keyframe injections */}
      <style>{`
        @keyframes slideUp {
          from { opacity: 0; transform: translateY(18px); }
          to   { opacity: 1; transform: translateY(0);    }
        }
        @keyframes fadeIn {
          from { opacity: 0; }
          to   { opacity: 1; }
        }
        @keyframes popIn {
          from { opacity: 0; transform: scale(0.6); }
          to   { opacity: 1; transform: scale(1);   }
        }
        @keyframes shake {
          0%, 100% { transform: translateX(0); }
          20%       { transform: translateX(-8px); }
          40%       { transform: translateX(8px); }
          60%       { transform: translateX(-5px); }
          80%       { transform: translateX(5px); }
        }
      `}</style>

      <div className="page-safe min-h-screen bg-gradient-to-br from-background via-background/95 to-primary/5 flex flex-col items-center justify-center p-6">

        {/* Back to landing — only on signup */}
        {view === "signup" && (
          <div className="w-full max-w-xs mb-4 self-start animate-[fadeIn_0.3s_ease]">
            <Link
              to="/"
              className="inline-flex items-center text-sm text-muted-foreground hover:text-primary transition-colors pointer-events-auto"
            >
              <ArrowLeft className="h-4 w-4 mr-1" /> Back
            </Link>
          </div>
        )}

        {/* Logo */}
        <div className="mb-8 animate-[fadeIn_0.4s_ease]">
          <img
            src="/app-assets/acounted-logo.png"
            alt="Acounted"
            className="h-14 w-auto mx-auto"
          />
        </div>

        {/* Views */}
        <div className="w-full max-w-xs">
          {view === "enter_pin"  && <EnterPinScreen  onForgot={() => setView("reset_pin")} />}
          {view === "signup"     && <SignUpScreen     onSuccess={() => navigate("/dashboard")} />}
          {view === "set_pin"    && <SetPinScreen     onSuccess={() => navigate("/dashboard")} />}
          {view === "reset_pin"  && <ResetPinScreen   onCancel={() => setView("enter_pin")} />}
          {view === "csv_import" && <CSVImportScreen  onCancel={() => setView("enter_pin")} />}
        </div>

        {/* Footer — switch mode + restore */}
        {(view === "enter_pin" || view === "signup") && (
          <div className="mt-6 flex flex-col items-center gap-3 w-full max-w-xs animate-[fadeIn_0.5s_ease]">

            {view === "enter_pin" && (
              <p className="text-sm text-muted-foreground">
                New here?{" "}
                <button
                  type="button"
                  onClick={() => setView("signup")}
                  className="text-primary font-medium hover:underline pointer-events-auto"
                >
                  Create your account
                </button>
              </p>
            )}

            {view === "signup" && (
              <p className="text-sm text-muted-foreground">
                Already have an account?{" "}
                <button
                  type="button"
                  onClick={() => setView("enter_pin")}
                  className="text-primary font-medium hover:underline pointer-events-auto"
                >
                  Log in
                </button>
              </p>
            )}

            <div className="flex items-center gap-3 w-full">
              <div className="flex-1 h-px bg-border/40" />
              <span className="text-xs text-muted-foreground/60">or</span>
              <div className="flex-1 h-px bg-border/40" />
            </div>

            <button
              type="button"
              onClick={() => setView("csv_import")}
              className="w-full flex items-center justify-center gap-2 h-11 rounded-xl border-2 border-primary/30 bg-primary/5 hover:bg-primary/10 hover:border-primary/50 transition-all pointer-events-auto"
            >
              <Upload className="h-4 w-4 text-primary" />
              <span className="text-sm font-semibold text-primary">Restore from backup</span>
            </button>

          </div>
        )}
      </div>
    </>
  );
};

export default Auth;
