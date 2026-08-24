import { isAddress, type Address } from "viem";
import {
  BURNER_DAILY_GAS_BUDGET,
  BURNER_TARGET_BALANCE,
  DAILY_BUDGET,
  DRIP_DAILY_CAP_PER_ADDRESS,
  DRIP_DAILY_CAP_PER_IP,
  dripFor,
} from "./constants";
import { currentRound } from "./format";
import { getStore, keys, toGwei, type Store } from "./store";

/**
 * Faucet policy.
 *
 * Everything that decides whether money leaves lives here rather than in a
 * route handler, so the rules can be read in one place and tested without an
 * HTTP request. The routes do transport; this does policy.
 */

export type Denial = {
  error: string;
  status: number;
  /** Shown to the player verbatim. Say what happened and when it changes. */
  message: string;
};

/** Caps expressed the way the store wants them. */
export const caps = {
  dripPerAddress: toGwei(DRIP_DAILY_CAP_PER_ADDRESS),
  dripPerIp: toGwei(DRIP_DAILY_CAP_PER_IP),
  gasPerAddress: toGwei(BURNER_DAILY_GAS_BUDGET),
  /** One IP may seed a handful of burners a day, not a farm of them. */
  gasPerIp: toGwei(BURNER_DAILY_GAS_BUDGET * 5n),
  daily: toGwei(DAILY_BUDGET),
};

export function normalizeAddress(input: unknown): Address | null {
  if (typeof input !== "string") return null;
  const trimmed = input.trim();
  return isAddress(trimmed) ? (trimmed as Address) : null;
}

/**
 * How much the house will top a burner up by right now.
 *
 * Tops up TO a target rather than BY a fixed amount, because a burner's balance
 * is also its tap-rate ceiling — a fixed grant to a burner that is nearly full
 * overshoots, and to one that is nearly empty leaves it throttled.
 */
export function topUpAmount(balance: bigint): bigint {
  return balance >= BURNER_TARGET_BALANCE ? 0n : BURNER_TARGET_BALANCE - balance;
}

export type BudgetState = {
  round: number;
  usedGwei: number;
  capGwei: number;
  /** 1 = untouched, 0 = spent. */
  remainingShare: number;
};

export async function budgetState(store: Store = getStore()): Promise<BudgetState> {
  const round = currentRound();
  const used = await store.get(keys.dailyBudget(round));
  return {
    round,
    usedGwei: used,
    capGwei: caps.daily,
    remainingShare: Math.max(0, Math.min(1, 1 - used / caps.daily)),
  };
}

/**
 * Commit an amount against every cap it has to clear, in one place.
 *
 * Order matters. The global budget is reserved LAST, because it is the counter
 * shared by every player: taking from it and then bouncing off a per-address
 * cap would let one blocked player eat everyone else's headroom for as long as
 * the refund takes. The per-key caps are cheap to check and reject early.
 */
export async function reserve(
  store: Store,
  entries: { key: string; cap: number; error: string; message: string }[],
  amountGwei: number
): Promise<{ ok: true; release: () => Promise<void> } | ({ ok: false } & Denial)> {
  const taken: string[] = [];

  const releaseAll = async () => {
    await Promise.all(taken.map((key) => store.refund(key, amountGwei)));
  };

  for (const entry of entries) {
    const result = await store.reserve(entry.key, amountGwei, entry.cap);
    if (!result.ok) {
      await releaseAll();
      return { ok: false, error: entry.error, status: 429, message: entry.message };
    }
    taken.push(entry.key);
  }

  return { ok: true, release: releaseAll };
}

export function nextRoundMessage(): string {
  return "Resets at 00:00 UTC.";
}

export { dripFor };
