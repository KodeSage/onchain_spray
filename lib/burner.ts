"use client";

import { encodeFunctionData, keccak256, type Address, type Hash, type Hex } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import type { PrivateKeyAccount } from "viem/accounts";
import { monadTestnet, httpClientFor } from "./chain";
import { getEndpoint } from "./rpc";
import { assertContractConfigured, tapArenaAbi } from "./contract";
import { createSender, type Sender, type SendStats } from "./sender";
import {
  BURNER_STORAGE_KEY,
  FEE_REFRESH_INTERVAL_MS,
  MAX_FEE_PER_GAS,
  MAX_PRIORITY_FEE_PER_GAS,
  MAX_TAPS_PER_BATCH,
  TAP_BATCH_GAS_LIMIT,
  TAP_BATCH_GAS_LIMIT_FIRST,
  TAP_GAS_LIMIT,
  TAP_GAS_LIMIT_FIRST,
} from "./constants";

/**
 * The burner engine. This is why a tap feels instant.
 *
 * The tap path does zero network round trips:
 *   1. take a nonce from a local counter (synchronous)
 *   2. sign locally with the in-browser key (synchronous, no popup, ever)
 *   3. hand the raw transaction to the batching sender and return
 *
 * No estimateGas, no fee lookup, no nonce fetch, no confirmation awaited. The
 * only network contact is the batch flush, which happens on its own timer.
 */

let account: PrivateKeyAccount | null = null;
let sender: Sender | null = null;

/** Module-level nonce counter. Never fetched per transaction — see below. */
let nonce = 0;
let nonceReady = false;

/** Serializes nonce assignment so two calls can never read the same value. */
let chain: Promise<unknown> = Promise.resolve();

let fees = {
  maxFeePerGas: MAX_FEE_PER_GAS,
  maxPriorityFeePerGas: MAX_PRIORITY_FEE_PER_GAS,
};
let feeTimer: ReturnType<typeof setInterval> | null = null;

/**
 * Whether this burner's Player slot is already non-zero on chain, which decides
 * the gas tier. Read once at init, then maintained locally.
 */
let hasTapped = false;

let resyncCount = 0;

/* -------------------------------------------------------------------------
   1. Key generation
   ------------------------------------------------------------------------- */

function loadOrCreateKey(): Hex {
  if (typeof window === "undefined") {
    throw new Error("burner is browser-only");
  }
  const existing = window.localStorage.getItem(BURNER_STORAGE_KEY);
  if (existing && /^0x[0-9a-fA-F]{64}$/.test(existing)) {
    return existing as Hex;
  }
  const fresh = generatePrivateKey();
  window.localStorage.setItem(BURNER_STORAGE_KEY, fresh);
  return fresh;
}

export function getAddress(): Address | null {
  return account?.address ?? null;
}

/* -------------------------------------------------------------------------
   2. Nonce management
   -------------------------------------------------------------------------
   Fetching the nonce per transaction is fatal: at ten taps a second the
   requests race, and you get nonce collisions and "replacement transaction
   underpriced" errors in the middle of a run.

   Instead the nonce is fetched exactly once with blockTag 'pending', held in a
   module-level counter, and incremented synchronously BEFORE any async work
   begins. Every send is serialized through a promise chain so two calls can
   never observe the same counter value.
   ------------------------------------------------------------------------- */

async function syncNonce(): Promise<void> {
  if (!account) return;
  const client = httpClientFor(getEndpoint(account.address).http);
  nonce = await client.getTransactionCount({
    address: account.address,
    blockTag: "pending",
  });
  nonceReady = true;
}

/** Called only on a nonce-related failure. Logged, never surfaced to the user. */
async function resyncNonce(): Promise<void> {
  resyncCount += 1;
  try {
    await syncNonce();
  } catch {
    /* the next tap will try again; the animation is unaffected */
  }
}

/* -------------------------------------------------------------------------
   3. Fees — refreshed in the background, never in the tap path
   ------------------------------------------------------------------------- */

async function refreshFees(): Promise<void> {
  if (!account) return;
  try {
    const client = httpClientFor(getEndpoint(account.address).http);
    const base = await client.getGasPrice();
    // maxFeePerGas is only a cap on Monad — price_per_gas is
    // min(base + priority, max) — so headroom here is free. Unlike the gas
    // limit, which is charged in full.
    const withHeadroom = base * 2n;
    fees = {
      maxFeePerGas: withHeadroom > MAX_FEE_PER_GAS ? withHeadroom : MAX_FEE_PER_GAS,
      maxPriorityFeePerGas: MAX_PRIORITY_FEE_PER_GAS,
    };
  } catch {
    /* keep the last known good fees */
  }
}

/* -------------------------------------------------------------------------
   4. Init
   ------------------------------------------------------------------------- */

export type BurnerState = {
  address: Address;
  balance: bigint;
  /** Lifetime taps already recorded on chain for this burner. */
  totalTaps: number;
  /** Taps recorded for the current round. */
  roundTaps: number;
};

