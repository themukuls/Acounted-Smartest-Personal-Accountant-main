import { useNavigate } from "react-router-dom";
import { AppLayout } from "@/components/layout/AppLayout";
import { GlassCard } from "@/components/ui/glass-card";
import { Button } from "@/components/ui/button";
import {
  ArrowLeft, CalendarDays, CheckCircle2, Circle,
  AlertCircle, Clock, TrendingUp, FileText, Wallet,
  Sparkles, RefreshCw,
} from "lucide-react";
import { getCurrentFinancialYear } from "@/lib/date-utils";
import { cn } from "@/lib/utils";
import { useState } from "react";

interface TaxEvent {
  id: string;
  date: Date;
  title: string;
  description: string;
  category: "advance_tax" | "itr" | "audit" | "investment";
  applicableTo?: string; // who this event applies to
}

// ── FY 2026-27 deadlines (Income Tax Act 2025 + Budget 2026) ─────────────────
// Key changes vs old calendar:
// - ITR-3 / ITR-4 (business/professional non-audit) → 31 Aug (was 31 Jul)
// - Belated / Revised ITR → 31 Mar of the NEXT year (was 31 Dec) — fee payable
// - Advance Tax for 44AD/44ADA → single instalment by 15 Mar (not 4 quarterly)
// - New: Form 10-IEA (opt into Old Regime) must be filed before ITR due date
// - New: Form 124 (new Form 12BB) investment declaration to employer — April
function buildEvents(fyStartYear: number): TaxEvent[] {
  const y = fyStartYear;    // e.g. 2026
  const ny = fyStartYear + 1; // e.g. 2027
  return [
    // ── Investment & employer declarations ───────────────────────────────
    {
      id: "form124_declaration",
      date: new Date(`${y}-04-30`),
      title: "Submit Form 124 to Employer",
      description: "New Form 12BB (Form 124) — declare HRA, home-loan, LTC & regime choice to your employer for correct TDS deduction all year.",
      category: "investment",
      applicableTo: "Salaried",
    },
    {
      id: "regime_choice_employer",
      date: new Date(`${y}-04-30`),
      title: "Inform Employer of Tax Regime",
      description: "Tell your employer Old or New Regime for TDS calculation. Default is New Regime — act only if you want Old Regime.",
      category: "investment",
      applicableTo: "Salaried",
    },

    // ── Advance tax ──────────────────────────────────────────────────────
    {
      id: "adv_q1",
      date: new Date(`${y}-06-15`),
      title: "Advance Tax Q1 — 15%",
      description: "15% of estimated annual tax liability due. Applies if total tax liability exceeds ₹10,000 (after TDS). Not applicable to senior citizens with no business income.",
      category: "advance_tax",
      applicableTo: "All taxpayers",
    },
    {
      id: "adv_q2",
      date: new Date(`${y}-09-15`),
      title: "Advance Tax Q2 — 45%",
      description: "Cumulative 45% of estimated annual tax due. Shortfall attracts interest u/s 234C.",
      category: "advance_tax",
      applicableTo: "All taxpayers",
    },
    {
      id: "adv_q3",
      date: new Date(`${y}-12-15`),
      title: "Advance Tax Q3 — 75%",
      description: "Cumulative 75% of estimated annual tax due.",
      category: "advance_tax",
      applicableTo: "All taxpayers",
    },
    {
      id: "adv_44ad_44ada",
      date: new Date(`${ny}-03-15`),
      title: "Advance Tax — 44AD / 44ADA (100%)",
      description: "Business & professional taxpayers under presumptive scheme pay 100% of advance tax in a single instalment by 15 March (no quarterly requirement).",
      category: "advance_tax",
      applicableTo: "Business / Professional (44AD, 44ADA)",
    },
    {
      id: "adv_q4",
      date: new Date(`${ny}-03-15`),
      title: "Advance Tax Q4 — 100%",
      description: "Final instalment — 100% of estimated tax. Any shortfall from earlier quarters must be made up here.",
      category: "advance_tax",
      applicableTo: "Salaried / Other income",
    },

    // ── Tax-saving investment deadline ───────────────────────────────────
    {
      id: "investment_deadline",
      date: new Date(`${ny}-03-31`),
      title: "Last Date for Tax-Saving Investments",
      description: "Final date to make PPF, ELSS, NPS, health-insurance, 80G donations and other Old-Regime deduction investments for this Tax Year. Missed investments cannot be carried forward.",
      category: "investment",
      applicableTo: "Old Regime taxpayers",
    },
    {
      id: "fy_end",
      date: new Date(`${ny}-03-31`),
      title: "Tax Year Ends (FY Close)",
      description: "End of Tax Year 2026-27 under the Income Tax Act 2025. Income earned through this date is assessed for this year.",
      category: "investment",
    },

    // ── ITR filing ───────────────────────────────────────────────────────
    {
      id: "itr_1_2",
      date: new Date(`${ny}-07-31`),
      title: "ITR-1 / ITR-2 Filing Deadline",
      description: "Last date to file ITR-1 (Sahaj) and ITR-2 for salaried individuals, pensioners, and those with capital gains or multiple house properties. No penalty if filed by this date.",
      category: "itr",
      applicableTo: "Salaried, pensioners, capital gains",
    },
    {
      id: "itr_3_4",
      date: new Date(`${ny}-08-31`),
      title: "ITR-3 / ITR-4 Filing Deadline",
      description: "Extended deadline for non-audit business and professional taxpayers (44AD, 44ADA). New under Income Tax Act 2025 — was 31 July previously.",
      category: "itr",
      applicableTo: "Business / Professional (non-audit)",
    },
    {
      id: "form10iea",
      date: new Date(`${ny}-07-31`),
      title: "File Form 10-IEA (Old Regime opt-in)",
      description: "Business/professional taxpayers must file Form 10-IEA before their ITR due date to opt into the Old Tax Regime. Salaried taxpayers declare via ITR only.",
      category: "itr",
      applicableTo: "Business / Professional choosing Old Regime",
    },
    {
      id: "audit_complete",
      date: new Date(`${ny}-09-30`),
      title: "Tax Audit Report Completion",
      description: "Deadline to complete and upload tax audit report (Sec 393 / old 44AB). Applies to businesses with turnover above ₹3 Cr (mostly digital) or ₹2 Cr (mixed).",
      category: "audit",
      applicableTo: "Large business / audit cases",
    },
    {
      id: "itr_audit",
      date: new Date(`${ny}-10-31`),
      title: "ITR Filing — Audit Cases",
      description: "Deadline for taxpayers requiring statutory audit (businesses above turnover threshold). Must complete audit before this date.",
      category: "itr",
      applicableTo: "Audit-required taxpayers",
    },
    {
      id: "itr_belated",
      date: new Date(`${ny + 1}-03-31`),
      title: "Belated / Revised ITR Deadline",
      description: "Last date to file a belated return or revise a filed ITR for Tax Year 2026-27. Extended to 31 March under Income Tax Act 2025 (was 31 December). A fee is charged for late filing.",
      category: "itr",
      applicableTo: "All taxpayers who missed the original deadline",
    },
  ];
}

