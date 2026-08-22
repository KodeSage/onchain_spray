/**
 * Rate-limit simulation.
 *
 * Answers one question before we build a UI on top of this: does 130 people
 * tapping twice a second fit inside the pool's published limits?
 *
 * Two modes:
 *   npx tsx scripts/rate-check.ts          simulated, no network
 *   npx tsx scripts/rate-check.ts --live   also probes the real endpoints
 */

import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { ENDPOINTS, getEndpoint } from "../lib/rpc";
import { createSender } from "../lib/sender";
import { MAX_BATCH_SIZE } from "../lib/constants";

const CLIENTS = 130;
const TAPS_PER_SEC = 2;
const DURATION_SEC = 20;

type Counter = { requests: number; transactions: number; largestBatch: number };

const RELAY = "http://relay.local/api/relay";

/** Mirrors app/api/relay/route.ts: aggregate across clients, flush every
 *  BATCH_WINDOW_MS, up to MAX_BATCH_SIZE, round-robin across the pool. */
function makeRelaySim(counters: Map<string, Counter>) {
  const q: string[] = [];
  let cursor = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;
  const batchable = ENDPOINTS.filter((e) => e.batchLimit > 1);

  function flush() {
    timer = null;
    while (q.length > 0) {
      const batch = q.splice(0, MAX_BATCH_SIZE);
      const e = batchable[cursor % batchable.length];
      cursor += 1;
      const c = counters.get(e.id)!;
      c.requests += 1;
      c.transactions += batch.length;
      c.largestBatch = Math.max(c.largestBatch, batch.length);
    }
  }

  return {
    accept(raws: string[]) {
      q.push(...raws);
      if (!timer) timer = setTimeout(flush, 150);
    },
    stop() {
      if (timer) clearTimeout(timer);
      flush();
    },
  };
}

