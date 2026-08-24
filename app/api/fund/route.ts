import { NextResponse } from "next/server";
import { formatEther } from "viem";
import { TRANSFER_GAS_LIMIT } from "@/lib/constants";
import { currentRound } from "@/lib/format";
import { houseAccount, houseBalance, houseReadClient, houseSend } from "@/lib/house";
import { keyErrorResponse } from "@/lib/server-key";
import { clientIp, keys, requireStore, toGwei } from "@/lib/store";
import {
  budgetState,
  caps,
  normalizeAddress,
  reserve,
  topUpAmount,
} from "@/lib/faucet";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Seeds a burner with gas.
 *
 * This is the half of the faucet the player never sees. It funds the in-browser
 * key so tapping costs them nothing, and it is metered per address, per IP and
 * against the day's global budget — gas given away is money given away, and the
 * fact that it is spent on gas rather than handed over does not make it free.
 *
 * The master key never reaches the client.
 *
 * TIMING. A newly funded account cannot transact until its funding transfer is
 * 3 blocks old, because Monad's consensus validates gas budgets against a
 * delayed state view. The response carries armAfterMs so the client knows to
 * hold before the first tap. The UI hides that wait behind onboarding by
 * calling this on page load rather than when the player presses start.
 */

/** 3 blocks at ~400ms, plus a margin for inclusion. */
const ARM_AFTER_MS = 1_600;

export async function POST(req: Request) {
  const house = houseAccount();
  if (!house.ok) {
    const { body, status } = keyErrorResponse(house.reason);
    return NextResponse.json(body, { status });
  }

  const storeResult = requireStore();
  if (!storeResult.ok) {
    return NextResponse.json(
      {
        ok: false,
        error: storeResult.error,
        message: "The faucet is not configured for public use. Set UPSTASH_REDIS_REST_URL.",
      },
      { status: 503 }
    );
  }
  const store = storeResult.store;

  let address: string | undefined;
  try {
    const body = (await req.json()) as { address?: string };
    address = body.address;
  } catch {
    return NextResponse.json({ ok: false, error: "bad_request" }, { status: 400 });
  }

  const to = normalizeAddress(address);
  if (!to) {
    return NextResponse.json({ ok: false, error: "bad_address" }, { status: 400 });
  }

  const ip = clientIp(req);
  const round = currentRound();

  // Don't fund a burner that is already comfortable. This is the common case
  // on a reload, and it must not consume any of the day's budget.
  let balance = 0n;
  try {
    balance = await houseReadClient().getBalance({ address: to });
  } catch {
    /* if we cannot read the balance, fund anyway — better than a dead burner */
  }

  const amount = topUpAmount(balance);
  if (amount === 0n) {
    return NextResponse.json({
      ok: true,
      skipped: "already_funded",
      balance: balance.toString(),
      armAfterMs: 0,
    });
  }

  const amountGwei = toGwei(amount);
  const reservation = await reserve(
    store,
    [
      {
        key: keys.gasByAddress(round, to),
        cap: caps.gasPerAddress,
        error: "gas_budget_spent",
        message:
          "This burner has had its gas allowance for today. Taps now settle in " +
          "batches, which is cheaper and plays the same. Resets at 00:00 UTC.",
      },
      {
        key: keys.gasByIp(round, ip),
        cap: caps.gasPerIp,
        error: "ip_limit",
        message: "This network has funded enough burners today. Resets at 00:00 UTC.",
      },
      {
        key: keys.dailyBudget(round),
        cap: caps.daily,
        error: "budget_exhausted",
        message: "The faucet has spent today's budget. It refills at 00:00 UTC.",
      },
    ],
    amountGwei
  );

  if (!reservation.ok) {
    return NextResponse.json(
      { ok: false, error: reservation.error, message: reservation.message },
      { status: reservation.status }
    );
  }

  try {
    // A native MON transfer is always exactly 21,000 gas. Hardcoded, because on
    // Monad the sender pays for the limit and estimateGas is both a wasted round
    // trip and rate-limited harder than everything else.
    const hash = await houseSend({ to, value: amount, gas: TRANSFER_GAS_LIMIT });
    return NextResponse.json({
      ok: true,
      hash,
      amount: formatEther(amount),
      armAfterMs: ARM_AFTER_MS,
    });
  } catch (err) {
    // The money never left, so the reservation must not stand.
    await reservation.release();
    const message = err instanceof Error ? err.message : "send_failed";
    console.error("[fund] send failed:", message);
    return NextResponse.json(
      { ok: false, error: "send_failed", message: "Could not reach the network. Try again." },
      { status: 502 }
    );
  }
}

/** Lets the preflight check read the house wallet and today's budget for real. */
export async function GET() {
  const house = houseAccount();
  if (!house.ok) {
    const { body, status } = keyErrorResponse(house.reason);
    return NextResponse.json(body, { status });
  }

  const store = requireStore();
  const budget = await budgetState(store.ok ? store.store : undefined);

  try {
    const balance = await houseBalance();
    return NextResponse.json({
      ok: true,
      house: house.address,
      balance: formatEther(balance),
      durableStore: store.ok && store.store.durable,
      round: budget.round,
      budgetUsedGwei: budget.usedGwei,
      budgetCapGwei: budget.capGwei,
      budgetRemainingShare: Number(budget.remainingShare.toFixed(4)),
    });
  } catch {
    return NextResponse.json({ ok: false, error: "rpc_unavailable" }, { status: 502 });
  }
}
