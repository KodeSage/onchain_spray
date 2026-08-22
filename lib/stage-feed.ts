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

export function startFeed(
  partyId: number,
  handlers: FeedHandlers,
  opts: { demo?: boolean } = {}
): Feed {
  if (opts.demo) return startDemoFeed(handlers);

  let stopped = false;
  let unwatch: (() => void) | null = null;
  let pollTimer: ReturnType<typeof setInterval> | null = null;
  let lastBlock: bigint | null = null;
  let attempt = 0;
  const seen = new Set<string>();

  const http = httpClientFor(ENDPOINTS[0].http);

  function emit(
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

      if (log.blockNumber !== null) {
        lastBlock = lastBlock === null || log.blockNumber > lastBlock ? log.blockNumber : lastBlock;
      }

      handlers.onSpray({
        sprayer,
        amount,
        newTotal,
        count: count ?? 0n,
        blockNumber: log.blockNumber ?? 0n,
        txHash: log.transactionHash ?? ("0x" as Hex),
        at: Date.now(),
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
      emit(logs);
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
          emit(logs);
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
          emit(logs);
        } catch {
          /* keep polling; a blip is not a failure */
        }
      })();
    }, POLL_INTERVAL_MS);
  }

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

const DEMO_SPRAYERS: Address[] = [
  "0x7f2a4C1d9E3b5A8f0C6d2E4b1A9c8D7e6F5a4B3c",
  "0x3B8e1F6a2D4c9E0b7A5f3C1d8E6b4A2c0F9e7D5b",
  "0xC4d7E2a9B1f5C3e8D6a0B4f2E9c7A5d3B1f8E6a4",
  "0x91aF5c3E7b2D8a6F4c0E9b1D7a5C3e2F8b6D4a0C",
  "0x5E3b9A7c1F4d2B8e6C0a5D3f1B9e7C4a2F6d8B0e",
  "0xA2f8D4b6C0e3A9d1F7b5E2c8A6d4B0f3E1c9D7a5",
  "0x6D1c8B4a2F9e7C3d5A0b6E4f2C8a1D9b7E3c5F0d",
];

function startDemoFeed(handlers: FeedHandlers): Feed {
  let stopped = false;
  let count = 0n;
  let total = 0n;
  let block = 55_900_000n;
  const timers: ReturnType<typeof setTimeout>[] = [];

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
        sprayer: DEMO_SPRAYERS[Math.floor(Math.random() * DEMO_SPRAYERS.length)],
        amount,
        newTotal: total,
        count,
        blockNumber: block,
        txHash: `0x${count.toString(16).padStart(64, "0")}` as Hex,
        at: Date.now(),
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
