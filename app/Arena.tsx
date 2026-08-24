"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Address } from "viem";
import ArenaCanvas, { type ArenaCanvasHandle } from "./ArenaCanvas";
import ClaimPanel from "./ClaimPanel";
import Leaderboard from "./Leaderboard";
import { ARENA_CONTRACT } from "@/lib/contract";
import { explorerAddress } from "@/lib/chain";
import {
  MIN_TAPS_TO_CLAIM,
  comboTier,
  type ArenaMode,
  type ComboTier,
} from "@/lib/constants";
import { formatCompact, formatCount, ordinal } from "@/lib/format";
import { useArena, useRank } from "@/lib/hooks/useArena";
import { useEasedNumber } from "@/lib/hooks/useEasedNumber";
import { usePayoutAddress, usePlayer } from "@/lib/hooks/usePlayer";

/**
 * The whole product, on one page.
 *
 * There is no second surface. The droplet field is the page background, so the
 * spectacle that used to need a projector now sits behind the thing you are
 * tapping — which is better anyway, because the two were never meant to be
 * looked at separately.
 */
export default function Arena() {
  const canvas = useRef<ArenaCanvasHandle | null>(null);
  const tapRef = useRef<HTMLButtonElement>(null);
  const [demo, setDemo] = useState(false);
  const [arenaMode, setArenaMode] = useState<ArenaMode>("open");
  const [payout, setPayout] = usePayoutAddress();

  useEffect(() => {
    setDemo(new URLSearchParams(window.location.search).get("demo") === "1");
  }, []);

  /* The budget signal that drives the degradation ladder. Slow on purpose —
     it changes over hours, not seconds. */
  useEffect(() => {
    let cancelled = false;
    const poll = async () => {
      try {
        const res = await fetch("/api/status", { signal: AbortSignal.timeout(6_000) });
        const data = (await res.json()) as { mode?: ArenaMode };
        if (!cancelled && data.mode) setArenaMode(data.mode);
      } catch {
        /* keep the last known mode; a missed poll is not a state change */
      }
    };
    void poll();
    const timer = setInterval(() => void poll(), 45_000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, []);

  /* Someone else's tap. Small and dim, from a random point along the bottom —
     it should read as the room being busy, not compete with your own taps. */
  const onRemoteTap = useCallback((e: { taps: number; player: Address }) => {
    canvas.current?.spawn(Math.min(3, e.taps), {
      x: Math.random() * window.innerWidth,
      y: window.innerHeight * (0.82 + Math.random() * 0.12),
    });
  }, []);

  const arena = useArena({ demo, onTap: onRemoteTap });

  /* Your own tap. Bright, from the target, scaled by combo. */
  const onLocalTap = useCallback((combo: number, tier: ComboTier) => {
    const crossing = combo > 0 && tier.at > 0 && combo === tier.at;
    canvas.current?.spawn(tier.particles, {
      hot: combo >= 10,
      big: crossing,
    });
  }, []);

  const player = usePlayer({ arenaMode, onLocalTap });
  const rank = useRank(arena.board, player.address);

  /* Keep bursts coming from the middle of the tap target, wherever the
     responsive layout has put it. */
  useEffect(() => {
    const place = () => {
      const el = tapRef.current;
      if (!el) return;
      const box = el.getBoundingClientRect();
      canvas.current?.setOrigin(box.left + box.width / 2, box.top + box.height * 0.42);
    };
    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, { passive: true });
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place);
    };
  }, [player.phase]);

  /* Fold the chain's count of your taps back into the optimistic one. */
  const { address: myAddress, reconcile } = player;
  useEffect(() => {
    if (!myAddress) return;
    const mine = arena.board.find(
      (row) => row.player.toLowerCase() === myAddress.toLowerCase()
    );
    if (mine) reconcile(mine.taps);
  }, [arena.board, myAddress, reconcile]);

  const easedTotal = useEasedNumber(arena.totalTaps);
  const easedTps = useEasedNumber(arena.tps, 260);
  const tier = comboTier(player.combo);
  const live = arena.status === "live-ws" || arena.status === "live-poll";

  return (
    <>
      <ArenaCanvas handleRef={canvas} />

      <main className="relative z-10 mx-auto flex min-h-dvh w-full max-w-6xl flex-col gap-6 px-4 py-5 sm:px-6 lg:gap-8 lg:py-8">
        <Header live={live} mode={arenaMode} demo={demo} />

        <div className="grid flex-1 items-start gap-6 lg:grid-cols-[1.15fr_0.85fr] lg:gap-8">
          {/* --- the arena itself --------------------------------------- */}
          <div className="flex flex-col gap-5">
            <div>
              <p className="t-section">Taps this round</p>
              <p className="t-hero mt-1 text-paper">{formatCompact(easedTotal)}</p>
              <div className="mt-3 flex flex-wrap items-baseline gap-x-6 gap-y-1">
                <Stat label="tx / sec" value={easedTps.toFixed(1)} accent />
                <Stat label="tappers" value={formatCount(arena.playerCount)} />
                {rank !== null && <Stat label="your rank" value={ordinal(rank)} accent />}
              </div>
            </div>

            <TapButton
              ref={tapRef}
              player={player}
              tier={tier}
              onDown={player.holdStart}
              onUp={player.holdEnd}
            />

            {player.notice && (
              <p className="t-meta text-amber" role="status">
                {player.notice}
              </p>
            )}
          </div>

          {/* --- board and claim ---------------------------------------- */}
          <div className="flex flex-col gap-5">
            <ClaimPanel
              player={player.address}
              taps={player.taps}
              payout={payout}
              onPayoutChange={setPayout}
              disabled={player.phase !== "ready"}
            />
            <Leaderboard board={arena.board} me={player.address} />
          </div>
        </div>

        <Footer />
      </main>
    </>
  );
}

