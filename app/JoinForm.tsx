"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { isAddress } from "viem";

type Mode = "join" | "host";

/**
 * Two ways in.
 *
 * "Get sprayed" is the one that matters: the person about to be sprayed types
 * their own wallet address, and everything sprayed at their party is payable to
 * that address on chain. No wallet extension, no gas, no signature — they type
 * an address and the projector starts pointing at them.
 */
export default function JoinForm() {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>("host");

  const [partyId, setPartyId] = useState("0");
  const [address, setAddress] = useState("");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const addressValid = isAddress(address.trim());

  async function createParty(e: React.FormEvent) {
    e.preventDefault();
    if (!addressValid || busy) return;
    setBusy(true);
    setError("");

    try {
      const res = await fetch("/api/create-party", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ recipient: address.trim(), name: name.trim() }),
        signal: AbortSignal.timeout(45_000),
      });
      const data = (await res.json()) as {
        ok: boolean;
        partyId?: number;
        error?: string;
      };

      if (!data.ok || data.partyId === undefined) {
        setError(errorText(data.error));
        setBusy(false);
        return;
      }
      // straight to the projector — the QR is on it
      router.push(`/stage/${data.partyId}`);
    } catch {
      setError("could not reach the server");
      setBusy(false);
    }
  }

  return (
    <div>
      {/* mode switch */}
      <div className="mb-6 flex gap-2">
        {(
          [
            ["host", "get sprayed"],
            ["join", "join a party"],
          ] as const
        ).map(([value, label]) => (
          <button
            key={value}
            type="button"
            onClick={() => {
              setMode(value);
              setError("");
            }}
            aria-pressed={mode === value}
            className={[
              "t-chip rounded-chip border px-6 py-3 transition-colors",
              mode === value
                ? "border-green bg-green text-ink"
                : "border-hairline bg-ink-4 text-text-2",
            ].join(" ")}
          >
            {label}
          </button>
        ))}
      </div>

      {mode === "host" ? (
        <form className="flex flex-col gap-3" onSubmit={createParty}>
          <div className="flex flex-wrap items-stretch gap-3">
            <label className="sr-only" htmlFor="recipient">
              Your wallet address
            </label>
            <input
              id="recipient"
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              placeholder="your wallet address — 0x…"
              spellCheck={false}
              autoComplete="off"
              className="t-chip min-w-0 flex-1 rounded-chip border border-hairline bg-ink-4 px-6 text-paper outline-none placeholder:text-text-4 focus:border-green"
              style={{ fontSize: 15, paddingBlock: 18 }}
            />
            <label className="sr-only" htmlFor="party-name">
              Party name
            </label>
            <input
              id="party-name"
              value={name}
              onChange={(e) => setName(e.target.value.slice(0, 31))}
              placeholder="party name"
              className="t-chip w-44 rounded-chip border border-hairline bg-ink-4 px-6 text-paper outline-none placeholder:text-text-4 focus:border-green"
              style={{ fontSize: 15, paddingBlock: 18 }}
            />
          </div>

          <div className="flex flex-wrap items-center gap-4">
            <button
              type="submit"
              disabled={!addressValid || busy}
              className="t-chip rounded-chip bg-green px-10 text-ink transition-transform disabled:opacity-40"
              style={{
                fontSize: 15,
                paddingBlock: 18,
                transitionDuration: "var(--dur-tap)",
                transitionTimingFunction: "var(--ease-tap)",
              }}
            >
              {busy ? "opening your party…" : "start my party"}
            </button>
            <p className="t-meta max-w-xs">
              {address.length > 0 && !addressValid
                ? "that is not a wallet address"
                : "everything the room sprays is paid to this address"}
            </p>
          </div>

          {error && (
            <p className="t-meta" style={{ color: "var(--color-gold)" }}>
              {error}
            </p>
          )}
        </form>
      ) : (
        <form
          className="flex flex-wrap items-stretch gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            const id = Number.parseInt(partyId, 10);
            if (!Number.isFinite(id) || id < 0) return;
            setBusy(true);
            router.push(`/spray/${id}`);
          }}
        >
          <label className="sr-only" htmlFor="party">
            Party number
          </label>
          <input
            id="party"
            inputMode="numeric"
            value={partyId}
            onChange={(e) => setPartyId(e.target.value.replace(/[^0-9]/g, ""))}
            className="t-chip w-28 rounded-chip border border-hairline bg-ink-4 px-5 text-center text-paper outline-none focus:border-green"
            style={{ fontSize: 15, paddingBlock: 18 }}
            aria-label="Party number"
          />
          <button
            type="submit"
            disabled={busy}
            className="t-chip rounded-chip bg-green px-10 text-ink transition-transform disabled:opacity-70"
            style={{
              fontSize: 15,
              paddingBlock: 18,
              transitionDuration: "var(--dur-tap)",
              transitionTimingFunction: "var(--ease-tap)",
            }}
          >
            {busy ? "joining…" : "join the party"}
          </button>
        </form>
      )}
    </div>
  );
}

function errorText(code?: string): string {
  switch (code) {
    case "bad_address":
      return "that is not a valid wallet address";
    case "name_too_long":
      return "party name must be 31 characters or fewer";
    case "rate_limited":
      return "too many parties from here — wait a moment";
    case "no_contract":
      return "the contract is not deployed yet";
    case "not_configured":
      return "the server has no funding wallet configured";
    default:
      return "could not open the party";
  }
}
