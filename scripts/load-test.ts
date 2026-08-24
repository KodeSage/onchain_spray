/**
 * Load test — find the breaking point before the room does.
 *
 *   npx tsx scripts/load-test.ts                 130 clients, 2 taps/s, 60s
 *   npx tsx scripts/load-test.ts --clients 40 --duration 20
 *   npx tsx scripts/load-test.ts --dry           sign only, send nothing
 *
 * Reports: transactions landed, dropped, 429s per endpoint, and p50/p95
 * tap-to-confirm latency.
 *
 * Requires a funded house wallet (HOUSE_PRIVATE_KEY) — it funds M burners,
 * fires N taps from each, then watches for the receipts. In --dry mode it
 * signs everything locally and reports throughput without spending anything,
 * which still exercises the nonce path and the batching maths.
 */

import { readFileSync, existsSync } from "node:fs";
import {
  createPublicClient,
  createWalletClient,
  encodeFunctionData,
  http,
  keccak256,
  parseEther,
  type Address,
  type Hex,
} from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { monadTestnet } from "../lib/chain";
import { tapArenaAbi } from "../lib/contract";
import { ENDPOINTS } from "../lib/rpc";
import { envOr } from "../lib/env";
import {
  MAX_BATCH_SIZE,
  MAX_FEE_PER_GAS,
  MAX_PRIORITY_FEE_PER_GAS,
  TAP_GAS_LIMIT,
  TAP_GAS_LIMIT_FIRST,
  BATCH_WINDOW_MS,
} from "../lib/constants";

function loadEnv() {
  for (const file of [".env", ".env.local"]) {
    if (!existsSync(file)) continue;
    for (const line of readFileSync(file, "utf8").split("\n")) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
    }
  }
}

function arg(name: string, fallback: number): number {
  const i = process.argv.indexOf(`--${name}`);
  if (i === -1) return fallback;
  const v = Number(process.argv[i + 1]);
  return Number.isFinite(v) ? v : fallback;
}

const CLIENTS = arg("clients", 130);
const TAPS_PER_SEC = arg("taps", 2);
const DURATION = arg("duration", 60);
const DRY = process.argv.includes("--dry");

type Sent = { hash: Hex; at: number };

const rateLimitByEndpoint = new Map<string, number>();
for (const e of ENDPOINTS) rateLimitByEndpoint.set(e.id, 0);

