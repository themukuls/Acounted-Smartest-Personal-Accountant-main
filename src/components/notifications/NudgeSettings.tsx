"use client";

/**
 * NudgeSettings.tsx — the controls for the reminder system.
 *
 * The point of this screen is that the promises the engine makes are visible
 * and checkable. A user who doesn't trust a notification feature turns the
 * whole thing off, so:
 *   - the caps and quiet hours are stated in plain words, not buried,
 *   - every category can be switched off on its own, and takes effect
 *     immediately (the toggle cancels anything already queued),
 *   - and the preview shows what would ACTUALLY be sent right now, computed
 *     from their real data by the same code path the scheduler uses — plus
 *     the reason each other candidate was held back.
 *
 * That last part is the honest version of a "test notification" button.
 */

import React from 'react';
import { motion } from 'framer-motion';
import {
  BellRing,
  Moon,
  Sparkles,
  CalendarClock,
  HeartHandshake,
  Trophy,
  ShieldCheck,
  Loader2,
} from 'lucide-react';
import { Switch } from '@/components/ui/switch';
import { Separator } from '@/components/ui/separator';
import { cn } from '@/lib/utils';
import { useNudgeSettings } from '@/hooks/useNudges';
import {
  CATEGORY_META,
  MAX_PER_WEEK,
  NUDGE_CATEGORIES,
  type NudgeCategory,
} from '@/lib/nudges/types';

const CATEGORY_ICONS: Record<NudgeCategory, React.ComponentType<{ className?: string }>> = {
  reengagement: HeartHandshake,
  encouragement: Sparkles,
  reminders: CalendarClock,
  milestones: Trophy,
};

const hourLabel = (h: number): string => {
  const suffix = h < 12 ? 'am' : 'pm';
  const twelve = h % 12 === 0 ? 12 : h % 12;
  return `${twelve} ${suffix}`;
};

/** The notification as the OS would render it. */
const PreviewCard = ({ title, body }: { title: string; body: string }) => (
  <motion.div
    initial={{ opacity: 0, y: 6 }}
    animate={{ opacity: 1, y: 0 }}
    transition={{ duration: 0.25 }}
    className="rounded-xl border border-primary/25 bg-primary/5 p-3"
  >
    <div className="flex items-start gap-2.5">
      <div className="h-7 w-7 rounded-lg bg-primary/15 flex items-center justify-center shrink-0 mt-0.5">
        <BellRing className="h-3.5 w-3.5 text-primary" />
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-xs font-bold text-foreground leading-snug">{title}</p>
        <p className="text-xs text-muted-foreground leading-relaxed mt-0.5">{body}</p>
      </div>
    </div>
  </motion.div>
);

