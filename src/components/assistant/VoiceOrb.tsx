"use client";

import { useEffect, useState } from "react";
import { Loader2, Mic, MicOff } from "lucide-react";

export type VoiceOrbState = "idle" | "waking" | "listening" | "thinking" | "denied";

interface VoiceOrbProps {
  state: VoiceOrbState;
  onClick?: () => void;
  disabled?: boolean;
  /** Accessible name for the button. */
  label: string;
  /** Diameter in px. */
  size?: number;
  /**
   * False freezes every layer. Pass the sheet's `open` flag: Radix keeps the
   * content mounted for the length of its exit animation, so unmounting alone
   * leaves a window in which a dismissed orb is still compositing.
   */
  active?: boolean;
}

/**
 * VoiceOrb — the assistant's listening indicator.
 *
 * Construction, outside-in: a blurred radial **bloom** that breathes; a glass
 * **sphere** with an inset rim light; three translucent **blobs** inside it,
 * screen-blended and blurred so their overlaps brighten like real light; a
 * **veil** that re-darkens the edges to keep the thing spherical rather than
 * flat; a drifting **specular** highlight; and a conic **ring** that only
 * appears while listening.
 *
 * Motion is procedural, not reactive — and deliberately so. The Web Speech API
 * exposes no audio level, and on Android the recogniser owns the microphone
 * outright, so anything that claimed to track the user's voice would be a lie.
 * Instead every layer runs on its own incommensurate period (13.7s / 17.3s /
 * 21.1s spins against 9.3s / 11.9s / 15.7s drifts, one of them reversed). Those
 * never come back into phase within any plausible viewing time, so the surface
 * reads as alive and non-repeating without pretending to hear anything.
 *
 * States are driven entirely by custom properties on the root, so there is one
 * copy of each keyframe and the transitions between states are smooth:
 *   listening — full amplitude, fastest drift, ring lit, glow at maximum
 *   waking    — permission prompt is up: dimmed and slowed, but clearly not dead
 *   thinking  — amplitude collapses to ~40% and the spins roughly triple in
 *               speed, so the motion converges inward and tightens
 *   idle      — very slow, low glow
 *   denied    — as idle, plus desaturated to slate so it reads as switched off
 *
 * Styles are scoped in a local <style> tag (same pattern as MobileBottomNav)
 * rather than in index.css.
 */
