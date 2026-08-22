import { NextResponse } from "next/server";
import { createWalletClient, http, parseEther, formatEther, isAddress, type Address } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { monadTestnet, httpClientFor, HTTP_TIMEOUT_MS } from "@/lib/chain";
import { ENDPOINTS } from "@/lib/rpc";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Drips testnet MON to a burner.
 *
 * The master key never reaches the client. faucet.monad.xyz drips small amounts
 * per day, so this wallet cannot be topped up on the morning of the event — it
 * has to be funded in advance. See README, "Funding maths".
 *
 * Funding is lazy and incremental rather than one big grant per person: of 130
 * people who scan the QR, only some tap hard, and a fixed up-front grant to all
 * of them wastes most of the budget on phones sitting in pockets. Clients ask
 * again when they run low, so MON follows actual tapping.
 */

const FUND_AMOUNT = parseEther(process.env.FUND_AMOUNT_MON ?? "0.35");
const TOTAL_CAP = parseEther(process.env.FUND_TOTAL_CAP_MON ?? "120");

/** A burner may be topped up this many times before we stop. */
const MAX_GRANTS_PER_ADDRESS = 6;
/** One IP is usually one phone; a few extra allows for shared NAT at a venue. */
const MAX_GRANTS_PER_IP = 25;
const MIN_INTERVAL_MS = 4_000;

type Grant = { count: number; last: number };

const byAddress = new Map<string, Grant>();
const byIp = new Map<string, Grant>();
let dispensed = 0n;

/** The master wallet has the same nonce-race problem as a burner: 130 phones
 *  asking for funds at once will collide. Same fix — one local counter, one
 *  promise chain, incremented before any await. */
let masterNonce = -1;
let masterChain: Promise<unknown> = Promise.resolve();

function clientIp(req: Request): string {
  const fwd = req.headers.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0].trim();
  return req.headers.get("x-real-ip") ?? "unknown";
}

function allow(map: Map<string, Grant>, key: string, max: number): boolean {
  const now = Date.now();
  const entry = map.get(key);
  if (!entry) {
    map.set(key, { count: 1, last: now });
    return true;
  }
  if (entry.count >= max) return false;
  if (now - entry.last < MIN_INTERVAL_MS) return false;
  entry.count += 1;
  entry.last = now;
  return true;
}

export async function POST(req: Request) {
  const key = process.env.FUNDING_PRIVATE_KEY;
  if (!key) {
    return NextResponse.json(
      { ok: false, error: "funding_not_configured" },
      { status: 503 }
    );
  }

  let address: string;
  try {
    const body = (await req.json()) as { address?: string };
    address = body.address ?? "";
  } catch {
    return NextResponse.json({ ok: false, error: "bad_request" }, { status: 400 });
  }

  if (!isAddress(address)) {
    return NextResponse.json({ ok: false, error: "bad_address" }, { status: 400 });
  }

  const to = address as Address;
  const ip = clientIp(req);

  if (dispensed + FUND_AMOUNT > TOTAL_CAP) {
    return NextResponse.json({ ok: false, error: "budget_exhausted" }, { status: 429 });
  }
  if (!allow(byAddress, to.toLowerCase(), MAX_GRANTS_PER_ADDRESS)) {
    return NextResponse.json({ ok: false, error: "address_limit" }, { status: 429 });
  }
  if (!allow(byIp, ip, MAX_GRANTS_PER_IP)) {
    return NextResponse.json({ ok: false, error: "ip_limit" }, { status: 429 });
  }

  const account = privateKeyToAccount(key as `0x${string}`);
  const rpc = ENDPOINTS[0].http;
  const wallet = createWalletClient({
    account,
    chain: monadTestnet,
    transport: http(rpc, { timeout: HTTP_TIMEOUT_MS }),
  });
  const publicClient = httpClientFor(rpc);

  // don't fund a burner that is already comfortable
  try {
    const existing = await publicClient.getBalance({ address: to });
    if (existing >= FUND_AMOUNT) {
      return NextResponse.json({
        ok: true,
        skipped: "already_funded",
        balance: existing.toString(),
      });
    }
  } catch {
    /* if we cannot read the balance, fund anyway — better than a dead phone */
  }

  const task = masterChain.then(async () => {
    if (masterNonce < 0) {
      masterNonce = await publicClient.getTransactionCount({
        address: account.address,
        blockTag: "pending",
      });
    }
    const assigned = masterNonce;
    masterNonce += 1;

    // A native MON transfer is always exactly 21,000 gas. Hardcoded, because on
    // Monad the sender pays for the limit and estimateGas is both a wasted round
    // trip and rate-limited harder than everything else.
    return wallet.sendTransaction({
      to,
      value: FUND_AMOUNT,
      gas: 21_000n,
      nonce: assigned,
    });
  });

  masterChain = task.catch(() => undefined);

  try {
    const hash = await task;
    dispensed += FUND_AMOUNT;
    return NextResponse.json({
      ok: true,
      hash,
      amount: formatEther(FUND_AMOUNT),
      remaining: formatEther(TOTAL_CAP - dispensed),
    });
  } catch (err) {
    // a failed send means our nonce counter is now ahead of chain; resync
    masterNonce = -1;
    const message = err instanceof Error ? err.message : "send_failed";
    console.error("[fund] send failed:", message);
    return NextResponse.json({ ok: false, error: "send_failed" }, { status: 502 });
  }
}

/** Lets the pre-flight checklist read the master wallet balance for real,
 *  rather than assuming it is funded. */
export async function GET() {
  const key = process.env.FUNDING_PRIVATE_KEY;
  if (!key) {
    return NextResponse.json({ ok: false, error: "funding_not_configured" }, { status: 503 });
  }
  const account = privateKeyToAccount(key as `0x${string}`);
  const publicClient = httpClientFor(ENDPOINTS[0].http);
  try {
    const balance = await publicClient.getBalance({ address: account.address });
    const perBurner = FUND_AMOUNT;
    return NextResponse.json({
      ok: true,
      master: account.address,
      balance: formatEther(balance),
      fundAmount: formatEther(perBurner),
      burnersCovered: Number(balance / perBurner),
      dispensedThisProcess: formatEther(dispensed),
      capRemaining: formatEther(TOTAL_CAP - dispensed),
    });
  } catch {
    return NextResponse.json({ ok: false, error: "rpc_unavailable" }, { status: 502 });
  }
}
