"use client";

import {
  createWalletClient,
  encodeFunctionData,
  http,
  keccak256,
  type Address,
  type Hash,
  type Hex,
} from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import type { PrivateKeyAccount } from "viem/accounts";
import { monadTestnet, httpClientFor, HTTP_TIMEOUT_MS } from "./chain";
import { getEndpoint } from "./rpc";
import { assertContractConfigured, sprayPartyAbi } from "./contract";
import { createSender, type Sender, type SendStats } from "./sender";
import {
  BURNER_STORAGE_KEY,
  FEE_REFRESH_INTERVAL_MS,
  MAX_FEE_PER_GAS,
  MAX_PRIORITY_FEE_PER_GAS,
  SPRAY_GAS_LIMIT,
  SPRAY_GAS_LIMIT_FIRST,
} from "./constants";

/**
 * The burner engine. This is why a spray feels instant.
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

/** Parties this burner has already sprayed, so we know which gas tier to use. */
const sprayedParties = new Set<number>();

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
   3. Nonce management
   -------------------------------------------------------------------------
   Fetching the nonce per transaction is fatal: at ten taps a second the
   requests race, and you get nonce collisions and "replacement transaction
   underpriced" errors in the middle of the demo.

   Instead the nonce is fetched exactly once with blockTag 'pending', held in a
   module-level counter, and incremented synchronously BEFORE any async work
   begins. Every send is serialized through a promise chain so two calls can
   never observe the same counter value.
   ------------------------------------------------------------------------- */

async function syncNonce(): Promise<void> {
  if (!account) return;
  const endpoint = getEndpoint(account.address);
  const client = httpClientFor(endpoint.http);
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
   4. Fees — refreshed in the background, never in the tap path
   ------------------------------------------------------------------------- */

async function refreshFees(): Promise<void> {
  if (!account) return;
  try {
    const client = httpClientFor(getEndpoint(account.address).http);
    const base = await client.getGasPrice();
    // maxFeePerGas is only a cap on Monad — price_per_gas is
    // min(base + priority, max) — so headroom here is free. Unlike the gas
    // limit, which is charged in full.
    const withHeadroom = (base * 2n) as bigint;
    fees = {
      maxFeePerGas: withHeadroom > MAX_FEE_PER_GAS ? withHeadroom : MAX_FEE_PER_GAS,
      maxPriorityFeePerGas: MAX_PRIORITY_FEE_PER_GAS,
    };
  } catch {
    /* keep the last known good fees */
  }
}

/* -------------------------------------------------------------------------
   Init
   ------------------------------------------------------------------------- */

export type BurnerState = {
  address: Address;
  balance: bigint;
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
  try {
    balance = await client.getBalance({ address: account.address });
  } catch {
    /* non-fatal — the UI shows a funding state and retries */
  }

  return { address: account.address, balance };
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
 * Sign a spray locally and hand it to the batch sender.
 *
 * Returns the transaction hash immediately, computed from the signed payload —
 * no confirmation is awaited and no popup is ever shown. If this function ever
 * blocks on the network, the project has failed.
 */
export async function spray(partyId: number, amount: bigint): Promise<Hash> {
  if (!account || !sender) throw new Error("burner not initialised");
  const to = assertContractConfigured();
  const acct = account;
  const snd = sender;

  if (!nonceReady) await syncNonce();

  // An address's first spray on a party writes sprayedBy from zero, which is an
  // SSTORE_SET. Every spray after it is a cheaper update. Monad charges on the
  // limit, so using the expensive tier for all 300 taps would waste ~25% of the
  // burner's balance.
  const first = !sprayedParties.has(partyId);
  const gas = first ? SPRAY_GAS_LIMIT_FIRST : SPRAY_GAS_LIMIT;

  const data = encodeFunctionData({
    abi: sprayPartyAbi,
    functionName: "spray",
    args: [BigInt(partyId)],
  });

  // Serialize through the chain so nonce assignment is atomic with respect to
  // other in-flight sprays.
  const task = chain.then(async () => {
    const assigned = nonce;
    nonce += 1; // synchronous increment, before any await

    try {
      const raw = await acct.signTransaction({
        chainId: monadTestnet.id,
        type: "eip1559",
        to,
        value: amount,
        data,
        nonce: assigned,
        gas,
        maxFeePerGas: fees.maxFeePerGas,
        maxPriorityFeePerGas: fees.maxPriorityFeePerGas,
      });

      snd.enqueue(raw);
      sprayedParties.add(partyId);

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
   Diagnostics — used by /api/health and the load test, never shown on stage
   ------------------------------------------------------------------------- */

export function senderStats(): SendStats | null {
  return sender?.stats() ?? null;
}

export function nonceDiagnostics() {
  return { nonce, nonceReady, resyncCount };
}

/** Exported for the resilience pass: force a flush on page hide. */
export async function flushPending(): Promise<void> {
  await sender?.flushNow();
}

/** Host-only helper. Never used on the sprayer path. */
export function walletClient() {
  if (!account) throw new Error("burner not initialised");
  return createWalletClient({
    account,
    chain: monadTestnet,
    transport: http(getEndpoint(account.address).http, { timeout: HTTP_TIMEOUT_MS }),
  });
}
