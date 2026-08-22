/**
 * Spin up a party from the CLI in ten seconds, without touching a UI.
 *
 *   npx tsx scripts/create-party.ts "Blitz Abuja" 0xRecipient...
 *
 * The recipient is whoever is being sprayed — every naira at this party is
 * payable to them. Defaults to the host's own wallet if omitted.
 *
 * Reads PRIVATE_KEY and NEXT_PUBLIC_SPRAY_CONTRACT from .env / .env.local.
 */

import { readFileSync, existsSync } from "node:fs";
import {
  createPublicClient,
  createWalletClient,
  http,
  stringToHex,
  decodeEventLog,
  isAddress,
  type Address,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { monadTestnet } from "../lib/chain";
import { sprayPartyAbi } from "../lib/contract";

function loadEnv() {
  for (const file of [".env", ".env.local"]) {
    if (!existsSync(file)) continue;
    for (const line of readFileSync(file, "utf8").split("\n")) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
    }
  }
}

async function main() {
  loadEnv();

  const name = process.argv[2] ?? "Monad Blitz Abuja";
  // who gets sprayed. Defaults to the host's own wallet if not given.
  const recipientArg = process.argv[3];
  const key = process.env.PRIVATE_KEY;
  const contract = process.env.NEXT_PUBLIC_SPRAY_CONTRACT as Address | undefined;

  if (!key) throw new Error("PRIVATE_KEY not set (put it in .env)");
  if (!contract) throw new Error("NEXT_PUBLIC_SPRAY_CONTRACT not set — deploy first");
  if (name.length > 31) throw new Error("party name must fit in bytes32 (31 chars)");

  const account = privateKeyToAccount(key as `0x${string}`);
  const recipient = (recipientArg ?? account.address) as Address;
  if (!isAddress(recipient)) {
    throw new Error(`not a wallet address: ${recipient}`);
  }
  const rpc = process.env.MONAD_RPC_URL ?? "https://testnet-rpc.monad.xyz";

  const publicClient = createPublicClient({ chain: monadTestnet, transport: http(rpc) });
  const wallet = createWalletClient({ account, chain: monadTestnet, transport: http(rpc) });

  const balance = await publicClient.getBalance({ address: account.address });
  console.log(`host     : ${account.address}`);
  console.log(`recipient: ${recipient}`);
  console.log(`balance  : ${Number(balance) / 1e18} MON`);
  if (balance === 0n) throw new Error("host wallet is empty — fund it at faucet.monad.xyz");

  const hash = await wallet.writeContract({
    address: contract,
    abi: sprayPartyAbi,
    functionName: "createParty",
    args: [stringToHex(name, { size: 32 }), recipient],
  });
  console.log(`tx       : ${hash}`);

  const receipt = await publicClient.waitForTransactionReceipt({ hash, timeout: 30_000 });

  let partyId: bigint | null = null;
  for (const log of receipt.logs) {
    try {
      const parsed = decodeEventLog({ abi: sprayPartyAbi, ...log });
      if (parsed.eventName === "PartyCreated") {
        partyId = (parsed.args as { partyId: bigint }).partyId;
      }
    } catch {
      /* not our event */
    }
  }

  console.log("");
  console.log(`party    : "${name}"`);
  console.log(`paying   : ${recipient}`);
  console.log(`partyId  : ${partyId ?? "?"}`);
  console.log(`sprayers : /spray/${partyId ?? 0}`);
  console.log(`stage    : /stage/${partyId ?? 0}`);
  console.log(`explorer : ${monadTestnet.blockExplorers.default.url}/tx/${hash}`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
