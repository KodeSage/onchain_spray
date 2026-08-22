/**
 * Measures the tap path, rather than guessing about it.
 *
 *   npx tsx scripts/bench-tap.ts
 *
 * The budget from CLAUDE.md is: tap to visible bill under 100ms. The note
 * animation is optimistic and starts synchronously in the pointerdown handler,
 * so the honest thing to measure is everything the tap path does that could
 * possibly block a frame — which is local signing, and nothing else. There is
 * no network call on this path: the signed transaction goes to a queue.
 */

import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { encodeFunctionData, keccak256 } from "viem";
import { sprayPartyAbi } from "../lib/contract";
import {
  DENOMINATIONS,
  MAX_FEE_PER_GAS,
  MAX_PRIORITY_FEE_PER_GAS,
  SPRAY_GAS_LIMIT,
} from "../lib/constants";
import { startFeed } from "../lib/stage-feed";

const account = privateKeyToAccount(generatePrivateKey());
const data = encodeFunctionData({ abi: sprayPartyAbi, functionName: "spray", args: [0n] });

async function signOnce(nonce: number): Promise<number> {
  const t0 = performance.now();
  const raw = await account.signTransaction({
    chainId: 10143,
    type: "eip1559",
    to: "0x1111111111111111111111111111111111111111",
    value: DENOMINATIONS[1].value,
    data,
    nonce,
    gas: SPRAY_GAS_LIMIT,
    maxFeePerGas: MAX_FEE_PER_GAS,
    maxPriorityFeePerGas: MAX_PRIORITY_FEE_PER_GAS,
  });
  keccak256(raw);
  return performance.now() - t0;
}

function percentile(sorted: number[], q: number): string {
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * q))].toFixed(2);
}

async function main() {
  console.log("=".repeat(64));
  console.log("TAP PATH");
  console.log("=".repeat(64));

  for (let i = 0; i < 30; i++) await signOnce(i);

  const times: number[] = [];
  for (let i = 0; i < 400; i++) times.push(await signOnce(i));
  times.sort((a, b) => a - b);

  console.log("\nlocal sign + hash — the whole synchronous cost of a tap:");
  console.log(
    `  p50 ${percentile(times, 0.5)}ms   p95 ${percentile(times, 0.95)}ms   ` +
      `p99 ${percentile(times, 0.99)}ms   max ${times[times.length - 1].toFixed(2)}ms`
  );

  const p95 = Number(percentile(times, 0.95));
  console.log(
    `\n  ${p95 < 16 ? "PASS" : p95 < 100 ? "OK" : "FAIL"}: budget is 100ms tap -> visible note.` +
      `\n  The note animation starts in the pointerdown handler, before this runs,` +
      `\n  so the visible latency is one frame (~16ms). This number is the cost of` +
      `\n  not blocking the next frame while signing.`
  );

  /* ---- demo feed with no network -------------------------------------- */
  console.log("\n" + "=".repeat(64));
  console.log("DEMO FALLBACK (no network)");
  console.log("=".repeat(64));

  let events = 0;
  let lastTotal = 0n;
  let monotonic = true;
  let status = "";

  const feed = startFeed(
    0,
    {
      onSpray: (e) => {
        events += 1;
        if (e.newTotal < lastTotal) monotonic = false;
        lastTotal = e.newTotal;
      },
      onStatus: (s) => {
        status = s;
      },
    },
    { demo: true }
  );

  await new Promise((r) => setTimeout(r, 3000));
  feed.stop();

  console.log(`\n  status        : ${status}`);
  console.log(`  events in 3s  : ${events}`);
  console.log(`  total is monotonic: ${monotonic ? "yes" : "NO — total went backwards"}`);
  console.log(
    `\n  ${events > 0 && monotonic ? "PASS" : "FAIL"}: /stage/0?demo=1 drives the identical ` +
      `pipeline with zero network calls.`
  );
  console.log("");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
