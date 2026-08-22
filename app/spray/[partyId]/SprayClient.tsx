"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  AUTOFIRE_INTERVAL_MS,
  DEFAULT_DENOMINATION,
  DENOMINATIONS,
  FUNDED_STORAGE_KEY,
  LOW_BALANCE_THRESHOLD,
  type Denomination,
} from "@/lib/constants";
import { getBalance, initBurner, spray as sendSpray } from "@/lib/burner";
import { formatMonExact, formatNairaNumber, truncateAddress } from "@/lib/format";
import { useEasedNumber } from "@/lib/hooks/useEasedNumber";
import { useParty } from "@/lib/hooks/useParty";
import NoteStack from "./NoteStack";

type Phase = "booting" | "funding" | "ready" | "dry" | "error";

export default function SprayClient({ partyId }: { partyId: number }) {
  const [phase, setPhase] = useState<Phase>("booting");
  const [address, setAddress] = useState<string>("");
  const [denomination, setDenomination] = useState<Denomination>(DEFAULT_DENOMINATION);
  const [sprayedWei, setSprayedWei] = useState(0n);
  const [tapCount, setTapCount] = useState(0);
  const [confirmed, setConfirmed] = useState(0);
  const [errorText, setErrorText] = useState("");

  const { party } = useParty(partyId);
  const stackRef = useRef<{ peel: (big: boolean) => void }>(null);
  const denominationRef = useRef(denomination);
  denominationRef.current = denomination;

  const eased = useEasedNumber(Number(sprayedWei) / 1e18 * 1_000_000, 120);

  /* ---- boot: key, funding, nonce ------------------------------------- */
  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const { address: addr, balance } = await initBurner();
        if (cancelled) return;
        setAddress(addr);

        if (balance < LOW_BALANCE_THRESHOLD) {
          // Cached so a refresh does not re-request funds — a room full of
          // people pulling to refresh would drain the master wallet.
          const alreadyAsked = window.sessionStorage.getItem(FUNDED_STORAGE_KEY);
          if (!alreadyAsked || balance === 0n) {
            setPhase("funding");
            await requestFunds(addr);
            window.sessionStorage.setItem(FUNDED_STORAGE_KEY, "1");
          }
        }

        if (cancelled) return;
        setPhase("ready");
      } catch (err) {
        if (cancelled) return;
        setErrorText(err instanceof Error ? err.message : "could not start");
        setPhase("error");
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  /* ---- background top-up when the burner runs low --------------------- */
  useEffect(() => {
    if (phase !== "ready" || !address) return;
    const timer = setInterval(() => {
      void (async () => {
        const balance = await getBalance();
        if (balance < LOW_BALANCE_THRESHOLD) {
          await requestFunds(address);
        }
      })();
    }, 20_000);
    return () => clearInterval(timer);
  }, [phase, address]);

  /* ---- the tap --------------------------------------------------------- */
  const tap = useCallback(() => {
    const denom = denominationRef.current;

    // Optimistic, always. The animation never waits for the chain and never
    // asks whether the last one worked.
    stackRef.current?.peel(denom.id === "large");
    setSprayedWei((v) => v + denom.value);
    setTapCount((c) => c + 1);
    navigator.vibrate?.(denom.id === "large" ? 22 : 12);

    void sendSpray(partyId, denom.value)
      .then(() => {
        // The sent tick only moves on a real send, so the room can see the
        // chain keeping up without the interaction ever being gated by it.
        setConfirmed((c) => c + 1);
      })
      .catch(() => {
        /* retried once inside the sender, then dropped. Never surfaced. */
      });
  }, [partyId]);

  /* ---- press and hold -------------------------------------------------- */
  const holdTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  const startHold = useCallback(() => {
    if (holdTimer.current) return;
    holdTimer.current = setInterval(tap, AUTOFIRE_INTERVAL_MS);
  }, [tap]);

  const stopHold = useCallback(() => {
    if (holdTimer.current) clearInterval(holdTimer.current);
    holdTimer.current = null;
  }, []);

  useEffect(() => stopHold, [stopHold]);

  const onPointerDown = useCallback(
    (e: React.PointerEvent) => {
      e.preventDefault();
      tap();
      startHold();
    },
    [tap, startHold]
  );

  if (phase === "booting" || phase === "funding") {
    return <Booting phase={phase} />;
  }

  if (phase === "error") {
    return (
      <main className="flex min-h-dvh flex-col items-center justify-center gap-3 p-8 text-center">
        <p className="t-tap-label text-paper">can&apos;t start</p>
        <p className="t-meta max-w-xs">{errorText}</p>
      </main>
    );
  }

  return (
    <main
      className="flex h-dvh touch-none select-none flex-col overflow-hidden bg-ink"
      style={{ WebkitTapHighlightColor: "transparent" }}
    >
      {/* header */}
      <header className="flex items-start justify-between px-5 pt-[max(1rem,env(safe-area-inset-top))]">
        <div className="min-w-0">
          <p className="t-party truncate">
            {party.name || `party #${partyId}`}
          </p>
          <p className="t-meta mt-1 truncate">
            {party.exists
              ? `spraying ${truncateAddress(party.host)}`
              : "spraying the dancer"}
          </p>
        </div>
        <div className="text-right">
          <p className="t-meta">{address ? truncateAddress(address) : ""}</p>
          <p className="t-meta mt-1 text-green">
            {confirmed}/{tapCount} sent
          </p>
        </div>
      </header>

      {/* personal total */}
      <section className="px-5 pt-6">
        <p className="t-meta">you have sprayed</p>
        <p className="t-personal-total mt-2 text-paper">
          {formatNairaNumber(eased)}
        </p>
      </section>

      {/* denominations */}
      <section className="flex gap-2 px-5 pt-6">
        {DENOMINATIONS.map((d) => {
          const active = d.id === denomination.id;
          return (
            <button
              key={d.id}
              type="button"
              onPointerDown={(e) => {
                e.stopPropagation();
                setDenomination(d);
                navigator.vibrate?.(6);
              }}
              aria-pressed={active}
              className={[
                "flex-1 rounded-chip border py-3 transition-colors",
                active
                  ? "border-green bg-green text-ink"
                  : "border-hairline bg-ink-4 text-text-2",
              ].join(" ")}
            >
              <span className="t-chip block">{d.label}</span>
              <span
                className="t-meta mt-1 block"
                style={active ? { color: "var(--color-ink)", opacity: 0.62 } : undefined}
              >
                ({formatMonExact(d.value)})
              </span>
            </button>
          );
        })}
      </section>

      {/* the tap target */}
      <NoteStack
        ref={stackRef}
        onPointerDown={onPointerDown}
        onPointerUp={stopHold}
        onPointerLeave={stopHold}
        onPointerCancel={stopHold}
      />
    </main>
  );
}

function Booting({ phase }: { phase: "booting" | "funding" }) {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-4 bg-ink">
      <div className="flex gap-1.5">
        {[0, 1, 2].map((i) => (
          <span
            key={i}
            className="h-2 w-8 rounded-chip bg-green"
            style={{
              animation: "spray-pulse 1.1s var(--ease-out) infinite",
              animationDelay: `${i * 0.13}s`,
              opacity: 0.25,
            }}
          />
        ))}
      </div>
      <p className="t-tap-label text-text-2">
        {phase === "funding" ? "getting you ready" : "starting up"}
      </p>
      <style>{`
        @keyframes spray-pulse {
          0%, 100% { opacity: 0.22; transform: scaleX(0.7); }
          50%      { opacity: 1;    transform: scaleX(1); }
        }
      `}</style>
    </main>
  );
}

async function requestFunds(address: string): Promise<void> {
  try {
    const res = await fetch("/api/fund", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ address }),
      signal: AbortSignal.timeout(12_000),
    });
    if (!res.ok) return;
    // give the funding transaction a moment to land before the first tap
    await new Promise((r) => setTimeout(r, 900));
  } catch {
    /* the user still gets a working UI; taps will fail silently until funded */
  }
}
