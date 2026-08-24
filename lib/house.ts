import { createWalletClient, http, type Address, type Hash, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { monadTestnet, httpClientFor, HTTP_TIMEOUT_MS } from "./chain";
import { ENDPOINTS } from "./rpc";
import { loadPrivateKey } from "./server-key";
import { MAX_FEE_PER_GAS, MAX_PRIORITY_FEE_PER_GAS } from "./constants";

/**
 * The house wallet — the server's hot key.
 *
 * It has the same nonce problem a burner has, for the same reason: many phones
 * asking for gas at the same moment will each fetch the same nonce and collide.
 * Same fix — one local counter, one promise chain, incremented before any await.
 *
 * The difference from a burner is that this module can be instantiated more
 * than once. Serverless gives each instance its own counter, so two instances
 * genuinely can pick the same nonce. That is not preventable from here without
 * a distributed lock on every send, which would cost more than it saves. What
 * IS preventable is a collision turning into a lost payout, so a send that
 * fails on a nonce error resyncs from chain and retries exactly once.
 */

let cachedAccount: ReturnType<typeof privateKeyToAccount> | null = null;

export type HouseResult =
  | { ok: true; address: Address }
  | { ok: false; reason: "missing" | "malformed" };

export function houseAccount(): HouseResult {
  if (cachedAccount) return { ok: true, address: cachedAccount.address };
  const loaded = loadPrivateKey();
  if (!loaded.ok) return { ok: false, reason: loaded.reason };
  cachedAccount = privateKeyToAccount(loaded.key);
  return { ok: true, address: cachedAccount.address };
}

function requireAccount() {
  const result = houseAccount();
  if (!result.ok || !cachedAccount) throw new Error(`house key ${result.ok ? "missing" : result.reason}`);
  return cachedAccount;
}

const rpc = ENDPOINTS[0].http;

function wallet() {
  return createWalletClient({
    account: requireAccount(),
    chain: monadTestnet,
    transport: http(rpc, { timeout: HTTP_TIMEOUT_MS }),
  });
}

export function houseReadClient() {
  return httpClientFor(rpc);
}

/** -1 means "unknown, fetch before the next send". */
let nonce = -1;
let queue: Promise<unknown> = Promise.resolve();

async function fetchNonce(): Promise<number> {
  const client = houseReadClient();
  return client.getTransactionCount({
    address: requireAccount().address,
    blockTag: "pending",
  });
}

export function invalidateNonce(): void {
  nonce = -1;
}

export async function houseBalance(): Promise<bigint> {
  return houseReadClient().getBalance({ address: requireAccount().address });
}

export type SendRequest = {
  to: Address;
  value?: bigint;
  data?: Hex;
  /** Always explicit. estimateGas is a wasted round trip and a rate-limit cost. */
  gas: bigint;
};

/**
 * Send from the house wallet, serialized behind a local nonce.
 *
 * Never called in a player's tap path — only by /api/fund and /api/claim, which
 * run at most a handful of times per player per round.
 */
export async function houseSend(req: SendRequest): Promise<Hash> {
  const task = queue.then(async () => {
    for (let attempt = 0; attempt < 2; attempt++) {
      if (nonce < 0) nonce = await fetchNonce();
      const assigned = nonce;
      nonce += 1; // synchronous increment, before any await

      try {
        return await wallet().sendTransaction({
          to: req.to,
          value: req.value ?? 0n,
          data: req.data,
          gas: req.gas,
          nonce: assigned,
          maxFeePerGas: MAX_FEE_PER_GAS,
          maxPriorityFeePerGas: MAX_PRIORITY_FEE_PER_GAS,
        });
      } catch (err) {
        // Our counter is now ahead of, or behind, chain. Drop it and let the
        // next iteration refetch. Anything that is not a nonce problem is a
        // real failure and the caller needs to see it.
        invalidateNonce();
        if (attempt === 1 || !isNonceError(err)) throw err;
      }
    }
    throw new Error("unreachable");
  });

  queue = task.catch(() => undefined);
  return task;
}

function isNonceError(err: unknown): boolean {
  const text = err instanceof Error ? err.message : String(err);
  return /nonce|replacement transaction underpriced|already known/i.test(text);
}