export async function initBurner(): Promise<BurnerState> {
  if (!account) {
    account = privateKeyToAccount(loadOrCreateKey());
  }
  if (!sender) {
    sender = createSender({ seed: account.address });
  }

  await syncNonce();

  if (!feeTimer) {
    void refreshFees();
    feeTimer = setInterval(() => void refreshFees(), FEE_REFRESH_INTERVAL_MS);
  }

  const client = httpClientFor(getEndpoint(account.address).http);
  let balance = 0n;
  let totalTaps = 0;
  let roundTaps = 0;

  try {
    balance = await client.getBalance({ address: account.address });
  } catch {
    /* non-fatal — the UI shows a funding state and retries */
  }

  // One read, at init, outside the tap path: is this burner's Player slot
  // already non-zero? That decides the gas tier for its very next tap, and
  // guessing wrong either wastes 30% of the balance or runs out of gas.
  try {
    const arena = assertContractConfigured();
    const [round, storedRoundTaps, storedTotal] = await client.readContract({
      address: arena,
      abi: tapArenaAbi,
      functionName: "players",
      args: [account.address],
    });
    const currentRound = await client.readContract({
      address: arena,
      abi: tapArenaAbi,
      functionName: "currentRound",
    });
    totalTaps = Number(storedTotal);
    roundTaps = round === currentRound ? Number(storedRoundTaps) : 0;
    hasTapped = totalTaps > 0;
  } catch {
    // Unconfigured contract or a dead RPC. Assume untapped: the expensive gas
    // tier wastes a little, the cheap tier would run out of gas and lose a tap.
    hasTapped = false;
  }

  return { address: account.address, balance, totalTaps, roundTaps };
}

export async function getBalance(): Promise<bigint> {
  if (!account) return 0n;
  try {
    const client = httpClientFor(getEndpoint(account.address).http);
    return await client.getBalance({ address: account.address });
  } catch {
    return 0n;
  }
}

/* -------------------------------------------------------------------------
   5. The API
   ------------------------------------------------------------------------- */

/**
 * Sign a tap locally and hand it to the batch sender.
 *
 * Returns the transaction hash immediately, computed from the signed payload —
 * no confirmation is awaited and no popup is ever shown. If this function ever
 * blocks on the network, the project has failed.
 */
export async function tap(): Promise<Hash> {
  return send(
    encodeFunctionData({ abi: tapArenaAbi, functionName: "tap" }),
    hasTapped ? TAP_GAS_LIMIT : TAP_GAS_LIMIT_FIRST
  );
}

/**
 * Credit several taps in one transaction.
 *
 * The cheap path, used when the day's gas budget is tight. tapBatch costs the
 * same as a single tap regardless of count, so this is a 1/n reduction in what
 * the house pays per tap with no change to the player's score.
 */
export async function tapBatch(count: number): Promise<Hash> {
  const clamped = Math.max(1, Math.min(MAX_TAPS_PER_BATCH, Math.floor(count)));
  return send(
    encodeFunctionData({
      abi: tapArenaAbi,
      functionName: "tapBatch",
      args: [clamped],
    }),
    hasTapped ? TAP_BATCH_GAS_LIMIT : TAP_BATCH_GAS_LIMIT_FIRST
  );
}

async function send(data: Hex, gas: bigint): Promise<Hash> {
  if (!account || !sender) throw new Error("burner not initialised");
  const to = assertContractConfigured();
  const acct = account;
  const snd = sender;

  if (!nonceReady) await syncNonce();

  // Serialize through the chain so nonce assignment is atomic with respect to
  // other in-flight taps.
  const task = chain.then(async () => {
    const assigned = nonce;
    nonce += 1; // synchronous increment, before any await

    try {
      const raw = await acct.signTransaction({
        chainId: monadTestnet.id,
        type: "eip1559",
        to,
        value: 0n,
        data,
        nonce: assigned,
        gas,
        maxFeePerGas: fees.maxFeePerGas,
        maxPriorityFeePerGas: fees.maxPriorityFeePerGas,
      });

      snd.enqueue(raw);
      hasTapped = true;

      // the hash of a signed transaction is just the hash of its payload, so we
      // can hand it back without ever asking the network
      return keccak256(raw);
    } catch (err) {
      if (isNonceError(err)) {
        void resyncNonce();
      }
      throw err;
    }
  });

  chain = task.catch(() => undefined);
  return task;
}

function isNonceError(err: unknown): boolean {
  const text = err instanceof Error ? err.message : String(err);
  return /nonce|replacement transaction underpriced|already known/i.test(text);
}

/* -------------------------------------------------------------------------
   Diagnostics — used by the load test and preflight, never shown in the arena
   ------------------------------------------------------------------------- */

export function senderStats(): SendStats | null {
  return sender?.stats() ?? null;
}

export function nonceDiagnostics() {
  return { nonce, nonceReady, resyncCount, hasTapped };
}

/** Force a flush on page hide, so a tab close does not drop queued taps. */
export async function flushPending(): Promise<void> {
  await sender?.flushNow();
}
