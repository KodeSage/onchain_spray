"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { Address } from "viem";
import { LEADERBOARD_SIZE, TPS_WINDOW_MS } from "../constants";
import { currentRound } from "../format";
import { startFeed, type FeedStatus, type TapEvent } from "../arena-feed";

/**
 * The arena's aggregation layer.
 *
 * The hard constraint here is React, not the chain. A busy round delivers
 * hundreds of events a second, and calling setState on each one would spend the
 * whole frame budget reconciling a leaderboard that a human cannot read that
 * fast anyway. So events land in refs synchronously, and the component tree is
 * told about them on a fixed 100ms cadence — ten renders a second, no matter
 * how loud the chain gets.
 *
 * Particles are the exception and go the other way: onTap fires synchronously
 * for every live event, straight into the canvas, bypassing React entirely.
 * That is what keeps a droplet on screen within one frame of its transaction.
 */

export type LeaderRow = {
  player: Address;
  taps: number;
  rank: number;
};

export type ArenaState = {
  status: FeedStatus;
  detail?: string;
  board: LeaderRow[];
  /** Every tap counted this round, across the recent window the feed can see. */
  totalTaps: number;
  playerCount: number;
  /** Transactions per second — the Monad number. */
  tps: number;
  /** Taps per second, which is higher whenever the arena is coalescing. */
  tapsPerSecond: number;
};

const PUBLISH_INTERVAL_MS = 100;

export function useArena(opts: {
  demo?: boolean;
  /** Called synchronously for every live tap. Keep it cheap — it runs on the hot path. */
  onTap?: (e: TapEvent) => void;
}): ArenaState {
  const { demo = false } = opts;

  // Kept in a ref so a changing callback never restarts the websocket.
  const onTapRef = useRef(opts.onTap);
  onTapRef.current = opts.onTap;

  const [round, setRound] = useState(() => currentRound());
  const [state, setState] = useState<ArenaState>({
    status: "connecting",
    board: [],
    totalTaps: 0,
    playerCount: 0,
    tps: 0,
    tapsPerSecond: 0,
  });

  /**
   * player -> latest roundTaps. Absolute values, so a duplicated or reordered
   * event converges instead of double-counting.
   */
  const tallies = useRef(new Map<Address, number>());
  /** Sliding window of live arrivals: [timestamp, tapsInThatTransaction]. */
  const arrivals = useRef<{ at: number; taps: number }[]>([]);
  const status = useRef<{ status: FeedStatus; detail?: string }>({ status: "connecting" });
  const dirty = useRef(true);

  // The round rolls over at 00:00 UTC. Everyone's board empties at the same
  // moment, which is the point of a global arena — but the feed is filtered by
  // round, so it has to be rebuilt rather than just relabelled.
  useEffect(() => {
    const timer = setInterval(() => {
      const now = currentRound();
      setRound((prev) => (prev === now ? prev : now));
    }, 15_000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    tallies.current.clear();
    arrivals.current = [];
    dirty.current = true;

    const feed = startFeed(
      round,
      {
        onTap: (e) => {
          const previous = tallies.current.get(e.player) ?? 0;
          // Absolute, and monotonic: a late-arriving older event must not walk
          // a player's total backwards.
          if (e.roundTaps > previous) tallies.current.set(e.player, e.roundTaps);

          if (!e.historical) {
            arrivals.current.push({ at: e.at, taps: e.taps });
            onTapRef.current?.(e);
          }
          dirty.current = true;
        },
        onStatus: (s, detail) => {
          status.current = { status: s, detail };
          dirty.current = true;
        },
      },
      { demo }
    );

    return () => feed.stop();
  }, [round, demo]);

  useEffect(() => {
    const timer = setInterval(() => {
      const now = Date.now();

      // Drop anything that has aged out of the rate window. Done here rather
      // than on arrival so the hot path stays a single array push.
      const cutoff = now - TPS_WINDOW_MS;
      const window = arrivals.current;
      let firstLive = 0;
      while (firstLive < window.length && window[firstLive].at < cutoff) firstLive += 1;
      if (firstLive > 0) {
        window.splice(0, firstLive);
        dirty.current = true;
      }

      if (!dirty.current) return;
      dirty.current = false;

      let transactions = 0;
      let taps = 0;
      for (const entry of window) {
        transactions += 1;
        taps += entry.taps;
      }
      const seconds = TPS_WINDOW_MS / 1000;

      let totalTaps = 0;
      const rows: { player: Address; taps: number }[] = [];
      for (const [player, count] of tallies.current) {
        totalTaps += count;
        rows.push({ player, taps: count });
      }
      rows.sort((a, b) => b.taps - a.taps);

      setState({
        status: status.current.status,
        detail: status.current.detail,
        board: rows.slice(0, LEADERBOARD_SIZE).map((row, i) => ({ ...row, rank: i + 1 })),
        totalTaps,
        playerCount: tallies.current.size,
        tps: transactions / seconds,
        tapsPerSecond: taps / seconds,
      });
    }, PUBLISH_INTERVAL_MS);

    return () => clearInterval(timer);
  }, []);

  return state;
}

/**
 * Where a player sits on the board, including when they are off the end of it.
 *
 * Returned separately from the board because it is the one number a player
 * checks constantly, and it must not disappear the moment they drop out of the
 * top eight.
 */
export function useRank(board: LeaderRow[], me: Address | null): number | null {
  return useMemo(() => {
    if (!me) return null;
    const found = board.find((row) => row.player.toLowerCase() === me.toLowerCase());
    return found?.rank ?? null;
  }, [board, me]);
}
