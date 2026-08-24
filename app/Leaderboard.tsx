"use client";

import type { Address } from "viem";
import type { LeaderRow } from "@/lib/hooks/useArena";
import { formatCount, truncateAddress } from "@/lib/format";

/**
 * Today's board.
 *
 * Covers a rolling recent window rather than the whole round — a UTC day is
 * ~216,000 blocks and no RPC will hand that over in a sane number of requests.
 * The header says so rather than implying a completeness the data does not
 * have. A player's own tap count is never approximated this way; that comes
 * from the contract.
 */
export default function Leaderboard({
  board,
  me,
}: {
  board: LeaderRow[];
  me: Address | null;
}) {
  return (
    <section className="rounded-[var(--radius-panel)] border border-hairline bg-ink-2/80 backdrop-blur-[2px]">
      <header className="flex items-baseline justify-between border-b border-hairline px-4 py-3">
        <h2 className="t-section">Today&apos;s board</h2>
        <span className="t-meta">recent window</span>
      </header>

      {board.length === 0 ? (
        <p className="t-meta px-4 py-6 text-center">
          nobody has tapped yet. be first.
        </p>
      ) : (
        <ol className="divide-y divide-hairline">
          {board.map((row) => {
            const mine = me !== null && row.player.toLowerCase() === me.toLowerCase();
            return (
              <li
                key={row.player}
                className={`flex items-center gap-3 px-4 py-2.5 transition-colors ${
                  mine ? "bg-ink-4" : ""
                }`}
                style={{ transitionDuration: "var(--dur-row)" }}
              >
                <span
                  className="t-lb-value w-6 shrink-0 text-left"
                  style={{ color: row.rank <= 3 ? "var(--color-violet)" : "var(--color-text-4)" }}
                >
                  {row.rank}
                </span>
                <span
                  className="t-lb-addr flex-1 truncate"
                  style={{ color: mine ? "var(--color-aqua)" : "var(--color-text-2)" }}
                >
                  {truncateAddress(row.player)}
                  {mine && <span className="t-meta ml-2 text-aqua">you</span>}
                </span>
                <span className="t-lb-value text-paper">{formatCount(row.taps)}</span>
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}
