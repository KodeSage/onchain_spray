# Onchain Spray

**Spray money onchain.** Nigerian owambe culture — spraying cash on a dancer —
rebuilt as thousands of micro-transactions per minute on Monad.

Two surfaces: a phone app for sprayers, a projector view for the room. Scan a QR,
tap a stack of notes, and every tap is a real transaction. No wallet popup, no
signing prompt, no confirmation — ever.

Built in one day at **Monad Blitz Abuja**.

---

## Architecture in five bullets

1. **Burner keys in the browser.** On first visit the phone generates a private
   key with viem, stores it in `localStorage`, and gets a small drip of testnet
   MON from `/api/fund`. Nothing is ever confirmed by the user, because the key
   is local. This is the whole trick.
2. **The tap path touches the network zero times.** A nonce comes from a local
   counter, the transaction is signed locally (p95 **0.51ms**), and the signed
   payload goes on a queue. No `eth_estimateGas`, no fee lookup, no nonce fetch,
   no receipt awaited. The note animation fires optimistically in the pointerdown
   handler.
3. **A cross-client relay makes the rate limits fit.** 130 phones at 2 taps/sec
   is 260 requests/sec against a 50 rps public endpoint. `/api/relay` batches
   transactions *across all clients* into JSON-RPC batches of up to 100 —
   measured **65x compression**, 3.8 req/s against a 50 rps limit.
4. **The event is the entire read API.** `Sprayed` carries `newTotal` and `count`
   in its payload, so the projector reconstructs the running total and the
   leaderboard from events alone — one websocket, no polling, no contract reads.
5. **Canvas particles, not DOM.** A preallocated pool of 3,000 note objects
   rendered on a Canvas 2D context. Nothing is allocated per spray.

```
   phone (/spray/:id)                    projector (/stage/:id)
   ├── burner key in localStorage        ├── ONE websocket subscription
   ├── local nonce counter               ├── leaderboard from events
   ├── sign locally  (0.5ms)             ├── canvas particle pool (3000)
   └── POST raw tx ──► /api/relay ──► Monad testnet ──► Sprayed event ──┘
                       (batch x100)        (10143)
```

---

## Local setup

Requires Node 20+ and [Foundry](https://book.getfoundry.sh/getting-started/installation).

```bash
git clone <this repo>
cd onchain_spray
npm install

cp .env.example .env.local
cp .env.example .env          # Foundry reads .env
```

Put a funded Monad testnet key in `.env` as `PRIVATE_KEY` (get MON from
[faucet.monad.xyz](https://faucet.monad.xyz)), then:

```bash
npm run contracts:test        # 16 tests
npm run deploy                # deploys, verifies, writes the address to .env.local
npm run dev
```

Open <http://localhost:3000/stage/0> on the projector and
<http://localhost:3000/spray/0> on a phone.

### Without deploying

`/stage/0?demo=1` replays a synthetic event stream through the identical
rendering pipeline with **zero network calls**. `/styleguide` renders every
design token. Both work on a fresh clone with no contract and no key.

---

## Funding maths — read this before the event

This is the thing most likely to kill the demo, and it is a logistics problem,
not a code problem.

On Monad you pay for the gas **limit**, not gas used. At the current base fee of
**102 gwei** and a measured steady-state `spray()` of ~60,000 gas:

| | |
|---|---|
| gas per tap | ~0.0063 MON |
| 200 taps per burner | ~1.27 MON |
| **130 burners x 200 taps** | **~165 MON** |

The public faucet drips small amounts per day, so **the master wallet cannot be
filled on the morning of the event.** Either fund it days in advance across
multiple faucet claims, or ask the Monad team for a testnet grant.

Two things reduce the number:

- **Funding is lazy.** `/api/fund` tops burners up when they run low rather than
  granting everyone a fixed amount up front. Of 130 people who scan, only some
  tap hard, so MON follows actual tapping.
- **The sprayed value comes back.** Only gas is truly burned — the sprayed MON
  accumulates in the contract and the host pulls it with `withdraw()`.

Verify the wallet by reading its balance, never by assuming:

```bash
npm run preflight
```

---

## Gas

`spray()` is designed backwards from a gas budget. Measured with
`npm run contracts:gas`:

| case | EVM pricing | Monad (cold SLOAD 8,100 not 2,100) |
|---|---|---|
| steady-state spray | 47,905 | **~59,905** |
| first spray per address | 65,005 | **~77,005** |

The first spray costs more because `sprayedBy` goes zero → non-zero
(`SSTORE_SET`, 20,000). The client uses two gas limits accordingly — paying the
first-spray limit on all 300 taps would waste ~25% of every burner's balance.

Structural choices that follow from the budget: no dynamic arrays, `bytes32`
party names, no external calls during `spray()` (the host withdraws later), and a
struct ordered so the three fields `spray()` touches — `active`, `total`,
`count` — share **one** storage slot.

> **Known trade-off.** The `sprayedBy` mapping costs ~11,000 gas per tap (~18%)
> and nothing in the demo reads it — the leaderboard is rebuilt from events.
> Removing it would bring steady-state under the 50,000 target and cut the
> funding budget by ~16%. It is kept because it is the on-chain record of who
> sprayed what.

---

## Scripts

| command | what it does |
|---|---|
| `npm run dev` | the app |
| `npm run preflight` | pre-demo checklist — reads real chain state |
| `npm run bench` | measures tap-path latency and the offline demo feed |
| `npm run rate-check` | simulates 130 clients against the endpoint pool |
| `npm run load-test` | fires real sprays from funded burners; `--dry` to skip spending |
| `npm run create-party "Name"` | opens a party from the CLI in ten seconds |
| `npm run contracts:gas` | gas report plus the honest per-case measurement |

---

## RPC pool

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

## Contract

`contracts/src/SprayParty.sol` — deployed on Monad testnet (chain 10143).

```
createParty(bytes32 name) -> uint256 partyId
spray(uint256 partyId) payable
withdraw(uint256 partyId)     host only
endParty(uint256 partyId)     host only

event Sprayed(uint256 indexed partyId, address indexed sprayer,
              uint256 amount, uint256 newTotal, uint64 count)
```

Address and explorer link are written into `.env.local` by `npm run deploy`.

---

## Design

Nigerian party at night, not crypto dashboard. The token set in
`app/globals.css` is authoritative and `/styleguide` renders all of it — every
colour, both type scales at real size, chip states, the note sprite, and a
tabular-figures proof. If something on screen uses a value that is not on that
page, the component is wrong.

Gold is reserved for the tx/sec readout and the big-spray takeover. Never pure
black, never pure white. Every changing number is `tabular-nums`.

---

## Licence

MIT.
