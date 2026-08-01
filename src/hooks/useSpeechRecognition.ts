/**
 * useSpeechRecognition — voice input, on both the web and the Android app.
 *
 * Two implementations behind one interface:
 *
 *  - **Web**: the Web Speech API (Chrome/Edge desktop and Android Chrome).
 *  - **Native**: @capacitor-community/speech-recognition, which talks to
 *    Android's on-device SpeechRecognizer.
 *
 * The native path is NOT optional. The Web Speech API does not exist inside an
 * Android WebView, so without the plugin `supported` would be false in the
 * shipped app and the mic would silently disappear — the one place the feature
 * matters most. If neither backend is available, `supported` stays false and
 * callers fall back to typing, which every caller already handles.
 *
 * The original interface (`supported`, `listening`, `transcript`, `start`,
 * `stop`) is unchanged, so TaxCopilot needs no modification. Three additions
 * exist for callers that start listening automatically:
 *
 *  - `starting`  — a `start()` is in flight but capture has not begun. On web
 *                  this is precisely the window in which the browser's
 *                  permission prompt is on screen, so the UI can say
 *                  "waiting for the microphone" instead of looking hung.
 *  - `denied`    — microphone permission was refused. Callers use this to stop
 *                  auto-starting (and so stop re-prompting) and to show an
 *                  honest fallback.
 *  - `abort()`   — tear the recogniser down *without* delivering a result.
 *                  `stop()` finalises and still fires `onResult`; when a sheet
 *                  closes mid-utterance that result is unwanted.
 *
 * Defaults to en-IN.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { SpeechRecognition } from '@capacitor-community/speech-recognition';
import { isNative } from '@/lib/platform';

// ─── Web Speech API ───────────────────────────────────────────────────────────

type SpeechRecognitionCtor = new () => SpeechRecognitionLike;
interface SpeechRecognitionLike {
  lang: string;
  interimResults: boolean;
  maxAlternatives: number;
  continuous: boolean;
  start: () => void;
  stop: () => void;
  abort: () => void;
  onresult: ((event: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
  onstart: (() => void) | null;
  onend: (() => void) | null;
  onerror: ((event?: { error?: string }) => void) | null;
}

function getRecognitionCtor(): SpeechRecognitionCtor | null {
  if (typeof window === 'undefined') return null;
  const w = window as unknown as {
    SpeechRecognition?: SpeechRecognitionCtor;
    webkitSpeechRecognition?: SpeechRecognitionCtor;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

/** Errors that mean "the user (or policy) said no", not "nothing was heard". */
const DENIAL_ERRORS = new Set(['not-allowed', 'service-not-allowed', 'security']);

/**
 * Nothing ever un-hangs a `starting` that gets no callback at all. Chrome fires
 * onstart/onend/onerror reliably, but a shimmed implementation might not, and a
 * permanently "preparing" orb is worse than dropping back to idle.
 */
