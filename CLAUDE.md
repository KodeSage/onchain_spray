# Onchain Spray

A real-time money-spraying protocol. Nigerian owambe culture — spraying cash on a
dancer — rebuilt as thousands of micro-transactions per minute on Monad.

Two surfaces: a phone app for sprayers, a projector view for the room.

This file is the constitution for the build. Every later decision defers to it.

## Hard constraints

- Built in one day at a hackathon. Every decision optimizes for *works on stage at
  6pm*, not *maintainable in six months*.
- Open source. Clean commits, readable code, real README.
- The demo is the product. If a feature does not appear on the projector during a
  90-second demo, it does not get built.

## The one rule that matters

**A spray must never open a wallet popup.** Not once. If any tap requires user
confirmation, the project has failed.

All signing is local, via an in-browser burner key. Latency from tap to visible
bill must be under 100ms (optimistic). Tap to on-chain confirmation under 1s.

## Non-goals

- No auth, no accounts, no database, no admin panel.
- No mainnet, no real money, no token.
- No mobile native. Web only, mobile-first.
- No wallet connect flow for sprayers. (Host-only, and only if trivial.)

## Stack

- Next.js 15 App Router, TypeScript strict, Tailwind v4
- viem for all chain interaction — no wagmi, no ethers, no RainbowKit
- Foundry for contracts
- Canvas 2D for particle rendering — **not** DOM elements, **not** GSAP for particles

## Aesthetic direction

Nigerian party at night, not crypto dashboard. The full token set lives in
`app/globals.css` and is authoritative — never invent a colour, size or font that
is not in it. `/styleguide` renders every token; it is how drift gets caught.

Banned on sight: purple-blue web3 gradients, glassmorphism, untouched shadcn
defaults, stock crypto iconography, chain logos as decoration, animated
node-network backgrounds.

## Build

Production builds use **webpack** (`next build`), not Turbopack. On Next 15.5.23
`next build --turbopack` emits an incomplete `app-paths-manifest.json` and
silently 404s `/api/relay`, `/styleguide` and `/opengraph-image` — the relay
being missing would take the whole rate-limit strategy down at the venue. Dev
still uses Turbopack, which is unaffected. Verify after any Next upgrade:

    npx next build && cat .next/server/app-paths-manifest.json   # expect 9 routes

## Code standards

- No `any`. No unhandled promise rejections.
- Every network call has a timeout and a failure path.
- Console must be clean during the demo.

## Monad-specific rules

These are not style preferences. They are chain behaviour, and getting them wrong
costs real MON or breaks the demo.

- **Gas is charged on `gas_limit`, not gas used.** A padded gas limit is not free
  headroom — it is a direct, per-tap cost multiplier. Gas limits are tight and
  measured, never "estimate + 40%". See `lib/constants.ts`.
- **Never call `eth_estimateGas` in the tap path.** It is capped at 25 rps on the
  primary endpoint — half the general limit — and costs a round trip.
- **Nonces are held locally**, never fetched per transaction.
- Cold storage access costs 8,100 gas (vs 2,100 on Ethereum). Contracts are
  written to touch as few cold slots as possible in the hot path.
