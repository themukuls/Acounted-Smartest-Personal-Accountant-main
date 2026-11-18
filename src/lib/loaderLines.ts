/**
 * loaderLines.ts — what the app says while it opens.
 *
 * One line per launch, drawn at random, never the same one twice running.
 *
 * The variety deliberately comes from a *different line next launch*, not from
 * rotating several in one launch: the app is ready in well under a second, and
 * a carousel would mean adding seconds of intentional delay every time someone
 * opens the app to log a ₹200 auto fare.
 *
 * Copy rules, same as the reminder nudges:
 *  - observations, not instructions — nothing that lectures on launch
 *  - no scolding ("you overspent"), no exclamation marks, no financial advice
 *  - ten words or fewer. AppPreloader holds the line for MIN_VISIBLE_MS
 *    (1500 ms) and reveals it word by word; ten words is what comfortably fits
 *    inside that budget with settled reading time left over. Longer copy means
 *    raising the floor, which every launch then pays for.
 */

export type LoaderGroup =
  | 'awareness'
  | 'saving'
  | 'accountant'
  | 'tax'
  | 'privacy';

export interface LoaderLine {
  text: string;
  group: LoaderGroup;
}

const ALL_LOADER_LINES: LoaderLine[] = [
  // Knowing your numbers
  { group: 'awareness', text: "Most overspending isn't dramatic. It's just unnoticed." },
  { group: 'awareness', text: "You can't plan around a number you're guessing at." },
  { group: 'awareness', text: 'The number you avoid is usually the one worth knowing.' },
  { group: 'awareness', text: 'Written down, spending stops being a mystery.' },

  // Saving
  { group: 'saving', text: "Saving isn't about earning more. It's about noticing sooner." },
  { group: 'saving', text: 'Small, boring and monthly is what actually compounds.' },
  { group: 'saving', text: 'Spot the leak before the month ends.' },
  { group: 'saving', text: '₹200 a day is ₹73,000 a year.' },

  // Having an accountant
  { group: 'accountant', text: "A good accountant doesn't judge. Just shows you the numbers." },
  { group: 'accountant', text: 'Your accountant, without the appointment.' },
  { group: 'accountant', text: "Someone's keeping score either way. Might as well be you." },

  // Tax
  { group: 'tax', text: "Most missed deductions aren't complicated. They're just forgotten." },
  { group: 'tax', text: '80C only helps if you remember it before March.' },
  { group: 'tax', text: 'Tax season is easier when the year was written down.' },

  // Privacy — the actual differentiator, and launch is when we have attention
  { group: 'privacy', text: 'Everything here stays on this device.' },
  { group: 'privacy', text: 'No bank logins. No data leaving. Just your numbers.' },
  { group: 'privacy', text: 'Your finances, visible to exactly one person.' },
];

// Tax copy remains available with the dormant feature, but can never be shown
// while the Tax experience is switched off.
export const LOADER_LINES: LoaderLine[] = ALL_LOADER_LINES.filter(
  (line) => line.group !== 'tax',
);

const LAST_LINE_KEY = 'vidhence_last_loader_line';

/**
 * Pure picker — exported so the no-repeat rule is testable without touching
 * storage or Math.random.
 *
 * @param lines    pool to choose from
 * @param lastText the text shown on the previous launch, if any
 * @param rand     returns [0, 1); injectable for deterministic tests
 */
export function pickLine(
  lines: LoaderLine[],
  lastText: string | null,
  rand: () => number = Math.random,
): LoaderLine {
  if (lines.length === 0) {
    throw new Error('pickLine called with an empty pool');
  }
  // Filter out the previous line so the same words never appear twice running.
  // If that would empty the pool (a one-line pool), fall back to the full set
  // rather than throwing — a repeated line is better than no line.
  const candidates = lines.filter((l) => l.text !== lastText);
  const pool = candidates.length > 0 ? candidates : lines;
  const index = Math.min(pool.length - 1, Math.floor(rand() * pool.length));
  return pool[index];
}

/** Pick a line for this launch and remember it, so the next one differs. */
export function nextLoaderLine(): LoaderLine {
  let last: string | null = null;
  try {
    last = localStorage.getItem(LAST_LINE_KEY);
  } catch {
    /* storage unavailable — just means no repeat-protection this once */
  }

  const line = pickLine(LOADER_LINES, last);

  try {
    localStorage.setItem(LAST_LINE_KEY, line.text);
  } catch {
    /* no-op */
  }
  return line;
}

/**
 * The extra line shown ONLY when loading drags past the threshold, so slow
 * devices get something more to read and fast ones are never delayed.
 */
export const SLOW_LOAD_LINE = 'Getting your numbers together.';
