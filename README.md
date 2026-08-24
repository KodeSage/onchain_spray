<div align="center">

# 💧 Tap

**A testnet faucet you have to earn.**

`faucet.monad.xyz` gives you MON and you leave. Tap makes you work for it — in a
live global arena where every tap is a real transaction on Monad, and where
coming back tomorrow is the point.

A tap is a faucet. Tapping is the game.

[![Monad Testnet](https://img.shields.io/badge/Monad-Testnet_10143-836EF9?style=for-the-badge)](https://testnet.monadvision.com/)
[![License](https://img.shields.io/badge/License-MIT-3FE0D0?style=for-the-badge)](LICENSE)

</div>

---

## The one rule that matters

> ### A tap must never open a wallet popup. Not once.

That single constraint dictates the architecture. Signing happens locally, with
a burner key generated in the browser, funded by the house. You paste an address
for your payout and nothing else. You never connect a wallet.

**Measured budget:**

| | target | measured |
|---|---|---|
| tap → visible droplet | < 100ms | one frame (~16ms), optimistic |
| synchronous cost of a tap | — | local sign + hash only, no network |
| tap → on-chain confirmation | < 1s | sub-second |

Verify it yourself: `npm run bench`.

---

## How it works

```
                          YOU                                  EVERYONE
   ┌───────────────────────────────────┐        ┌──────────────────────────────┐
   │ 1. page loads                     │        │  ONE websocket subscription  │
   │    burner key generated + funded  │        │  filtered to today's round   │
   │    in the background              │        │                              │
   │                                   │        │  leaderboard + totals + tx/s │
   │ 2. you tap                        │───tx──▶│    rebuilt from events only  │
   │    signed locally, 0 round trips  │        │                              │
   │    droplet on the next frame      │◀─event─│  canvas droplet pool (3000)  │
   │                                   │        │  full-bleed page background  │
   │ 3. 25 taps unlocks a claim        │        └──────────────────────────────┘
   │    paste an address, prove human  │
   │    house settles it on chain      │
   └───────────────────────────────────┘
```

There are no rooms and no instances. One global arena, one leaderboard, one
round for everybody, rolling over at 00:00 UTC.

---

## Why a game, and not just a faucet

Every faucet has the same problem: it is a free money endpoint on the public
internet, and the people most motivated to use it are scripts. The usual answers
are captchas and wallet-age heuristics, which are a tax on real users and a
speed bump for everyone else.

Making the faucet a game changes what an attacker has to spend. A bot can solve
a captcha. A bot cannot skip 25 transactions' worth of gas and wall-clock time
per address per day without that becoming the expensive part of the attack — and
if it does pay that, it has paid the house's own cost of service in Monad
transactions, which is not the worst outcome a testnet faucet can have.

The side effect is the actually valuable one: **you learn what the chain feels
like before you need it.** You do not read that Monad is fast, you tap two
hundred times and watch every tap land.

---

## The contract

[`contracts/src/TapArena.sol`](contracts/src/TapArena.sol) — ~260 lines, no
dependencies, no proxies.

Three decisions carry the whole design, and all three are Monad-specific:

### One packed slot per player

```solidity
struct Player {
    uint32 round;         // the round roundTaps belongs to
    uint32 roundTaps;     // the leaderboard number
    uint64 totalTaps;     // lifetime
    uint32 claimedRound;  // last round settled
    uint96 claimedTotal;  // lifetime wei claimed
}   // 32+32+64+32+96 = 256 bits, exactly one slot
```

Cold storage access costs **8,100 gas on Monad** versus 2,100 on Ethereum, so
the number of distinct slots the hot path touches is the dominant cost. `tap()`
touches one — a cold SLOAD, a warm SSTORE, a log, and nothing else.

### No global counter

Monad executes transactions optimistically in parallel and re-executes them on
conflict. A single shared `totalTaps` slot would put every tap in the arena in
conflict with every other tap. Correctness would be unaffected; throughput would
not — and throughput is the thing this app exists to show.

So there is no global state in the hot path at all. Two players share no slot,
and every global number on screen is reconstructed on the client from `Tapped`
events. `roundTaps` is emitted as an **absolute** value rather than a delta,
which is what makes the reconstruction exact: a duplicated, reordered or
re-delivered event converges to the same total, because the last write for a
player wins instead of accumulating.

For the same reason there is no pause flag on `tap()`. Reading one would
reintroduce exactly the shared cold slot the design removes. The arena is gated
off-chain, at the operator.

### Rounds are derived, not stored

```solidity
function currentRound() public view returns (uint32) {
    return uint32(block.timestamp / 1 days) + 1;
}
```

Nobody pays gas to start a round, there is no rollover transaction, and there is
no shared "current round" slot for taps to contend on. A player's tally resets
because the round stamped in their slot no longer matches — which costs nothing
and happens lazily, on their next tap.

The `+ 1` is load-bearing: rounds are 1-based so that `claimedRound == 0` can
unambiguously mean *never claimed*.

---

## Measured gas

Every number below comes from `npm run contracts:gas`
([`contracts/test/TapGas.t.sol`](contracts/test/TapGas.t.sol)), Monad-adjusted
for the 8,100-gas cold SLOAD. **On Monad the sender pays for the gas `limit`,
not gas used**, so these are what the house actually pays.

| | gas | MON @ 100 gwei |
|---|---|---|
| `tap()` steady-state | **40,058** | 0.0040 |
| `tap()` first for an address | 57,146 | 0.0057 |
| `tap()` first of a new round | 40,046 | 0.0040 — rollover is free |
| `tapBatch(8)` | 39,931 | **0.0005 / tap** |
| `tapBatch(64)` | 39,931 | **0.000062 / tap** |
| `settleClaim()` | 47,133 call gas | one per player per round |

The measurement is deliberately awkward to make it honest: one measurement per
test function, because the EVM access list resets per transaction, with the
warm-up written in `setUp()` so the number reflects a **cold slot holding a
non-zero value** — which is what tap number seven actually costs, rather than
the fiction you get from measuring two taps in a row.

---

## Faucet economics

The house pays for gameplay *and* the drip, so the cost per player has to be
bounded by construction rather than by hoping.

```
  burner top-up target      0.15 MON     ~37 single taps
  daily gas budget/address  0.30 MON     ~75 single taps
  drip                      0.05 MON + 0.001/tap, capped at 0.5 MON
  ────────────────────────────────────────────────────────────────
  worst case per player     0.80 MON per round
```

When an address exhausts its daily gas budget the client does not stop — it
switches to `tapBatch`, where a tap costs **1/64th** as much. Heavy play
automatically becomes the cheap path, so the cost per player converges no matter
how long someone plays.

The drip scales with tap count and **nothing else**. Combo, streak and rank are
deliberately excluded from the formula: anything that pays out for *how* you
tapped rather than *that* you tapped is a thing a script does better than a
person. Combo is worth chasing because it looks good, not because it pays.

---

## Trust model

Stated plainly, because a faucet that overstates its guarantees is worse than
one that has none.

**The contract is trustless about eligibility.** `settleClaim` proves the taps
happened, that they happened in the round being claimed, that they clear
`MIN_TAPS_TO_CLAIM`, and that nobody is paid twice. Double-claim prevention
lives on chain specifically so it survives the off-chain rate limiter being
wiped, cold-started or misconfigured — and so anyone can audit the payout
history from the `Claimed` log.

**The contract is operator-trusted about the amount.** It cannot see a Turnstile
token, an IP address or a Redis counter, so it cannot know what the drip *should*
be. It enforces a `MAX_CLAIM` ceiling as a rail against a bug in the formula,
and otherwise takes the operator's word. The drip rides in as `msg.value` rather
than from a pool the contract holds, so there is no balance sitting in the arena
to drain.

**Off-chain, the faucet fails closed.** Missing Redis or a missing Turnstile
secret is not a degraded faucet, it is an open wallet, so in production both are
required and the routes return 503 without them. Rate limits key on the *payout*
address, not the burner — burners are free and infinite, the payout address is
the thing an attacker actually wants filled.

---

## Degradation ladder

The arena never shows an error where it can show less arena.

| rung | trigger | behaviour |
|---|---|---|
| **open** | budget healthy | one tap, one transaction, full droplet density |
| **tightening** | < 35% of the day's budget left | taps coalesce into `tapBatch` — same score, a fraction of the gas |
| **spectate** | < 5% left | taps stop settling; the live wall still runs on everyone else's taps, and the claim panel says when it refills |

`/?demo=1` drives the identical rendering pipeline from a synthetic event
stream, with **zero** network calls — useful for showing the arena offline, and
it is the same code path spectate mode falls back to.

---

## Running it

```bash
npm install
cp .env.example .env.local     # fill in HOUSE_PRIVATE_KEY at minimum
npm run dev
```

Redis and Turnstile may be left unset in development — the store falls back to
an in-process stand-in and the captcha is skipped, both loudly. In production
their absence closes the faucet.

### Deploy the contract

```bash
cd contracts && forge test          # 46 tests
cd .. && npm run deploy             # writes NEXT_PUBLIC_ARENA_CONTRACT to .env.local
```

Set `OPERATOR_ADDRESS` to the address of `HOUSE_PRIVATE_KEY` before deploying.
The deployer becomes the **owner** and should not be the same key as the
operator: the key sitting in a serverless environment variable should not also
be the key that can hand ownership away.

### Before going public

```bash
npm run preflight
```

Reads real state rather than assuming: chain reachable, contract has code, house
wallet balance against a day's worth of players, Upstash reachable, both
Turnstile keys present, no `.env` in git history.

---

## Scripts

| | |
|---|---|
| `npm run bench` | measures the synchronous cost of a tap, and the offline pipeline |
| `npm run preflight` | faucet readiness check — run before every deploy |
| `npm run contracts:gas` | the gas table above, regenerated |
| `npm run load-test` | funds N burners, fires M taps, reports landed/dropped/429s |
| `npm run rate-check` | probes the published RPC rate limits |
| `/styleguide` | every design token, rendered — how palette drift gets caught |

---

## Stack

Next.js 15 · TypeScript strict · Tailwind v4 · viem · Foundry · Canvas 2D ·
Upstash Redis · Cloudflare Turnstile

No wagmi, no ethers, no RainbowKit, no DOM particles.

[`CLAUDE.md`](CLAUDE.md) is the constitution for the build — every decision in
this repo defers to it.

---

## License

MIT
