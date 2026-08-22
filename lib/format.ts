/**
 * Display formatting.
 *
 * Everything the room reads is in naira, not MON — nobody at an owambe thinks
 * in tokens, and "₦8,750,000 sprayed" lands on a projector in a way that
 * "8.75 MON" never will. The rate is linear and fixed so the totals add up.
 */

/** 1 MON displays as ₦1,000,000. */
export const NAIRA_PER_MON = 1_000_000n;
const WEI_PER_MON = 10n ** 18n;

export function weiToNaira(wei: bigint): number {
  // scale before narrowing so small sprays do not round to zero
  return Number((wei * NAIRA_PER_MON * 100n) / WEI_PER_MON) / 100;
}

const nairaFormatter = new Intl.NumberFormat("en-NG", {
  maximumFractionDigits: 0,
});

export function formatNaira(wei: bigint): string {
  return `₦${nairaFormatter.format(Math.floor(weiToNaira(wei)))}`;
}

/** For an eased counter, which holds a plain number mid-tween. */
export function formatNairaNumber(naira: number): string {
  return `₦${nairaFormatter.format(Math.floor(naira))}`;
}

const countFormatter = new Intl.NumberFormat("en-US");

export function formatCount(n: number | bigint): string {
  return countFormatter.format(typeof n === "bigint" ? Number(n) : Math.floor(n));
}

/** 0x7f2a…4b3c — the leaderboard form. */
export function truncateAddress(address: string): string {
  if (address.length < 12) return address;
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

export function formatMon(wei: bigint, decimals = 3): string {
  const whole = Number(wei) / 1e18;
  return `${whole.toFixed(decimals)} MON`;
}

/**
 * Exact MON, with trailing zeros trimmed. Denominations are tiny (0.0002 MON),
 * so a fixed 3-decimal format would render several of them as "0.000 MON".
 * Derived from `value` rather than stored alongside it, so the label can never
 * drift from the amount actually sprayed.
 */
export function formatMonExact(wei: bigint): string {
  const whole = wei / 10n ** 18n;
  const frac = (wei % 10n ** 18n).toString().padStart(18, "0").replace(/0+$/, "");
  return frac.length > 0 ? `${whole}.${frac} MON` : `${whole} MON`;
}
