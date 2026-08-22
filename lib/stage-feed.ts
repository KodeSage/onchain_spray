"use client";

import { parseAbiItem, type Address, type Hex } from "viem";
import { createStageWsClient, httpClientFor, monadTestnet } from "./chain";
import { ENDPOINTS } from "./rpc";
import { SPRAY_CONTRACT } from "./contract";

/**
 * The stage's read layer.
 *
 * One websocket subscription, no polling, and no contract calls — the entire
 * read cost of the projector is one connection. Every number on screen is
 * reconstructed from Sprayed events alone, which is why the event carries
 * newTotal and count in its payload.
 *
 * Resilience: the socket drops on bad venue wifi. On reconnect we backfill with
 * getLogs from the last block we actually saw, so the total never goes
 * backwards and no spray is silently lost.
 */

export const sprayedEventAbi = parseAbiItem(
  "event Sprayed(uint256 indexed partyId, address indexed sprayer, uint256 amount, uint256 newTotal, uint64 count)"
);

export type SprayEvent = {
  sprayer: Address;
  amount: bigint;
  newTotal: bigint;
  count: bigint;
  blockNumber: bigint;
  txHash: Hex;
  /** local arrival time, used for the tx/sec window */
  at: number;
  /**
   * Replayed from the log on a cold load rather than arriving live. The stage
   * must fold these into the leaderboard but must NOT spawn particles for them
   * or count them toward tx/sec — a reload would otherwise dump thousands of
   * notes on screen at once and spike the rate to a number nobody earned.
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
  onSpray: (e: SprayEvent) => void;
  onStatus: (s: FeedStatus, detail?: string) => void;
};

export type Feed = { stop: () => void };

const POLL_INTERVAL_MS = 900;
const MAX_BACKOFF_MS = 8_000;

/** getLogs window per request. Kept small so no single call is rejected. */
const HISTORY_CHUNK = 2_000n;
/** How far back to rebuild the leaderboard from on a cold load. At ~400ms
 *  blocks this is a little over two hours — longer than any demo, short enough
 *  to finish while the projector is warming up. */
const HISTORY_LOOKBACK = 20_000n;

export function startFeed(
  partyId: number,
  handlers: FeedHandlers,
  opts: { demo?: boolean; history?: boolean } = {}
): Feed {
  if (opts.demo) return startDemoFeed(handlers, partyId);

  let stopped = false;
  let unwatch: (() => void) | null = null;
  let pollTimer: ReturnType<typeof setInterval> | null = null;
  let lastBlock: bigint | null = null;
  let attempt = 0;
  const seen = new Set<string>();

  const http = httpClientFor(ENDPOINTS[0].http);

  function emit(
    historical: boolean,
    logs: readonly {
      args: { sprayer?: Address; amount?: bigint; newTotal?: bigint; count?: bigint };
      blockNumber: bigint | null;
      transactionHash: Hex | null;
      logIndex: number | null;
    }[]
  ) {
    for (const log of logs) {
      const { sprayer, amount, newTotal, count } = log.args;
      if (!sprayer || amount === undefined || newTotal === undefined) continue;

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

      handlers.onSpray({
        sprayer,
        amount,
        newTotal,
        count: count ?? 0n,
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
        address: SPRAY_CONTRACT,
        event: sprayedEventAbi,
        args: { partyId: BigInt(partyId) },
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
        address: SPRAY_CONTRACT,
        event: sprayedEventAbi,
        args: { partyId: BigInt(partyId) },
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

    // after a few failed sockets, stop fighting it and poll instead — the
    // projector must never go blank because of a transport preference
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
            address: SPRAY_CONTRACT,
            event: sprayedEventAbi,
            args: { partyId: BigInt(partyId) },
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
   * Replay past sprays on a cold load.
   *
   * The running total and transaction count come back from partyInfo, but the
   * leaderboard cannot — it is a per-address sum that only exists in the event
   * log. Without this a browser reload mid-party shows an empty leaderboard
   * until five more people spray, which on a projector looks broken.
   *
   * Best-effort by design: if the RPC refuses the range, the live feed still
   * works and the leaderboard simply rebuilds from now on.
   */
  async function replayHistory() {
    try {
      const head = await http.getBlockNumber();
      const earliest = head > HISTORY_LOOKBACK ? head - HISTORY_LOOKBACK : 0n;

      for (let from = earliest; from <= head; from += HISTORY_CHUNK) {
        if (stopped) return;
        const to = from + HISTORY_CHUNK - 1n > head ? head : from + HISTORY_CHUNK - 1n;
        const logs = await http.getLogs({
          address: SPRAY_CONTRACT,
          event: sprayedEventAbi,
          args: { partyId: BigInt(partyId) },
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
   Demo mode
   -------------------------------------------------------------------------
   /stage?demo=1 replays a synthetic event stream at realistic timing through
   the identical rendering pipeline. If the venue network dies on stage, one
   query param saves the demo. This is not a mock of the UI — it is the same UI,
   fed from a different source.
   ------------------------------------------------------------------------- */

/**
 * The demo cast is derived, not hardcoded — a fixed list of literal addresses
 * would be the one part of the stage that could not be traced back to a real
 * event. These are generated per party so a given demo always shows the same
 * faces, and the leaderboard reorders exactly the way it does with live data.
 */
function demoSprayers(partyId: number, n = 9): Address[] {
  const out: Address[] = [];
  // xorshift, seeded by the party, so the cast is stable per party and
  // different between parties
  let state = (partyId + 1) * 0x9e3779b9;
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

function startDemoFeed(handlers: FeedHandlers, partyId: number): Feed {
  let stopped = false;
  let count = 0n;
  let total = 0n;
  let block = 55_900_000n;
  const timers: ReturnType<typeof setTimeout>[] = [];
  const sprayers = demoSprayers(partyId);

  handlers.onStatus("demo", "replaying recorded stream");

  const denominations = [100000000000000n, 500000000000000n, 2000000000000000n];

  // Curve: the room takes a few seconds to scan, then it goes off. Matches the
  // shape of the real thing so the rehearsal is honest.
  function intensityAt(elapsedMs: number): number {
    const t = elapsedMs / 1000;
    if (t < 4) return 0.12;
    if (t < 10) return 0.12 + ((t - 4) / 6) * 0.8;
    if (t < 60) return 0.92 + Math.sin(t / 3) * 0.08;
    return 0.85;
  }

  const started = Date.now();

  function tick() {
    if (stopped) return;
    const elapsed = Date.now() - started;
    const intensity = intensityAt(elapsed);

    // ~260 sprays/sec at full intensity, delivered in per-block clumps
    const burst = Math.max(1, Math.round(intensity * 26));
    block += 1n;

    for (let i = 0; i < burst; i++) {
      const big = Math.random() < 0.03;
      const amount = big
        ? denominations[2] * BigInt(2 + Math.floor(Math.random() * 4))
        : denominations[Math.floor(Math.random() * (Math.random() < 0.6 ? 2 : 3))];
      total += amount;
      count += 1n;
      handlers.onSpray({
        sprayer: sprayers[Math.floor(Math.random() * sprayers.length)],
        amount,
        newTotal: total,
        count,
        blockNumber: block,
        txHash: `0x${count.toString(16).padStart(64, "0")}` as Hex,
        at: Date.now(),
        historical: false,
      });
    }

    // Monad blocks are ~400ms
    const t = setTimeout(tick, 400);
    timers.push(t);
  }

  tick();

  return {
    stop: () => {
      stopped = true;
      for (const t of timers) clearTimeout(t);
    },
  };
}
