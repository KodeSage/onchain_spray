"use client";

import { useEffect, useRef, type RefObject } from "react";
import { createParticleField, type ParticleField, type SpawnOptions } from "@/lib/particles";

/**
 * The droplet field, full-bleed behind the whole page.
 *
 * There is one canvas and one rAF loop for the entire app. It is deliberately
 * outside React's control: the parent gets a plain object with a spawn method
 * and calls it straight from the tap handler and the event feed, so a droplet
 * appears on the next frame without a render happening at all.
 */

export type ArenaCanvasHandle = {
  spawn: (count: number, opts?: SpawnOptions) => void;
  /** Centre of the tap target, in CSS pixels, so bursts come from the right place. */
  setOrigin: (x: number, y: number) => void;
};

export default function ArenaCanvas({
  handleRef,
}: {
  handleRef: RefObject<ArenaCanvasHandle | null>;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext("2d", { alpha: true });
    if (!ctx) return;

    const field: ParticleField = createParticleField(ctx);
    const origin = { x: 0, y: 0 };

    // Cap the device pixel ratio. A 3x phone renders nine times the pixels for
    // a difference nobody can see on a moving droplet, and drops frames doing it.
    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      field.resize(window.innerWidth, window.innerHeight, dpr);
    };
    resize();
    window.addEventListener("resize", resize);

    handleRef.current = {
      spawn: (count, opts) =>
        field.spawn(count, {
          x: origin.x || window.innerWidth / 2,
          y: origin.y || window.innerHeight * 0.62,
          ...opts,
        }),
      setOrigin: (x, y) => {
        origin.x = x;
        origin.y = y;
      },
    };

    let raf = 0;
    let last = performance.now();
    let running = true;

    const tick = (now: number) => {
      if (!running) return;
      // Clamp dt so a backgrounded tab does not resume with one enormous step
      // that teleports every droplet off the bottom of the screen at once.
      const dt = Math.min((now - last) / 1000, 0.05);
      last = now;
      field.render(dt);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);

    // A hidden tab gets no rAF anyway; this makes the resume clean rather than
    // leaving a screenful of stale droplets to fall all at once.
    const onVisibility = () => {
      if (document.visibilityState === "hidden") {
        field.clear();
      } else {
        last = performance.now();
      }
    };
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      running = false;
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);
      document.removeEventListener("visibilitychange", onVisibility);
      handleRef.current = null;
    };
  }, [handleRef]);

  return (
    <canvas
      ref={canvasRef}
      aria-hidden
      className="pointer-events-none fixed inset-0 z-0"
    />
  );
}
