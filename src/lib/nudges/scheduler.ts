/**
 * scheduler.ts — decides whether to say anything at all, and when.
 *
 * `rules.ts` answers "what is true and worth saying?". This file answers the
 * harder question: "is it worth interrupting this person right now?" — almost
 * always, the answer is no.
 *
 * ── The contract with the user ──────────────────────────────────────────────
 *   • At most ONE notification per day. Not per category, per day.
 *   • At most FOUR in any rolling seven days.
 *   • Nothing between 22:00 and 08:00. Anything that would land there is
 *     pushed to 08:00, and then has to survive the caps again on that day.
 *   • Never the same category two days running, and never the same rule
 *     inside the cooldown that rule set for itself.
 *   • The exact same message is never sent twice, ever.
 *   • Off means off, immediately: disabling cancels everything already queued.
 *
 * The selection half is a pure function (`selectNudge`) so all of that is
 * testable without a device. The scheduling half is the only part that touches
 * `@capacitor/local-notifications`, is imported dynamically, and no-ops on web.
 */

import { isNative } from '@/lib/platform';
import { addDaysToKey, dayKey } from './dates';
import { evaluateNudges } from './rules';
import { appendHistory, loadHistory, loadPreferences, savePreferences } from './storage';
import {
  MAX_PER_DAY,
  MAX_PER_WEEK,
  type Nudge,
  type NudgeCategory,
  type NudgeHistory,
  type NudgePreferences,
  type NudgeSnapshot,
} from './types';

/** How long after evaluation a nudge is actually delivered. */
const DELIVERY_DELAY_MINUTES = 2;

// ── Quiet hours ──────────────────────────────────────────────────────────────

/** True when `hour` falls inside the (possibly overnight) quiet window. */
export function inQuietHours(hour: number, startHour: number, endHour: number): boolean {
  if (startHour === endHour) return false; // no quiet period configured
  if (startHour > endHour) return hour >= startHour || hour < endHour; // overnight
  return hour >= startHour && hour < endHour;
}

/** The next instant at `endHour:00` strictly after `from`. */
function nextQuietEnd(from: Date, endHour: number): Date {
  const at = new Date(from.getTime());
  at.setHours(endHour, 0, 0, 0);
  if (at.getTime() <= from.getTime()) at.setDate(at.getDate() + 1);
  return at;
}

/**
 * When a nudge evaluated at `now` should actually be delivered.
 *
 * Normally a couple of minutes out — long enough that the notification does
 * not land while the user is still looking at the app that produced it.
 * If that lands inside quiet hours it is moved to the end of the window,
 * which is the whole point: a budgeting app has nothing so urgent that it
 * earns a 01:00 buzz.
 *
 * `now` arrives from `getISTDate()`, so `getHours()` here reads IST wall-clock
 * — the same frame the whole app reasons in. Quiet hours are therefore IST
 * hours, as specified.
 */
export function resolveDeliveryTime(now: Date, prefs: NudgePreferences): Date {
  const target = new Date(now.getTime() + DELIVERY_DELAY_MINUTES * 60_000);
  if (!inQuietHours(target.getHours(), prefs.quietStartHour, prefs.quietEndHour)) {
    return target;
  }
  return nextQuietEnd(target, prefs.quietEndHour);
}

// ── Selection ────────────────────────────────────────────────────────────────

export interface SuppressedNudge {
  nudge: Nudge;
  reason: string;
}

export interface SelectionResult {
  /** The one nudge that would be delivered, or null. */
  selected: Nudge | null;
  /** The day it would land on, `yyyy-MM-dd`. */
  deliveryDay: string;
  /** A single reason nothing at all can be sent that day. */
  blockedReason: string | null;
  /** Per-candidate reasons, in candidate order. Powers the settings preview. */
  suppressed: SuppressedNudge[];
}

/**
 * Apply preferences, caps and cooldowns to a ranked candidate list.
 *
 * Pure. `deliveryDay` is the day the nudge would LAND on, not the day it was
 * evaluated — a nudge computed at 23:40 is capped against tomorrow, because
 * that is the day the user's attention actually gets spent.
 */
