"use client";

/**
 * WhatWeRefuse — screen 2 of 6.
 *
 * Trust before the ask. This screen exists because it is the actual
 * differentiator: every other Indian money app in this category opens by
 * asking for a bank login. Acounted cannot ask for one — there is no server
 * to send credentials to — and saying so plainly is worth more than any
 * feature list.
 *
 * The last two blocks are the honest ones. A refusal list that only lists
 * upsides reads as marketing; naming the cost immediately afterwards is what
 * makes the rest believable. Do not remove them to make the screen tidier.
 *
 * All copy lives in REFUSALS, THE_COST and THE_EXCEPTION.
 */

import { Landmark, Share2, Megaphone } from 'lucide-react';

export const REFUSALS = [
  {
    Icon: Landmark,
    title: 'It cannot connect to your bank',
    body: 'Not "we choose not to" — it has no way to. There is no Acounted server for credentials to go to. Your records sit in this device\'s own storage.',
  },
  {
    Icon: Share2,
    title: 'Nobody else gets your numbers',
    body: 'No analytics on what you spend, nothing sold to a lender or an insurer, no copy held anywhere for us to lose. Backups are files you make and keep.',
  },
  {
    Icon: Megaphone,
    title: 'Nothing inside is an advertisement',
    body: 'No card offers, no insurance leads, no fund that pays to be called recommended. What the app shows you is your data and the arithmetic on it.',
  },
] as const;

/** The cost of the three refusals above, stated before the user discovers it. */
export const THE_COST =
  'The cost of all that: nothing imports itself. You enter what you spend. It takes a couple of minutes and it is the whole reason the numbers are yours.';

/** The one place data does leave the device — said plainly rather than buried. */
export const THE_EXCEPTION =
  'One exception, so you hear it from us: the optional AI assistant runs on an API key you supply. Only what you send it reaches that provider, and it stays switched off until you switch it on.';

export const WhatWeRefuse = () => (
  <div className="space-y-4">
    <p className="text-sm leading-relaxed text-muted-foreground">
      Most apps in this category open by asking for your bank login. Here is
      what this one will not do, before it asks you for anything.
    </p>

    <div className="space-y-2.5">
      {REFUSALS.map(({ Icon, title, body }) => (
        <div
          key={title}
          className="flex gap-3 rounded-xl border border-border/50 bg-background/60 p-3.5"
        >
          <Icon className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
          <div className="min-w-0 space-y-1">
            <p className="text-sm font-bold leading-snug text-foreground">{title}</p>
            <p className="text-xs leading-relaxed text-muted-foreground">{body}</p>
          </div>
        </div>
      ))}
    </div>

    <p className="rounded-xl bg-muted/50 p-3.5 text-xs leading-relaxed text-foreground/80">
      {THE_COST}
    </p>

    <p className="text-[11px] leading-relaxed text-muted-foreground">
      {THE_EXCEPTION}
    </p>
  </div>
);
