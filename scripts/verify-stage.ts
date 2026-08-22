/**
 * Proves the stage numbers survive a reload.
 *
 *   npx tsx scripts/verify-stage.ts            read-only
 *   npx tsx scripts/verify-stage.ts --spray    sprays 3x and sweeps (spends MON)
 *
 * The stage derives what the dancer has received as `total - pending` straight
 * from partyInfo, so it is chain truth on every page load rather than a running
 * sum in React state that resets when the browser reloads. This checks the
 * exact values it reads.
 */
import { createPublicClient, createWalletClient, http, formatEther, parseEther } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { readFileSync } from "node:fs";
import { monadTestnet } from "../lib/chain";
import { sprayPartyAbi } from "../lib/contract";

function env() {
  const out: Record<string,string> = {};
  for (const f of [".env", ".env.local"]) {
    try {
      for (const l of readFileSync(f, "utf8").split("\n")) {
        const m = l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
        if (m) out[m[1]] = m[2];
      }
    } catch {}
  }
  return out;
}

async function main() {
  const e = env();
  const addr = e.NEXT_PUBLIC_SPRAY_CONTRACT as `0x${string}`;
  const account = privateKeyToAccount(e.FUNDING_PRIVATE_KEY as `0x${string}`);
  const rpc = e.NEXT_PUBLIC_RPC_PRIMARY || "https://testnet-rpc.monad.xyz";
  const pc = createPublicClient({ chain: monadTestnet, transport: http(rpc, { timeout: 20000 }) });
  const wc = createWalletClient({ account, chain: monadTestnet, transport: http(rpc, { timeout: 20000 }) });

  const PARTY = BigInt(process.argv.find(a=>/^--party=/.test(a))?.split("=")[1] ?? "1");
  const doSpray = process.argv.includes("--spray");
  const read = async () => {
    const [, recipient, , , total, count, pending] = await pc.readContract({
      address: addr, abi: sprayPartyAbi, functionName: "partyInfo", args: [PARTY] });
    return { recipient, total, count, pending, received: total - pending };
  };

  const show = (label: string, s: Awaited<ReturnType<typeof read>>) => {
    console.log(`${label}`);
    console.log(`   total sprayed : ${formatEther(s.total)} MON   (${s.count} sprays)`);
    console.log(`   pending       : ${formatEther(s.pending)} MON`);
    console.log(`   RECEIVED      : ${formatEther(s.received)} MON   <- what the stage shows`);
  };

  show("BEFORE", await read());

  if (!doSpray) {
    console.log("\n(read-only; pass --spray to send real sprays)\n");
    return;
  }

  console.log("\nspraying 3x 0.0005 MON...");
  let nonce = await pc.getTransactionCount({ address: account.address, blockTag: "pending" });
  const hashes: `0x${string}`[] = [];
  for (let i = 0; i < 3; i++) {
    hashes.push(await wc.writeContract({
      address: addr, abi: sprayPartyAbi, functionName: "spray", args: [PARTY],
      value: parseEther("0.0005"), gas: 80000n, nonce: nonce++,
    }));
  }
  await pc.waitForTransactionReceipt({ hash: hashes[hashes.length-1], timeout: 60000 });
  const r = await pc.getTransactionReceipt({ hash: hashes[0] });
  console.log(`   gasUsed on a real spray: ${r.gasUsed}  (limit charged on Monad: 80000)`);

  show("\nAFTER SPRAYS (money still in contract)", await read());

  console.log("\ntriggering /api/payout ...");
  const res = await fetch("http://localhost:3000/api/payout", {
    method: "POST", headers: {"Content-Type":"application/json"},
    body: JSON.stringify({ partyId: Number(PARTY) }), signal: AbortSignal.timeout(60000) });
  console.log("   ->", res.status, (await res.text()).slice(0,140));
  await new Promise(r => setTimeout(r, 4000));

  const after = await read();
  show("\nAFTER PAYOUT", after);
  const bal = await pc.getBalance({ address: after.recipient });
  console.log(`\n   recipient ${after.recipient}`);
  console.log(`   wallet balance: ${formatEther(bal)} MON`);
  console.log(`\n   These are read from chain on every page load, so a reload shows them.`);
}
main().catch(e => { console.error(e.message ?? e); process.exit(1); });