async function main() {
  loadEnv();

  const contract = process.env.NEXT_PUBLIC_ARENA_CONTRACT as Address | undefined;
  if (!contract) {
    console.error("NEXT_PUBLIC_ARENA_CONTRACT not set — deploy the contract first.");
    console.error("Run with --dry to exercise signing and batching without a contract.");
    if (!DRY) process.exit(1);
  }

  console.log("=".repeat(74));
  console.log(
    `LOAD TEST — ${CLIENTS} clients x ${TAPS_PER_SEC} taps/sec x ${DURATION}s` +
      (DRY ? "  [DRY: signing only]" : "")
  );
  console.log("=".repeat(74));

  const rpc = process.env.NEXT_PUBLIC_RPC_PRIMARY || ENDPOINTS[0].http;
  const publicClient = createPublicClient({
    chain: monadTestnet,
    transport: http(rpc, { timeout: 15_000 }),
  });

  /* ---- burners --------------------------------------------------------- */
  const burners = Array.from({ length: CLIENTS }, () =>
    privateKeyToAccount(generatePrivateKey())
  );
  const nonces = new Map<Address, number>();
  for (const b of burners) nonces.set(b.address, 0);

  /* ---- funding --------------------------------------------------------- */
  if (!DRY) {
    const masterKey = process.env.HOUSE_PRIVATE_KEY;
    if (!masterKey) {
      console.error("\nHOUSE_PRIVATE_KEY not set — cannot fund burners.");
      console.error("Either set it, or run with --dry.");
      process.exit(1);
    }
    const master = privateKeyToAccount(masterKey as `0x${string}`);
    const wallet = createWalletClient({
      account: master,
      chain: monadTestnet,
      transport: http(rpc, { timeout: 20_000 }),
    });

    const perBurner = parseEther(envOr("FUND_AMOUNT_MON", "0.35"));
    const needed = perBurner * BigInt(CLIENTS);
    const balance = await publicClient.getBalance({ address: master.address });

    console.log(`\nmaster   : ${master.address}`);
    console.log(`balance  : ${Number(balance) / 1e18} MON`);
    console.log(`needed   : ${Number(needed) / 1e18} MON for ${CLIENTS} burners`);

    if (balance < needed) {
      console.error(
        `\nINSUFFICIENT: short by ${Number(needed - balance) / 1e18} MON. ` +
          `Fund the master wallet or lower --clients.`
      );
      process.exit(1);
    }

    console.log(`\nfunding ${CLIENTS} burners...`);
    let masterNonce = await publicClient.getTransactionCount({
      address: master.address,
      blockTag: "pending",
    });
    const fundHashes: Hex[] = [];
    for (const b of burners) {
      fundHashes.push(
        await wallet.sendTransaction({
          to: b.address,
          value: perBurner,
          gas: 21_000n,
          nonce: masterNonce++,
        })
      );
    }
    await publicClient.waitForTransactionReceipt({
      hash: fundHashes[fundHashes.length - 1],
      timeout: 90_000,
    });
    console.log("funded.");
  }

  /* ---- the run --------------------------------------------------------- */
  const data = encodeFunctionData({
    abi: tapArenaAbi,
    functionName: "tap",
  });

  const sent: Sent[] = [];
  let signed = 0;
  let sendErrors = 0;
  const queue: { raw: Hex; hash: Hex; at: number }[] = [];

  const start = Date.now();
  const endAt = start + DURATION * 1000;

  // one flusher, batching across all clients — mirrors app/api/relay
  let cursor = 0;
  const batchable = ENDPOINTS.filter((e) => e.batchLimit > 1);

  const flusher = setInterval(() => {
    void (async () => {
      if (queue.length === 0) return;
      const batch = queue.splice(0, Math.min(queue.length, MAX_BATCH_SIZE));
      const endpoint = batchable[cursor++ % batchable.length];

      if (DRY) {
        for (const item of batch) sent.push({ hash: item.hash, at: item.at });
        return;
      }

      try {
        const res = await fetch(endpoint.http, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(
            batch.map((item, i) => ({
              jsonrpc: "2.0",
              id: i,
              method: "eth_sendRawTransaction",
              params: [item.raw],
            }))
          ),
          signal: AbortSignal.timeout(15_000),
        });

        if (res.status === 429) {
          rateLimitByEndpoint.set(endpoint.id, (rateLimitByEndpoint.get(endpoint.id) ?? 0) + 1);
          sendErrors += batch.length;
          return;
        }

        const json = (await res.json()) as { error?: unknown }[];
        const results = Array.isArray(json) ? json : [json];
        results.forEach((r, i) => {
          if (r.error) sendErrors += 1;
          else sent.push({ hash: batch[i].hash, at: batch[i].at });
        });
      } catch {
        sendErrors += batch.length;
      }
    })();
  }, BATCH_WINDOW_MS);

  const tapper = setInterval(() => {
    void (async () => {
      if (Date.now() > endAt) return;
      await Promise.all(
        burners.map(async (b) => {
          const n = nonces.get(b.address)!;
          nonces.set(b.address, n + 1);
          try {
            const raw = await b.signTransaction({
              chainId: monadTestnet.id,
              type: "eip1559",
              to: (contract ?? "0x0000000000000000000000000000000000000000") as Address,
              // a tap carries no value; it is a faucet, not a payment
              value: 0n,
              data,
              nonce: n,
              gas: n === 0 ? TAP_GAS_LIMIT_FIRST : TAP_GAS_LIMIT,
              maxFeePerGas: MAX_FEE_PER_GAS,
              maxPriorityFeePerGas: MAX_PRIORITY_FEE_PER_GAS,
            });
            signed += 1;
            queue.push({ raw, hash: keccak256(raw), at: Date.now() });
          } catch {
            sendErrors += 1;
          }
        })
      );
    })();
  }, 1000 / TAPS_PER_SEC);

  await new Promise((r) => setTimeout(r, DURATION * 1000));
  clearInterval(tapper);
  console.log("\ntapping stopped, draining queue...");
  await new Promise((r) => setTimeout(r, 3000));
  clearInterval(flusher);

  /* ---- confirmations --------------------------------------------------- */
  const latencies: number[] = [];
  let landed = 0;

  if (!DRY && sent.length > 0) {
    console.log(`checking receipts for ${sent.length} transactions...`);
    const sample = sent.length > 400 ? everyNth(sent, Math.ceil(sent.length / 400)) : sent;

    await Promise.all(
      sample.map(async (s) => {
        try {
          const receipt = await publicClient.waitForTransactionReceipt({
            hash: s.hash,
            timeout: 30_000,
          });
          if (receipt.status === "success") {
            landed += 1;
            latencies.push(Date.now() - s.at);
          }
        } catch {
          /* never confirmed within the window */
        }
      })
    );
    // scale the sampled landing rate back up
    if (sample.length < sent.length) {
      landed = Math.round((landed / sample.length) * sent.length);
    }
  }

  /* ---- report ---------------------------------------------------------- */
  const elapsed = (Date.now() - start) / 1000;
  const expected = CLIENTS * TAPS_PER_SEC * DURATION;

  latencies.sort((a, b) => a - b);
  const pct = (p: number) =>
    latencies.length === 0 ? 0 : latencies[Math.min(latencies.length - 1, Math.floor(latencies.length * p))];

  console.log("\n" + "=".repeat(74));
  console.log("RESULT");
  console.log("=".repeat(74));
  console.log(`  duration            : ${elapsed.toFixed(1)}s`);
  console.log(`  expected taps       : ${expected}`);
  console.log(`  signed locally      : ${signed}`);
  console.log(`  accepted by RPC     : ${sent.length}`);
  console.log(`  send errors/dropped : ${sendErrors}`);
  if (!DRY) {
    console.log(`  landed on chain     : ${landed}`);
    console.log(`  p50 tap->confirm    : ${pct(0.5)}ms`);
    console.log(`  p95 tap->confirm    : ${pct(0.95)}ms`);
  }
  console.log(`  throughput          : ${(sent.length / elapsed).toFixed(1)} tx/sec`);

  console.log(`\n  429s per endpoint:`);
  for (const e of ENDPOINTS) {
    const n = rateLimitByEndpoint.get(e.id) ?? 0;
    console.log(`    ${e.label.padEnd(32)} ${n}`);
  }

  // The real drop metric is signed-but-not-accepted. Comparing against the
  // nominal `expected` conflates two different things: taps the RPC refused,
  // and taps the generator never produced because the event loop was busy.
  // Both matter, but only the first one is the network failing.
  const dropRate = signed > 0 ? (signed - sent.length) / signed : 0;
  const genRate = expected > 0 ? signed / expected : 0;

  console.log(
    `\n  VERDICT: ${
      dropRate <= 0.01
        ? `network holds — ${(dropRate * 100).toFixed(2)}% of signed taps dropped`
        : `NETWORK DROPPING ${(dropRate * 100).toFixed(1)}% of signed taps`
    }`
  );
  if (genRate < 0.95) {
    console.log(
      `  NOTE: the generator produced only ${(genRate * 100).toFixed(0)}% of the ` +
        `nominal ${expected} taps (${signed}). That is this script's own event ` +
        `loop, not the chain — real load comes from ${CLIENTS} separate phones.`
    );
  }
  console.log("");
}

function everyNth<T>(arr: T[], n: number): T[] {
  return arr.filter((_, i) => i % n === 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