export function selectNudge(
  candidates: Nudge[],
  history: NudgeHistory,
  prefs: NudgePreferences,
  deliveryDay: string,
): SelectionResult {
  const base: SelectionResult = {
    selected: null,
    deliveryDay,
    blockedReason: null,
    suppressed: [],
  };

  if (!prefs.enabled) {
    return { ...base, blockedReason: 'Reminders are switched off.' };
  }

  const entries = history.entries;

  // Daily cap.
  const sameDay = entries.filter((e) => e.deliveryDay === deliveryDay).length;
  if (sameDay >= MAX_PER_DAY) {
    return { ...base, blockedReason: 'One reminder is already queued for that day.' };
  }

  // Weekly cap — rolling seven days ending on the delivery day.
  const weekStart = addDaysToKey(deliveryDay, -6);
  const inWeek = entries.filter(
    (e) => e.deliveryDay >= weekStart && e.deliveryDay <= deliveryDay,
  ).length;
  if (inWeek >= MAX_PER_WEEK) {
    return {
      ...base,
      blockedReason: `That would be more than ${MAX_PER_WEEK} in seven days.`,
    };
  }

  const seenIds = new Set(entries.map((e) => e.id));
  const yesterday = addDaysToKey(deliveryDay, -1);
  const categoriesYesterday = new Set(
    entries.filter((e) => e.deliveryDay === yesterday).map((e) => e.category),
  );

  const lastFiredByRule = new Map<string, string>();
  for (const e of entries) {
    const prev = lastFiredByRule.get(e.ruleId);
    if (prev === undefined || e.deliveryDay > prev) lastFiredByRule.set(e.ruleId, e.deliveryDay);
  }

  const suppressed: SuppressedNudge[] = [];

  for (const nudge of candidates) {
    if (!prefs.categories[nudge.category]) {
      suppressed.push({ nudge, reason: 'This category is switched off.' });
      continue;
    }
    if (seenIds.has(nudge.id)) {
      suppressed.push({ nudge, reason: 'Already sent — never repeated.' });
      continue;
    }
    const last = lastFiredByRule.get(nudge.ruleId);
    if (last !== undefined && last > addDaysToKey(deliveryDay, -nudge.cooldownDays)) {
      suppressed.push({
        nudge,
        reason: `Cooling down — this kind fires at most once every ${nudge.cooldownDays} days.`,
      });
      continue;
    }
    if (categoriesYesterday.has(nudge.category)) {
      suppressed.push({ nudge, reason: 'Same kind of nudge went out yesterday.' });
      continue;
    }

    // First survivor wins: candidates arrive already ranked by priority.
    return { ...base, selected: nudge, suppressed };
  }

  return { ...base, suppressed };
}

/**
 * Evaluate + select in one pure step. Used by the settings preview so that
 * what it shows is exactly what the scheduler would do.
 */
export function previewNudges(
  snapshot: NudgeSnapshot,
  history: NudgeHistory,
  prefs: NudgePreferences,
): { candidates: Nudge[]; selection: SelectionResult; deliverAt: Date } {
  const candidates = evaluateNudges(snapshot);
  const deliverAt = resolveDeliveryTime(snapshot.today, prefs);
  const selection = selectNudge(candidates, history, prefs, dayKey(deliverAt));
  return { candidates, selection, deliverAt };
}

// ── Native delivery ──────────────────────────────────────────────────────────

const CHANNEL_ID = 'vidhence_nudges';

/**
 * A stable 32-bit id for a nudge, because Android notification ids are ints
 * and our ids are strings. FNV-1a, masked to 31 bits so it is always positive.
 */
export function notificationIdFor(nudgeId: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < nudgeId.length; i += 1) {
    h ^= nudgeId.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 1) % 2_000_000_000 || 1;
}

type LocalNotificationsModule = typeof import('@capacitor/local-notifications');

async function loadPlugin(): Promise<LocalNotificationsModule['LocalNotifications'] | null> {
  if (!isNative()) return null;
  try {
    const mod = await import('@capacitor/local-notifications');
    return mod.LocalNotifications;
  } catch (err) {
    console.warn('[nudges] local-notifications unavailable', err);
    return null;
  }
}

/**
 * Ask for notification permission.
 *
 * Called ONLY from the master toggle. Asking at cold start is how apps train
 * people to hit "Deny" on reflex — by the time we ask, the user has just tapped
 * a switch labelled "Remind me", so the prompt is an answer to something they
 * did rather than an ambush.
 */
export async function requestNudgePermission(): Promise<boolean> {
  const plugin = await loadPlugin();
  if (!plugin) return true; // web: nothing to grant, nothing to block

  try {
    const current = await plugin.checkPermissions();
    let granted = current.display === 'granted';
    if (!granted) {
      const asked = await plugin.requestPermissions();
      granted = asked.display === 'granted';
    }
    if (granted) {
      try {
        await plugin.createChannel({
          id: CHANNEL_ID,
          name: 'Reminders',
          description: 'Occasional, earned nudges about your own money.',
          // IMPORTANCE_DEFAULT — appears, does not shove itself in front of
          // whatever the user is doing.
          importance: 3,
          visibility: 1,
        });
      } catch {
        /* iOS and older Android have no channels; harmless. */
      }
    }
    return granted;
  } catch (err) {
    console.warn('[nudges] permission request failed', err);
    return false;
  }
}

