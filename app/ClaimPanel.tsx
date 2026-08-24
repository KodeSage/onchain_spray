"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { isAddress, type Address } from "viem";
import { DRIP_MAX, MIN_TAPS_TO_CLAIM, dripFor } from "@/lib/constants";
import { explorerTx } from "@/lib/chain";
import { formatMonExact, timeUntilNextRound } from "@/lib/format";

/**
 * Where the player names an address and takes their drip.
 *
 * The only place in the product that asks for anything, and the only place with
 * a gate in front of it. Everything above it is frictionless on purpose; the
 * friction is spent here, where the money leaves.
 */

type ClaimResult =
  | { kind: "idle" }
  | { kind: "working" }
  | { kind: "done"; hash: string; amount: string }
  | { kind: "error"; message: string };

const SITE_KEY = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY ?? "";

export default function ClaimPanel({
  player,
  taps,
  payout,
  onPayoutChange,
  disabled,
}: {
  player: Address | null;
  taps: number;
  payout: string;
  onPayoutChange: (value: string) => void;
  disabled: boolean;
}) {
  const [result, setResult] = useState<ClaimResult>({ kind: "idle" });
  const [countdown, setCountdown] = useState(() => timeUntilNextRound());
  const tokenRef = useRef<string>("");
  const widgetRef = useRef<HTMLDivElement>(null);

  const eligible = taps >= MIN_TAPS_TO_CLAIM;
  const remaining = Math.max(0, MIN_TAPS_TO_CLAIM - taps);
  const amount = dripFor(taps);
  const validPayout = isAddress(payout.trim());

  useEffect(() => {
    const timer = setInterval(() => setCountdown(timeUntilNextRound()), 1000);
    return () => clearInterval(timer);
  }, []);

  /* Turnstile renders itself once the player is actually close to claiming, so
     a spectator never pays for a challenge widget they will not use. */
  useEffect(() => {
    if (!SITE_KEY || !eligible || !widgetRef.current) return;
    if (widgetRef.current.childElementCount > 0) return;

    let cancelled = false;

    const render = () => {
      if (cancelled || !widgetRef.current || widgetRef.current.childElementCount > 0) return;
      window.turnstile?.render(widgetRef.current, {
        sitekey: SITE_KEY,
        theme: "dark",
        callback: (token: string) => {
          tokenRef.current = token;
        },
        "expired-callback": () => {
          tokenRef.current = "";
        },
      });
    };

    if (window.turnstile) {
      render();
      return;
    }

    const script = document.createElement("script");
    script.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
    script.async = true;
    script.onload = render;
    document.head.appendChild(script);

    return () => {
      cancelled = true;
    };
  }, [eligible]);

  const claim = useCallback(async () => {
    if (!player || !validPayout) return;
    setResult({ kind: "working" });

    try {
      const res = await fetch("/api/claim", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          player,
          payout: payout.trim(),
          token: tokenRef.current || undefined,
        }),
        signal: AbortSignal.timeout(30_000),
      });
      const data = (await res.json()) as {
        ok?: boolean;
        hash?: string;
        amount?: string;
        message?: string;
        error?: string;
      };

      if (data.ok && data.hash) {
        setResult({ kind: "done", hash: data.hash, amount: data.amount ?? "" });
      } else {
        setResult({
          kind: "error",
          message: data.message ?? "That did not go through. Try again.",
        });
        // A consumed token cannot be reused, so make the player solve a fresh one.
        tokenRef.current = "";
        window.turnstile?.reset();
      }
    } catch {
      setResult({
        kind: "error",
        message: "Could not reach the faucet. Check your connection and try again.",
      });
    }
  }, [player, payout, validPayout]);

  if (result.kind === "done") {
    return (
      <section className="rounded-[var(--radius-panel)] border border-hairline-hot bg-ink-2 p-5">
        <p className="t-section text-aqua">Sent</p>
        <p className="t-display mt-2 text-paper">{result.amount} MON</p>
        <p className="t-body mt-2 text-text-2">
          On its way to {payout.trim().slice(0, 10)}…{payout.trim().slice(-6)}.
        </p>
        <a
          href={explorerTx(result.hash)}
          target="_blank"
          rel="noreferrer"
          className="t-meta mt-4 inline-block text-violet-lift hover:text-paper"
        >
          view transaction →
        </a>
        <p className="t-meta mt-4">next round in {countdown}</p>
      </section>
    );
  }

  return (
    <section className="rounded-[var(--radius-panel)] border border-hairline bg-ink-2/80 p-5 backdrop-blur-[2px]">
      <header className="flex items-baseline justify-between">
        <h2 className="t-section">Claim your drip</h2>
        <span className="t-meta">resets in {countdown}</span>
      </header>

      <p className="t-display mt-3 text-paper">{formatMonExact(amount)}</p>
      <p className="t-meta mt-1">
        {eligible
          ? `earned from ${taps} taps · up to ${formatMonExact(DRIP_MAX)} a round`
          : `${remaining} more ${remaining === 1 ? "tap" : "taps"} to unlock`}
      </p>

      <label className="mt-5 block">
        <span className="t-label text-text-3">Payout address</span>
        <input
          value={payout}
          onChange={(e) => onPayoutChange(e.target.value)}
          placeholder="0x…"
          spellCheck={false}
          autoComplete="off"
          inputMode="text"
          className="mt-2 w-full rounded-[var(--radius-panel)] border border-hairline bg-ink-3 px-3 py-3 font-mono text-[15px] text-paper outline-none placeholder:text-text-4 focus:border-violet"
          style={{ fontFamily: "var(--font-mono), monospace" }}
        />
      </label>
      {payout.length > 0 && !validPayout && (
        <p className="t-meta mt-2 text-danger">that is not a valid address</p>
      )}

      {SITE_KEY && eligible && <div ref={widgetRef} className="mt-4" />}

      <button
        type="button"
        onClick={() => void claim()}
        disabled={!eligible || !validPayout || disabled || result.kind === "working"}
        className="mt-4 w-full rounded-[var(--radius-panel)] border px-4 py-3.5 transition-colors disabled:cursor-not-allowed"
        style={{
          background:
            eligible && validPayout && !disabled ? "var(--color-violet)" : "var(--color-ink-4)",
          borderColor:
            eligible && validPayout && !disabled
              ? "var(--color-violet)"
              : "var(--color-hairline)",
          color: eligible && validPayout && !disabled ? "#08080A" : "var(--color-text-4)",
        }}
      >
        <span className="t-label">
          {result.kind === "working"
            ? "settling…"
            : eligible
              ? "Claim"
              : `${remaining} more taps`}
        </span>
      </button>

      {result.kind === "error" && (
        <p className="t-body mt-3 text-danger" style={{ fontSize: 14 }}>
          {result.message}
        </p>
      )}

      <p className="t-meta mt-4 leading-relaxed">
        testnet MON only · one claim per round · the drip is paid by the contract,
        not by us sending you a transfer
      </p>
    </section>
  );
}
