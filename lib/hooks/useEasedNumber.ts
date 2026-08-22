"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Eases a number toward its target on rAF.
 *
 * Counters never snap. On a projector a snapping total reads as a glitch, and
 * an eased one reads as momentum — which is the whole point of the number.
 * Exponential smoothing rather than a fixed-duration tween, because the target
 * moves continuously (hundreds of times a second) and a tween would restart
 * forever and never arrive.
 */
export function useEasedNumber(target: number, halfLifeMs = 140): number {
  const [display, setDisplay] = useState(target);
  const current = useRef(target);
  const goal = useRef(target);

  goal.current = target;

  useEffect(() => {
    let raf = 0;
    let last = performance.now();

    const tick = (now: number) => {
      const dt = Math.min(now - last, 100);
      last = now;

      const diff = goal.current - current.current;
      if (Math.abs(diff) < 0.5) {
        if (current.current !== goal.current) {
          current.current = goal.current;
          setDisplay(goal.current);
        }
      } else {
        // frame-rate independent exponential approach
        const k = 1 - Math.pow(0.5, dt / halfLifeMs);
        current.current += diff * k;
        setDisplay(current.current);
      }
      raf = requestAnimationFrame(tick);
    };

    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [halfLifeMs]);

  return display;
}