export const NudgeSettings = () => {
  const {
    preferences,
    isLoading,
    preview,
    isPreviewLoading,
    isSaving,
    setCategory,
  } = useNudgeSettings();

  if (isLoading || !preferences) {
    return (
      <div className="space-y-3">
        {[1, 2, 3].map((i) => (
          <div key={i} className="h-14 rounded-xl bg-muted/60 animate-pulse" />
        ))}
      </div>
    );
  }

  const enabled = preferences.enabled;
  const selected = preview?.selection.selected ?? null;
  const held = preview?.selection.suppressed ?? [];
  const blocked = preview?.selection.blockedReason ?? null;

  return (
    <div className="space-y-4">
      {/* ── Always-on master state ── */}
      <div
        className={cn(
          'rounded-xl border p-3.5 transition-colors',
          enabled ? 'border-primary/25 bg-primary/5' : 'border-border/50 bg-background/60',
        )}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-start gap-3 min-w-0">
            <div
              className={cn(
                'h-9 w-9 rounded-xl flex items-center justify-center shrink-0',
                enabled ? 'bg-primary/15' : 'bg-muted',
              )}
            >
              <BellRing
                className={cn('h-4 w-4', enabled ? 'text-primary' : 'text-muted-foreground')}
              />
            </div>
            <div className="min-w-0">
              <h3 className="text-sm font-bold text-foreground">Reminders</h3>
              <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">
                Nudges built from your own entries — never a generic "don't forget to
                track".
              </p>
            </div>
          </div>
          <span className="mt-0.5 shrink-0 rounded-full bg-emerald-100 px-2.5 py-1 text-[10px] font-bold text-emerald-700">Always on</span>
        </div>
      </div>

      {/* ── The promises, stated up front ── */}
      <div className="rounded-xl border border-border/40 bg-background/60 p-3 space-y-2">
        <div className="flex items-center gap-2">
          <ShieldCheck className="h-3.5 w-3.5 text-emerald-600 shrink-0" />
          <p className="text-xs font-bold text-foreground">What you're agreeing to</p>
        </div>
        <ul className="text-xs text-muted-foreground space-y-1 leading-relaxed">
          <li>At most one a day, and never more than {MAX_PER_WEEK} in a week.</li>
          <li className="flex items-center gap-1.5">
            <Moon className="h-3 w-3 shrink-0" />
            Nothing between {hourLabel(preferences.quietStartHour)} and{' '}
            {hourLabel(preferences.quietEndHour)}.
          </li>
          <li>Never the same kind of nudge two days running.</li>
          <li>Every message is about something real in your data.</li>
        </ul>
      </div>

      {/* ── Per-category ── */}
      <div className={cn('space-y-1', !enabled && 'opacity-50')}>
        <p className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground px-0.5">
          What you'd like to hear about
        </p>
        {NUDGE_CATEGORIES.map((cat) => {
          const Icon = CATEGORY_ICONS[cat];
          const meta = CATEGORY_META[cat];
          return (
            <div
              key={cat}
              className="flex items-center justify-between gap-3 rounded-xl border border-border/40 p-3"
            >
              <div className="flex items-start gap-2.5 min-w-0">
                <Icon className="h-4 w-4 text-primary shrink-0 mt-0.5" />
                <div className="min-w-0">
                  <p className="text-xs font-semibold text-foreground">{meta.label}</p>
                  <p className="text-[11px] text-muted-foreground leading-relaxed mt-0.5">
                    {meta.description}
                  </p>
                </div>
              </div>
              <Switch
                checked={preferences.categories[cat]}
                disabled={!enabled || isSaving}
                onCheckedChange={(v) => setCategory(cat, v)}
                aria-label={meta.label}
                className="pointer-events-auto shrink-0"
              />
            </div>
          );
        })}
      </div>

      <Separator className="bg-border/40" />

      {/* ── Live preview ── */}
      <div className="space-y-2">
        <div className="flex items-center justify-between gap-2 px-0.5">
          <p className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground">
            What you'd get right now
          </p>
          {isPreviewLoading && (
            <Loader2 className="h-3 w-3 text-muted-foreground animate-spin shrink-0" />
          )}
        </div>

        {selected ? (
          <>
            <PreviewCard title={selected.title} body={selected.body} />
            {preview?.deliverAt && (
              <p className="text-[10px] text-muted-foreground px-0.5">
                Would arrive at{' '}
                {preview.deliverAt.toLocaleTimeString('en-IN', {
                  hour: 'numeric',
                  minute: '2-digit',
                })}
                {' · '}
                {selected.deepLink}
              </p>
            )}
          </>
        ) : (
          <div className="rounded-xl border border-border/40 bg-muted/30 p-3">
            <p className="text-xs font-semibold text-foreground">
              {blocked ?? 'Nothing worth sending right now.'}
            </p>
            <p className="text-[11px] text-muted-foreground mt-0.5 leading-relaxed">
              That is the normal state. Silence means nothing in your data has earned a nudge today.
            </p>
          </div>
        )}

        {held.length > 0 && (
          <div className="rounded-xl border border-border/40 p-3 space-y-2">
            <p className="text-[11px] font-bold text-foreground">
              Held back ({held.length})
            </p>
            {held.slice(0, 5).map(({ nudge, reason }) => (
              <div key={nudge.id} className="space-y-0.5">
                <p className="text-[11px] font-medium text-muted-foreground leading-snug">
                  {nudge.title}
                </p>
                <p className="text-[10px] text-muted-foreground/70">{reason}</p>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
