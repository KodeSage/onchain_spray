import { parseEther, parseGwei } from "viem";

/* ---------------------------------------------------------------------------
   GAS
   ---------------------------------------------------------------------------
   On Monad the sender pays for the gas LIMIT, not gas used:

       gas_paid = gas_limit * price_per_gas

   Every tap is paid for by the house, out of a burner the house funded, so a
   padded limit is not free headroom — it is a direct multiplier on the faucet's
   cost per player. These limits are measured, not guessed. See
   contracts/test/TapGas.t.sol.

   Measured with `npm run contracts:gas`, already Monad-adjusted (tap() touches
   exactly one cold slot, so +6,000 over this Foundry build's Ethereum pricing):

       tap() steady-state      40,058   0.0040 MON @ 100 gwei
       tap() first-for-address 57,146   0.0057 MON
       tap() first-of-new-round40,046   same as steady state, by design
       tapBatch(n)             39,931   0.0000624 MON per tap at n=64

   Two tiers, because an address's first tap writes its Player slot from zero
   (SSTORE_SET, 20,000) and every tap after it is an update (2,900). Paying the
   first-tap limit on every tap would waste ~30% of every burner's balance.
   --------------------------------------------------------------------------- */

/** An address's very first tap: its Player slot goes 0 -> non-zero. */
export const TAP_GAS_LIMIT_FIRST = 60_000n;

/** Every tap after the first. Measured 40,058; ~5% headroom. */
export const TAP_GAS_LIMIT = 42_000n;

/**
 * tapBatch costs the same as tap() regardless of n — the whole point is that
 * 21,000 base and one cold SLOAD are paid once instead of n times.
 */
export const TAP_BATCH_GAS_LIMIT = 42_000n;
export const TAP_BATCH_GAS_LIMIT_FIRST = 60_000n;

/**
 * settleClaim, sent by the house. Measured 47,133 call gas + 21,000 base, plus
 * surcharge on ~3 cold slots. Generous on purpose: this runs once per player
 * per day, not thousands of times a minute, so headroom here costs almost
 * nothing and a failed claim is the worst failure in the product.
 */
export const CLAIM_GAS_LIMIT = 110_000n;

/** A native MON transfer is always exactly this. Never estimated. */
export const TRANSFER_GAS_LIMIT = 21_000n;

/**
 * Fee caps. Worth understanding: on Monad
 *
 *     price_per_gas = min(base + priority, max)
 *
 * so maxFeePerGas is only a cap — setting it generously costs nothing unless
 * the base fee actually rises to meet it. Unlike the gas limit, headroom here
 * is free insurance. The floor base fee is 100 MON-gwei.
 */
export const MAX_FEE_PER_GAS = parseGwei("200");
export const MAX_PRIORITY_FEE_PER_GAS = parseGwei("1");

/** Refreshed in the background at most this often — never in the tap path. */
export const FEE_REFRESH_INTERVAL_MS = 30_000;

/** The floor base fee, used to price a tap when reporting budget in MON. */
export const ASSUMED_GAS_PRICE = parseGwei("100");

/** What one steady-state tap actually costs the house. */
export const TAP_COST_WEI = TAP_GAS_LIMIT * ASSUMED_GAS_PRICE;

/* ---------------------------------------------------------------------------
   FUNDING THE BURNER
   ---------------------------------------------------------------------------
   Funding is lazy and incremental rather than one big grant: of everyone who
   opens the page, only some actually play, and a fixed up-front grant to all of
   them wastes most of the budget on tabs nobody touched.

   A burner's balance is also its tap-rate ceiling. Consensus enforces a
   cumulative gas budget across all inflight transactions in the last 3 blocks
   of min(10 MON, lagged_state_balance), so a burner holding B MON can spend
   B / TAP_COST gas per ~1.2s window. That is why the top-up threshold is set
   where it is rather than as low as possible:

       at 0.06 MON -> 15 taps per window -> ~12 taps/sec ceiling
       at 0.15 MON -> 37 taps per window -> ~31 taps/sec ceiling

   Human autofire is 5 taps/sec, so 0.06 MON keeps a 2.4x margin over the
   fastest a person can actually play.
   --------------------------------------------------------------------------- */

/** Top-ups bring the burner back up to this, rather than adding a fixed sum. */
export const BURNER_TARGET_BALANCE = parseEther("0.15");

/** Below this the client asks for a top-up. Also the rate-ceiling floor. */
export const BURNER_TOP_UP_THRESHOLD = parseEther("0.06");

/**
 * Total gas the house will fund for one address in one round.
 *
 * This is the number that makes the faucet's cost per player bounded. Roughly
 * 75 single taps. It is not a cap on how much you may play — when it is spent
 * the client switches to tapBatch, where a tap costs 1/64th as much and the
 * remaining balance is good for hundreds more. Heavy play automatically becomes
 * the cheap path.
 */
export const BURNER_DAILY_GAS_BUDGET = parseEther("0.30");

