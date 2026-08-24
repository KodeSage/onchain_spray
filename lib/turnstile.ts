import { HTTP_TIMEOUT_MS } from "./chain";

/**
 * Cloudflare Turnstile verification.
 *
 * The gate sits on claim and nowhere else. Putting a challenge in front of
 * tapping would break the one rule the product has — a tap is instant and
 * uninterrupted — and would not buy much anyway, since a tap costs the attacker
 * gas and yields them nothing. The money leaves at claim, so that is where the
 * proof-of-humanity belongs.
 */

const VERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";

export type TurnstileResult =
  | { ok: true; skipped?: boolean }
  | { ok: false; reason: "missing_token" | "rejected" | "unavailable" };

export function turnstileConfigured(): boolean {
  return Boolean(process.env.TURNSTILE_SECRET_KEY?.trim());
}

export async function verifyTurnstile(
  token: string | undefined,
  ip: string
): Promise<TurnstileResult> {
  const secret = process.env.TURNSTILE_SECRET_KEY?.trim();

  // Unset in development, so the claim flow can be exercised end to end without
  // a Cloudflare account. requireTurnstile() is what stops this reaching prod.
  if (!secret) return { ok: true, skipped: true };

  if (!token) return { ok: false, reason: "missing_token" };

  const body = new URLSearchParams({ secret, response: token });
  if (ip && ip !== "unknown") body.set("remoteip", ip);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), HTTP_TIMEOUT_MS);

  try {
    const res = await fetch(VERIFY_URL, {
      method: "POST",
      body,
      signal: controller.signal,
    });
    if (!res.ok) return { ok: false, reason: "unavailable" };

    const data = (await res.json()) as { success?: boolean };
    return data.success === true ? { ok: true } : { ok: false, reason: "rejected" };
  } catch {
    // A Cloudflare outage must not become an open faucet. Fail closed and let
    // the caller tell the player to try again.
    return { ok: false, reason: "unavailable" };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * A production deployment with no Turnstile secret has no proof-of-humanity at
 * all. Like the durable store, it fails closed rather than quietly degrading.
 */
export function requireTurnstile(): { ok: true } | { ok: false; error: string } {
  if (!turnstileConfigured() && process.env.NODE_ENV === "production") {
    return { ok: false, error: "captcha_not_configured" };
  }
  return { ok: true };
}
