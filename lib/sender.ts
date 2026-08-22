import type { Hex } from "viem";
import {
  BATCH_WINDOW_MS,
  BATCH_WINDOW_MS_DEGRADED,
  MAX_BATCH_SIZE,
  MAX_QUEUE_DEPTH,
} from "./constants";
import { createRotator, isRateLimitError, type Rotator } from "./rpc";
import { HTTP_TIMEOUT_MS } from "./chain";

/**
 * Batched transaction sender.
 *
 * The arithmetic that forces this design: 130 people tapping twice a second is
 * 260 requests/sec. The primary public endpoint allows 50. Pooling all three
 * public endpoints reaches roughly 100. On one-request-per-tap the demo
 * rate-limits itself into a wall about four seconds after the QR goes up.
 *
 * So taps buffer for 150ms and flush as a single JSON-RPC batch. Ten rapid taps
 * become one request instead of ten — roughly an order of magnitude of headroom
 * — and it costs nothing in perceived latency, because the note animation is
 * optimistic and already fired on tap.
 *
 * Nonces are assigned and incremented locally, in order, before the batch is
 * built (see lib/burner.ts). The batch preserves that order.
 */

export type SendStats = {
  queued: number;
  sent: number;
  landed: number;
  dropped: number;
  rateLimited: number;
  rotations: number;
  batches: number;
  largestBatch: number;
  endpointId: string;
};

type Pending = {
  raw: Hex;
  attempts: number;
};

export type Sender = {
  /** Fire and forget. Returns immediately — never awaited in the tap path. */
  enqueue: (raw: Hex) => void;
  flushNow: () => Promise<void>;
  stats: () => SendStats;
  stop: () => void;
  onDrop?: (raw: Hex) => void;
};

type SenderOptions = {
  seed: string;
  /** Injected in tests / load tests so we can count without a real network. */
  fetchImpl?: typeof fetch;
  /**
   * Cross-client relay. Batching inside one client compresses nothing — at 2
   * taps/sec a client accumulates 0.3 transactions per 150ms window. Batching
   * across all clients is what turns 260 req/s into ~7. Set to null to force
   * direct-to-RPC sends.
   */
  relayUrl?: string | null;
};

