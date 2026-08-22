import { NextResponse } from "next/server";
import {
  createWalletClient,
  http,
  isAddress,
  stringToHex,
  decodeEventLog,
  type Address,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { monadTestnet, httpClientFor, HTTP_TIMEOUT_MS } from "@/lib/chain";
import { ENDPOINTS } from "@/lib/rpc";
import { assertContractConfigured, sprayPartyAbi } from "@/lib/contract";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Opens a party for whoever is about to be sprayed.
 *
 * The recipient types their own wallet address into the UI and gets a party
 * back — they never need a wallet extension, gas, or a signature. The server
 * pays for the one createParty transaction; from then on every naira sprayed at
 * that party is payable to the address they submitted and to nobody else, fixed
 * on chain at creation.
 */

const MAX_NAME_BYTES = 31;
const MIN_INTERVAL_MS = 3_000;
const MAX_PER_IP = 12;

type Grant = { count: number; last: number };
const byIp = new Map<string, Grant>();

/** Same nonce discipline as everywhere else: one counter, incremented before
 *  any await, so two concurrent creates cannot collide. */
let masterNonce = -1;
let chain: Promise<unknown> = Promise.resolve();

function clientIp(req: Request): string {
  const fwd = req.headers.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0].trim();
  return req.headers.get("x-real-ip") ?? "unknown";
}

export async function POST(req: Request) {
  const key = process.env.FUNDING_PRIVATE_KEY;
  if (!key) {
    return NextResponse.json(
      { ok: false, error: "not_configured" },
      { status: 503 }
    );
  }

  let recipientRaw: string;
  let name: string;
  try {
    const body = (await req.json()) as { recipient?: string; name?: string };
    recipientRaw = (body.recipient ?? "").trim();
    name = (body.name ?? "").trim();
  } catch {
    return NextResponse.json({ ok: false, error: "bad_request" }, { status: 400 });
  }

  if (!isAddress(recipientRaw)) {
    return NextResponse.json({ ok: false, error: "bad_address" }, { status: 400 });
  }
  if (new TextEncoder().encode(name).length > MAX_NAME_BYTES) {
    return NextResponse.json({ ok: false, error: "name_too_long" }, { status: 400 });
  }

  const ip = clientIp(req);
  const now = Date.now();
  const entry = byIp.get(ip);
  if (entry) {
    if (entry.count >= MAX_PER_IP || now - entry.last < MIN_INTERVAL_MS) {
      return NextResponse.json({ ok: false, error: "rate_limited" }, { status: 429 });
    }
    entry.count += 1;
    entry.last = now;
  } else {
    byIp.set(ip, { count: 1, last: now });
  }

  let contract: Address;
  try {
    contract = assertContractConfigured();
  } catch {
    return NextResponse.json({ ok: false, error: "no_contract" }, { status: 503 });
  }

  const account = privateKeyToAccount(key as `0x${string}`);
  const rpc = ENDPOINTS[0].http;
  const publicClient = httpClientFor(rpc);
  const wallet = createWalletClient({
    account,
    chain: monadTestnet,
    transport: http(rpc, { timeout: HTTP_TIMEOUT_MS }),
  });

  const task = chain.then(async () => {
    if (masterNonce < 0) {
      masterNonce = await publicClient.getTransactionCount({
        address: account.address,
        blockTag: "pending",
      });
    }
    const assigned = masterNonce;
    masterNonce += 1;

    return wallet.writeContract({
      address: contract,
      abi: sprayPartyAbi,
      functionName: "createParty",
      args: [
        stringToHex(name || "Owambe", { size: 32 }),
        recipientRaw as Address,
      ],
      // createParty is a fixed-shape write: 3 cold slots and one LOG4. Measured
      // at ~128k in the gas report; on Monad the caller pays the limit, so this
      // is tight rather than padded.
      gas: 220_000n,
      nonce: assigned,
    });
  });

  chain = task.catch(() => undefined);

  try {
    const hash = await task;
    const receipt = await publicClient.waitForTransactionReceipt({
      hash,
      timeout: 30_000,
    });

    let partyId: string | null = null;
    for (const log of receipt.logs) {
      try {
        const parsed = decodeEventLog({ abi: sprayPartyAbi, ...log });
        if (parsed.eventName === "PartyCreated") {
          partyId = (parsed.args as { partyId: bigint }).partyId.toString();
        }
      } catch {
        /* not our event */
      }
    }

    if (partyId === null) {
      return NextResponse.json({ ok: false, error: "no_event" }, { status: 502 });
    }

    return NextResponse.json({
      ok: true,
      partyId: Number(partyId),
      recipient: recipientRaw,
      name: name || "Owambe",
      hash,
    });
  } catch (err) {
    masterNonce = -1; // our counter may now be ahead of chain
    console.error(
      "[create-party]",
      err instanceof Error ? err.message : "failed"
    );
    return NextResponse.json({ ok: false, error: "create_failed" }, { status: 502 });
  }
}
