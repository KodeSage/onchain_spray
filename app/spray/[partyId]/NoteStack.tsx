"use client";

import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from "react";

/**
 * The tap target: the lower 60% of the screen, a stack of notes, not a button.
 *
 * Peeled notes are DOM elements here, unlike the projector — a phone shows a
 * handful at a time, and the compositor handles a few absolutely-positioned
 * transforms far more cheaply than a canvas that has to repaint on every frame.
 * The projector's thousands of notes are canvas; these dozen are not.
 */

export type NoteStackHandle = { peel: (big: boolean) => void };

type Peeled = { id: number; big: boolean; dx: number; rot: number };

type Props = {
  onPointerDown: (e: React.PointerEvent) => void;
  onPointerUp: () => void;
  onPointerLeave: () => void;
  onPointerCancel: () => void;
};

const NoteStack = forwardRef<NoteStackHandle, Props>(function NoteStack(props, ref) {
  const [peeled, setPeeled] = useState<Peeled[]>([]);
  const [pressed, setPressed] = useState(false);
  const nextId = useRef(0);

  const peel = useCallback((big: boolean) => {
    const id = nextId.current++;
    const note: Peeled = {
      id,
      big,
      dx: (Math.random() - 0.5) * 190,
      rot: (Math.random() - 0.5) * 90,
    };
    // cap the live set — rapid tapping must never accumulate nodes
    setPeeled((list) => [...list.slice(-14), note]);
    window.setTimeout(() => {
      setPeeled((list) => list.filter((n) => n.id !== id));
    }, 900);
  }, []);

  useImperativeHandle(ref, () => ({ peel }), [peel]);

  useEffect(() => {
    const up = () => setPressed(false);
    window.addEventListener("pointerup", up);
    return () => window.removeEventListener("pointerup", up);
  }, []);

  return (
    <section
      className="relative mt-6 flex-1 overflow-hidden rounded-t-tap border-t border-hairline bg-ink-3"
      onPointerDown={(e) => {
        setPressed(true);
        props.onPointerDown(e);
      }}
      onPointerUp={props.onPointerUp}
      onPointerLeave={props.onPointerLeave}
      onPointerCancel={props.onPointerCancel}
      onContextMenu={(e) => e.preventDefault()}
      role="button"
      tabIndex={0}
      aria-label="Spray money"
    >
      {/* notes in flight */}
      <div className="pointer-events-none absolute inset-0">
        {peeled.map((n) => (
          <span
            key={n.id}
            className="absolute left-1/2 bottom-[38%] block rounded-[3px] border"
            style={
              {
                width: n.big ? 82 : 68,
                height: n.big ? 42 : 35,
                borderColor: "var(--color-note-edge-hi)",
                background: "var(--color-note-fill-hi)",
                animation: "note-fly 900ms var(--ease-out) forwards",
                "--dx": `${n.dx}px`,
                "--rot": `${n.rot}deg`,
              } as React.CSSProperties
            }
          >
            <span
              className="absolute inset-[4px] rounded-[1px] border"
              style={{ borderColor: "var(--color-gold)", opacity: 0.42 }}
            />
          </span>
        ))}
      </div>

      {/* the stack itself */}
      <div className="pointer-events-none absolute inset-x-0 bottom-0 flex justify-center pb-[max(2.5rem,env(safe-area-inset-bottom))]">
        <div
          className="relative transition-transform"
          style={{
            transform: pressed ? "translateY(6px) scale(0.975)" : "none",
            transitionDuration: "var(--dur-tap)",
            transitionTimingFunction: "var(--ease-tap)",
          }}
        >
          {[5, 4, 3, 2, 1, 0].map((i) => (
            <span
              key={i}
              className="absolute left-1/2 block rounded-[4px] border"
              style={{
                width: 176,
                height: 92,
                marginLeft: -88,
                bottom: i * 5,
                transform: `rotate(${(i % 2 === 0 ? 1 : -1) * (i * 0.7)}deg)`,
                borderColor: "var(--color-note-edge)",
                background: i === 0 ? "var(--color-note-fill-hi)" : "var(--color-note-fill)",
                zIndex: 10 - i,
              }}
            >
              {i === 0 && (
                <span
                  className="absolute inset-[7px] rounded-[2px] border"
                  style={{ borderColor: "var(--color-gold)", opacity: 0.45 }}
                />
              )}
            </span>
          ))}
          <span className="block h-[122px] w-[176px]" />
        </div>
      </div>

      <p className="t-tap-label absolute inset-x-0 top-7 text-center text-text-4">
        tap to spray · hold to pour
      </p>

      <style>{`
        @keyframes note-fly {
          0% {
            transform: translate(-50%, 0) rotate(0deg) scale(1);
            opacity: 1;
          }
          100% {
            transform: translate(calc(-50% + var(--dx)), -78vh) rotate(var(--rot)) scale(0.72);
            opacity: 0;
          }
        }
      `}</style>
    </section>
  );
});

export default NoteStack;
