import type { Hex } from "viem";

/**
 * Server-only key loading. Never import this from a client component.
 *
 * viem requires a 0x-prefixed 32-byte hex string and throws a raw crypto error
 * on anything else:
 *
 *     invalid private key, expected hex or 32 bytes, got string
 *
 * That surfaced as a 500 with a stack trace on the route that hands out money.
 * A key pasted without the 0x prefix is the overwhelmingly common way to get it
 * — every explorer and faucet shows keys bare — so normalise it rather than
 * punishing the paste, and fail loudly and clearly when it genuinely is not a
 * key.
 *
 * Note for anyone debugging env precedence: Next loads .env.local AFTER .env,
 * so .env.local wins. A good key in .env does not help if .env.local has a bad
 * one.
 */

const HEX_64 = /^[0-9a-fA-F]{64}$/;

export type KeyResult =
  | { ok: true; key: Hex }
  | { ok: false; reason: "missing" | "malformed" };

export function loadPrivateKey(name = "HOUSE_PRIVATE_KEY"): KeyResult {
  const raw = process.env[name];
  if (!raw || raw.trim() === "") return { ok: false, reason: "missing" };

  // tolerate surrounding quotes and stray whitespace from hand-edited env files
  const cleaned = raw.trim().replace(/^["']|["']$/g, "").trim();
  const body = cleaned.startsWith("0x") || cleaned.startsWith("0X")
    ? cleaned.slice(2)
    : cleaned;

  if (!HEX_64.test(body)) return { ok: false, reason: "malformed" };
  return { ok: true, key: `0x${body.toLowerCase()}` as Hex };
}

/** The JSON body + status a route should return when the key is unusable. */
export function keyErrorResponse(reason: "missing" | "malformed") {
  return reason === "missing"
    ? { body: { ok: false as const, error: "not_configured" }, status: 503 }
    : {
        body: {
          ok: false as const,
          error: "bad_house_key",
          hint:
            "HOUSE_PRIVATE_KEY must be a 32-byte hex private key. Check " +
            ".env.local — it overrides .env.",
        },
        status: 503,
      };
}