async function main() {
  const live = process.argv.includes("--live");

  console.log("=".repeat(74));
  console.log(`RATE CHECK — ${CLIENTS} clients x ${TAPS_PER_SEC} taps/sec x ${DURATION_SEC}s`);
  console.log("=".repeat(74));

  // ---- endpoint assignment ------------------------------------------------
  const addresses = Array.from({ length: CLIENTS }, () =>
    privateKeyToAccount(generatePrivateKey()).address
  );

  const assignment = new Map<string, number>();
  for (const addr of addresses) {
    const e = getEndpoint(addr);
    assignment.set(e.id, (assignment.get(e.id) ?? 0) + 1);
  }

  console.log("\nCLIENT ASSIGNMENT (deterministic, weighted by published rps)");
  for (const e of ENDPOINTS) {
    const n = assignment.get(e.id) ?? 0;
    if (n === 0 && e.id !== "dedicated") {
      console.log(`  ${e.label.padEnd(34)} ${String(n).padStart(4)} clients  (failover only)`);
      continue;
    }
    const pct = ((n / CLIENTS) * 100).toFixed(1);
    console.log(`  ${e.label.padEnd(34)} ${String(n).padStart(4)} clients  ${pct.padStart(5)}%`);
  }

  // ---- simulated batching -------------------------------------------------
  const counters = new Map<string, Counter>();
  for (const e of ENDPOINTS) {
    counters.set(e.id, { requests: 0, transactions: 0, largestBatch: 0 });
  }

  const relaySim = makeRelaySim(counters);

  // a fetch that counts instead of calling out
  const fakeFetch = (async (url: string | URL | Request, init?: RequestInit) => {
    const href = typeof url === "string" ? url : url.toString();

    if (href.startsWith(RELAY)) {
      const body = JSON.parse(String(init?.body ?? "{}")) as { raws?: string[] };
      relaySim.accept(body.raws ?? []);
      return new Response(JSON.stringify({ ok: true }), { status: 202 });
    }

    const endpoint = ENDPOINTS.find((e) => href.startsWith(e.http));
    const body = JSON.parse(String(init?.body ?? "[]"));
    const items = Array.isArray(body) ? body : [body];
    if (endpoint) {
      const c = counters.get(endpoint.id)!;
      c.requests += 1;
      c.transactions += items.length;
      c.largestBatch = Math.max(c.largestBatch, items.length);
    }
    return new Response(
      JSON.stringify(items.map((_, i) => ({ jsonrpc: "2.0", id: i, result: "0x" + "0".repeat(64) }))),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  }) as unknown as typeof fetch;

  const mode = process.argv.includes("--direct") ? "direct" : "relay";
  const senders = addresses.map((addr) =>
    createSender({
      seed: addr,
      fetchImpl: fakeFetch,
      relayUrl: mode === "relay" ? RELAY : null,
    })
  );
  console.log(`\nMODE: ${mode === "relay" ? "cross-client relay (/api/relay)" : "direct to RPC (--direct)"}`);

  const raw = ("0x" + "ab".repeat(110)) as `0x${string}`;
  const start = Date.now();

  await new Promise<void>((resolve) => {
    let ticks = 0;
    const totalTicks = DURATION_SEC * TAPS_PER_SEC;
    const interval = setInterval(() => {
      for (const s of senders) s.enqueue(raw);
      ticks += 1;
      if (ticks >= totalTicks) {
        clearInterval(interval);
        resolve();
      }
    }, 1000 / TAPS_PER_SEC);
  });

  // let the final batches drain
  await new Promise((r) => setTimeout(r, 1200));
  for (const s of senders) s.stop();
  relaySim.stop();

  const elapsed = (Date.now() - start) / 1000;
  const expectedTx = CLIENTS * TAPS_PER_SEC * DURATION_SEC;

  console.log(`\nRESULT after ${elapsed.toFixed(1)}s`);
  console.log(
    "  endpoint".padEnd(36) +
      "req/s".padStart(9) +
      "limit".padStart(8) +
      "tx/s".padStart(9) +
      "max batch".padStart(11) +
      "  verdict"
  );

  let totalRequests = 0;
  let totalTx = 0;
  let anyOver = false;

  for (const e of ENDPOINTS) {
    const c = counters.get(e.id)!;
    if (c.requests === 0) continue;
    const rps = c.requests / elapsed;
    const txps = c.transactions / elapsed;
    totalRequests += c.requests;
    totalTx += c.transactions;
    const over = rps > e.rps;
    if (over) anyOver = true;
    console.log(
      `  ${e.label}`.padEnd(36) +
        rps.toFixed(1).padStart(9) +
        String(e.rps).padStart(8) +
        txps.toFixed(1).padStart(9) +
        String(c.largestBatch).padStart(11) +
        (over ? "  OVER LIMIT" : "  ok")
    );
  }

  const naiveRps = expectedTx / elapsed;
  console.log(
    `\n  transactions carried : ${totalTx} / ${expectedTx} expected`
  );
  console.log(`  requests used        : ${totalRequests}`);
  console.log(
    `  compression          : ${(totalTx / Math.max(totalRequests, 1)).toFixed(1)}x ` +
      `(${naiveRps.toFixed(0)} req/s naive -> ${(totalRequests / elapsed).toFixed(1)} req/s batched)`
  );
  console.log(`  batch ceiling        : ${MAX_BATCH_SIZE}`);
  console.log(
    `\n  VERDICT: ${anyOver ? "AT LEAST ONE ENDPOINT OVER ITS PUBLISHED LIMIT" : "every endpoint within its published limit"}`
  );

  // ---- live probe ---------------------------------------------------------
  if (live) {
    console.log("\n" + "=".repeat(74));
    console.log("LIVE PROBE — real requests, read-only (eth_blockNumber)");
    console.log("=".repeat(74));

    for (const e of ENDPOINTS) {
      const target = Math.min(Math.ceil(e.rps * 1.2), 60);
      let ok = 0;
      let rateLimited = 0;
      let failed = 0;
      const t0 = Date.now();

      await Promise.all(
        Array.from({ length: target }, async () => {
          try {
            const res = await fetch(e.http, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                jsonrpc: "2.0",
                id: 1,
                method: "eth_blockNumber",
                params: [],
              }),
              signal: AbortSignal.timeout(8000),
            });
            if (res.status === 429) rateLimited += 1;
            else if (res.ok) ok += 1;
            else failed += 1;
          } catch {
            failed += 1;
          }
        })
      );

      const dt = (Date.now() - t0) / 1000;
      console.log(
        `  ${e.label.padEnd(30)} ${target} reqs in ${dt.toFixed(2)}s -> ` +
          `${ok} ok, ${rateLimited} rate-limited, ${failed} failed`
      );
    }
  }

  console.log("");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
