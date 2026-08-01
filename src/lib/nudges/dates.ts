/**
 * dates.ts — day arithmetic for the nudge system. Pure, no date-fns.
 *
 * Everything in the nudge engine is reasoned about in whole local days, not
 * instants. "Three days since your last entry" has to mean three *calendar*
 * days regardless of whether the entries were at 00:30 or 23:50 — the ordinary
 * timestamp subtraction gets that wrong roughly half the time, and a nudge
 * that is off by a day is a nudge that says something untrue.
 *
 * So: every comparison goes through `dayKey` (a `yyyy-MM-dd` string in the
 * local frame) or `daysBetweenKeys`. There are no Date subtractions anywhere
 * else in this folder.
 */

const WEEKDAYS = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
] as const;

const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
] as const;

const SHORT_MONTHS = MONTHS.map((m) => m.slice(0, 3));

const pad = (n: number): string => (n < 10 ? `0${n}` : String(n));

/** Local `yyyy-MM-dd` for a Date. */
export function dayKey(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/**
 * `yyyy-MM-dd` for an ISO timestamp or date string, in the LOCAL frame.
 *
 * A bare `yyyy-MM-dd` is returned as-is rather than parsed. `new Date('2026-08-01')`
 * is UTC midnight, which in IST is 05:30 on the 1st but in any negative-offset
 * zone is the 31st — parsing a date-only string would silently shift the day.
 */
export function dayKeyOf(value: string): string {
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  return dayKey(d);
}

/** Parse a `yyyy-MM-dd` key into a local Date at midnight. */
export function fromDayKey(key: string): Date {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, (m ?? 1) - 1, d ?? 1);
}

/** Whole days from `a` to `b`. Positive when `b` is later. */
export function daysBetweenKeys(a: string, b: string): number {
  const ms = fromDayKey(b).getTime() - fromDayKey(a).getTime();
  return Math.round(ms / 86_400_000);
}

/** Shift a day key by `n` days. */
export function addDaysToKey(key: string, n: number): string {
  const d = fromDayKey(key);
  d.setDate(d.getDate() + n);
  return dayKey(d);
}

/** Shift a Date by whole days, without mutating it. */
export function addDays(date: Date, n: number): Date {
  const d = new Date(date.getTime());
  d.setDate(d.getDate() + n);
  return d;
}

/** "Monday", "Tuesday", … for a day key. */
export function weekdayName(key: string): string {
  return WEEKDAYS[fromDayKey(key).getDay()];
}

/** "August" for a Date. */
export function monthName(date: Date): string {
  return MONTHS[date.getMonth()];
}

/** "12 Aug" for a day key — the app's usual short date shape. */
export function shortDate(key: string): string {
  const d = fromDayKey(key);
  return `${d.getDate()} ${SHORT_MONTHS[d.getMonth()]}`;
}

/**
 * "today" / "tomorrow" / "on Friday" for a day that is 0–6 days out.
 * Beyond that, falls back to "on 12 Aug", because "on Friday" stops being
 * unambiguous once it could mean either of two Fridays.
 */
export function relativeDayPhrase(fromKey: string, toKey: string): string {
  const n = daysBetweenKeys(fromKey, toKey);
  if (n === 0) return 'today';
  if (n === 1) return 'tomorrow';
  if (n > 1 && n <= 6) return `on ${weekdayName(toKey)}`;
  return `on ${shortDate(toKey)}`;
}

/** `n` with an English plural, e.g. `plural(1, 'day')` → "1 day". */
export function plural(n: number, word: string, wordPlural?: string): string {
  return `${n} ${n === 1 ? word : (wordPlural ?? `${word}s`)}`;
}