/* ------------------------------------------------------------------------- */

function Header({
  live,
  mode,
  demo,
}: {
  live: boolean;
  mode: ArenaMode;
  demo: boolean;
}) {
  const label = demo
    ? "spectate"
    : mode === "spectate"
      ? "budget spent"
      : mode === "tightening"
        ? "batching"
        : live
          ? "live"
          : "connecting";

  const colour =
    mode === "spectate" || demo
      ? "var(--color-text-4)"
      : mode === "tightening"
        ? "var(--color-amber)"
        : live
          ? "var(--color-aqua)"
          : "var(--color-text-4)";

  return (
    <header className="flex items-center justify-between gap-4">
      <div className="flex items-baseline gap-3">
        <span className="t-label text-violet">TAP</span>
        <span className="t-meta hidden sm:inline">Monad testnet faucet</span>
      </div>

      <div className="flex items-center gap-2">
        <span
          className={live && !demo && mode === "open" ? "live-dot" : ""}
          style={{
            width: 7,
            height: 7,
            borderRadius: "var(--radius-chip)",
            background: colour,
          }}
        />
        <span className="t-meta" style={{ color: colour }}>
          {label}
        </span>
      </div>
    </header>
  );
}

function Stat({
  label,
  value,
  accent = false,
}: {
  label: string;
  value: string;
  accent?: boolean;
}) {
  return (
    <div>
      <span
        className="t-stat tnum"
        style={{ color: accent ? "var(--color-aqua)" : "var(--color-paper)" }}
      >
        {value}
      </span>
      <span className="t-meta ml-2">{label}</span>
    </div>
  );
}

const TapButton = function TapButton({
  ref,
  player,
  tier,
  onDown,
  onUp,
}: {
  ref: React.Ref<HTMLButtonElement>;
  player: ReturnType<typeof usePlayer>;
  tier: ComboTier;
  onDown: () => void;
  onUp: () => void;
}) {
  const booting = player.phase === "booting" || player.phase === "funding";
  const spectating = player.mode === "spectate";
  const combo = player.combo;

  return (
    <button
      ref={ref}
      type="button"
      disabled={booting || spectating}
      onPointerDown={(e) => {
        e.preventDefault();
        onDown();
      }}
      onPointerUp={onUp}
      onPointerLeave={onUp}
      onPointerCancel={onUp}
      className="tap-target relative flex min-h-[clamp(200px,34vh,340px)] w-full flex-col items-center justify-center rounded-[var(--radius-tap)] border-2 disabled:cursor-not-allowed"
      style={{
        background: combo >= 10 ? "rgba(63,224,208,0.06)" : "var(--color-ink-3)",
        borderColor:
          combo >= 25
            ? "var(--color-aqua)"
            : combo >= 10
              ? "var(--color-violet)"
              : "var(--color-hairline)",
      }}
      aria-label="Tap to earn"
    >
      {booting ? (
        <>
          <span className="t-label text-text-3">priming your key</span>
          <span className="t-meta mt-2">a burner is being funded for you</span>
        </>
      ) : spectating ? (
        <>
          <span className="t-label text-text-3">spectating</span>
          <span className="t-meta mt-2">
            today&apos;s budget is spent — the wall is still live
          </span>
        </>
      ) : (
        <>
          <span className="t-hero text-paper">{formatCount(player.taps)}</span>
          <span className="t-label mt-2 text-text-3">
            {player.taps >= MIN_TAPS_TO_CLAIM
              ? "taps · claimable"
              : `taps · ${MIN_TAPS_TO_CLAIM - player.taps} to unlock`}
          </span>

          <span
            className="t-chip mt-4 rounded-[var(--radius-chip)] px-3 py-1.5"
            style={{
              background: combo >= 10 ? "var(--color-aqua)" : "var(--color-ink-4)",
              color: combo >= 10 ? "#08080A" : "var(--color-text-3)",
            }}
          >
            {combo >= 2 ? `${combo}× ${tier.label}` : "tap · or hold"}
          </span>

          {player.mode === "coalesced" && (
            <span className="t-meta absolute bottom-3">
              settling in batches · same score, less gas
            </span>
          )}
        </>
      )}
    </button>
  );
};

function Footer() {
  return (
    <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-hairline pt-4">
      <div className="flex flex-wrap gap-5">
        {ARENA_CONTRACT && (
          <a
            href={explorerAddress(ARENA_CONTRACT)}
            target="_blank"
            rel="noreferrer"
            className="t-meta hover:text-text-2"
          >
            contract →
          </a>
        )}
        <a
          href="https://github.com/"
          target="_blank"
          rel="noreferrer"
          className="t-meta hover:text-text-2"
        >
          source →
        </a>
        <a href="/styleguide" className="t-meta hover:text-text-2">
          styleguide →
        </a>
      </div>
      <p className="t-meta">testnet MON · no popups · signing stays in your browser</p>
    </footer>
  );
}
