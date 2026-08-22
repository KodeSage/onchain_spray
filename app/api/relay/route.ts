import { NextResponse } from "next/server";
import type { Hex } from "viem";
import { ENDPOINTS } from "@/lib/rpc";
import { BATCH_WINDOW_MS, MAX_BATCH_SIZE } from "@/lib/constants";
import { HTTP_TIMEOUT_MS } from "@/lib/chain";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Transaction relay — the thing that actually makes the rate limits fit.
 *
 * The original plan was to batch taps inside each client. Measured, that gives
 * 1.0x compression and does nothing, because one person tapping twice a second
 * accumulates 0.3 transactions per 150ms window. To fill a batch of ten inside
 * one client you would have to tap 67 times a second.
 *
 * Batching has to happen ACROSS clients. 130 phones at 2 taps/sec is 260
 * transactions a second arriving here; flushed every 150ms that is ~39
 * transactions per JSON-RPC request, or ~6.7 requests/sec against a 50 rps
 * limit. Compression ~39x, headroom 7.5x.
 *
 * Clients still sign locally — this relay only forwards opaque signed payloads
 * and cannot alter, reorder within a sender, or forge them. It never sees a key.
 */

type Queued = { raw: Hex; attempts: number };

const queue: Queued[] = [];
let timer: ReturnType<typeof setTimeout> | null = null;
let inFlight = false;
let cursor = 0;

/** Bounded: a wedged upstream must not grow this without limit. */
const MAX_RELAY_QUEUE = 5_000;

const stats = {
  accepted: 0,
  forwarded: 0,
  dropped: 0,
  batches: 0,
  largestBatch: 0,
  rateLimited: 0,
  byEndpoint: {} as Record<string, number>,
  startedAt: Date.now(),
};

/** Round-robin across endpoints that allow batching. Spreads the relay's own
 *  load so one endpoint's limit is never the ceiling. */
function nextEndpoint() {
  const batchable = ENDPOINTS.filter((e) => e.batchLimit > 1);
  const pool = batchable.length > 0 ? batchable : ENDPOINTS;
  const e = pool[cursor % pool.length];
  cursor += 1;
  return e;
}

function schedule() {
  if (timer) return;
  timer = setTimeout(() => {
    timer = null;
    void flush();
  }, BATCH_WINDOW_MS);
}

async function flush(): Promise<void> {
  if (inFlight || queue.length === 0) return;
  inFlight = true;

  const endpoint = nextEndpoint();
  const batch = queue.splice(0, Math.min(queue.length, MAX_BATCH_SIZE));

  try {
    const body = batch.map((item, i) => ({
      jsonrpc: "2.0",
      id: i,
      method: "eth_sendRawTransaction",
      params: [item.raw],
    }));

    const res = await fetch(endpoint.http, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
    });

    stats.batches += 1;
    stats.largestBatch = Math.max(stats.largestBatch, batch.length);
    stats.byEndpoint[endpoint.id] = (stats.byEndpoint[endpoint.id] ?? 0) + 1;

    if (res.status === 429) {
      stats.rateLimited += 1;
      requeue(batch);
      return;
    }
    if (!res.ok) {
      requeue(batch);
      return;
    }

    const json: unknown = await res.json();
    const results = Array.isArray(json) ? json : [json];
    for (const entry of results) {
      const r = entry as { error?: unknown };
      if (r.error) stats.dropped += 1;
      else stats.forwarded += 1;
    }
  } catch {
    requeue(batch);
  } finally {
    inFlight = false;
    if (queue.length > 0) schedule();
  }
}

function requeue(batch: Queued[]) {
  for (let i = batch.length - 1; i >= 0; i--) {
    const item = batch[i];
    item.attempts += 1;
    if (item.attempts > 2) {
      stats.dropped += 1;
      continue;
    }
    queue.unshift(item);
  }
  schedule();
}

const HEX_TX = /^0x[0-9a-fA-F]{64,}$/;

export async function POST(req: Request) {
  let raws: string[];
  try {
    const body = (await req.json()) as { raw?: string; raws?: string[] };
    raws = body.raws ?? (body.raw ? [body.raw] : []);
  } catch {
    return NextResponse.json({ ok: false, error: "bad_request" }, { status: 400 });
  }

  if (raws.length === 0 || raws.length > MAX_BATCH_SIZE) {
    return NextResponse.json({ ok: false, error: "bad_payload" }, { status: 400 });
  }

  let accepted = 0;
  for (const raw of raws) {
    if (!HEX_TX.test(raw)) continue;
    if (queue.length >= MAX_RELAY_QUEUE) {
      stats.dropped += 1;
      continue;
    }
    queue.push({ raw: raw as Hex, attempts: 0 });
    accepted += 1;
  }

  stats.accepted += accepted;
  if (accepted > 0) schedule();

  // Return immediately. The client is not waiting on this — the note already
  // flew. Making it await the upstream RPC would put the venue's round trip
  // back in the tap path.
  return NextResponse.json({ ok: true, accepted }, { status: 202 });
}

/** Diagnostics for the pre-demo checklist and the load test. */
export async function GET() {
  const uptime = (Date.now() - stats.startedAt) / 1000;
  return NextResponse.json({
    ok: true,
    uptimeSec: Number(uptime.toFixed(1)),
    queueDepth: queue.length,
    ...stats,
    requestsPerSec: Number((stats.batches / Math.max(uptime, 1)).toFixed(2)),
    txPerSec: Number((stats.forwarded / Math.max(uptime, 1)).toFixed(2)),
    compression: stats.batches > 0
      ? Number((stats.forwarded / stats.batches).toFixed(1))
      : 0,
  });
}
