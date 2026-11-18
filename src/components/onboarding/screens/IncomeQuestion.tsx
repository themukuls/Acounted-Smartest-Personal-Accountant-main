"use client";

/**
 * IncomeQuestion — screen 5 of 6. One question. Not three.
 *
 * What used to live here was a form: income type, monthly salary, basic
 * salary, allowances, city, freelance average, freelance target, other
 * income — asked of a stranger, before the app had done anything for them.
 * All of it is now a contextual prompt inside the app, asked at the moment
 * the number is actually needed. This screen collects the single number the
 * next screen can do something visible with, and nothing else.
 *
 * Two rules this screen exists to demonstrate:
 *
 *  1. THE REASON SITS NEXT TO THE FIELD. Not in a tooltip, not on a previous
 *     screen. If we cannot say why we want a number in one line, we should
 *     not be asking for it.
 *
 *  2. SKIP LOOKS SKIPPABLE. It is a real button, the same height and the
 *     same width as Continue — not grey text under it. When the field is
 *     empty, Skip is the only live path, which is the honest state of
 *     affairs: we do not need this number, we would just like it.
 *
 * Copy lives in the consts below.
 */

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { TAX_FEATURE_ENABLED } from '@/lib/features';

/** Sits directly above the field. The reason, at the moment of asking. */
export const WHY_WE_ASK =
  TAX_FEATURE_ENABLED
    ? 'Asking because the tax estimate needs one figure to start from, and this is the one it uses. Take-home is fine. A round number is fine.'
    : 'Asking so your budgets and monthly money view start with a useful baseline. Take-home is fine. A round number is fine.';

/** Sits directly below the field. */
export const WHERE_IT_GOES =
  'It stays on this device, like everything else, and you can change it any time from your profile.';

/** Shown next to Skip so the skip is a stated option, not a way out. */
export const SKIP_REASSURANCE =
  'Skipping costs you nothing — you can add this later from your profile.';

export const SKIP_LABEL = 'Skip this question';
export const CONTINUE_LABEL = 'Continue';

interface IncomeQuestionProps {
  /** Raw input value, kept as a string so an empty field stays empty. */
  value: string;
  onChange: (next: string) => void;
  onContinue: () => void;
  onSkip: () => void;
  saving?: boolean;
}

export const IncomeQuestion = ({
  value,
  onChange,
  onContinue,
  onSkip,
  saving = false,
}: IncomeQuestionProps) => {
  const parsed = Number.parseFloat(value);
  const hasNumber = Number.isFinite(parsed) && parsed > 0;

  return (
    <div className="space-y-4">
      <p className="text-sm leading-relaxed text-muted-foreground">{WHY_WE_ASK}</p>

      <div className="space-y-2">
        <div className="relative">
          <span className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-lg font-semibold text-muted-foreground">
            ₹
          </span>
          <Input
            type="number"
            inputMode="numeric"
            autoComplete="off"
            placeholder="60,000"
            value={value}
            onChange={(e) => onChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && hasNumber && !saving) onContinue();
            }}
            className="pointer-events-auto h-14 rounded-xl pl-9 text-lg font-semibold"
          />
          <span className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">
            per month
          </span>
        </div>
        <p className="text-[11px] leading-relaxed text-muted-foreground">
          {WHERE_IT_GOES}
        </p>
      </div>

      <div className="space-y-2 pt-1">
        <div className="flex items-center gap-3">
          <Button
            type="button"
            variant="outline"
            onClick={onSkip}
            disabled={saving}
            className="pointer-events-auto h-12 flex-1 rounded-xl border-2 text-sm font-semibold"
          >
            {SKIP_LABEL}
          </Button>
          <Button
            type="button"
            onClick={onContinue}
            disabled={!hasNumber || saving}
            className="pointer-events-auto h-12 flex-1 rounded-xl text-sm font-semibold"
          >
            {saving ? 'Saving…' : CONTINUE_LABEL}
          </Button>
        </div>
        <p className="text-[11px] leading-relaxed text-muted-foreground">
          {SKIP_REASSURANCE}
        </p>
      </div>
    </div>
  );
};
