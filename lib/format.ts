/**
 * Display formatting.
 *
 * Everything on screen is either a tap count or an amount of MON. There is no
 * second currency and no conversion rate — this is a testnet faucet, the token
 * is the unit, and inventing a fiat display for a token with no price would be
 * a lie told in a nice font.
 */

const countFormatter = new Intl.NumberFormat("en-US");

export function formatCount(n: number | bigint): string {
  return countFormatter.format(typeof n === "bigint" ? Number(n) : Math.floor(n));
}

/** Compact form for the live wall, where six digits do not fit. 12.4k, 1.2M. */
export function formatCompact(n: number | bigint): string {
  const v = typeof n === "bigint" ? Number(n) : n;
  if (v < 10_000) return countFormatter.format(Math.floor(v));
  if (v < 1_000_000) return `${(v / 1_000).toFixed(1)}k`;
  return `${(v / 1_000_000).toFixed(2)}M`;
}

const WEI_PER_MON = 10n ** 18n;

/** Fixed-precision MON. Used wherever the number sits in a column. */
export function formatMon(wei: bigint, decimals = 3): string {
  const scale = 10n ** BigInt(decimals);
  const scaled = (wei * scale) / WEI_PER_MON;
  return `${(Number(scaled) / Number(scale)).toFixed(decimals)} MON`;
}

/**
 * Exact MON with trailing zeros trimmed. Gas costs are tiny (0.004 MON), so a
 * fixed 3-decimal format renders several of them as "0.004" and a couple as
 * "0.000". Derived from the wei value rather than stored alongside it, so a
 * label can never drift from the amount it describes.
 */
export function formatMonExact(wei: bigint): string {
  const whole = wei / WEI_PER_MON;
  const frac = (wei % WEI_PER_MON).toString().padStart(18, "0").replace(/0+$/, "");
  return frac.length > 0 ? `${whole}.${frac} MON` : `${whole} MON`;
}

/** For an eased counter, which holds a plain number mid-tween. */
export function formatMonNumber(mon: number, decimals = 3): string {
  return `${mon.toFixed(decimals)} MON`;
}

export function weiToMon(wei: bigint): number {
  return Number((wei * 10_000n) / WEI_PER_MON) / 10_000;
}

/** 0x7f2a…4b3c — the leaderboard form. */
export function truncateAddress(address: string): string {
  if (address.length < 12) return address;
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

/** 1st, 2nd, 3rd, 4th. */
export function ordinal(n: number): string {
  const mod100 = n % 100;
  if (mod100 >= 11 && mod100 <= 13) return `${n}th`;
  switch (n % 10) {
    case 1:
      return `${n}st`;
    case 2:
      return `${n}nd`;
    case 3:
      return `${n}rd`;
    default:
      return `${n}th`;
  }
}

/**
 * Time until the round rolls over, as a coarse human string.
 * Rounds are UTC days, so this is the same countdown for everyone on Earth —
 * which is the point of a global arena.
 */
export function timeUntilNextRound(now = Date.now()): string {
  const dayMs = 86_400_000;
  const remaining = dayMs - (now % dayMs);
  const hours = Math.floor(remaining / 3_600_000);
  const minutes = Math.floor((remaining % 3_600_000) / 60_000);
  if (hours > 0) return `${hours}h ${minutes}m`;
  const seconds = Math.floor((remaining % 60_000) / 1000);
  return `${minutes}m ${seconds}s`;
}

/** The round number the contract would return right now. Mirrors currentRound(). */
export function currentRound(now = Date.now()): number {
  return Math.floor(now / 86_400_000) + 1;
}