/* ---------------------------------------------------------------------------
   THE DRIP
   ---------------------------------------------------------------------------
   What the player actually takes home, to an address they named.

   Scaled by tap count and nothing else. Combo, streak and rank are deliberately
   excluded from the formula: anything that pays out for *how* you tapped rather
   than *that* you tapped is a thing a script does better than a person. Combo
   is worth playing for because it looks good, not because it pays.
   --------------------------------------------------------------------------- */

/** Paid at MIN_TAPS_TO_CLAIM. Must match TapArena.MIN_TAPS_TO_CLAIM. */
export const MIN_TAPS_TO_CLAIM = 25;

export const DRIP_BASE = parseEther("0.05");
export const DRIP_PER_TAP = parseEther("0.001");

/**
 * Ceiling on one claim. Reached at 475 taps. The contract enforces its own,
 * higher ceiling (MAX_CLAIM = 5 MON) as a rail against a bug in this formula.
 */
export const DRIP_MAX = parseEther("0.5");

/** Most one address may be paid in one round, across all claims. */
export const DRIP_DAILY_CAP_PER_ADDRESS = parseEther("0.5");

/** Most one IP may be paid in one round. A few phones on one NAT is normal. */
export const DRIP_DAILY_CAP_PER_IP = parseEther("1.5");

/** Everything the faucet will dispense in one round, drip and gas together. */
export const DAILY_BUDGET = parseEther("50");

/**
 * Which rung of the degradation ladder the arena is on. Decided server-side in
 * /api/status and consumed by the client; declared here so neither side has to
 * import from the other.
 */
export type ArenaMode = "open" | "tightening" | "spectate";

/** Below this share of the daily budget the arena starts coalescing taps. */
export const BUDGET_TIGHTEN_AT = 0.35;

/** Below this share the arena stops settling taps and runs in spectate mode. */
export const BUDGET_SPECTATE_AT = 0.05;

export function dripFor(taps: number): bigint {
  if (taps < MIN_TAPS_TO_CLAIM) return 0n;
  const earned = DRIP_BASE + DRIP_PER_TAP * BigInt(taps - MIN_TAPS_TO_CLAIM);
  return earned > DRIP_MAX ? DRIP_MAX : earned;
}

/* ---------------------------------------------------------------------------
   SENDING
   --------------------------------------------------------------------------- */

/** Taps buffer for this long, then flush as one batched JSON-RPC call. */
export const BATCH_WINDOW_MS = 150;

/** Widened under rate-limit pressure so each request carries more work. */
export const BATCH_WINDOW_MS_DEGRADED = 300;

/** JSON-RPC batch ceiling on QuickNode and Ankr. */
export const MAX_BATCH_SIZE = 100;

/** Bound the queue so a wedged network cannot grow it without limit. */
export const MAX_QUEUE_DEPTH = 400;

/** Press-and-hold auto-fire rate. */
export const AUTOFIRE_INTERVAL_MS = 200;

/**
 * How long taps coalesce into one tapBatch when the arena is tightening.
 * Long enough to gather a worthwhile batch, short enough that the on-chain
 * count never lags the on-screen count by more than a beat.
 */
export const COALESCE_WINDOW_MS = 700;

/** Must match TapArena.MAX_BATCH. */
export const MAX_TAPS_PER_BATCH = 64;

/* ---------------------------------------------------------------------------
   COMBO
   ---------------------------------------------------------------------------
   Pure juice. Affects particle density and the look of the tap target, and
   nothing that pays.
   --------------------------------------------------------------------------- */

/** Taps closer together than this keep the combo alive. */
export const COMBO_WINDOW_MS = 900;

export type ComboTier = {
  at: number;
  label: string;
  /** particles spawned per tap at this tier */
  particles: number;
};

export const COMBO_TIERS: readonly ComboTier[] = [
  { at: 0, label: "warm", particles: 3 },
  { at: 10, label: "flowing", particles: 6 },
  { at: 25, label: "surging", particles: 11 },
  { at: 50, label: "torrent", particles: 18 },
  { at: 100, label: "flood", particles: 28 },
] as const;

export function comboTier(combo: number): ComboTier {
  let tier = COMBO_TIERS[0];
  for (const t of COMBO_TIERS) if (combo >= t.at) tier = t;
  return tier;
}

/* ---------------------------------------------------------------------------
   STORAGE
   ---------------------------------------------------------------------------
   Versioned, and deliberately not the key the spray build used: an old burner
   carries a nonce that belongs to a different contract's history.
   --------------------------------------------------------------------------- */

export const BURNER_STORAGE_KEY = "tap:burner:v1";
export const PAYOUT_STORAGE_KEY = "tap:payout:v1";

/* ---------------------------------------------------------------------------
   ARENA
   --------------------------------------------------------------------------- */

export const PARTICLE_POOL_SIZE = 3000;
export const TPS_WINDOW_MS = 5_000;
export const LEADERBOARD_SIZE = 8;
