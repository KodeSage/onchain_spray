"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Address } from "viem";
import {
  BIG_SPRAY_THRESHOLD,
  DENOMINATIONS,
  LEADERBOARD_SIZE,
  TPS_WINDOW_MS,
} from "@/lib/constants";
import { createParticleField, type ParticleField } from "@/lib/particles";
import { startFeed, type FeedStatus, type SprayEvent } from "@/lib/stage-feed";
import { formatCount, formatNairaNumber, truncateAddress, weiToNaira } from "@/lib/format";
import { useEasedNumber } from "@/lib/hooks/useEasedNumber";
import { useParty } from "@/lib/hooks/useParty";
import JoinQr from "./JoinQr";

type Leader = { address: Address; wei: bigint };

type BigSpray = { address: Address; wei: bigint; at: number };

export default function StageClient({ partyId, demo }: { partyId: number; demo: boolean }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const fieldRef = useRef<ParticleField | null>(null);

  // demo mode has no contract to read, so it names itself
  const { party } = useParty(partyId, {
    fallbackName: demo ? "Owambe (demo)" : undefined,
  });

  const [status, setStatus] = useState<FeedStatus>("connecting");
  const [totalWei, setTotalWei] = useState(0n);
  const [txCount, setTxCount] = useState(0);
  const [tps, setTps] = useState(0);
  const [leaders, setLeaders] = useState<Leader[]>([]);
  const [bigSpray, setBigSpray] = useState<BigSpray | null>(null);
  const [fps, setFps] = useState(60);

  // kept in refs: these mutate hundreds of times a second and must not each
  // trigger a React render
  const totalsRef = useRef(new Map<string, bigint>());
  const recentRef = useRef<number[]>([]);
  const pendingSpawns = useRef<{ count: number; big: boolean }>({ count: 0, big: false });

  /* ---- canvas ---------------------------------------------------------- */
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d", { alpha: true });
    if (!ctx) return;

    const field = createParticleField(ctx);
    fieldRef.current = field;

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const resize = () => field.resize(window.innerWidth, window.innerHeight, dpr);
    resize();
    window.addEventListener("resize", resize);

    let raf = 0;
    let last = performance.now();
    let frames = 0;
    let fpsAt = last;

    const loop = (now: number) => {
      const dt = Math.min((now - last) / 1000, 0.05);
      last = now;

      // drain spawns accumulated since the last frame in one go, so a burst of
      // 40 events in one block costs one spawn call rather than 40 renders
      const queued = pendingSpawns.current;
      if (queued.count > 0) {
        field.spawn(queued.count, { big: queued.big });
        queued.count = 0;
        queued.big = false;
      }

      field.render(dt);

      frames += 1;
      if (now - fpsAt >= 500) {
        setFps(Math.round((frames * 1000) / (now - fpsAt)));
        frames = 0;
        fpsAt = now;
      }

      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);
      fieldRef.current = null;
    };
  }, []);

  /* ---- feed ------------------------------------------------------------ */
  const onSpray = useCallback((e: SprayEvent) => {
    // The total comes from the event payload, not from accumulation, so a
    // duplicate or an out-of-order arrival can never corrupt it. It only ever
    // moves forward.
    setTotalWei((prev) => (e.newTotal > prev ? e.newTotal : prev));
    setTxCount((prev) => (Number(e.count) > prev ? Number(e.count) : prev + 1));

    const key = e.sprayer.toLowerCase();
    const map = totalsRef.current;
    map.set(key, (map.get(key) ?? 0n) + e.amount);

    recentRef.current.push(e.at);

    const big = e.amount >= BIG_SPRAY_THRESHOLD * 2n;
    const denom =
      DENOMINATIONS.find((d) => d.value === e.amount) ??
      DENOMINATIONS[DENOMINATIONS.length - 1];
    pendingSpawns.current.count += big ? denom.particles * 3 : denom.particles;
    if (big) pendingSpawns.current.big = true;

    if (big) {
      setBigSpray({ address: e.sprayer, wei: e.amount, at: Date.now() });
    }
  }, []);

  useEffect(() => {
    const feed = startFeed(partyId, { onSpray, onStatus: (s) => setStatus(s) }, { demo });
    return () => feed.stop();
  }, [partyId, demo, onSpray]);

  /* ---- derived: tx/sec + leaderboard, on a timer not per event --------- */
  useEffect(() => {
    const timer = setInterval(() => {
      const cutoff = Date.now() - TPS_WINDOW_MS;
      const recent = recentRef.current;
      let i = 0;
      while (i < recent.length && recent[i] < cutoff) i += 1;
      if (i > 0) recent.splice(0, i);
      setTps(recent.length / (TPS_WINDOW_MS / 1000));

      const top = [...totalsRef.current.entries()]
        .sort((a, b) => (b[1] > a[1] ? 1 : b[1] < a[1] ? -1 : 0))
        .slice(0, LEADERBOARD_SIZE)
        .map(([address, wei]) => ({ address: address as Address, wei }));
      setLeaders(top);
    }, 250);
    return () => clearInterval(timer);
  }, []);

  /* ---- big spray takeover ---------------------------------------------- */
  useEffect(() => {
    if (!bigSpray) return;
    const t = setTimeout(() => setBigSpray(null), 2200);
    return () => clearTimeout(t);
  }, [bigSpray]);

  const easedTotal = useEasedNumber(weiToNaira(totalWei), 180);
  const easedCount = useEasedNumber(txCount, 150);
  const easedTps = useEasedNumber(tps, 220);

  const shake = bigSpray !== null;

  return (
    <main
      className="relative h-dvh w-full overflow-hidden bg-ink"
      style={shake ? { animation: "stage-shake 420ms var(--ease-out)" } : undefined}
    >
      <canvas ref={canvasRef} className="absolute inset-0 z-0" />

      {/* ---- HUD ---------------------------------------------------------- */}
      <div className="pointer-events-none relative z-10 flex h-full flex-col justify-between p-12">
        <div className="flex items-start justify-between gap-12">
          {/* total sprayed — the biggest thing on screen */}
          <div>
            <p className="t-section">
              {party.name || `party #${partyId}`}
              {party.exists && (
                <>
                  {"  ·  "}
                  <span style={{ color: "var(--color-green)" }}>
                    {truncateAddress(party.host)}
                  </span>
                </>
              )}
              {party.exists && !party.active && "  ·  ENDED"}
            </p>
            <p className="t-section mt-8">total sprayed</p>
            <p className="t-total mt-3 text-paper">{formatNairaNumber(easedTotal)}</p>

            <div className="mt-10 flex items-end gap-14">
              <div>
                <p className="t-section">transactions</p>
                <p className="t-tps mt-2 text-paper">{formatCount(easedCount)}</p>
              </div>
              <div>
                <p className="t-section">status</p>
                <p className="t-tps mt-2" style={{ color: statusColor(status) }}>
                  {statusLabel(status)}
                </p>
              </div>
            </div>
          </div>

          {/* tx/sec — the number that proves Monad. Gold, and gold only here. */}
          <div className="shrink-0 bg-gold px-8 py-6 text-ink">
            <p
              className="t-section !text-ink/70"
              style={{ color: "color-mix(in srgb, var(--color-ink) 70%, transparent)" }}
            >
              transactions / sec
            </p>
            <p className="t-tps mt-1 text-ink" style={{ fontSize: 96, lineHeight: 1 }}>
              {easedTps.toFixed(1)}
            </p>
          </div>
        </div>

        <div className="flex items-end justify-between gap-12">
          {/* leaderboard */}
          <div className="w-[620px]">
            <p className="t-section mb-4">top sprayers</p>
            <div
              className="relative"
              style={{ height: LEADERBOARD_SIZE * 52 }}
            >
              {leaders.map((l, i) => (
                <div
                  key={l.address}
                  className="absolute inset-x-0 flex items-center justify-between rounded-panel bg-ink-4 px-5 py-3"
                  style={{
                    transform: `translateY(${i * 52}px)`,
                    transitionProperty: "transform",
                    transitionDuration: "var(--dur-row)",
                    transitionTimingFunction: "var(--ease-out)",
                  }}
                >
                  <span className="t-lb-addr text-text-2">
                    <span className="mr-4 text-text-4">{i + 1}</span>
                    {truncateAddress(l.address)}
                  </span>
                  <span className="t-lb-value text-paper">
                    {formatNairaNumber(weiToNaira(l.wei))}
                  </span>
                </div>
              ))}
              {leaders.length === 0 && (
                <p className="t-lb-addr text-text-4">waiting for the first note…</p>
              )}
            </div>
          </div>

          <JoinQr partyId={partyId} />
        </div>
      </div>

      {/* ---- big spray takeover ------------------------------------------- */}
      {bigSpray && (
        <div className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center">
          <div
            className="absolute inset-0"
            style={{
              background: "var(--color-gold)",
              animation: "stage-flash 420ms var(--ease-out) forwards",
            }}
          />
          <div
            className="relative text-center"
            style={{ animation: "big-in 260ms var(--ease-tap)" }}
          >
            <p className="t-section !text-ink" style={{ color: "var(--color-ink)" }}>
              big spray
            </p>
            <p
              className="t-total mt-2"
              style={{ color: "var(--color-ink)", fontSize: 148 }}
            >
              {truncateAddress(bigSpray.address)}
            </p>
            <p
              className="t-tps mt-2"
              style={{ color: "var(--color-ink)" }}
            >
              {formatNairaNumber(weiToNaira(bigSpray.wei))}
            </p>
          </div>
        </div>
      )}

      {/* dev-only readout; hidden during the demo */}
      {process.env.NODE_ENV !== "production" && (
        <p className="t-meta absolute bottom-2 left-3 z-30">
          {fps}fps · {fieldRef.current?.alive() ?? 0} notes · {status}
        </p>
      )}

      <style>{`
        @keyframes stage-shake {
          0%,100% { transform: translate(0,0); }
          20%     { transform: translate(-14px, 6px); }
          40%     { transform: translate(12px, -8px); }
          60%     { transform: translate(-8px, -4px); }
          80%     { transform: translate(6px, 5px); }
        }
        @keyframes stage-flash {
          0%   { opacity: 0.92; }
          100% { opacity: 0; }
        }
        @keyframes big-in {
          0%   { transform: scale(0.86); opacity: 0; }
          100% { transform: scale(1); opacity: 1; }
        }
      `}</style>
    </main>
  );
}

function statusLabel(s: FeedStatus): string {
  switch (s) {
    case "live-ws":
      return "LIVE";
    case "live-poll":
      return "LIVE";
    case "demo":
      return "DEMO";
    case "reconnecting":
      return "…";
    case "connecting":
      return "…";
    default:
      return "—";
  }
}

function statusColor(s: FeedStatus): string {
  if (s === "live-ws" || s === "live-poll") return "var(--color-green)";
  if (s === "demo") return "var(--color-gold)";
  return "var(--color-text-4)";
}
