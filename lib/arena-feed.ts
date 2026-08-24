"use client";

import { parseAbiItem, type Address, type Hex } from "viem";
import { createStageWsClient, httpClientFor, monadTestnet } from "./chain";
import { ENDPOINTS } from "./rpc";
import { ARENA_CONTRACT } from "./contract";

/**
 * The arena's read layer.
 *
 * One websocket subscription, no polling, and no contract calls — the entire
 * read cost of the live wall is one connection. Every number on screen is
 * reconstructed from Tapped events alone, which is why the event carries
 * roundTaps and totalTaps in its payload.
 *
 * roundTaps is ABSOLUTE, not a delta, and that is what makes the reconstruction
 * exact. The client keeps a map of player -> latest roundTaps; the global total
 * is the sum of that map. A duplicate event, an out-of-order event or a
 * re-delivered backfill all converge to the same number, because the last write
 * for a player wins rather than accumulating.
 *
 * Resilience: the socket drops on bad wifi. On reconnect we backfill with
 * getLogs from the last block we actually saw, so no tap is silently lost.
 */

export const tappedEventAbi = parseAbiItem(
  "event Tapped(address indexed player, uint32 indexed round, uint32 taps, uint32 roundTaps, uint64 totalTaps)"
);

export type TapEvent = {
  player: Address;
  /** How many taps this single transaction represents (1, or n for tapBatch). */
  taps: number;
  /** The player's round total AFTER this transaction. Absolute, not a delta. */
  roundTaps: number;
  /** The player's lifetime total after this transaction. */
  totalTaps: bigint;
  blockNumber: bigint;
  txHash: Hex;
  /** local arrival time, used for the taps/sec window */
  at: number;
  /**
   * Replayed from the log on a cold load rather than arriving live. The arena
   * must fold these into the leaderboard but must NOT spawn droplets for them
   * or count them toward taps/sec — a reload would otherwise dump thousands of
   * particles on screen at once and spike the rate to a number nobody earned.
   */
  historical: boolean;
};

export type FeedStatus =
  | "connecting"
  | "live-ws"
  | "live-poll"
  | "reconnecting"
  | "demo"
  | "error";

export type FeedHandlers = {
  onTap: (e: TapEvent) => void;
  onStatus: (s: FeedStatus, detail?: string) => void;
};

export type Feed = { stop: () => void };

const POLL_INTERVAL_MS = 900;
const MAX_BACKOFF_MS = 8_000;

/** getLogs window per request. Kept small so no single call is rejected. */
const HISTORY_CHUNK = 2_000n;

/**
 * How far back to rebuild the leaderboard from on a cold load.
 *
 * A UTC round is ~216,000 blocks at 400ms, which is far more than any RPC will
 * hand over in a reasonable number of requests. So the leaderboard is a rolling
 * recent window rather than the whole day, and the UI says so. The player's own
 * round total is never approximated this way — that comes from players() on the
 * contract and is exact.
 */
const HISTORY_LOOKBACK = 20_000n;

