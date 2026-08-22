import { parseEther, parseGwei } from "viem";

/* ---------------------------------------------------------------------------
   GAS
   ---------------------------------------------------------------------------
   On Monad the sender pays for the gas LIMIT, not gas used:

       gas_paid = gas_limit * price_per_gas

   So a padded limit is not free headroom — it is a direct per-tap cost
   multiplier, paid on every one of the ~17,000 taps in a 90-second demo. These
   limits are measured, not guessed. See contracts/test/SprayGas.t.sol.

   Measured with `forge test --match-contract SprayGasTest -vv`:

       steady-state spray   26,905 call gas + 21,000 base = 47,905
       first-per-address    44,005 call gas + 21,000 base = 65,005

   Those are EVM prices. Monad charges 8,100 for a cold SLOAD where Ethereum
   charges 2,100 (verified locally in test/ColdStoragePricing.t.sol, which shows
   this Foundry build using Ethereum pricing). spray() touches two cold slots —
   the party's packed hot slot and sprayedBy[partyId][sprayer] — so add
   2 x 6,000 = 12,000:

       steady-state         ~59,905  on Monad
       first-per-address    ~77,005  on Monad

   Two tiers, because an address's first spray writes sprayedBy from zero
   (SSTORE_SET, 20,000) and every spray after it is an update (2,900). Paying
   the first-spray limit on all 300 taps would waste ~25% of every burner's
   balance.
   --------------------------------------------------------------------------- */

/** An address's very first spray on a party: sprayedBy goes 0 -> non-zero. */
export const SPRAY_GAS_LIMIT_FIRST = 80_000n;

/** Every spray after the first. */
export const SPRAY_GAS_LIMIT = 62_000n;

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

/* ---------------------------------------------------------------------------
   DENOMINATIONS
   ---------------------------------------------------------------------------
   The spectacle is the COUNT of transactions, not the value of each one. These
   are deliberately tiny: at these amounts a burner's balance is spent almost
   entirely on gas (~0.0063 MON a tap), and the sprayed value itself is rounding
   error. Labelled in naira, because nobody at an owambe thinks in tokens — the
   rate is linear (1 MON = NGN 1,000,000, see lib/format.ts) so the running
   total on the projector actually adds up.
   --------------------------------------------------------------------------- */

export type Denomination = {
  id: "small" | "medium" | "large";
  label: string;
  sublabel: string;
  value: bigint;
  /** particles spawned on the stage per spray at this denomination */
  particles: number;
};

export const DENOMINATIONS: readonly Denomination[] = [
  {
    id: "small",
    label: "₦200",
    sublabel: "small",
    value: parseEther("0.0002"),
    particles: 3,
  },
  {
    id: "medium",
    label: "₦500",
    sublabel: "medium",
    value: parseEther("0.0005"),
    particles: 8,
  },
  {
    id: "large",
    label: "₦1000",
    sublabel: "large",
    value: parseEther("0.001"),
    particles: 22,
  },
] as const;

export const DEFAULT_DENOMINATION = DENOMINATIONS[1];

/** At or above this, the stage takes over the screen and the room cheers. */
export const BIG_SPRAY_THRESHOLD = parseEther("0.001");

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

/* ---------------------------------------------------------------------------
   FUNDING
   --------------------------------------------------------------------------- */

/** localStorage key for the burner. Versioned so a format change is a no-op. */
export const BURNER_STORAGE_KEY = "onchain-spray:burner:v1";
export const FUNDED_STORAGE_KEY = "onchain-spray:funded:v1";

/** Below this, the client asks /api/fund for a top-up. */
export const LOW_BALANCE_THRESHOLD = parseEther("0.05");

/* ---------------------------------------------------------------------------
   STAGE
   --------------------------------------------------------------------------- */

export const PARTICLE_POOL_SIZE = 3000;
export const TPS_WINDOW_MS = 5_000;
export const LEADERBOARD_SIZE = 5;