/** Drop every queued nudge. Called the instant the master toggle goes off. */
export async function cancelAllNudges(): Promise<void> {
  const plugin = await loadPlugin();
  if (!plugin) return;
  try {
    const pending = await plugin.getPending();
    if (pending.notifications.length > 0) {
      await plugin.cancel({ notifications: pending.notifications.map((n) => ({ id: n.id })) });
    }
  } catch (err) {
    console.warn('[nudges] cancel failed', err);
  }
}

/** Establish the always-on reminder invariant and request OS permission. */
export async function setNudgesEnabled(_enabled = true): Promise<NudgePreferences> {
  const prefs = await loadPreferences();
  await requestNudgePermission();
  // Keep the app preference on even when Android permission is denied. This
  // makes the state honest: Acounted is ready and will resume immediately if
  // the user later enables notifications in system settings.
  const next = { ...prefs, enabled: true, permissionAsked: true };
  await savePreferences(next);
  return next;
}

export type PreferencesPatch = Partial<Omit<NudgePreferences, 'categories'>> & {
  categories?: Partial<Record<NudgeCategory, boolean>>;
};

/** Update preferences, cancelling anything a newly-disabled category queued. */
export async function updatePreferences(patch: PreferencesPatch): Promise<NudgePreferences> {
  const prefs = await loadPreferences();
  const next: NudgePreferences = {
    ...prefs,
    ...patch,
    categories: { ...prefs.categories, ...(patch.categories ?? {}) },
  };
  await savePreferences(next);

  // Any category that just went off may have something queued. The queue is at
  // most one item, so cancelling all and letting the next cycle re-schedule is
  // both simplest and the only version that cannot leave a stale nudge behind.
  const turnedSomethingOff = Object.entries(next.categories).some(
    ([k, v]) => !v && prefs.categories[k as keyof typeof prefs.categories],
  );
  if (turnedSomethingOff || !next.enabled) await cancelAllNudges();

  return next;
}

// ── The cycle ────────────────────────────────────────────────────────────────

export interface CycleResult {
  scheduled: Nudge | null;
  selection: SelectionResult | null;
  reason: string | null;
}

/**
 * The whole loop: evaluate, select, schedule, record.
 *
 * Safe to call as often as you like — on every resume, after every save. The
 * caps make repeat calls idempotent in practice, and it never throws.
 */
export async function runNudgeCycle(snapshot: NudgeSnapshot): Promise<CycleResult> {
  try {
    const prefs = await loadPreferences();
    if (!prefs.enabled) return { scheduled: null, selection: null, reason: 'disabled' };

    const history = await loadHistory();
    const candidates = evaluateNudges(snapshot, { preferences: prefs });
    const deliverAt = resolveDeliveryTime(snapshot.today, prefs);
    const deliveryDay = dayKey(deliverAt);
    const selection = selectNudge(candidates, history, prefs, deliveryDay);

    if (!selection.selected) {
      return { scheduled: null, selection, reason: selection.blockedReason ?? 'no candidate' };
    }

    const nudge = selection.selected;
    const plugin = await loadPlugin();

    if (plugin) {
      await plugin.schedule({
        notifications: [
          {
            id: notificationIdFor(nudge.id),
            title: nudge.title,
            body: nudge.body,
            channelId: CHANNEL_ID,
            schedule: { at: deliverAt, allowWhileIdle: false },
            extra: { deepLink: nudge.deepLink, nudgeId: nudge.id, ruleId: nudge.ruleId },
          },
        ],
      });
    }

    // Recorded on web too, so the preview and the caps behave identically
    // during `npm run dev` and nobody debugs a phantom.
    await appendHistory(
      {
        id: nudge.id,
        ruleId: nudge.ruleId,
        category: nudge.category,
        deliveryDay,
        deliverAt: deliverAt.toISOString(),
      },
      snapshot.today,
    );

    return { scheduled: nudge, selection, reason: null };
  } catch (err) {
    // A notification failing is never worth breaking the app over.
    console.error('[nudges] cycle failed', err);
    return { scheduled: null, selection: null, reason: 'error' };
  }
}
