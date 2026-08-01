"use client";

/**
 * AppPreloader — the "line rises" cold-start loader.
 *
 * Covers the gap between React mounting and the app knowing who the user is.
 * No logo, no spinner: one short statement that arrives word by word over a
 * calm navy-tinted field, a hairline meter easing beneath it, both gone the
 * moment the app is ready.
 *
 * ── Timing, and why it is what it is ────────────────────────────────────────
 *
 * FINISH EARLY. The app is usually ready in a few hundred milliseconds. This
 * component tracks readiness (auth resolved) and dismisses as soon as it can —
 * it never waits out a fixed animation.
 *
 * But not TOO early: dismissing after 60 ms produces a flash that reads as a
 * rendering glitch, and the line can't be read at all. MIN_VISIBLE_MS is the
 * floor that makes the copy legible, and it is sized off how long a person
 * actually needs: the pool tops out at ten words, and ten words of unfamiliar
 * prose take roughly 1.2–1.8 s to read comfortably. 550 ms — the old floor —
 * was under half of that, which is why people reported not being able to
 * finish the sentence. It is a real, deliberate cost on fast devices; the
 * tradeoff being made is "readable" over "absolutely fastest", and it is the
 * only added delay in here. Worst case on a fast device is
 * MIN_VISIBLE_MS + FADE_MS = 1800 ms.
 *
 * The words themselves land fast (see WORD_STAGGER_MS): the entrance must not
 * eat the reading budget, so the last word of a ten-word line is fully legible
 * by ~730 ms, leaving well over half the floor as settled reading time.
 *
 * SECOND LINE ONLY WHEN SLOW. Past SLOW_LOAD_MS a second line fades in, so the
 * copy earns its place on slow devices and never intrudes on quick ones. That
 * threshold sits past the floor on purpose — if we are still here after the
 * floor has elapsed, the load is genuinely slow.
 *
 * ── The native splash ───────────────────────────────────────────────────────
 *
 * capacitor.config sets launchAutoHide: false, so Android's splash stays up
 * until we hide it here — that removes the old race where the splash vanished
 * on a 1.5 s timer and left a blank white screen behind it. A watchdog hides it
 * regardless after SPLASH_FAILSAFE_MS, because a splash that never hides is an
 * app that looks frozen.
 *
 * The splash ground is flat white, so the loader's FIRST PAINTED FRAME is flat
 * white too: the ambient field and the vignette are separate layers that start
 * at opacity 0 and bloom in. Nothing about the handoff changes colour, which
 * means no splash asset has to be regenerated to match this. Keep it that way
 * if you restyle — paint tint in, never as the base.
 */

import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { isNative } from '@/lib/platform';
import { nextLoaderLine, SLOW_LOAD_LINE } from '@/lib/loaderLines';

/** Floor for how long the line stays up, so it can actually be read. */
const MIN_VISIBLE_MS = 1500;
/** Past this, loading counts as slow and earns a second line. */
const SLOW_LOAD_MS = 1900;
/** Must match the CSS fade-out duration on `.app-preloader.is-leaving`. */
const FADE_MS = 300;
/** Gap between one word appearing and the next. Must match the CSS. */
const WORD_STAGGER_MS = 42;
/** Delay before the first word appears. Must match the CSS. */
const WORD_LEAD_MS = 90;
/** Never leave the native splash up longer than this, whatever else happens. */
const SPLASH_FAILSAFE_MS = 4000;

export const AppPreloader = () => {
  const { loading: authLoading } = useAuth();

  // Chosen once per mount — a line that changed mid-launch would be unreadable.
  const line = useMemo(() => nextLoaderLine(), []);
  // Split once, not on every render: each word animates in on its own delay so
  // that reading the sentence and watching it arrive are the same act.
  const words = useMemo(() => line.text.split(' '), [line.text]);

  const [leaving, setLeaving] = useState(false);
  const [gone, setGone] = useState(false);
  const [slow, setSlow] = useState(false);
  const mountedAt = useRef(Date.now());

  // Hide Android's splash as soon as React is on screen, and keep a watchdog
  // in case the plugin call is rejected by an OEM build.
  useEffect(() => {
    if (!isNative()) return;
    let failsafe: ReturnType<typeof setTimeout>;

    void import('@capacitor/splash-screen')
      .then(({ SplashScreen }) => {
        void SplashScreen.hide().catch(() => {});
        failsafe = setTimeout(() => void SplashScreen.hide().catch(() => {}), SPLASH_FAILSAFE_MS);
      })
      .catch(() => {});

    return () => clearTimeout(failsafe);
  }, []);

  // Promote to the slow state if we're still here after the threshold.
  useEffect(() => {
    if (!authLoading) return;
    const t = setTimeout(() => setSlow(true), SLOW_LOAD_MS);
    return () => clearTimeout(t);
  }, [authLoading]);

  // Start the fade once the app is ready, respecting the readability floor.
  useEffect(() => {
    if (authLoading || leaving) return;

    const elapsed = Date.now() - mountedAt.current;
    const wait = Math.max(0, MIN_VISIBLE_MS - elapsed);

    const startLeave = setTimeout(() => setLeaving(true), wait);
    return () => clearTimeout(startLeave);
  }, [authLoading, leaving]);

  // Unmount after the fade has run.
  //
  // This is deliberately a SEPARATE effect. Scheduling both timers together
  // looks tidier but is broken: setLeaving(true) changes `leaving`, React runs
  // the cleanup, and that cleanup cancels the unmount timer too — then the
  // guard above bails, so it is never rescheduled and a full-screen overlay
  // stays in the DOM for the life of the session. Keying this effect on
  // `leaving` alone means the timer is only ever created once the fade starts.
  useEffect(() => {
    if (!leaving) return;
    const finish = setTimeout(() => setGone(true), FADE_MS);
    return () => clearTimeout(finish);
  }, [leaving]);

  if (gone) return null;

  return (
    <div
      className={`app-preloader${leaving ? ' is-leaving' : ''}`}
      // Announced politely rather than assertively — it's reassurance, not an
      // alert, and a screen reader user shouldn't have their focus yanked.
      role="status"
      aria-live="polite"
    >
      <div className="app-preloader__inner">
        {/* The words are separated by real space text nodes, not CSS margins,
            so the live-region announcement is the plain sentence. The whole
            sentence is in the DOM from the first render — only the paint is
            staggered — so assistive tech never sees it grow word by word. */}
        <p className="app-preloader__line">
          {words.map((word, i) => (
            <Fragment key={`${i}-${word}`}>
              {i > 0 && ' '}
              <span
                className="app-preloader__word"
                style={{ animationDelay: `${WORD_LEAD_MS + i * WORD_STAGGER_MS}ms` }}
              >
                {word}
              </span>
            </Fragment>
          ))}
        </p>

        {/* Not a percentage of anything — we cannot measure the load, so the
            fill eases out to a hold rather than ticking to a fake 100%. It only
            reaches the end when the app is actually ready, on `.is-leaving`. */}
        <span className="app-preloader__meter" aria-hidden="true">
          <span className="app-preloader__meter-fill" />
        </span>

        {slow && <p className="app-preloader__slow">{SLOW_LOAD_LINE}</p>}
      </div>
    </div>
  );
};
