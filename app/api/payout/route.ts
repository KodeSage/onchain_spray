import { NextResponse } from "next/server";
import { createWalletClient, http, formatEther, type Address } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { monadTestnet, httpClientFor, HTTP_TIMEOUT_MS } from "@/lib/chain";
import { ENDPOINTS } from "@/lib/rpc";
import { assertContractConfigured, sprayPartyAbi } from "@/lib/contract";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Sweeps everything sprayed so far into the recipient's wallet.
 *
 * The stage calls this on a timer, so the money lands while the room is still
 * spraying rather than after everyone has gone home. The dancer needs no gas
 * and no wallet — they submitted an address and it fills up.
 *
 * `payout` on the contract is permissionless and can only ever pay the
 * recipient fixed at creation, so this route cannot redirect funds anywhere.
 * The only thing it spends is the server's gas.
 */

/** Don't sweep more often than this, whatever the caller asks for. */
const MIN_SWEEP_INTERVAL_MS = 8_000;

const lastSweep = new Map<number, number>();
let masterNonce = -1;
let chain: Promise<unknown> = Promise.resolve();

export async function POST(req: Request) {
  const key = process.env.FUNDING_PRIVATE_KEY;
  if (!key) {
    return NextResponse.json({ ok: false, error: "not_configured" }, { status: 503 });
  }

  let partyId: number;
  try {
    const body = (await req.json()) as { partyId?: number };
    partyId = Number(body.partyId);
  } catch {
    return NextResponse.json({ ok: false, error: "bad_request" }, { status: 400 });
  }

  if (!Number.isFinite(partyId) || partyId < 0) {
    return NextResponse.json({ ok: false, error: "bad_party" }, { status: 400 });
  }

  const now = Date.now();
  const last = lastSweep.get(partyId) ?? 0;
  if (now - last < MIN_SWEEP_INTERVAL_MS) {
    return NextResponse.json({ ok: true, skipped: "too_soon" });
  }

  let contract: Address;
  try {
    contract = assertContractConfigured();
  } catch {
    return NextResponse.json({ ok: false, error: "no_contract" }, { status: 503 });
  }

  const rpc = ENDPOINTS[0].http;
  const publicClient = httpClientFor(rpc);

  // Nothing to sweep is the common case between bursts — check first rather
  // than burning a transaction on a revert.
  let pending = 0n;
  let recipient: Address;
  try {
    const info = await publicClient.readContract({
      address: contract,
      abi: sprayPartyAbi,
      functionName: "partyInfo",
      args: [BigInt(partyId)],
    });
    recipient = info[1];
    pending = info[6];
  } catch {
    return NextResponse.json({ ok: false, error: "read_failed" }, { status: 502 });
  }

  if (pending === 0n) {
    lastSweep.set(partyId, now);
    return NextResponse.json({ ok: true, skipped: "nothing_pending", recipient });
  }

  lastSweep.set(partyId, now);

  const account = privateKeyToAccount(key as `0x${string}`);
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
      functionName: "payout",
      args: [BigInt(partyId)],
      // one cold struct slot, one value-bearing call to a cold account
      gas: 120_000n,
      nonce: assigned,
    });
  });

  chain = task.catch(() => undefined);

  try {
    const hash = await task;
    return NextResponse.json({
      ok: true,
      hash,
      recipient,
      amount: formatEther(pending),
    });
  } catch (err) {
    masterNonce = -1;
    console.error("[payout]", err instanceof Error ? err.message : "failed");
    return NextResponse.json({ ok: false, error: "payout_failed" }, { status: 502 });
  }
}
