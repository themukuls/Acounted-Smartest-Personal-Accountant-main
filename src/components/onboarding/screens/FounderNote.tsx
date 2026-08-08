"use client";

/**
 * FounderNote — screen 1 of 6.
 *
 * ╔══════════════════════════════════════════════════════════════════════════╗
 * ║  TODO: founder to replace in his own voice.                              ║
 * ║                                                                          ║
 * ║  The copy below is a PLACEHOLDER. It is deliberately unpolished. Do not  ║
 * ║  ship it, and do not have anyone else "improve" it — a founder's note    ║
 * ║  that reads as written-by-committee (or by a model) is worse than no     ║
 * ║  note at all. The only fix is the founder's own words.                   ║
 * ╚══════════════════════════════════════════════════════════════════════════╝
 *
 * KEEP THE FOUR BEATS, in this order. They are what makes a note like this
 * land rather than read as a mission statement:
 *
 *   1. A SPECIFIC GRIEVANCE — one real thing that went wrong, with a detail
 *      in it. Not "personal finance is broken". Something that happened.
 *   2. WHAT THE APP REFUSES TO DO — the decision that grievance forced.
 *   3. THE HONEST COST — what that refusal costs the user, stated plainly and
 *      before they find out for themselves. Nothing auto-imports.
 *   4. THE TRADE — what they get for paying that cost. One sentence.
 *
 * Aim for ~110 words. Longer and nobody reads it; shorter and it sounds like
 * a tagline. Square brackets mark the specifics only the founder can supply.
 *
 * Editing: change FOUNDER_NOTE and FOUNDER_SIGNOFF. Nothing else in this file
 * needs to be touched.
 */

/**
 * PLACEHOLDER COPY — replace wholesale.
 * Blank lines separate paragraphs; the renderer splits on them.
 */
export const FOUNDER_NOTE = `Placeholder — the founder's own words go here.

[The grievance, with one real detail. e.g. the March scramble for
receipts, the ₹— refund that never came, the bank app that showed a
balance and nothing else.]

[So this app won't do the thing that caused it: no bank login, nothing
sold, no one else holding your numbers.]

[The honest cost: nothing imports itself. You type things in. A couple of
minutes, most days.]

[The trade: you do that, and by [month] you already know what you owe and
what you can claim, instead of finding out.]`;

/** PLACEHOLDER — replace with the founder's actual name and role. */
export const FOUNDER_SIGNOFF = '[Name], who built this';

/**
 * Shown only in development so the placeholder cannot quietly reach a build
 * without someone noticing. Delete this along with the placeholder copy.
 */
const IS_PLACEHOLDER = true;

export const FounderNote = () => {
  const paragraphs = FOUNDER_NOTE.split('\n\n').map((p) => p.replace(/\n/g, ' ').trim());

  return (
    <div className="space-y-5">
      {IS_PLACEHOLDER && import.meta.env.DEV && (
        <p className="rounded-lg border border-dashed border-amber-400/60 bg-amber-50/60 px-3 py-2 text-[10px] font-semibold uppercase tracking-wider text-amber-700">
          Placeholder copy — founder to replace in his own voice
        </p>
      )}

      <div className="space-y-3">
        {paragraphs.map((p, i) => (
          <p
            key={i}
            className={
              i === 0
                ? 'text-base font-semibold leading-relaxed text-foreground'
                : 'text-sm leading-relaxed text-muted-foreground'
            }
          >
            {p}
          </p>
        ))}
      </div>

      <p className="border-l-2 border-primary/30 pl-3 text-xs font-medium text-foreground/80">
        {FOUNDER_SIGNOFF}
      </p>
    </div>
  );
};