const START_TIMEOUT_MS = 10_000;

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function useSpeechRecognition(opts?: { lang?: string; onResult?: (text: string) => void }) {
  const native = isNative();
  const lang = opts?.lang ?? 'en-IN';

  const Ctor = native ? null : getRecognitionCtor();

  // On web we know synchronously. On native the plugin has to be asked, so we
  // start pessimistic and flip to true once `available()` answers.
  const [supported, setSupported] = useState(!native && !!Ctor);
  const [listening, setListening] = useState(false);
  const [starting, setStarting]   = useState(false);
  const [denied, setDenied]       = useState(false);
  const [transcript, setTranscript] = useState('');

  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const onResultRef = useRef(opts?.onResult);
  onResultRef.current = opts?.onResult;

  /** Set by abort(): drops any result that lands after the caller gave up. */
  const suppressRef = useRef(false);
  const startTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  /** Guards against a result landing after the component unmounted. */
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (startTimerRef.current) clearTimeout(startTimerRef.current);
    };
  }, []);

  const clearStartTimer = useCallback(() => {
    if (startTimerRef.current) {
      clearTimeout(startTimerRef.current);
      startTimerRef.current = null;
    }
  }, []);

  const emit = useCallback((text: string) => {
    if (!mountedRef.current || suppressRef.current || !text) return;
    setTranscript(text);
    onResultRef.current?.(text);
  }, []);

  // ── Native availability probe ──────────────────────────────────────────────
  useEffect(() => {
    if (!native) return;
    let cancelled = false;
    SpeechRecognition.available()
      .then(({ available }) => { if (!cancelled) setSupported(available); })
      .catch(() => { if (!cancelled) setSupported(false); });
    return () => { cancelled = true; };
  }, [native]);

  // ── Permission probe ───────────────────────────────────────────────────────
  // Learn about an existing refusal *without* prompting, so a caller that
  // auto-starts can skip straight to its typed fallback rather than firing a
  // request that is going to bounce.
  useEffect(() => {
    let cancelled = false;

    if (native) {
      SpeechRecognition.checkPermissions()
        .then(({ speechRecognition }) => {
          if (!cancelled && speechRecognition === 'denied') setDenied(true);
        })
        .catch(() => { /* plugin unavailable — start() will find out */ });
      return () => { cancelled = true; };
    }

    if (typeof navigator === 'undefined' || !navigator.permissions?.query) return;
    let status: PermissionStatus | null = null;
    const sync = () => {
      if (!cancelled && status) setDenied(status.state === 'denied');
    };
    navigator.permissions
      // Not in every lib.dom PermissionName union, hence the cast.
      .query({ name: 'microphone' as PermissionName })
      .then((result) => {
        if (cancelled) return;
        status = result;
        sync();
        result.addEventListener('change', sync);
      })
      .catch(() => { /* Firefox/Safari don't expose it — start() will find out */ });

    return () => {
      cancelled = true;
      status?.removeEventListener('change', sync);
    };
  }, [native]);

  // ── Native: stop listening if the app goes to the background ───────────────
  useEffect(() => {
    if (!native) return;
    const onHide = () => {
      suppressRef.current = true;
      SpeechRecognition.stop().catch(() => { /* wasn't listening */ });
      setListening(false);
      setStarting(false);
    };
    window.addEventListener('pagehide', onHide);
    return () => window.removeEventListener('pagehide', onHide);
  }, [native]);

  // ── Web: build the recogniser ──────────────────────────────────────────────
  useEffect(() => {
    if (native || !Ctor) return;
    const rec = new Ctor();
    rec.lang = lang;
    rec.interimResults = false;
    rec.maxAlternatives = 1;
    rec.continuous = false;
    rec.onresult = (event) => {
      emit(event.results?.[0]?.[0]?.transcript ?? '');
    };
    // onstart fires only once capture actually begins — i.e. after the user has
    // answered the permission prompt. That is what makes `starting` meaningful.
    rec.onstart = () => {
      clearStartTimer();
      setDenied(false);
      setStarting(false);
      setListening(true);
    };
    rec.onend = () => {
      clearStartTimer();
      setStarting(false);
      setListening(false);
    };
    rec.onerror = (event) => {
      clearStartTimer();
      if (event?.error && DENIAL_ERRORS.has(event.error)) setDenied(true);
      setStarting(false);
      setListening(false);
    };
    recognitionRef.current = rec;
    return () => {
      try { rec.abort(); } catch { /* no-op */ }
      recognitionRef.current = null;
    };
  }, [Ctor, lang, native, emit, clearStartTimer]);

  // ── start ──────────────────────────────────────────────────────────────────
  const start = useCallback(async () => {
    if (listening || starting || !supported) return;
    suppressRef.current = false;
    setTranscript('');

    if (native) {
      setStarting(true);
      try {
        // Ask for RECORD_AUDIO the first time. A denial is a normal outcome —
        // the caller's text input remains available, so we record it and stop.
        const status = await SpeechRecognition.checkPermissions();
        let granted = status.speechRecognition === 'granted';
        if (!granted) {
          const requested = await SpeechRecognition.requestPermissions();
          granted = requested.speechRecognition === 'granted';
        }
        if (!granted) {
          if (mountedRef.current) setDenied(true);
          return;
        }
        if (mountedRef.current) setDenied(false);
        if (suppressRef.current) return;   // caller closed while we were asking

        setStarting(false);
        setListening(true);
        // popup:false keeps it in-app; partialResults:false means this promise
        // resolves once with the final transcript, which is what we want for
        // one-shot capture.
        const result = await SpeechRecognition.start({
          language: lang,
          maxResults: 1,
          partialResults: false,
          popup: false,
        });
        emit(result?.matches?.[0] ?? '');
      } catch {
        /* no speech, cancelled, or recogniser busy */
      } finally {
        if (mountedRef.current) {
          setStarting(false);
          setListening(false);
        }
      }
      return;
    }

    try {
      recognitionRef.current?.start();
      setStarting(true);
      clearStartTimer();
      startTimerRef.current = setTimeout(() => {
        if (mountedRef.current) setStarting(false);
      }, START_TIMEOUT_MS);
    } catch {
      // Already running, or the engine refused outright.
      setStarting(false);
      setListening(false);
    }
  }, [listening, starting, supported, native, lang, emit, clearStartTimer]);

  // ── stop ───────────────────────────────────────────────────────────────────
  /** Finish the utterance: whatever was heard is still delivered. */
  const stop = useCallback(() => {
    clearStartTimer();
    if (native) {
      SpeechRecognition.stop().catch(() => { /* wasn't listening */ });
      setListening(false);
      setStarting(false);
      return;
    }
    try { recognitionRef.current?.stop(); } catch { /* no-op */ }
    setListening(false);
    setStarting(false);
  }, [native, clearStartTimer]);

  // ── abort ──────────────────────────────────────────────────────────────────
  /** Throw the utterance away: no `onResult` will fire for it. */
  const abort = useCallback(() => {
    clearStartTimer();
    suppressRef.current = true;
    if (native) {
      SpeechRecognition.stop().catch(() => { /* wasn't listening */ });
    } else {
      try { recognitionRef.current?.abort(); } catch { /* no-op */ }
    }
    setListening(false);
    setStarting(false);
  }, [native, clearStartTimer]);

  return { supported, listening, starting, denied, transcript, start, stop, abort };
}
