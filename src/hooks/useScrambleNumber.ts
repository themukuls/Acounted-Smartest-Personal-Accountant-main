import { useState, useEffect, useRef } from "react";

/**
 * useScrambleNumber
 *
 * Revolut-style number reveal — digits scramble randomly then lock
 * into the real value. Feels like a vault opening, not a page load.
 */
export const useScrambleNumber = (
  target: number,
  active: boolean,
  duration = 1000
): { display: number; isScrambling: boolean } => {
  const [display,     setDisplay]     = useState(0);
  const [isScrambling, setIsScrambling] = useState(false);
  const raf     = useRef<number | null>(null);

  useEffect(() => {
    if (raf.current) cancelAnimationFrame(raf.current);

    if (!active) {
      setDisplay(0);
      setIsScrambling(false);
      return;
    }

    if (target <= 0) {
      setDisplay(0);
      setIsScrambling(false);
      return;
    }

    setIsScrambling(true);

    const scrambleDuration = duration * 0.5;
    const settleDuration   = duration * 0.5;
    const startTime        = performance.now();

    const animate = (now: number) => {
      const elapsed = now - startTime;

      if (elapsed < scrambleDuration) {
        // Scramble phase — random numbers in same magnitude
        const noise = Math.floor(Math.random() * target * 1.2);
        setDisplay(noise);
        raf.current = requestAnimationFrame(animate);
      } else {
        // Settle phase — count up to exact target
        const settleElapsed = elapsed - scrambleDuration;
        const t = Math.min(settleElapsed / settleDuration, 1);
        const eased = t === 1 ? 1 : 1 - Math.pow(2, -10 * t); // easeOutExpo

        setDisplay(Math.round(target * eased));

        if (t < 1) {
          raf.current = requestAnimationFrame(animate);
        } else {
          // Guarantee we land exactly on target
          setDisplay(target);
          setIsScrambling(false);
        }
      }
    };

    raf.current = requestAnimationFrame(animate);

    return () => {
      if (raf.current) cancelAnimationFrame(raf.current);
    };
  }, [target, active, duration]);

  return { display, isScrambling };
};
