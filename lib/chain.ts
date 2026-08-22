import { createPublicClient, defineChain, http, webSocket } from "viem";
import { ENDPOINTS, getStageWebsocket } from "./rpc";

/**
 * Monad testnet. Values verified against docs.monad.xyz and against a live
 * eth_chainId call (returns 0x279f).
 *
 * Note: testnet was reset from genesis on 2025-12-16. Assume no pre-existing
 * state and a fresh faucet balance.
 */
export const monadTestnet = defineChain({
  id: 10143,
  name: "Monad Testnet",
  nativeCurrency: { name: "Monad", symbol: "MON", decimals: 18 },
  rpcUrls: {
    default: { http: [ENDPOINTS[0].http] },
  },
  blockExplorers: {
    default: {
      name: "MonadVision",
      url: "https://testnet.monadvision.com",
    },
    monadscan: {
      name: "MonadScan",
      url: "https://testnet.monadscan.com",
    },
  },
  testnet: true,
});

export const FAUCET_URL = "https://faucet.monad.xyz";

/** Every network call has a timeout. No exceptions. */
export const HTTP_TIMEOUT_MS = 8_000;
export const WS_TIMEOUT_MS = 12_000;

/** Shared read client. Reads only — sends go through lib/sender.ts. */
export const publicClient = createPublicClient({
  chain: monadTestnet,
  transport: http(ENDPOINTS[0].http, {
    timeout: HTTP_TIMEOUT_MS,
    retryCount: 2,
    retryDelay: 150,
  }),
});

/** Build a read client against a specific endpoint (used by the rotator). */
export function httpClientFor(url: string) {
  return createPublicClient({
    chain: monadTestnet,
    transport: http(url, {
      timeout: HTTP_TIMEOUT_MS,
      retryCount: 1,
      retryDelay: 150,
    }),
  });
}

/**
 * The stage's single websocket client. The projector opens exactly one
 * subscription, never polls, and never calls the contract — its entire read
 * cost is one connection.
 */
export function createStageWsClient() {
  const url = getStageWebsocket();
  if (!url) return null;
  return createPublicClient({
    chain: monadTestnet,
    transport: webSocket(url, {
      timeout: WS_TIMEOUT_MS,
      keepAlive: { interval: 15_000 },
      reconnect: false, // we manage reconnect + backfill ourselves in lib/stage-feed.ts
    }),
  });
}

export function explorerTx(hash: string): string {
  return `${monadTestnet.blockExplorers.default.url}/tx/${hash}`;
}

export function explorerAddress(address: string): string {
  return `${monadTestnet.blockExplorers.default.url}/address/${address}`;
}