export function startFeed(
  round: number,
  handlers: FeedHandlers,
  opts: { demo?: boolean; history?: boolean } = {}
): Feed {
  if (opts.demo) return startDemoFeed(handlers);

  let stopped = false;
  let unwatch: (() => void) | null = null;
  let pollTimer: ReturnType<typeof setInterval> | null = null;
  let lastBlock: bigint | null = null;
  let attempt = 0;
  const seen = new Set<string>();

  const http = httpClientFor(ENDPOINTS[0].http);
  const filter = { round } as const;

  function emit(
    historical: boolean,
    logs: readonly {
      args: {
        player?: Address;
        taps?: number;
        roundTaps?: number;
        totalTaps?: bigint;
      };
      blockNumber: bigint | null;
      transactionHash: Hex | null;
      logIndex: number | null;
    }[]
  ) {
    for (const log of logs) {
      const { player, taps, roundTaps, totalTaps } = log.args;
      if (!player || taps === undefined || roundTaps === undefined) continue;

      // dedupe across ws + backfill overlap
      const key = `${log.transactionHash}:${log.logIndex}`;
      if (seen.has(key)) continue;
      seen.add(key);
      if (seen.size > 50_000) seen.clear();

      // Replay must not move the live cursor: connectWs anchors lastBlock to
      // the head, and letting a historical block pull it backwards would make
      // the next reconnect re-scan hours of logs.
      if (!historical && log.blockNumber !== null) {
        lastBlock =
          lastBlock === null || log.blockNumber > lastBlock ? log.blockNumber : lastBlock;
      }

      handlers.onTap({
        player,
        taps,
        roundTaps,
        totalTaps: totalTaps ?? 0n,
        blockNumber: log.blockNumber ?? 0n,
        txHash: log.transactionHash ?? ("0x" as Hex),
        at: Date.now(),
        historical,
      });
    }
  }

  /** Fetch everything we missed while the socket was down. */
  async function backfill() {
    if (lastBlock === null) return;
    try {
      const current = await http.getBlockNumber();
      if (current <= lastBlock) return;
      const logs = await http.getLogs({
        address: ARENA_CONTRACT,
        event: tappedEventAbi,
        args: filter,
        fromBlock: lastBlock + 1n,
        toBlock: current,
      });
      emit(false, logs);
    } catch {
      /* the next reconnect tries again */
    }
  }

  async function connectWs() {
    if (stopped) return;
    const client = createStageWsClient();
    if (!client) {
      startPolling();
      return;
    }

    try {
      handlers.onStatus(attempt === 0 ? "connecting" : "reconnecting");
      if (lastBlock === null) lastBlock = await http.getBlockNumber();

      unwatch = client.watchEvent({
        address: ARENA_CONTRACT,
        event: tappedEventAbi,
        args: filter,
        onLogs: (logs) => {
          attempt = 0;
          emit(false, logs);
        },
        onError: () => {
          if (stopped) return;
          reconnect();
        },
      });

      await backfill();
      handlers.onStatus("live-ws", monadTestnet.name);
    } catch {
      reconnect();
    }
  }

  function reconnect() {
    if (stopped) return;
    unwatch?.();
    unwatch = null;
    attempt += 1;

    // after a few failed sockets, stop fighting it and poll instead — the wall
    // must never go blank because of a transport preference
    if (attempt > 3) {
      startPolling();
      return;
    }

    const delay = Math.min(400 * 2 ** attempt, MAX_BACKOFF_MS);
    handlers.onStatus("reconnecting", `attempt ${attempt}`);
    setTimeout(() => void connectWs(), delay);
  }

  function startPolling() {
    if (stopped || pollTimer) return;
    handlers.onStatus("live-poll");
    pollTimer = setInterval(() => {
      void (async () => {
        try {
          const current = await http.getBlockNumber();
          if (lastBlock === null) {
            lastBlock = current;
            return;
          }
          if (current <= lastBlock) return;
          const logs = await http.getLogs({
            address: ARENA_CONTRACT,
            event: tappedEventAbi,
            args: filter,
            fromBlock: lastBlock + 1n,
            toBlock: current,
          });
          lastBlock = current;
          emit(false, logs);
        } catch {
          /* keep polling; a blip is not a failure */
        }
      })();
    }, POLL_INTERVAL_MS);
  }

  /**
   * Replay recent taps on a cold load.
   *
   * Without this, a reload shows an empty leaderboard until eight more people
   * tap, which reads as broken. Best-effort by design: if the RPC refuses the
   * range, the live feed still works and the board rebuilds from now on.
   */
  async function replayHistory() {
    try {
      const head = await http.getBlockNumber();
      const earliest = head > HISTORY_LOOKBACK ? head - HISTORY_LOOKBACK : 0n;

      for (let from = earliest; from <= head; from += HISTORY_CHUNK) {
        if (stopped) return;
        const to = from + HISTORY_CHUNK - 1n > head ? head : from + HISTORY_CHUNK - 1n;
        const logs = await http.getLogs({
          address: ARENA_CONTRACT,
          event: tappedEventAbi,
          args: filter,
          fromBlock: from,
          toBlock: to,
        });
        if (logs.length > 0) emit(true, logs);
      }
    } catch {
      /* live feed carries on; the leaderboard just starts from now */
    }
  }

  if (opts.history !== false) void replayHistory();
  void connectWs();

  return {
    stop: () => {
      stopped = true;
      unwatch?.();
      if (pollTimer) clearInterval(pollTimer);
    },
  };
}

