import { NextResponse } from "next/server";
import { encodeFunctionData, formatEther } from "viem";
import { CLAIM_GAS_LIMIT, MIN_TAPS_TO_CLAIM } from "@/lib/constants";
import { assertContractConfigured, tapArenaAbi } from "@/lib/contract";
import { dripFor, caps, normalizeAddress, reserve } from "@/lib/faucet";
import { houseAccount, houseReadClient, houseSend } from "@/lib/house";
import { keyErrorResponse } from "@/lib/server-key";
import { clientIp, keys, requireStore, toGwei } from "@/lib/store";
import { requireTurnstile, verifyTurnstile } from "@/lib/turnstile";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Pays a player's drip for the current round.
 *
 * The one route where money leaves, so it is the one route that checks
 * everything and fails closed on all of it:
 *
 *   1. Turnstile, proving a person is present
 *   2. the contract's own view of eligibility — taps, round, not already paid
 *   3. durable per-payout-address, per-IP and global daily caps
 *   4. the on-chain settlement, which enforces (2) a second time atomically
 *
 * Step 3 keys on the PAYOUT address rather than the burner. Burners are free
 * and infinite — a sybil makes a thousand of them without trying. The payout
 * address is the thing they actually want the MON to land in, so that is what
 * the daily cap has to be attached to.
 *
 * This route waits for the receipt, unlike everything else in the codebase.
 * houseSend returns once a transaction is submitted, and a settleClaim that
 * reverts on chain would otherwise be reported to the player as a success while
 * the reservation stood and no money moved. A claim happens once per player per
 * day; a second of latency is worth being right.
 */

const RECEIPT_TIMEOUT_MS = 15_000;

type ClaimBody = {
  /** The in-browser burner that did the tapping. */
  player?: string;
  /** Where the player wants the MON. */
  payout?: string;
  /** Turnstile response token. */
  token?: string;
};

export async function POST(req: Request) {
  const house = houseAccount();
  if (!house.ok) {
    const { body, status } = keyErrorResponse(house.reason);
    return NextResponse.json(body, { status });
  }

  const gate = requireTurnstile();
  if (!gate.ok) {
    return NextResponse.json(
      {
        ok: false,
        error: gate.error,
        message: "The faucet is not configured for public use. Set TURNSTILE_SECRET_KEY.",
      },
      { status: 503 }
    );
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

  let body: ClaimBody;
  try {
    body = (await req.json()) as ClaimBody;
  } catch {
    return NextResponse.json({ ok: false, error: "bad_request" }, { status: 400 });
  }

  const player = normalizeAddress(body.player);
  const payout = normalizeAddress(body.payout);
  if (!player || !payout) {
    return NextResponse.json(
      { ok: false, error: "bad_address", message: "That does not look like a wallet address." },
      { status: 400 }
    );
  }

  const ip = clientIp(req);

  const human = await verifyTurnstile(body.token, ip);
  if (!human.ok) {
    return NextResponse.json(
      {
        ok: false,
        error: human.reason,
        message:
          human.reason === "unavailable"
            ? "Could not run the human check. Try again in a moment."
            : "The human check did not pass. Reload and try again.",
      },
      { status: human.reason === "unavailable" ? 503 : 403 }
    );
  }

  let arena: `0x${string}`;
  try {
    arena = assertContractConfigured();
  } catch {
    return NextResponse.json({ ok: false, error: "not_configured" }, { status: 503 });
  }

  // Ask the contract, not the client, how many taps this player has. The client
  // is the one actor with an interest in the answer being wrong.
  const client = houseReadClient();
  let eligible: readonly [boolean, number, number, number];
  try {
    eligible = await client.readContract({
      address: arena,
      abi: tapArenaAbi,
      functionName: "claimable",
      args: [player],
    });
  } catch {
    return NextResponse.json(
      { ok: false, error: "rpc_unavailable", message: "Could not reach the network. Try again." },
      { status: 502 }
    );
  }

  const [ok, round, roundTaps, tapsNeeded] = eligible;
  if (!ok) {
    const alreadyClaimed = tapsNeeded === 0;
    return NextResponse.json(
      {
        ok: false,
        error: alreadyClaimed ? "already_claimed" : "not_enough_taps",
        roundTaps,
        tapsNeeded,
        message: alreadyClaimed
          ? "You have already claimed this round. The next one opens at 00:00 UTC."
          : `${tapsNeeded} more ${tapsNeeded === 1 ? "tap" : "taps"} to claim. ` +
            `${MIN_TAPS_TO_CLAIM} is the minimum.`,
      },
      { status: 409 }
    );
  }

  const amount = dripFor(roundTaps);
  if (amount === 0n) {
    return NextResponse.json(
      { ok: false, error: "not_enough_taps", roundTaps, tapsNeeded },
      { status: 409 }
    );
  }

  const amountGwei = toGwei(amount);
  const reservation = await reserve(
    store,
    [
      {
        key: keys.dripByAddress(round, payout),
        cap: caps.dripPerAddress,
        error: "address_cap",
        message: "This wallet has had its full drip today. It resets at 00:00 UTC.",
      },
      {
        key: keys.dripByIp(round, ip),
        cap: caps.dripPerIp,
        error: "ip_cap",
        message: "This network has claimed its limit today. It resets at 00:00 UTC.",
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
    const hash = await houseSend({
      to: arena,
      value: amount,
      gas: CLAIM_GAS_LIMIT,
      data: encodeFunctionData({
        abi: tapArenaAbi,
        functionName: "settleClaim",
        args: [player, payout, round, amount],
      }),
    });

    const receipt = await client.waitForTransactionReceipt({
      hash,
      timeout: RECEIPT_TIMEOUT_MS,
    });

    if (receipt.status !== "success") {
      await reservation.release();
      return NextResponse.json(
        {
          ok: false,
          error: "settlement_reverted",
          hash,
          message: "The settlement did not go through. Nothing was deducted — try again.",
        },
        { status: 502 }
      );
    }

    return NextResponse.json({
      ok: true,
      hash,
      round,
      roundTaps,
      amount: formatEther(amount),
      payout,
    });
  } catch (err) {
    // Either the send failed or the receipt never arrived. In the second case
    // the transaction may still land, so the reservation is deliberately NOT
    // released — the contract's own AlreadyClaimed check is what makes a
    // retry safe, and over-counting the budget errs toward the wallet.
    const message = err instanceof Error ? err.message : "send_failed";
    console.error("[claim] settlement failed:", message);
    return NextResponse.json(
      {
        ok: false,
        error: "send_failed",
        message: "Could not confirm the payout. Check the explorer before retrying.",
      },
      { status: 502 }
    );
  }
}
