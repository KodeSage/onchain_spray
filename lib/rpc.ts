/**
 * RPC endpoint pool.
 *
 * The whole demo lives or dies here. 130 phones tapping twice a second is 260
 * requests/sec. The primary public endpoint allows 50. Pooling all three public
 * endpoints gets us to roughly 100. So we do three things: batch sends
 * (lib/sender.ts), shard clients across the pool (this file), and give the stage
 * exactly one websocket.
 *
 * Limits below are from docs.monad.xyz and are the real published numbers, not
 * guesses. Do not raise them hopefully.
 */

export type RpcEndpoint = {
  id: string;
  label: string;
  http: string;
  ws?: string;
  /** requests per second, sustained, across ALL users of the endpoint */
  rps: number;
  /** JSON-RPC batch limit. 1 means the endpoint rejects batches entirely. */
  batchLimit: number;
  archive: boolean;
  /** relative share of clients assigned here, derived from rps */
  weight: number;
};

/** Optional dedicated key. Public endpoints are the fallback, not the plan. */
const PRIMARY_OVERRIDE = process.env.NEXT_PUBLIC_RPC_PRIMARY?.trim() || "";
const PRIMARY_OVERRIDE_WS = process.env.NEXT_PUBLIC_RPC_PRIMARY_WS?.trim() || "";

const PUBLIC_POOL: RpcEndpoint[] = [
  {
    id: "quicknode",
    label: "QuickNode (public)",
    http: "https://testnet-rpc.monad.xyz",
    ws: "wss://testnet-rpc.monad.xyz",
    rps: 50,
    batchLimit: 100,
    archive: true,
    weight: 50,
  },
  {
    id: "ankr",
    label: "Ankr",
    http: "https://rpc.ankr.com/monad_testnet",
    // 300 requests per 10s == 30 rps sustained
    rps: 30,
    batchLimit: 100,
    archive: false,
    weight: 30,
  },
  {
    id: "monad-foundation",
    label: "Monad Foundation",
    http: "https://rpc-testnet.monadinfra.com",
    ws: "wss://rpc-testnet.monadinfra.com",
    rps: 20,
    // documented: this endpoint does NOT allow batching. Clients assigned here
    // fall back to serial sends. This is load-bearing — batching to it 400s.
    batchLimit: 1,
    archive: false,
    weight: 20,
  },
];

const DEDICATED: RpcEndpoint | null = PRIMARY_OVERRIDE
  ? {
      id: "dedicated",
      label: "Dedicated key (NEXT_PUBLIC_RPC_PRIMARY)",
      http: PRIMARY_OVERRIDE,
      ws: PRIMARY_OVERRIDE_WS || undefined,
      // a paid key is assumed to comfortably exceed the public tier; it takes
      // every client and the public pool becomes pure failover.
      rps: 500,
      batchLimit: 100,
      archive: true,
      weight: 1,
    }
  : null;

/** Every endpoint we are willing to talk to, dedicated first if configured. */
export const ENDPOINTS: RpcEndpoint[] = DEDICATED
  ? [DEDICATED, ...PUBLIC_POOL]
  : [...PUBLIC_POOL];

/** Endpoints eligible for initial assignment (not just failover). */
const ASSIGNABLE: RpcEndpoint[] = DEDICATED ? [DEDICATED] : PUBLIC_POOL;

/** FNV-1a. Small, stable, and identical in node and the browser. */
function hash32(seed: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/**
 * Deterministically assign a client one endpoint, weighted by published rps, so
 * load spreads instead of all 130 phones landing on QuickNode.
 *
 * Deterministic on purpose: the same burner address always gets the same
 * endpoint, so a refresh does not reshuffle the whole room mid-demo.
 */
export function getEndpoint(seed: string): RpcEndpoint {
  const total = ASSIGNABLE.reduce((sum, e) => sum + e.weight, 0);
  let bucket = hash32(seed) % total;
  for (const endpoint of ASSIGNABLE) {
    if (bucket < endpoint.weight) return endpoint;
    bucket -= endpoint.weight;
  }
  return ASSIGNABLE[ASSIGNABLE.length - 1];
}

/**
 * Rotation state for one client. Rotates off an endpoint after repeated 429s
 * rather than on the first one — a single 429 under burst is normal and
 * rotating immediately just moves the burst somewhere else.
 */
export type Rotator = {
  current: () => RpcEndpoint;
  /** Report a rate-limit. Returns true if this caused a rotation. */
  reportRateLimit: () => boolean;
  reportSuccess: () => void;
  rotations: () => number;
};

const ROTATE_AFTER = 3;

export function createRotator(seed: string): Rotator {
  const start = getEndpoint(seed);
  // rotation order: start, then every other endpoint by descending capacity
  const order: RpcEndpoint[] = [
    start,
    ...ENDPOINTS.filter((e) => e.id !== start.id).sort((a, b) => b.rps - a.rps),
  ];

  let index = 0;
  let strikes = 0;
  let rotations = 0;

  return {
    current: () => order[index],
    reportRateLimit: () => {
      strikes += 1;
      if (strikes < ROTATE_AFTER) return false;
      strikes = 0;
      index = (index + 1) % order.length;
      rotations += 1;
      return true;
    },
    reportSuccess: () => {
      strikes = 0;
    },
    rotations: () => rotations,
  };
}

/** The single websocket the stage subscribes on. Prefers a dedicated key. */
export function getStageWebsocket(): string | null {
  const withWs = ENDPOINTS.find((e) => e.ws);
  return withWs?.ws ?? null;
}

export function isRateLimitError(err: unknown): boolean {
  if (!err) return false;
  const status = (err as { status?: number }).status;
  if (status === 429) return true;
  const text = err instanceof Error ? err.message : String(err);
  return /429|rate ?limit|too many requests/i.test(text);
}