export const VoiceOrb = ({
  state,
  onClick,
  disabled = false,
  label,
  size = 168,
  active = true,
}: VoiceOrbProps) => {
  // A backgrounded app must not keep compositing either. Between `active` and
  // this, there is no state in which the orb animates unseen: the caller only
  // mounts it while the sheet is open, `active` covers the exit animation, and
  // this covers the app being sent to the background with the sheet up.
  const [hidden, setHidden] = useState(
    typeof document !== "undefined" && document.visibilityState === "hidden",
  );
  useEffect(() => {
    const sync = () => setHidden(document.visibilityState === "hidden");
    document.addEventListener("visibilitychange", sync);
    return () => document.removeEventListener("visibilitychange", sync);
  }, []);

  const paused = hidden || !active;

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      className="vo-root pointer-events-auto"
      data-state={state}
      data-paused={paused ? "true" : "false"}
      style={{ ["--vo-size" as string]: `${size}px` }}
    >
      <style>{`
        .vo-root {
          --vo-amp:   1;
          --vo-glow:  1;
          --vo-sat:   1;
          --vo-scale: 1;
          --vo-d-a:  13.7s;  --vo-d-b:  17.3s;  --vo-d-c:  21.1s;
          --vo-r-a:   9.3s;  --vo-r-b:  11.9s;  --vo-r-c:  15.7s;
          --vo-d-bloom: 5.3s;
          --vo-d-breathe: 7.1s;
          --vo-d-spec: 8.9s;
          --vo-d-ring: 4.7s;

          position: relative;
          display: grid;
          place-items: center;
          width: var(--vo-size);
          height: var(--vo-size);
          padding: 0;
          border: 0;
          background: transparent;
          border-radius: 50%;
          cursor: pointer;
          isolation: isolate;
          -webkit-tap-highlight-color: transparent;
          transform: scale(var(--vo-scale));
          transition: transform .5s cubic-bezier(.22,.61,.36,1);
        }
        .vo-root:disabled { cursor: default; }
        .vo-root:active:not(:disabled) { transform: scale(calc(var(--vo-scale) * .96)); }
        .vo-root:focus-visible { outline: 2px solid #60A5FA; outline-offset: 6px; }

        /* ── state tuning ─────────────────────────────────────────────── */
        .vo-root[data-state="listening"] { --vo-amp: 1;   --vo-glow: 1;   --vo-scale: 1.02; }
        .vo-root[data-state="waking"]    { --vo-amp: .55; --vo-glow: .55; --vo-scale: .97;
          --vo-d-a: 20s; --vo-d-b: 25s; --vo-d-c: 31s;
          --vo-r-a: 14s; --vo-r-b: 18s; --vo-r-c: 23s;
          --vo-d-bloom: 3.1s; }
        .vo-root[data-state="thinking"]  { --vo-amp: .38; --vo-glow: .85; --vo-scale: .93;
          --vo-d-a: 4.3s; --vo-d-b: 5.9s; --vo-d-c: 7.3s;
          --vo-r-a: 2.9s; --vo-r-b: 3.7s; --vo-r-c: 4.9s;
          --vo-d-bloom: 2.3s; --vo-d-breathe: 3.1s; --vo-d-ring: 1.1s; }
        .vo-root[data-state="idle"]      { --vo-amp: .35; --vo-glow: .42; --vo-scale: .94;
          --vo-d-a: 34s; --vo-d-b: 41s; --vo-d-c: 53s;
          --vo-r-a: 26s; --vo-r-b: 31s; --vo-r-c: 37s;
          --vo-d-bloom: 11s; --vo-d-breathe: 13s; }
        .vo-root[data-state="denied"]    { --vo-amp: .18; --vo-glow: .26; --vo-sat: .18; --vo-scale: .92;
          --vo-d-a: 48s; --vo-d-b: 59s; --vo-d-c: 71s;
          --vo-r-a: 40s; --vo-r-b: 47s; --vo-r-c: 55s;
          --vo-d-bloom: 16s; --vo-d-breathe: 18s; }

        /* Dismissed or backgrounded: freeze every layer, don't just slow it
           down. Transitions go too, so a state change on the way out doesn't
           animate under a sheet nobody can see. */
        .vo-root[data-paused="true"] *,
        .vo-root[data-paused="true"] {
          animation-play-state: paused !important;
          transition: none !important;
        }

        /* ── bloom ────────────────────────────────────────────────────── */
        .vo-bloom {
          position: absolute;
          inset: -24%;
          border-radius: 50%;
          background: radial-gradient(circle at 50% 50%,
            rgba(37, 99, 235, .60) 0%,
            rgba(30, 58, 138, .32) 40%,
            rgba(30, 58, 138, 0)   70%);
          filter: blur(16px) saturate(var(--vo-sat));
          opacity: calc(.85 * var(--vo-glow));
          animation: vo-bloom var(--vo-d-bloom) ease-in-out infinite;
          transition: opacity .5s ease, filter .5s ease;
          pointer-events: none;
        }
        @keyframes vo-bloom {
          0%, 100% { transform: scale(.93); }
          50%      { transform: scale(1.09); }
        }

        /* ── sphere ───────────────────────────────────────────────────── */
        .vo-sphere {
          position: relative;
          width: 100%;
          height: 100%;
          border-radius: 50%;
          overflow: hidden;
          background: radial-gradient(circle at 32% 26%,
            #2F5FD6 0%, #1E3A8A 46%, #1B2E4F 78%, #101E38 100%);
          box-shadow:
            inset 0 0 44px rgba(8, 17, 40, .80),
            inset 0 5px 16px rgba(147, 197, 253, .20),
            0 20px 44px rgba(15, 32, 74, .45);
          filter: saturate(var(--vo-sat));
          animation: vo-breathe var(--vo-d-breathe) ease-in-out infinite;
          transition: filter .6s ease;
        }
        @keyframes vo-breathe {
          0%, 100% { transform: scale(.985); }
          50%      { transform: scale(1.03); }
        }

        /* ── blobs ────────────────────────────────────────────────────── */
        .vo-layer {
          position: absolute;
          top: 50%;
          left: 50%;
          width: 116%;
          height: 116%;
          margin: -58% 0 0 -58%;
          will-change: transform;
        }
        .vo-blob {
          position: absolute;
          inset: 0;
          filter: blur(9px);
          mix-blend-mode: screen;
          will-change: transform, border-radius;
        }
        .vo-blob-a {
          background: radial-gradient(circle at 40% 38%,
            rgba(147, 197, 253, .80), rgba(37, 99, 235, .34) 52%, transparent 72%);
          border-radius: 46% 54% 62% 38% / 55% 42% 58% 45%;
          animation: vo-morph-a var(--vo-d-a) linear infinite;
        }
        .vo-blob-b {
          background: radial-gradient(circle at 62% 56%,
            rgba(37, 99, 235, .82), rgba(30, 58, 138, .30) 55%, transparent 74%);
          border-radius: 60% 40% 44% 56% / 42% 58% 42% 58%;
          animation: vo-morph-b var(--vo-d-b) linear infinite reverse;
        }
        .vo-blob-c {
          background: radial-gradient(circle at 48% 70%,
            rgba(96, 165, 250, .58), rgba(27, 46, 79, .26) 58%, transparent 76%);
          border-radius: 52% 48% 38% 62% / 60% 46% 54% 40%;
          animation: vo-morph-c var(--vo-d-c) linear infinite;
        }
        @keyframes vo-morph-a {
          0%   { transform: rotate(0deg);   border-radius: 46% 54% 62% 38% / 55% 42% 58% 45%; }
          33%  { transform: rotate(120deg); border-radius: 58% 42% 40% 60% / 44% 58% 42% 56%; }
          66%  { transform: rotate(240deg); border-radius: 38% 62% 56% 44% / 62% 38% 56% 44%; }
          100% { transform: rotate(360deg); border-radius: 46% 54% 62% 38% / 55% 42% 58% 45%; }
        }
        @keyframes vo-morph-b {
          0%   { transform: rotate(0deg);   border-radius: 60% 40% 44% 56% / 42% 58% 42% 58%; }
          40%  { transform: rotate(144deg); border-radius: 42% 58% 62% 38% / 58% 40% 60% 42%; }
          75%  { transform: rotate(270deg); border-radius: 55% 45% 38% 62% / 40% 62% 38% 60%; }
          100% { transform: rotate(360deg); border-radius: 60% 40% 44% 56% / 42% 58% 42% 58%; }
        }
        @keyframes vo-morph-c {
          0%   { transform: rotate(0deg);   border-radius: 52% 48% 38% 62% / 60% 46% 54% 40%; }
          45%  { transform: rotate(162deg); border-radius: 38% 62% 58% 42% / 44% 60% 40% 56%; }
          80%  { transform: rotate(288deg); border-radius: 62% 38% 48% 52% / 52% 40% 60% 48%; }
          100% { transform: rotate(360deg); border-radius: 52% 48% 38% 62% / 60% 46% 54% 40%; }
        }

        /* Drift lives on the wrapper so it never fights the blob's rotation
           for the transform property. Amplitude is what collapses inward when
           the state turns to thinking. */
        .vo-layer-a { animation: vo-drift-a var(--vo-r-a) ease-in-out infinite; }
        .vo-layer-b { animation: vo-drift-b var(--vo-r-b) ease-in-out infinite; }
        .vo-layer-c { animation: vo-drift-c var(--vo-r-c) ease-in-out infinite; }
        @keyframes vo-drift-a {
          0%, 100% { transform: translate(calc(-6% * var(--vo-amp)), calc(4% * var(--vo-amp))) scale(calc(1 - .10 * var(--vo-amp))); }
          50%      { transform: translate(calc(7% * var(--vo-amp)), calc(-5% * var(--vo-amp))) scale(calc(1 + .12 * var(--vo-amp))); }
        }
        @keyframes vo-drift-b {
          0%, 100% { transform: translate(calc(5% * var(--vo-amp)), calc(6% * var(--vo-amp))) scale(calc(1 + .08 * var(--vo-amp))); }
          50%      { transform: translate(calc(-6% * var(--vo-amp)), calc(-3% * var(--vo-amp))) scale(calc(1 - .12 * var(--vo-amp))); }
        }
        @keyframes vo-drift-c {
          0%, 100% { transform: translate(calc(3% * var(--vo-amp)), calc(-6% * var(--vo-amp))) scale(calc(1 - .06 * var(--vo-amp))); }
          50%      { transform: translate(calc(-4% * var(--vo-amp)), calc(7% * var(--vo-amp))) scale(calc(1 + .14 * var(--vo-amp))); }
        }

        /* ── glass shading ────────────────────────────────────────────── */
        .vo-veil {
          position: absolute;
          inset: 0;
          border-radius: 50%;
          background:
            radial-gradient(circle at 50% 116%, rgba(96, 165, 250, .34), transparent 54%),
            radial-gradient(circle at 50% 50%, transparent 40%, rgba(9, 17, 38, .58) 100%);
          pointer-events: none;
        }
        .vo-spec {
          position: absolute;
          top: 9%;
          left: 19%;
          width: 44%;
          height: 28%;
          border-radius: 50%;
          background: radial-gradient(ellipse at 50% 50%,
            rgba(255, 255, 255, .58), rgba(255, 255, 255, 0) 70%);
          filter: blur(7px);
          opacity: calc(.62 * var(--vo-glow));
          animation: vo-spec var(--vo-d-spec) ease-in-out infinite;
          transition: opacity .5s ease;
          pointer-events: none;
        }
        @keyframes vo-spec {
          0%, 100% { transform: rotate(-20deg) translate(-4%, 2%) scale(1); }
          50%      { transform: rotate(-6deg) translate(8%, -3%) scale(1.14); }
        }

        /* ── ring (listening / thinking only) ─────────────────────────── */
        .vo-ring {
          position: absolute;
          inset: -7%;
          border-radius: 50%;
          background: conic-gradient(from 0deg,
            rgba(147, 197, 253, 0)   0deg,
            rgba(147, 197, 253, .90) 54deg,
            rgba(37, 99, 235, .28)   132deg,
            rgba(147, 197, 253, 0)   210deg,
            rgba(147, 197, 253, 0)   360deg);
          -webkit-mask: radial-gradient(farthest-side, transparent calc(100% - 1.5px), #000 calc(100% - 1.5px));
                  mask: radial-gradient(farthest-side, transparent calc(100% - 1.5px), #000 calc(100% - 1.5px));
          opacity: 0;
          animation: vo-ring var(--vo-d-ring) linear infinite;
          transition: opacity .45s ease;
          pointer-events: none;
        }
        .vo-root[data-state="listening"] .vo-ring { opacity: .95; }
        .vo-root[data-state="thinking"]  .vo-ring { opacity: .7; }
        @keyframes vo-ring { to { transform: rotate(360deg); } }

        /* ── icon ─────────────────────────────────────────────────────── */
        .vo-icon {
          position: absolute;
          display: grid;
          place-items: center;
          color: #EFF6FF;
          filter: drop-shadow(0 2px 6px rgba(6, 14, 34, .6));
          opacity: calc(.55 + .45 * var(--vo-glow));
          transition: opacity .4s ease;
          pointer-events: none;
        }

        /* ── reduced motion ───────────────────────────────────────────── */
        @media (prefers-reduced-motion: reduce) {
          .vo-root, .vo-root * {
            animation: none !important;
            transition: none !important;
          }
          /* Freeze a pleasant composition rather than three concentric discs. */
          .vo-layer-a { transform: translate(-5%,  4%) scale(1.04); }
          .vo-layer-b { transform: translate( 5%,  5%) scale(0.94); }
          .vo-layer-c { transform: translate( 2%, -6%) scale(1.08); }
          .vo-blob-a  { transform: rotate(24deg); }
          .vo-blob-b  { transform: rotate(-38deg); }
          .vo-blob-c  { transform: rotate(96deg); }
        }
      `}</style>

      <span className="vo-bloom" aria-hidden="true" />
      <span className="vo-ring" aria-hidden="true" />

      <span className="vo-sphere" aria-hidden="true">
        <span className="vo-layer vo-layer-a"><span className="vo-blob vo-blob-a" /></span>
        <span className="vo-layer vo-layer-b"><span className="vo-blob vo-blob-b" /></span>
        <span className="vo-layer vo-layer-c"><span className="vo-blob vo-blob-c" /></span>
        <span className="vo-veil" />
        <span className="vo-spec" />
      </span>

      <span className="vo-icon" aria-hidden="true">
        {state === "thinking" ? (
          <Loader2 className="h-7 w-7 animate-spin" />
        ) : state === "denied" ? (
          <MicOff className="h-7 w-7" />
        ) : (
          <Mic className="h-7 w-7" />
        )}
      </span>
    </button>
  );
};