const CATEGORY_META = {
  advance_tax: { icon: TrendingUp, color: "text-violet-600", bg: "bg-violet-100", label: "Advance Tax" },
  itr:         { icon: FileText,   color: "text-blue-600",   bg: "bg-blue-100",   label: "ITR Filing"  },
  audit:       { icon: Sparkles,   color: "text-amber-600",  bg: "bg-amber-100",  label: "Audit"       },
  investment:  { icon: Wallet,     color: "text-emerald-600",bg: "bg-emerald-100",label: "Investment"  },
};

type Status = "past" | "urgent" | "upcoming" | "future";

function getStatus(date: Date, today: Date): Status {
  const diff = Math.ceil((date.getTime() - today.getTime()) / 86400000);
  if (diff < 0)   return "past";
  if (diff <= 14) return "urgent";
  if (diff <= 60) return "upcoming";
  return "future";
}

const STATUS_STYLES: Record<Status, string> = {
  past:     "border-muted/40 opacity-60",
  urgent:   "border-red-200 bg-red-50/40",
  upcoming: "border-amber-200 bg-amber-50/30",
  future:   "border-muted/30",
};

const STATUS_BADGE: Record<Status, { text: string; cls: string }> = {
  past:     { text: "Past",      cls: "bg-muted/60 text-muted-foreground"   },
  urgent:   { text: "Urgent",    cls: "bg-red-100 text-red-700"             },
  upcoming: { text: "Coming up", cls: "bg-amber-100 text-amber-700"         },
  future:   { text: "Scheduled", cls: "bg-muted/40 text-muted-foreground"   },
};

