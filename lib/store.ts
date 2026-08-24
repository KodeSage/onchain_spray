import { Redis } from "@upstash/redis";

/**
 * Durable counters for the faucet.
 *
 * The build this grew out of kept its rate limits in module-level Maps. That is
 * correct for a party that runs for ninety minutes on one process, and useless
 * for a public faucet: a serverless route is many instances, each cold-starting
 * with an empty Map, so the "limit" resets whenever the platform feels like it.
 * Anything that guards money lives here instead.
 *
 * UNITS. Every amount in this module is GWEI, not wei. Redis INCRBY is a signed
 * 64-bit integer (max 9.2e18) and the daily budget in wei is 5e19, which would
 * silently wrap. Gwei puts the same budget at 5e10 with room to spare, and a
 * faucet has no use for sub-gwei precision. Convert at the boundary with
 * toGwei/fromGwei and never store a wei value here.
 */

const GWEI = 1_000_000_000n;

export function toGwei(wei: bigint): number {
  return Number(wei / GWEI);
}

export function fromGwei(gwei: number): bigint {
  return BigInt(Math.round(gwei)) * GWEI;
}

/** Counters outlive their round by a day, so a late claim still sees them. */
const TTL_SECONDS = 60 * 60 * 48;

export type ReserveResult = {
  ok: boolean;
  /** Total already committed against this key, after the attempt. */
  used: number;
  /** What was left before this attempt. */
  remaining: number;
};

export type Store = {
  configured: boolean;
  /** Durable, or an in-process stand-in that is not safe for production. */
  durable: boolean;
  get(key: string): Promise<number>;
  /**
   * Atomically commit `amount` against `key` unless that would exceed `cap`.
   *
   * Increment-then-refund rather than check-then-increment: two concurrent
   * requests that both read "under the cap" and then both write would each
   * think they were fine. Incrementing first means concurrent callers see each
   * other, and the loser gives its share straight back. The cap can never be
   * exceeded; it can transiently appear fuller than it is, which is the safe
   * direction for something guarding a wallet.
   */
  reserve(key: string, amount: number, cap: number): Promise<ReserveResult>;
  /** Give back a reservation whose transaction did not land. */
  refund(key: string, amount: number): Promise<void>;
};

function redisFromEnv(): Redis | null {
  const url = process.env.UPSTASH_REDIS_REST_URL?.trim();
  const token = process.env.UPSTASH_REDIS_REST_TOKEN?.trim();
  if (!url || !token) return null;
  try {
    return new Redis({ url, token });
  } catch {
    return null;
  }
}

function createRedisStore(redis: Redis): Store {
  return {
    configured: true,
    durable: true,
    async get(key) {
      const value = await redis.get<string | number>(key);
      return value === null || value === undefined ? 0 : Number(value);
    },
    async reserve(key, amount, cap) {
      const used = await redis.incrby(key, amount);
      // Always re-arm the TTL. A daily key that keeps being written should keep
      // living; one that stops being written should expire.
      await redis.expire(key, TTL_SECONDS);

      if (used > cap) {
        const after = await redis.incrby(key, -amount);
        return { ok: false, used: after, remaining: Math.max(0, cap - after) };
      }
      return { ok: true, used, remaining: Math.max(0, cap - used) };
    },
    async refund(key, amount) {
      await redis.incrby(key, -amount);
    },
  };
}

/**
 * Development stand-in.
 *
 * Deliberately NOT used in production — see requireStore. Having `npm run dev`
 * demand an Upstash account before the page will render would be a bad trade,
 * but shipping this to a public URL would mean shipping no rate limiting at all.
 */
function createMemoryStore(): Store {
  const counters = new Map<string, number>();
  return {
    configured: false,
    durable: false,
    async get(key) {
      return counters.get(key) ?? 0;
    },
    async reserve(key, amount, cap) {
      const used = (counters.get(key) ?? 0) + amount;
      if (used > cap) {
        const current = counters.get(key) ?? 0;
        return { ok: false, used: current, remaining: Math.max(0, cap - current) };
      }
      counters.set(key, used);
      return { ok: true, used, remaining: Math.max(0, cap - used) };
    },
    async refund(key, amount) {
      counters.set(key, Math.max(0, (counters.get(key) ?? 0) - amount));
    },
  };
}

let cached: Store | null = null;

export function getStore(): Store {
  if (!cached) {
    const redis = redisFromEnv();
    cached = redis ? createRedisStore(redis) : createMemoryStore();
    if (!redis && process.env.NODE_ENV !== "production") {
      console.warn(
        "[store] UPSTASH_REDIS_REST_URL/TOKEN unset — using an in-process store. " +
          "Rate limits will not survive a restart. Never deploy this way."
      );
    }
  }
  return cached;
}

/**
 * The store, or an explanation of why the faucet is closed.
 *
 * A production deployment without durable counters is not a degraded faucet, it
 * is an open wallet. It fails closed.
 */
export function requireStore(): { ok: true; store: Store } | { ok: false; error: string } {
  const store = getStore();
  if (!store.durable && process.env.NODE_ENV === "production") {
    return { ok: false, error: "store_not_configured" };
  }
  return { ok: true, store };
}

/* -------------------------------------------------------------------------
   Key naming
   -------------------------------------------------------------------------
   Every key carries the round, so yesterday's counters can never gate today's
   claims and nothing needs a reset job. Addresses are lowercased so the same
   wallet cannot get two allowances by changing its checksum casing.
   ------------------------------------------------------------------------- */

export const keys = {
  dripByAddress: (round: number, address: string) =>
    `tap:${round}:drip:addr:${address.toLowerCase()}`,
  dripByIp: (round: number, ip: string) => `tap:${round}:drip:ip:${ip}`,
  gasByAddress: (round: number, address: string) =>
    `tap:${round}:gas:addr:${address.toLowerCase()}`,
  gasByIp: (round: number, ip: string) => `tap:${round}:gas:ip:${ip}`,
  dailyBudget: (round: number) => `tap:${round}:budget`,
};

/** One IP is usually one person; a few devices behind one NAT is normal. */
export function clientIp(req: Request): string {
  const forwarded = req.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0].trim();
  return req.headers.get("x-real-ip") ?? "unknown";
}