/* -------------------------------------------------------------------------
   Spectate mode
   -------------------------------------------------------------------------
   Two jobs, one implementation. `?demo=1` replays a synthetic stream through
   the identical rendering pipeline so the arena can be shown with no network at
   all; and it is what the bottom rung of the degradation ladder falls back to
   when the day's budget is spent. This is not a mock of the UI — it is the same
   UI, fed from a different source.
   ------------------------------------------------------------------------- */

/**
 * The demo cast is derived, not hardcoded — a fixed list of literal addresses
 * would be the one part of the arena that could not be traced back to a real
 * event. Seeded, so the same round always shows the same faces.
 */
function demoPlayers(seed: number, n = 12): Address[] {
  const out: Address[] = [];
  let state = (seed + 1) * 0x9e3779b9;
  const next = () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return state >>> 0;
  };
  for (let i = 0; i < n; i++) {
    let hex = "";
    while (hex.length < 40) hex += next().toString(16).padStart(8, "0");
    out.push(`0x${hex.slice(0, 40)}` as Address);
  }
  return out;
}

function startDemoFeed(handlers: FeedHandlers): Feed {
  let stopped = false;
  let block = 55_900_000n;
  let sequence = 0n;
  const timers: ReturnType<typeof setTimeout>[] = [];
  const players = demoPlayers(Math.floor(Date.now() / 86_400_000));
  const roundTaps = new Map<Address, number>();
  const lifetime = new Map<Address, bigint>();

  handlers.onStatus("demo", "synthetic stream");

  // Curve: a slow trickle, then the arena fills up. Matches the shape of a real
  // round so a rehearsal is honest.
  function intensityAt(elapsedMs: number): number {
    const t = elapsedMs / 1000;
    if (t < 4) return 0.15;
    if (t < 12) return 0.15 + ((t - 4) / 8) * 0.75;
    return 0.9 + Math.sin(t / 4) * 0.1;
  }

  const started = Date.now();

  function tick() {
    if (stopped) return;
    const intensity = intensityAt(Date.now() - started);
    const burst = Math.max(1, Math.round(intensity * 22));
    block += 1n;

    for (let i = 0; i < burst; i++) {
      const player = players[Math.floor(Math.random() * players.length)];
      // Most transactions are a single tap; some are a coalesced batch, exactly
      // as they are when the real arena is tightening.
      const taps = Math.random() < 0.15 ? 2 + Math.floor(Math.random() * 12) : 1;

      const nextRound = (roundTaps.get(player) ?? 0) + taps;
      const nextLifetime = (lifetime.get(player) ?? 0n) + BigInt(taps);
      roundTaps.set(player, nextRound);
      lifetime.set(player, nextLifetime);
      sequence += 1n;

      handlers.onTap({
        player,
        taps,
        roundTaps: nextRound,
        totalTaps: nextLifetime,
        blockNumber: block,
        txHash: `0x${sequence.toString(16).padStart(64, "0")}` as Hex,
        at: Date.now(),
        historical: false,
      });
    }

    // Monad blocks are ~400ms
    timers.push(setTimeout(tick, 400));
  }

  tick();

  return {
    stop: () => {
      stopped = true;
      for (const t of timers) clearTimeout(t);
    },
  };
}