type FilterCategory = "all" | "advance_tax" | "itr" | "audit" | "investment";

const FILTER_OPTIONS: { value: FilterCategory; label: string }[] = [
  { value: "all",          label: "All"        },
  { value: "advance_tax",  label: "Advance Tax"},
  { value: "itr",          label: "ITR Filing" },
  { value: "audit",        label: "Audit"      },
  { value: "investment",   label: "Investment" },
];

const TaxCalendar = () => {
  const navigate = useNavigate();
  const fy = getCurrentFinancialYear();
  const fyStartYear = parseInt(fy.split("-")[0], 10);
  const allEvents = buildEvents(fyStartYear);
  const today = new Date();

  const STORAGE_KEY = `tax_calendar_checked_${fy}`;
  const [checked, setChecked] = useState<Set<string>>(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      return raw ? new Set(JSON.parse(raw)) : new Set();
    } catch {
      return new Set();
    }
  });

  const [filter, setFilter] = useState<FilterCategory>("all");

  const toggle = (id: string) => {
    setChecked((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      localStorage.setItem(STORAGE_KEY, JSON.stringify([...next]));
      return next;
    });
  };

  const clearAll = () => {
    setChecked(new Set());
    localStorage.removeItem(STORAGE_KEY);
  };

  // Deduplicate events that share the same date/title (e.g. adv_q4 and adv_44ad share 15 Mar)
  const events = allEvents.filter((e) => filter === "all" || e.category === filter);

  // Sort by date
  const sorted = [...events].sort((a, b) => a.date.getTime() - b.date.getTime());

  const totalUnique = allEvents.length;
  const completed   = allEvents.filter((e) => checked.has(e.id)).length;
  const pct         = Math.round((completed / totalUnique) * 100);

  // Next upcoming event
  const nextEvent = allEvents
    .filter((e) => !checked.has(e.id) && e.date >= today)
    .sort((a, b) => a.date.getTime() - b.date.getTime())[0];

  return (
    <AppLayout>
      <div className="space-y-5 mt-4 md:mt-0">

        {/* Header */}
        <div className="flex items-center gap-3">
          <Button
            variant="ghost" size="sm"
            className="h-9 w-9 p-0 rounded-xl pointer-events-auto"
            onClick={() => navigate("/tax-copilot")}
          >
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div className="h-10 w-10 rounded-2xl bg-primary/10 flex items-center justify-center shrink-0">
            <CalendarDays className="h-5 w-5 text-primary" />
          </div>
          <div className="flex-1">
            <h1 className="text-xl font-bold tracking-tight gradient-text">Tax Calendar</h1>
            <p className="text-xs text-muted-foreground">Tax Year 2026-27 · Income Tax Act 2025</p>
          </div>
          <button
            onClick={clearAll}
            className="pointer-events-auto text-xs text-muted-foreground flex items-center gap-1 hover:text-foreground transition-colors"
          >
            <RefreshCw className="h-3 w-3" /> Reset
          </button>
        </div>

        {/* Progress + next event */}
        <GlassCard className="p-4 space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-sm font-semibold text-foreground">Progress</p>
            <p className="text-xs text-muted-foreground">{completed}/{totalUnique} marked</p>
          </div>
          <div className="h-2 bg-muted/40 rounded-full overflow-hidden">
            <div
              className="h-full bg-primary rounded-full transition-all duration-500"
              style={{ width: `${pct}%` }}
            />
          </div>
          {nextEvent && (
            <div className="flex items-center gap-2 pt-1 border-t border-border/30">
              <Clock className="h-3.5 w-3.5 text-primary shrink-0" />
              <p className="text-xs text-muted-foreground">
                Next: <span className="font-semibold text-foreground">{nextEvent.title}</span>
                {" — "}{nextEvent.date.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}
              </p>
            </div>
          )}
        </GlassCard>

        {/* Filter pills */}
        <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-hide">
          {FILTER_OPTIONS.map(({ value, label }) => (
            <button
              key={value}
              type="button"
              onClick={() => setFilter(value)}
              className={cn(
                "px-3 py-1.5 rounded-xl text-xs font-medium border whitespace-nowrap transition-all pointer-events-auto shrink-0",
                filter === value
                  ? "bg-primary text-primary-foreground border-primary"
                  : "bg-background border-border/60 text-muted-foreground hover:border-primary/40 hover:text-foreground",
              )}
            >
              {label}
            </button>
          ))}
        </div>

        {/* Events list */}
        <div className="space-y-3">
          {sorted.map((event) => {
            const status  = getStatus(event.date, today);
            const isChecked = checked.has(event.id);
            const meta    = CATEGORY_META[event.category];
            const Icon    = meta.icon;
            const badge   = STATUS_BADGE[status];
            const dateStr = event.date.toLocaleDateString("en-IN", {
              day: "numeric", month: "short", year: "numeric",
            });

            return (
              <GlassCard
                key={event.id}
                className={cn(
                  "p-4 border transition-all",
                  isChecked ? "opacity-60 border-muted/30" : STATUS_STYLES[status],
                )}
              >
                <div className="flex items-start gap-3">
                  <div className={cn("h-9 w-9 rounded-xl flex items-center justify-center shrink-0", meta.bg)}>
                    <Icon className={cn("h-4 w-4", meta.color)} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <p className="text-sm font-semibold text-foreground leading-tight">{event.title}</p>
                        <p className="text-xs text-muted-foreground mt-0.5">{dateStr}</p>
                      </div>
                      <span className={cn("text-[10px] font-bold px-1.5 py-0.5 rounded-full shrink-0", badge.cls)}>
                        {isChecked ? "Done ✓" : badge.text}
                      </span>
                    </div>
                    <p className="text-xs text-muted-foreground mt-1 leading-relaxed">{event.description}</p>
                    {event.applicableTo && (
                      <p className="text-[10px] text-primary/70 mt-1 font-medium">Applies to: {event.applicableTo}</p>
                    )}
                  </div>
                  <button
                    onClick={() => toggle(event.id)}
                    className="shrink-0 mt-0.5 pointer-events-auto"
                  >
                    {isChecked
                      ? <CheckCircle2 className="h-5 w-5 text-emerald-500" />
                      : <Circle className="h-5 w-5 text-muted-foreground/40" />}
                  </button>
                </div>
              </GlassCard>
            );
          })}
        </div>

        {/* Act 2025 notice */}
        <GlassCard className="p-4 bg-blue-50/40 border-blue-200/40">
          <div className="flex items-start gap-2.5">
            <CalendarDays className="h-4 w-4 text-blue-600 mt-0.5 shrink-0" />
            <div className="space-y-1">
              <p className="text-xs font-semibold text-blue-800">Income Tax Act 2025 — What Changed</p>
              <ul className="text-xs text-blue-700 space-y-0.5">
                <li>• ITR-3 / ITR-4 (business, non-audit) deadline moved to <strong>31 August</strong></li>
                <li>• Belated / Revised return now allowed until <strong>31 March</strong> (fee applies)</li>
                <li>• 44AD / 44ADA taxpayers pay advance tax as a <strong>single instalment by 15 March</strong></li>
                <li>• New Regime is the default — opt out via <strong>Form 10-IEA</strong> before your ITR due date</li>
                <li>• "Tax Year" replaces "Financial Year / Assessment Year" in official language</li>
              </ul>
            </div>
          </div>
        </GlassCard>

        {/* Legend */}
        <GlassCard className="p-4">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">Legend</p>
          <div className="grid grid-cols-2 gap-2">
            {[
              { icon: AlertCircle,  color: "text-red-500",           label: "Urgent (≤14 days)"  },
              { icon: Clock,        color: "text-amber-500",          label: "Coming up (≤60 days)"},
              { icon: Circle,       color: "text-muted-foreground",   label: "Scheduled"          },
              { icon: CheckCircle2, color: "text-emerald-500",        label: "Marked done"        },
            ].map(({ icon: LI, color, label }) => (
              <div key={label} className="flex items-center gap-2">
                <LI className={cn("h-4 w-4 shrink-0", color)} />
                <span className="text-xs text-muted-foreground">{label}</span>
              </div>
            ))}
          </div>
        </GlassCard>

      </div>
    </AppLayout>
  );
};

export default TaxCalendar;
