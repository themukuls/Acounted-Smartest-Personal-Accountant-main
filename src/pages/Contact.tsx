import React, { useState } from "react";
import { AppLayout } from "@/components/layout/AppLayout";
import { GlassCard } from "@/components/ui/glass-card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";
import {
  MessageCircle, Mail, Send, CheckCircle2,
  HeartHandshake, Phone, User, Users,
  Sparkles, ShieldCheck, TrendingUp, Bell,
  ArrowRight,
} from "lucide-react";

/* ── WhatsApp community link — replace with your actual invite link ── */
const WA_COMMUNITY_LINK = "https://chat.whatsapp.com/CRHanwM7LFoCOnZIdGpRTx";

const Contact: React.FC = () => {
  const { toast } = useToast();
  const [tab, setTab] = useState<"contact" | "community">("contact");
  const [sendMethod, setSendMethod] = useState<"whatsapp" | "email">("whatsapp");
  const [formData, setFormData] = useState({ name: "", email: "", phone: "", message: "" });
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    setFormData(prev => ({ ...prev, [e.target.name]: e.target.value }));
  };

  const canSend = formData.name.trim() !== "" && formData.message.trim() !== "";

  const handleSend = async () => {
    setSending(true);
    await new Promise(r => setTimeout(r, 500));
    const text = [
      `*Message via Acounted*`, ``,
      `*Name:* ${formData.name}`,
      formData.email ? `*Email:* ${formData.email}` : null,
      formData.phone ? `*Phone:* ${formData.phone}` : null,
      ``, `*Message:*`, formData.message,
    ].filter(l => l !== null).join("\n");

    if (sendMethod === "whatsapp") {
      window.open(`https://wa.me/918368731309?text=${encodeURIComponent(text)}`, "_blank");
    } else {
      window.open(
        `mailto:support@acounted.com?subject=${encodeURIComponent(`Message from ${formData.name}`)}&body=${encodeURIComponent(text)}`,
        "_blank"
      );
    }
    setSending(false);
    setSent(true);
  };

  const handleReset = () => {
    setSent(false);
    setFormData({ name: "", email: "", phone: "", message: "" });
    setSendMethod("whatsapp");
  };

  return (
    <AppLayout>
      <div className="space-y-5 pt-4 md:pt-0 pb-8 max-w-lg mx-auto">

        {/* ── Page header ──────────────────────────────────── */}
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 rounded-2xl bg-primary/10 flex items-center justify-center shrink-0">
            <HeartHandshake className="h-5 w-5 text-primary" />
          </div>
          <div>
            <h1 className="text-xl font-bold tracking-tight gradient-text">Get in touch</h1>
            <p className="text-xs text-muted-foreground">We'd love to hear from you</p>
          </div>
        </div>

        {/* ── Tab selector ─────────────────────────────────── */}
        <div className="flex gap-1 p-1 rounded-xl bg-muted/40 border border-border/40">
          {([
            { id: "contact" as const,   label: "Contact",   icon: MessageCircle },
            { id: "community" as const, label: "Community", icon: Users },
          ]).map(t => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={cn(
                "flex-1 flex items-center justify-center gap-2 py-2 rounded-lg text-sm font-semibold transition-all duration-200 pointer-events-auto",
                tab === t.id
                  ? "bg-white shadow-sm text-primary border border-border/40"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              <t.icon className="h-4 w-4" />
              {t.label}
            </button>
          ))}
        </div>

        {/* ══════════════════════════════════════════
            TAB: CONTACT
        ══════════════════════════════════════════ */}
        {tab === "contact" && (
          <>
            {sent ? (
              <GlassCard className="p-8 text-center space-y-4" hover={false}>
                <div className="h-16 w-16 rounded-full bg-emerald-100 flex items-center justify-center mx-auto">
                  <CheckCircle2 className="h-8 w-8 text-emerald-600" />
                </div>
                <div>
                  <h2 className="text-lg font-bold text-foreground">Message sent!</h2>
                  <p className="text-sm text-muted-foreground mt-1">
                    Thanks for reaching out. We'll get back to you soon.
                  </p>
                </div>
                <div className={cn(
                  "rounded-xl px-4 py-3 text-sm font-medium",
                  sendMethod === "whatsapp"
                    ? "bg-green-50 text-green-700 border border-green-200"
                    : "bg-blue-50 text-blue-700 border border-blue-200"
                )}>
                  {sendMethod === "whatsapp"
                    ? "💬 Expect a reply on WhatsApp within ~2 hours"
                    : "📧 Expect a reply on email within ~24 hours"}
                </div>
                <Button variant="outline" className="w-full rounded-xl pointer-events-auto" onClick={handleReset}>
                  Send another message
                </Button>
              </GlassCard>
            ) : (
              <GlassCard className="p-5 space-y-4" hover={false}>

                {/* Name */}
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-foreground">
                    Name <span className="text-destructive">*</span>
                  </label>
                  <div className="relative">
                    <User className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                    <Input name="name" value={formData.name} onChange={handleChange}
                      placeholder="Your name"
                      className="h-10 text-sm rounded-xl pl-9 pointer-events-auto" />
                  </div>
                </div>

                {/* Email */}
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-foreground">
                    Email <span className="text-muted-foreground font-normal">(optional)</span>
                  </label>
                  <div className="relative">
                    <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                    <Input name="email" type="email" value={formData.email} onChange={handleChange}
                      placeholder="your@email.com"
                      className="h-10 text-sm rounded-xl pl-9 pointer-events-auto" />
                  </div>
                </div>

                {/* Phone */}
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-foreground">
                    Phone <span className="text-muted-foreground font-normal">(optional)</span>
                  </label>
                  <div className="relative">
                    <Phone className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                    <Input name="phone" type="tel" value={formData.phone} onChange={handleChange}
                      placeholder="Your phone number"
                      className="h-10 text-sm rounded-xl pl-9 pointer-events-auto" />
                  </div>
                </div>

                {/* Message */}
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-foreground">
                    How can we help? <span className="text-destructive">*</span>
                  </label>
                  <Textarea name="message" value={formData.message} onChange={handleChange}
                    placeholder="Tell us what's on your mind…"
                    className="min-h-[110px] text-sm rounded-xl resize-none pointer-events-auto" />
                </div>

                {/* Send via toggle */}
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-foreground">Send via</label>
                  <div className="flex gap-2">
                    {(["whatsapp", "email"] as const).map(method => (
                      <button key={method} onClick={() => setSendMethod(method)}
                        className={cn(
                          "flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl border text-sm font-medium transition-all pointer-events-auto",
                          sendMethod === method
                            ? method === "whatsapp"
                              ? "bg-green-50 border-green-300 text-green-700"
                              : "bg-blue-50 border-blue-300 text-blue-700"
                            : "bg-background/50 border-border/60 text-muted-foreground hover:border-border"
                        )}>
                        {method === "whatsapp"
                          ? <><MessageCircle className="h-4 w-4" /> WhatsApp</>
                          : <><Mail className="h-4 w-4" /> Email</>}
                      </button>
                    ))}
                  </div>
                  <p className="text-[10px] text-muted-foreground px-0.5">
                    {sendMethod === "whatsapp"
                      ? "Opens WhatsApp with your message ready — we reply within ~2 hours"
                      : "Opens your email app with the message ready — we reply within ~24 hours"}
                  </p>
                </div>

                {/* Send */}
                <Button className="w-full rounded-xl h-11 pointer-events-auto"
                  disabled={!canSend || sending} onClick={handleSend}>
                  {sending ? (
                    <span className="flex items-center gap-2">
                      <div className="h-4 w-4 rounded-full border-2 border-primary-foreground/30 border-t-primary-foreground animate-spin" />
                      Opening…
                    </span>
                  ) : (
                    <span className="flex items-center gap-2">
                      <Send className="h-4 w-4" /> Send Message
                    </span>
                  )}
                </Button>
              </GlassCard>
            )}
          </>
        )}

        {/* ══════════════════════════════════════════
            TAB: COMMUNITY
        ══════════════════════════════════════════ */}
        {tab === "community" && (
          <div className="space-y-4">

            {/* Hero CTA card */}
            <div className="relative rounded-2xl overflow-hidden bg-gradient-to-br from-green-500 to-emerald-600 p-5 text-white">
              {/* Subtle circle decoration */}
              <div className="absolute -right-8 -top-8 h-32 w-32 rounded-full bg-white/10 pointer-events-none" />
              <div className="absolute -right-4 top-12 h-20 w-20 rounded-full bg-white/8 pointer-events-none" />

              <div className="relative space-y-3">
                <div className="flex items-center gap-2.5">
                  <div className="h-10 w-10 rounded-xl bg-white/20 flex items-center justify-center shrink-0">
                    <MessageCircle className="h-5 w-5 text-white" />
                  </div>
                  <div>
                    <p className="text-base font-bold leading-tight">Acounted Community</p>
                    <p className="text-xs text-white/75">WhatsApp · Free · Private</p>
                  </div>
                </div>

                <p className="text-sm text-white/90 leading-relaxed">
                  Join our WhatsApp community — get tips, share wins, ask questions, and stay updated with the latest Acounted features.
                </p>

                <button
                  onClick={() => window.open(WA_COMMUNITY_LINK, "_blank")}
                  className="pointer-events-auto w-full flex items-center justify-center gap-2 bg-white text-emerald-700 font-bold text-sm py-3 rounded-xl transition-all active:scale-95 hover:bg-white/90"
                >
                  <MessageCircle className="h-4 w-4" />
                  Join the Community
                  <ArrowRight className="h-4 w-4" />
                </button>
              </div>
            </div>

            {/* What the community offers */}
            <GlassCard className="p-4 space-y-3" hover={false}>
              <p className="text-sm font-bold text-foreground">What you get in the community</p>
              <div className="space-y-3">
                {[
                  {
                    icon: Sparkles, color: "text-violet-600", bg: "bg-violet-50",
                    title: "Tips & tricks",
                    desc: "Weekly money-saving tips, tax hacks, and investment ideas shared by the Acounted team.",
                  },
                  {
                    icon: Users, color: "text-blue-600", bg: "bg-blue-50",
                    title: "Peer support",
                    desc: "Ask questions, share your wins, and learn from others on the same financial journey.",
                  },
                  {
                    icon: Bell, color: "text-amber-600", bg: "bg-amber-50",
                    title: "Feature updates first",
                    desc: "Be the first to know about new features, beta access, and improvements to Acounted.",
                  },
                  {
                    icon: ShieldCheck, color: "text-emerald-600", bg: "bg-emerald-50",
                    title: "Private & safe",
                    desc: "Your financial data stays on your device. The community is just a support space — no data shared.",
                  },
                  {
                    icon: TrendingUp, color: "text-primary", bg: "bg-primary/8",
                    title: "Financial challenges",
                    desc: "Monthly saving challenges and goal check-ins to keep you on track and motivated.",
                  },
                ].map(({ icon: Icon, color, bg, title, desc }) => (
                  <div key={title} className="flex items-start gap-3">
                    <div className={cn("h-8 w-8 rounded-xl flex items-center justify-center shrink-0", bg)}>
                      <Icon className={cn("h-4 w-4", color)} />
                    </div>
                    <div>
                      <p className="text-xs font-bold text-foreground">{title}</p>
                      <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">{desc}</p>
                    </div>
                  </div>
                ))}
              </div>
            </GlassCard>

            {/* Second CTA at bottom */}
            <button
              onClick={() => window.open(WA_COMMUNITY_LINK, "_blank")}
              className="pointer-events-auto w-full flex items-center justify-center gap-2 bg-gradient-to-r from-green-500 to-emerald-600 text-white font-bold text-sm py-3.5 rounded-xl transition-all active:scale-95 hover:opacity-90 shadow-md"
            >
              <MessageCircle className="h-4 w-4" />
              Join on WhatsApp — it's free
            </button>

          </div>
        )}

      </div>
    </AppLayout>
  );
};

export default Contact;
