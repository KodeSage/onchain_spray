# Tap

A gamified testnet faucet for the Monad ecosystem.

`faucet.monad.xyz` gives you MON and you leave. Tap makes you *earn* it, in a
live global arena where every tap is a real transaction, and gives you a reason
to come back tomorrow.

A tap is a faucet. Tapping is the game. That is the whole name.

This file is the constitution for the build. Every later decision defers to it.

## What this is

One global, always-on arena. No rooms, no instances, no per-event state. A
player lands, gets an in-browser burner seeded with gas by the house, taps as
fast as they like, and claims a drip of MON to an address they name. The
leaderboard resets daily; so do the caps.

## Hard constraints

- Open source. Clean commits, readable code, real README.
- Testnet only (chain 10143). No mainnet, no real money, no token.
- Web only, mobile-first, one responsive surface. There is no separate
  projector build — the particle canvas is the page background.

## The one rule that matters

**A tap must never open a wallet popup.** Not once. If any tap requires user
confirmation, the project has failed.

All signing is local, via an in-browser burner key. Latency from tap to visible
droplet must be under 100ms (optimistic). Tap to on-chain confirmation under 1s.

The player pastes a payout address. They never connect a wallet.

## The faucet is the product, and faucets get drained

This is the line that separates Tap from the app it grew out of. A party app
runs for ninety minutes in a room you can see. A faucet is public, permanent and
adversarial, and every design decision has to assume someone is trying to empty
it.

- **Durable rate limits, always.** Per-address, per-IP and per-day caps live in
  Redis, never in a module-level `Map`. In-memory limits reset on every
  serverless cold start and are per-instance — they are not rate limits, they
  are the appearance of rate limits.
- **A global daily budget governor.** The house wallet is itself drip-fed from
  the public faucet. When the day's budget is spent the arena degrades on
  purpose (see below) instead of failing at the RPC.
- **Double-claim prevention is on-chain**, in `settleClaim`, so it survives a
  Redis wipe and anyone can audit it.
- **Proof-of-humanity on claim** (Turnstile), never on tap. Gameplay stays
  frictionless; the gate sits where the money leaves.
- The contract is operator-trusted for the claim *amount* and trustless for the
  claim *eligibility*. Say so plainly in the README rather than implying more.

## Non-goals

- No auth, no accounts, no admin panel. Redis holds counters and nothing that
  identifies a person.
- No wallet connect, for anybody.
- No mobile native.

## Stack

- Next.js 15 App Router, TypeScript strict, Tailwind v4
- viem for all chain interaction — no wagmi, no ethers, no RainbowKit
- Foundry for contracts
- Canvas 2D for particle rendering — **not** DOM elements, **not** GSAP
- Upstash Redis (REST) for durable counters — REST, because a pooled TCP client
  in a serverless route is its own outage
- Cloudflare Turnstile for the claim gate

## Aesthetic direction

Water and voltage. A faucet that feels like an arcade cabinet, not a crypto
dashboard and not a rewards portal. Dark, fast, loud with motion and quiet with
chrome.

The full token set lives in `app/globals.css` and is authoritative — never
invent a colour, size or font that is not in it. `/styleguide` renders every
token; it is how drift gets caught.

Monad's brand purple is legitimate here and is the primary accent — this is an
ecosystem product. That is not licence for the thing below.

Banned on sight: purple-blue web3 gradients, glassmorphism, untouched shadcn
defaults, stock crypto iconography, chain logos as decoration, animated
node-network backgrounds.

## Build

Production builds use **webpack** (`next build`), not Turbopack. On Next 15.5.23
`next build --turbopack` emits an incomplete `app-paths-manifest.json` and
silently 404s API routes — `/api/relay` and `/api/claim` going missing would
take the faucet down without an error. Dev still uses Turbopack, which is
unaffected. Verify after any Next upgrade:

    npx next build && cat .next/server/app-paths-manifest.json

## Code standards

- No `any`. No unhandled promise rejections.
- Every network call has a timeout and a failure path.
- Console must be clean.

## Monad-specific rules

These are not style preferences. They are chain behaviour, and getting them
wrong costs real MON or breaks the arena.

- **Gas is charged on `gas_limit`, not gas used.** A padded gas limit is not
  free headroom — it is a direct, per-tap cost multiplier paid by the house on
  every tap of every player. Gas limits are tight and measured, never
  "estimate + 40%". See `lib/constants.ts` and `contracts/test/TapGas.t.sol`.
- **Never call `eth_estimateGas` in the tap path.** It is capped at 25 rps on
  the primary endpoint — half the general limit — and costs a round trip.
- **Nonces are held locally**, never fetched per transaction.
- Cold storage access costs 8,100 gas (vs 2,100 on Ethereum). `tap()` touches
  exactly one cold slot, and it is the caller's own.
- **No global counter in the hot path.** Monad executes optimistically in
  parallel and re-executes on conflict. A single shared `totalTaps` slot would
  make every tap conflict with every other tap — correctness is unaffected,
  throughput is not, and this app exists to demonstrate throughput. Global
  numbers are rebuilt from events on the client, which is free.
- **A burner's tap-rate ceiling is its balance.** Consensus enforces a
  cumulative gas budget across all inflight transactions in the last 3 blocks of
  `min(10 MON, lagged_state_balance)`. A burner below 10 MON is not throttled to
  one tx per 1.2s — it gets `balance / gas_cost` transactions per 1.2s window.
  That is why `LOW_BALANCE_THRESHOLD` is a throttling threshold, not a
  convenience, and why it is set well above one window's worth of taps.
- **A newly funded account cannot transact for ~1.2s** (3 blocks), because
  consensus validates gas budgets against a delayed state view. Burners are
  therefore generated and funded on page load, in the background, while the
  player is still reading — never at the moment they press start.

## Degradation ladder

The arena never shows an error where it can show less arena. In order:

1. **Funded and healthy** — one tap, one transaction. Full particle density.
2. **Budget tightening** — client switches to `tapBatch`, coalescing taps in a
   short window. Same score, same feel, a fraction of the gas.
3. **Budget spent for the day** — taps stop settling on chain, the arena runs in
   spectate mode with the live wall still fed by other players, and the claim
   panel says exactly when it refills.
