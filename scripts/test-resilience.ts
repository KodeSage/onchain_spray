/**
 * Resilience checks — the failure modes the venue will actually produce.
 *
 *   npx tsx scripts/test-resilience.ts
 *
 * Answers, with a forced fault rather than an assumption:
 *   1. does a client survive a hard 429 by rotating endpoints?
 *   2. is the send queue actually bounded under a wedged network?
 *   3. does the relay fall back to direct RPC when it is unreachable?
 */

import type { Hex } from "viem";
import { createSender } from "../lib/sender";
import { ENDPOINTS } from "../lib/rpc";
import { MAX_QUEUE_DEPTH } from "../lib/constants";

const RAW = ("0x" + "ab".repeat(110)) as Hex;
const results: { name: string; ok: boolean; detail: string }[] = [];

function check(name: string, ok: boolean, detail: string) {
  results.push({ name, ok, detail });
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/* ------------------------------------------------------------------ 1 */
async function test429Rotation() {
  const hits: string[] = [];
  let failing = true;

  // every request to the first endpoint 429s; everything else succeeds
  const fetchImpl = (async (url: string | URL, init?: RequestInit) => {
    const href = typeof url === "string" ? url : url.toString();
    const endpoint = ENDPOINTS.find((e) => href.startsWith(e.http));
    hits.push(endpoint?.id ?? "unknown");

    if (failing && endpoint?.id === hits[0]) {
      return new Response("rate limited", { status: 429 });
    }
    // a JSON-RPC batch returns one result per request item
    const body = JSON.parse(String(init?.body ?? "[]"));
    const items = Array.isArray(body) ? body : [body];
    return new Response(
      JSON.stringify(
        items.map((_, i) => ({ jsonrpc: "2.0", id: i, result: "0x" + "0".repeat(64) }))
      ),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  }) as unknown as typeof fetch;

  // relayUrl null: talk to the RPC pool directly, which is where rotation lives
  const sender = createSender({ seed: "0xrotation-test", fetchImpl, relayUrl: null });

  for (let i = 0; i < 30; i++) {
    sender.enqueue(RAW);
    await sleep(60);
  }
  // let it rotate, then give it room to actually drain the backlog, so
  // "transactions still land" is a claim about delivery and not about a queue
  // that simply had not been emptied yet when we looked
  await sleep(4000);

  const stats = sender.stats();
  sender.stop();

  const firstEndpoint = hits[0];
  const distinct = new Set(hits);
  const movedOff = hits.slice(-5).some((h) => h !== firstEndpoint);

  check(
    "429 -> rotates to another endpoint",
    stats.rotations > 0 && distinct.size > 1 && movedOff,
    `${stats.rateLimited} rate-limits, ${stats.rotations} rotations, ` +
      `endpoints touched: ${[...distinct].join(" -> ")}`
  );

  const delivered = stats.sent + stats.dropped;
  check(
    "429 -> transactions still land after rotating",
    stats.sent >= 10,
    `${stats.sent} sent, ${stats.dropped} dropped, ` +
      `${stats.queued - delivered} still queued of ${stats.queued}`
  );

  failing = false;
}

/* ------------------------------------------------------------------ 2 */
async function testQueueBounded() {
  // a network that never answers
  const fetchImpl = (async () => {
    await sleep(60_000);
    return new Response("{}", { status: 200 });
  }) as unknown as typeof fetch;

  const sender = createSender({ seed: "0xwedged-test", fetchImpl, relayUrl: null });

  for (let i = 0; i < MAX_QUEUE_DEPTH * 3; i++) sender.enqueue(RAW);
  await sleep(400);

  const stats = sender.stats();
  sender.stop();

  check(
    "wedged network -> queue stays bounded",
    stats.dropped > 0 && stats.queued === MAX_QUEUE_DEPTH * 3,
    `${stats.queued} enqueued, ${stats.dropped} evicted, cap ${MAX_QUEUE_DEPTH}`
  );
}

/* ------------------------------------------------------------------ 3 */
async function testRelayFallback() {
  let relayCalls = 0;
  let rpcCalls = 0;

  const fetchImpl = (async (url: string | URL, init?: RequestInit) => {
    const href = typeof url === "string" ? url : url.toString();
    if (href.includes("/api/relay")) {
      relayCalls += 1;
      throw new Error("relay unreachable");
    }
    rpcCalls += 1;
    const body = JSON.parse(String(init?.body ?? "[]"));
    const items = Array.isArray(body) ? body : [body];
    return new Response(
      JSON.stringify(
        items.map((_, i) => ({ jsonrpc: "2.0", id: i, result: "0x" + "0".repeat(64) }))
      ),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  }) as unknown as typeof fetch;

  const sender = createSender({
    seed: "0xfallback-test",
    fetchImpl,
    relayUrl: "http://localhost:3000/api/relay",
  });

  for (let i = 0; i < 12; i++) {
    sender.enqueue(RAW);
    await sleep(80);
  }
  await sleep(1500);

  const stats = sender.stats();
  sender.stop();

  check(
    "relay down -> falls back to direct RPC",
    relayCalls > 0 && rpcCalls > 0 && stats.sent > 0,
    `${relayCalls} relay attempts, ${rpcCalls} direct RPC calls, ${stats.sent} sent`
  );
}

async function main() {
  console.log("=".repeat(70));
  console.log("RESILIENCE");
  console.log("=".repeat(70));

  await test429Rotation();
  await testQueueBounded();
  await testRelayFallback();

  console.log("");
  for (const r of results) {
    console.log(`[${r.ok ? " OK " : "FAIL"}] ${r.name}`);
    console.log(`         ${r.detail}`);
  }

  const failed = results.filter((r) => !r.ok).length;
  console.log("\n" + "-".repeat(70));
  console.log(failed === 0 ? "all resilience checks pass" : `${failed} failed`);
  console.log("");
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
