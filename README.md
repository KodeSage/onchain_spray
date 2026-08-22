<div align="center">

# 💸 Onchain Spray

**At a Nigerian party you don't send one transfer — you spray hundreds of small
notes, as fast as the music.**

Owambe culture rebuilt as thousands of micro-transactions per minute on Monad.
Scan a QR, tap a stack of notes, and every single tap is a real on-chain
transaction. No wallet popup. No signing prompt. No confirmation. Ever.

[![Live Demo](https://img.shields.io/badge/▶_Live_Demo-onchain--spray.vercel.app-00D26A?style=for-the-badge)](https://onchain-spray.vercel.app/)
[![Contract](https://img.shields.io/badge/Contract-0x1fd7…16ff-836EF9?style=for-the-badge)](https://testnet.monadvision.com/address/0x1fd73540851e43883d7742ee04eeca5f750d16ff)
[![Monad Testnet](https://img.shields.io/badge/Monad-Testnet_10143-FFC940?style=for-the-badge)](https://testnet.monadvision.com/)

Built in one day at **Monad Blitz Abuja**.

</div>

---

## 🔗 Deployment

Live on Monad testnet (chain `10143`). Everything below is verifiable on chain
right now — no screenshots, no mocks.

| | |
|---|---|
| **Live demo** | **<https://onchain-spray.vercel.app/>** |
| **Deployed contract** | [`0x1fd73540851e43883d7742Ee04EeCa5f750D16ff`](https://testnet.monadvision.com/address/0x1fd73540851e43883d7742ee04eeca5f750d16ff) |
| **Deployment transaction** | [`0x1305e195f03face3f03f64e0b32715d13f1ebe72d23b71e0eb3ccfd10bb05188`](https://testnet.monadvision.com/tx/0x1305e195f03face3f03f64e0b32715d13f1ebe72d23b71e0eb3ccfd10bb05188) |
| **Deployed at** | block `55,928,828` · 2026-08-22 11:50:31 UTC |
| **Deploy gas used** | 779,509 @ 104.5 gwei |
| **Contract source** | [`contracts/src/SprayParty.sol`](contracts/src/SprayParty.sol) |
| **Explorer** | [MonadVision](https://testnet.monadvision.com/) |

### See it without installing anything

| link | what it shows |
|---|---|
| [**Landing**](https://onchain-spray.vercel.app/) | enter a wallet address, open a party |
| [**Stage / projector**](https://onchain-spray.vercel.app/stage/0) | the room's view — live total, leaderboard, tx/sec, flying notes |
| [**Spray / phone**](https://onchain-spray.vercel.app/spray/0) | open on your phone and tap. It really sends transactions |
| [**Offline demo**](https://onchain-spray.vercel.app/stage/0?demo=1) | identical render pipeline, **zero** network calls |
| [**Styleguide**](https://onchain-spray.vercel.app/styleguide) | every design token, rendered |

> Party `0` on the live contract is **"Monad Blitz Abuja"**. Four parties have
> been opened on this deployment so far.

---

## The one rule that matters

> ### A spray must never open a wallet popup. Not once.

That single constraint dictates the entire architecture. If any tap required
user confirmation, the product would not exist — you cannot approve a MetaMask
prompt two hundred times in ninety seconds while dancing.

**Measured budget:**

| | target | measured |
|---|---|---|
| tap → visible note | < 100ms | **~16ms** (one frame, optimistic) |
| synchronous cost of a tap | — | **p50 0.48ms · p95 0.55ms** |
| tap → on-chain confirmation | < 1s | sub-second |

Verify it yourself: `npm run bench`.

---

## How it works

```
        PHONE  /spray/:id                          PROJECTOR  /stage/:id
  ┌────────────────────────────┐            ┌──────────────────────────────┐
  │  burner key in localStorage│            │  ONE websocket subscription  │
  │  local nonce counter       │            │  totals + leaderboard        │
  │  sign locally  (0.5ms)     │            │    rebuilt from events only  │
  │  no RPC call in tap path   │            │  canvas particle pool (3000) │
  └─────────────┬──────────────┘            └──────────────▲───────────────┘
                │ POST signed raw tx                       │
                ▼                                          │
        ┌───────────────┐   JSON-RPC batch ×100    ┌────────┴────────┐
        │  /api/relay   │ ───────────────────────► │  Monad testnet  │
        │ batches ACROSS│                          │   chain 10143   │
        │  all clients  │ ◄─── Sprayed event ──────│                 │
        └───────────────┘                          └─────────────────┘
```

### 1. Burner keys in the browser — this is the whole trick

On first visit the phone generates a private key with viem, stores it in
`localStorage`, and receives a small drip of testnet MON from `/api/fund`.
Nothing is ever confirmed by the user **because the key is local**.

The person *being sprayed* needs even less. They type their wallet address on
the landing page, `/api/create-party` opens a party for them, and every naira
sprayed there is payable to that address on chain. No extension, no gas, no
signature — **on either side of the transaction.**

### 2. The tap path touches the network zero times

A nonce comes from a local counter. The transaction is signed locally. The
signed payload goes on a queue. There is no `eth_estimateGas`, no fee lookup, no
nonce fetch, no awaited receipt. The note animation fires optimistically inside
the `pointerdown` handler — before signing even begins.

### 3. A cross-client relay makes the rate limits fit

This was the hardest problem, and the first solution was wrong.

The obvious plan is to batch taps *inside* each client. Measured, that gives
**1.0× compression and does nothing** — one person tapping twice a second
accumulates 0.3 transactions per 150ms window. To fill a batch of ten inside one
client you would have to tap 67 times a second.

Batching has to happen **across clients**. 130 phones at 2 taps/sec is 260
tx/sec arriving at `/api/relay`; flushed every 150ms and forwarded as JSON-RPC
batches of up to 100, that collapses to a handful of requests per second against
a 50 rps limit.

Clients still sign locally — the relay forwards opaque signed payloads and
**cannot alter, reorder within a sender, or forge them. It never sees a key.**

### 4. The event *is* the entire read API

`Sprayed` carries `newTotal` and `count` in its payload, so the projector
reconstructs the running total and the leaderboard from events alone — one
websocket, no polling, **zero contract reads**. Party identity is read once at
mount from `partyInfo`, so nothing about the party is hardcoded in a component.

### 5. Canvas particles, not DOM

A preallocated pool of 3,000 note objects rendered on a Canvas 2D context.
Nothing is allocated per spray.

---

## ⛽ Gas engineering

On Monad **you pay for the gas `limit`, not gas used.** A padded limit is not
free headroom — it is a direct per-tap cost multiplier, paid on every one of the
~17,000 taps in a 90-second demo. So `spray()` was designed backwards from a gas
budget.

Measured with `npm run contracts:gas`:

| case | EVM pricing | Monad (cold SLOAD 8,100, not 2,100) | limit shipped |
|---|---|---|---|
| steady-state spray | 47,883 | **~59,883** | `62,000` |
| first spray per address | 64,983 | **~76,983** | `80,000` |

The first spray costs more because `sprayedBy` goes zero → non-zero
(`SSTORE_SET`, 20,000). The client ships **two** gas limits accordingly — paying
the first-spray limit on all 300 taps would waste ~25% of every burner's balance.

Structural choices that follow from that budget:

- no dynamic arrays
- `bytes32` party names — no string writes in the hot path
- no external calls during `spray()` (the recipient is paid later, on a timer)
- the `Party` struct is ordered so the three fields `spray()` touches —
  `active`, `total`, `count` — share **one** storage slot

```
slot 0 │ host (20 bytes) + withdrawn (12 bytes)   ← exactly full
slot 1 │ recipient
slot 2 │ name (bytes32)
slot 3 │ active (1) + total (16) + count (8)      ← the hot slot
```

`spray()` reads and writes slot 3 and nothing else in the struct: one cold
SLOAD, one warm SSTORE. `recipient` deliberately lives outside the hot path, so
adding it costs `spray()` nothing.

> **Known trade-off, stated honestly.** The `sprayedBy` mapping costs ~11,000
> gas per tap (~18%) and nothing in the demo reads it — the leaderboard is
> rebuilt from events. Removing it would bring steady-state under the 50,000
> target and cut the funding budget by ~16%. It is kept because it is the
> on-chain record of who sprayed what.

---

## 📜 Contract

[`contracts/src/SprayParty.sol`](contracts/src/SprayParty.sol) — **21 tests, all
passing** (`npm run contracts:test`), including fuzz coverage on spray
accumulation.

```solidity
createParty(bytes32 name, address recipient) returns (uint256 partyId)
spray(uint256 partyId) payable          // the hot path
payout(uint256 partyId)                 // permissionless — always pays `recipient`
endParty(uint256 partyId)               // host only
partyInfo(uint256 partyId) view         // tooling only, never in the hot path

event Sprayed(uint256 indexed partyId, address indexed sprayer,
              uint256 amount, uint256 newTotal, uint64 count);
event PartyCreated(uint256 indexed partyId, address indexed host,
                   address indexed recipient, bytes32 name);
```

**`recipient` is set once at creation and is immutable.** The host cannot
redirect the money to themselves — there is a test for exactly that
(`test_payout_hostCannotTakeTheMoney`).

**`payout` is deliberately permissionless.** The funds can only ever reach the
address fixed at creation, so letting the stage trigger the sweep on a timer is
free and means the person being sprayed needs no gas and no wallet popup. The
money lands in their wallet *while the room is still spraying.*

**`spray()` deliberately does not forward per tap.** A value-bearing call to a
cold account on every tap is ~19,000 extra gas on Monad — a ~32% increase on a
function called thousands of times a minute, plus reentrancy surface on the
hottest path in the system. Sweeping on a timer costs one transaction per sweep.

---

## 🚀 Local setup

Requires **Node 20+** and [Foundry](https://book.getfoundry.sh/getting-started/installation).

```bash
git clone <this repo>
cd onchain_spray
npm install

cp .env.example .env.local
cp .env.example .env          # Foundry reads .env
```

Put a funded Monad testnet key in `.env` as `PRIVATE_KEY` (get MON from
[faucet.monad.xyz](https://faucet.monad.xyz)). That wallet becomes the party
host. Set `PARTY_NAME` to whoever is being sprayed. Then:

```bash
npm run contracts:test        # 21 tests
npm run deploy                # deploys, verifies, writes the address to .env.local
npm run dev
```

Open <http://localhost:3000/stage/0> on the projector and
<http://localhost:3000/spray/0> on a phone.

### Run it with no contract and no key

```bash
npm run dev
# → http://localhost:3000/stage/0?demo=1    synthetic events, zero network calls
# → http://localhost:3000/styleguide        every design token
```

Both work on a fresh clone.

### Build note

Production builds use **webpack** (`next build`), not Turbopack. On Next 15.5.23
`next build --turbopack` emits an incomplete `app-paths-manifest.json` and
silently 404s `/api/relay`, `/styleguide` and `/opengraph-image`. Dev uses
Turbopack and is unaffected. Verify after any Next upgrade:

```bash
npx next build && cat .next/server/app-paths-manifest.json   # expect 9 routes
```

---

## 💰 Funding maths — read this before running an event

This is the thing most likely to kill a live demo, and it is a **logistics**
problem, not a code problem.

You pay for the gas limit, not gas used. At a base fee of ~102 gwei and a
measured steady-state `spray()`:

| | |
|---|---|
| gas per tap | ~0.0063 MON |
| 200 taps per burner | ~1.27 MON |
| **130 burners × 200 taps** | **~165 MON** |

The public faucet drips small amounts per day, so **the master wallet cannot be
filled on the morning of the event.** Fund it days in advance across multiple
claims, or ask the Monad team for a testnet grant.

Two things reduce the number:

- **Funding is lazy.** `/api/fund` tops burners up when they run low rather than
  granting everyone a fixed amount up front. Of 130 people who scan, only some
  tap hard — so MON follows actual tapping.
- **The sprayed value is not burned.** Only gas is. Sprays accumulate in the
  contract and `/api/payout` sweeps them to the recipient every 10 seconds.

Verify the wallet by reading its balance, never by assuming:

```bash
npm run preflight
```

---

## 🌐 RPC pool

Clients are assigned an endpoint deterministically by hashing their burner
address, weighted by published capacity, so load spreads instead of 130 phones
landing on QuickNode. On repeated 429s a client rotates to the next endpoint and
widens its batch window.

| endpoint | rps | batch |
|---|---|---|
| QuickNode `testnet-rpc.monad.xyz` | 50 | 100 |
| Ankr `rpc.ankr.com/monad_testnet` | 30 | 100 |
| Monad Foundation `rpc-testnet.monadinfra.com` | 20 | **none** |

Set `NEXT_PUBLIC_RPC_PRIMARY` to a dedicated key (Alchemy, QuickNode and
thirdweb all offer a free Monad testnet key) and every client is assigned there,
with the public pool as failover. **Public endpoints are the fallback, not the
plan.**

---

## 🧰 Scripts

| command | what it does |
|---|---|
| `npm run dev` | the app |
| `npm run preflight` | pre-demo checklist — reads real chain state |
| `npm run bench` | measures tap-path latency and the offline demo feed |
| `npm run rate-check` | simulates 130 clients against the endpoint pool |
| `npm run load-test` | fires real sprays from funded burners; `--dry` to skip spending |
| `npm run create-party "Name" 0xRecipient` | opens a party from the CLI in ten seconds |
| `npx tsx scripts/test-resilience.ts` | forces a 429 and a dead relay, checks recovery |
| `npm run contracts:test` | 21 contract tests |
| `npm run contracts:gas` | gas report plus the honest per-case measurement |

---

## 🎨 Design

**Nigerian party at night, not crypto dashboard.**

The token set in [`app/globals.css`](app/globals.css) is authoritative and
[`/styleguide`](https://onchain-spray.vercel.app/styleguide) renders all of it —
every colour, both type scales at real size, chip states, the note sprite, and a
tabular-figures proof. If something on screen uses a value that is not on that
page, the component is wrong.

Gold is reserved for the tx/sec readout and the big-spray takeover. Never pure
black, never pure white. Every changing number is `tabular-nums`.

Banned on sight: purple-blue web3 gradients, glassmorphism, untouched shadcn
defaults, stock crypto iconography, chain logos as decoration, animated
node-network backgrounds.

---

## 🛠 Stack

| | |
|---|---|
| **Framework** | Next.js 15 App Router · TypeScript strict · Tailwind v4 |
| **Chain** | viem only — no wagmi, no ethers, no RainbowKit |
| **Contracts** | Foundry |
| **Rendering** | Canvas 2D particle pool — not DOM, not GSAP |
| **Network** | Monad testnet (10143) |

No auth. No accounts. No database. No admin panel. No mainnet. No token.

---

## 📄 Licence

MIT — see [LICENSE](LICENSE).