export function createSender({ seed, fetchImpl, relayUrl }: SenderOptions): Sender {
  const doFetch = fetchImpl ?? fetch;
  const relay =
    relayUrl === undefined
      ? typeof window !== "undefined"
        ? "/api/relay"
        : null
      : relayUrl;
  /** Set when the relay fails; direct sends take over until this passes. */
  let relayDownUntil = 0;
  const rotator: Rotator = createRotator(seed);

  const queue: Pending[] = [];
  let timer: ReturnType<typeof setTimeout> | null = null;
  let inFlight = false;
  let stopped = false;
  let batchWindow = BATCH_WINDOW_MS;
  let backoffUntil = 0;

  const stats: SendStats = {
    queued: 0,
    sent: 0,
    landed: 0,
    dropped: 0,
    rateLimited: 0,
    rotations: 0,
    batches: 0,
    largestBatch: 0,
    endpointId: rotator.current().id,
  };

  const sender: Sender = {
    enqueue,
    flushNow: flush,
    stats: () => ({
      ...stats,
      endpointId: relayUsable() ? "relay" : rotator.current().id,
      rotations: rotator.rotations(),
    }),
    stop: () => {
      stopped = true;
      if (timer) clearTimeout(timer);
      timer = null;
    },
  };

  function enqueue(raw: Hex) {
    if (stopped) return;

    // Bounded. A wedged network must not grow this without limit — dropping the
    // oldest is correct here, because the newest tap is the one the user just
    // made and is watching an animation for.
    if (queue.length >= MAX_QUEUE_DEPTH) {
      const evicted = queue.shift();
      stats.dropped += 1;
      if (evicted) sender.onDrop?.(evicted.raw);
    }

    queue.push({ raw, attempts: 0 });
    stats.queued += 1;
    schedule();
  }

  function schedule() {
    if (timer || stopped) return;
    const wait = Math.max(batchWindow, backoffUntil - Date.now());
    timer = setTimeout(() => {
      timer = null;
      void flush();
    }, wait);
  }

  function relayUsable(): boolean {
    return relay !== null && Date.now() >= relayDownUntil;
  }

  async function flush(): Promise<void> {
    if (stopped || inFlight || queue.length === 0) return;
    if (Date.now() < backoffUntil) {
      schedule();
      return;
    }

    inFlight = true;

    if (relayUsable()) {
      const viaRelay = queue.splice(0, Math.min(queue.length, MAX_BATCH_SIZE));
      try {
        await sendViaRelay(viaRelay);
        return;
      } catch {
        // relay unreachable — fall back to talking to the RPC directly, which
        // is slower on the limits but keeps the room spraying
        relayDownUntil = Date.now() + 5_000;
        requeue(viaRelay);
        return;
      } finally {
        inFlight = false;
        if (queue.length > 0) schedule();
      }
    }

    const endpoint = rotator.current();

    // The Monad Foundation endpoint does not allow batching. Clients assigned
    // there fall back to serial sends rather than getting 400s all night.
    const size = Math.min(queue.length, endpoint.batchLimit === 1 ? 1 : MAX_BATCH_SIZE);
    const batch = queue.splice(0, size);

    try {
      const body = batch.map((item, i) => ({
        jsonrpc: "2.0",
        id: i,
        method: "eth_sendRawTransaction",
        params: [item.raw],
      }));

      const controller = new AbortController();
      const abort = setTimeout(() => controller.abort(), HTTP_TIMEOUT_MS);

      let res: Response;
      try {
        res = await doFetch(endpoint.http, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          // a single-item batch is still a valid JSON-RPC batch, but the
          // non-batching endpoint wants a bare object
          body: JSON.stringify(endpoint.batchLimit === 1 ? body[0] : body),
          signal: controller.signal,
        });
      } finally {
        clearTimeout(abort);
      }

      stats.batches += 1;
      stats.largestBatch = Math.max(stats.largestBatch, batch.length);

      if (res.status === 429) {
        handleRateLimit(batch);
        return;
      }

      if (!res.ok) {
        requeue(batch);
        backoff(400);
        return;
      }

      const json: unknown = await res.json();
      const results = Array.isArray(json) ? json : [json];

      let rateLimitedInBody = false;
      for (const entry of results) {
        const r = entry as { error?: { message?: string; code?: number } };
        if (r.error) {
          if (isRateLimitError(r.error) || isRateLimitError(r.error.message)) {
            rateLimitedInBody = true;
            continue;
          }
          // Anything else — already known, nonce too low, underpriced — is a
          // transaction we deliberately give up on. The user never sees it; the
          // note already flew. Retrying a bad nonce just poisons the queue.
          stats.dropped += 1;
          continue;
        }
        stats.sent += 1;
      }

      if (rateLimitedInBody) {
        handleRateLimit(batch);
        return;
      }

      rotator.reportSuccess();
      batchWindow = BATCH_WINDOW_MS;
    } catch (err) {
      if (isRateLimitError(err)) {
        handleRateLimit(batch);
        return;
      }
      // network blip or timeout: one retry, then let it go
      requeue(batch);
      backoff(300);
    } finally {
      inFlight = false;
      if (queue.length > 0) schedule();
    }
  }

  async function sendViaRelay(batch: Pending[]): Promise<void> {
    const controller = new AbortController();
    const abort = setTimeout(() => controller.abort(), HTTP_TIMEOUT_MS);
    try {
      const res = await doFetch(relay as string, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ raws: batch.map((b) => b.raw) }),
        signal: controller.signal,
      });
      if (!res.ok) throw new Error(`relay ${res.status}`);
      stats.batches += 1;
      stats.sent += batch.length;
      stats.largestBatch = Math.max(stats.largestBatch, batch.length);
      batchWindow = BATCH_WINDOW_MS;
    } finally {
      clearTimeout(abort);
    }
  }

  function handleRateLimit(batch: Pending[]) {
    stats.rateLimited += 1;
    const rotated = rotator.reportRateLimit();
    if (rotated) stats.rotations = rotator.rotations();

    // Widen the window so each request carries more transactions. Fewer, fatter
    // requests is exactly what a rate limit is asking for.
    batchWindow = BATCH_WINDOW_MS_DEGRADED;
    requeue(batch);
    backoff(rotated ? 150 : 500);
  }

  function requeue(batch: Pending[]) {
    for (let i = batch.length - 1; i >= 0; i--) {
      const item = batch[i];
      item.attempts += 1;
      if (item.attempts > 2) {
        stats.dropped += 1;
        sender.onDrop?.(item.raw);
        continue;
      }
      // put back at the front — nonce order must be preserved
      queue.unshift(item);
    }
  }

  function backoff(ms: number) {
    backoffUntil = Date.now() + ms;
    schedule();
  }

  return sender;
}
