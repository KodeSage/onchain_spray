import { NextResponse } from "next/server";
import { BUDGET_SPECTATE_AT, BUDGET_TIGHTEN_AT, type ArenaMode } from "@/lib/constants";
import { budgetState } from "@/lib/faucet";
import { getStore } from "@/lib/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The arena's health, and the signal that drives the degradation ladder.
 *
 * Polled by the client on a slow timer. It deliberately exposes a *mode* rather
 * than raw numbers, so the rung the arena is on is decided in one place instead
 * of being re-derived from thresholds by every caller. It touches no key
 * material and reads one counter, so it is cheap enough to be public.
 */

export async function GET() {
  const budget = await budgetState(getStore());

  const mode: ArenaMode =
    budget.remainingShare <= BUDGET_SPECTATE_AT
      ? "spectate"
      : budget.remainingShare <= BUDGET_TIGHTEN_AT
        ? "tightening"
        : "open";

  return NextResponse.json({
    ok: true,
    mode,
    round: budget.round,
    /** 1 = untouched, 0 = spent. Rounded, because the exact figure is nobody's business. */
    remaining: Number(budget.remainingShare.toFixed(3)),
    resetsAt: new Date(Math.ceil(Date.now() / 86_400_000) * 86_400_000).toISOString(),
  });
}
