"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from "react";
import type { Address } from "viem";
import {
  AUTOFIRE_INTERVAL_MS,
  BURNER_TOP_UP_THRESHOLD,
  COALESCE_WINDOW_MS,
  COMBO_WINDOW_MS,
  MAX_TAPS_PER_BATCH,
  PAYOUT_STORAGE_KEY,
  comboTier,
  type ArenaMode,
  type ComboTier,
} from "../constants";
import { flushPending, getBalance, initBurner, tap, tapBatch } from "../burner";

/**
 * Everything that belongs to the person holding the phone.
 *
 * The order of operations at the top is the whole trick. A newly funded account
 * on Monad cannot transact until its funding transfer is three blocks old,
 * because consensus validates gas budgets against a delayed state view. So the
 * burner is generated and funded the moment the page loads — while the player
 * is still reading the headline and typing an address — and by the time they
 * reach for the tap target the wait is long gone. Funding on "start" would
 * spend that 1.2s in front of them, and the first taps would fail.
 */

export type PlayerPhase = "booting" | "funding" | "ready" | "closed";

/** Which rung of the degradation ladder the client is on. */
export type TapMode = "single" | "coalesced" | "spectate";

export type PlayerState = {
  phase: PlayerPhase;
  address: Address | null;
  balance: bigint;
  /** Taps this round, optimistic — reconciled upward from the chain. */
  taps: number;
  combo: number;
  tier: ComboTier;
  mode: TapMode;
  /** Set when something went wrong that the player needs to know about. */
  notice: string | null;
};

type Options = {
  /** Arena-wide budget mode, polled from /api/status. */
  arenaMode: ArenaMode;
  /** Fired for every tap the player makes, immediately, for particles. */
  onLocalTap?: (combo: number, tier: ComboTier) => void;
};

export function usePlayer({ arenaMode, onLocalTap }: Options) {
  const [state, setState] = useState<PlayerState>({
    phase: "booting",
    address: null,
    balance: 0n,
    taps: 0,
    combo: 0,
    tier: comboTier(0),
    mode: "single",
    notice: null,
  });

  const armedAt = useRef(0);
  const lastTapAt = useRef(0);
  const combo = useRef(0);
  const localTaps = useRef(0);
  const pendingBatch = useRef(0);
  const batchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onLocalTapRef = useRef(onLocalTap);
  onLocalTapRef.current = onLocalTap;

  /* ---------------------------------------------------------------------
     Boot: make a key, ask for gas, and start the arming clock.
     --------------------------------------------------------------------- */

  const cancelled = useRef(false);

  useEffect(() => {
    cancelled.current = false;

    void (async () => {
      try {
        const burner = await initBurner();
        if (cancelled.current) return;

        localTaps.current = burner.roundTaps;
        setState((s) => ({
          ...s,
          phase: burner.balance >= BURNER_TOP_UP_THRESHOLD ? "ready" : "funding",
          address: burner.address,
          balance: burner.balance,
          taps: burner.roundTaps,
        }));

        if (burner.balance >= BURNER_TOP_UP_THRESHOLD) {
          // Already funded from a previous visit: nothing to wait for.
          armedAt.current = Date.now();
          return;
        }

        await requestFunding(burner.address, cancelled, setState, armedAt);
      } catch {
        if (!cancelled.current) {
          setState((s) => ({
            ...s,
            phase: "closed",
            notice: "Could not start a session. Reload to try again.",
          }));
        }
      }
    })();

    return () => {
      cancelled.current = true;
    };
  }, []);

  /* ---------------------------------------------------------------------
     Keep the burner topped up. A burner's balance is its tap-rate ceiling,
     so running it to empty throttles the player before it strands them.
     --------------------------------------------------------------------- */

  useEffect(() => {
    if (!state.address || state.phase === "closed") return;
    const address = state.address;

    const timer = setInterval(() => {
      void (async () => {
        const balance = await getBalance();
        setState((s) => (s.balance === balance ? s : { ...s, balance }));
        if (balance < BURNER_TOP_UP_THRESHOLD) {
          await requestFunding(address, cancelled, setState, armedAt);
        }
      })();
    }, 12_000);

    return () => clearInterval(timer);
  }, [state.address, state.phase]);

  /* ---------------------------------------------------------------------
     Decide the rung: spectate beats coalesced beats single.
     --------------------------------------------------------------------- */

  const mode: TapMode =
    arenaMode === "spectate"
      ? "spectate"
      : arenaMode === "tightening" || state.balance < BURNER_TOP_UP_THRESHOLD
        ? "coalesced"
        : "single";

  useEffect(() => {
    setState((s) => (s.mode === mode ? s : { ...s, mode }));
  }, [mode]);

  /* ---------------------------------------------------------------------
     Coalescing
     ---------------------------------------------------------------------
     One tapBatch costs what one tap costs, so this is a straight 1/n cut in
     what the house pays with no change to the player's score. The window is
     short enough that the on-chain count never trails the on-screen count by
     more than a beat.
     --------------------------------------------------------------------- */

  const flushBatch = useCallback(() => {
    if (batchTimer.current) {
      clearTimeout(batchTimer.current);
      batchTimer.current = null;
    }
    const count = pendingBatch.current;
    pendingBatch.current = 0;
    if (count <= 0) return;

    void tapBatch(count).catch(() => {
      /* the droplet already flew; a dropped batch is not worth an error state */
    });
  }, []);

  const scheduleBatch = useCallback(() => {
    pendingBatch.current += 1;
    if (pendingBatch.current >= MAX_TAPS_PER_BATCH) {
      flushBatch();
      return;
    }
    if (!batchTimer.current) {
      batchTimer.current = setTimeout(flushBatch, COALESCE_WINDOW_MS);
    }
  }, [flushBatch]);

  /* ---------------------------------------------------------------------
     The tap itself
     --------------------------------------------------------------------- */

  const doTap = useCallback(() => {
    const now = Date.now();
    if (now < armedAt.current) return; // still inside the 3-block funding delay

    combo.current = now - lastTapAt.current <= COMBO_WINDOW_MS ? combo.current + 1 : 1;
    lastTapAt.current = now;
    localTaps.current += 1;

    const tier = comboTier(combo.current);
    onLocalTapRef.current?.(combo.current, tier);

    setState((s) => ({ ...s, taps: localTaps.current, combo: combo.current, tier }));

    if (mode === "spectate") return;
    if (mode === "coalesced") {
      scheduleBatch();
      return;
    }

    void tap().catch(() => {
      /* optimistic by design: the droplet is already on screen */
    });
  }, [mode, scheduleBatch]);

  /* Combo decays on its own, so letting go visibly costs something. */
  useEffect(() => {
    const timer = setInterval(() => {
      if (combo.current === 0) return;
      if (Date.now() - lastTapAt.current > COMBO_WINDOW_MS) {
        combo.current = 0;
        setState((s) => (s.combo === 0 ? s : { ...s, combo: 0, tier: comboTier(0) }));
      }
    }, 200);
    return () => clearInterval(timer);
  }, []);

  /* Press and hold. */
  const autofire = useRef<ReturnType<typeof setInterval> | null>(null);

  const holdStart = useCallback(() => {
    doTap();
    autofire.current ??= setInterval(doTap, AUTOFIRE_INTERVAL_MS);
  }, [doTap]);

  const holdEnd = useCallback(() => {
    if (autofire.current) {
      clearInterval(autofire.current);
      autofire.current = null;
    }
  }, []);

  /* A closed tab must not swallow taps that were only ever queued locally. */
  useEffect(() => {
    const onHide = () => {
      if (document.visibilityState === "hidden") {
        flushBatch();
        void flushPending();
      }
    };
    document.addEventListener("visibilitychange", onHide);
    return () => {
      document.removeEventListener("visibilitychange", onHide);
      flushBatch();
    };
  }, [flushBatch]);

  /**
   * Fold the chain's view of the player's round back in.
   *
   * The optimistic counter can only ever be ahead, never behind, so this takes
   * the maximum: a reload rehydrates from chain, and a live session keeps its
   * optimistic lead instead of visibly rewinding on every confirmation.
   */
  const reconcile = useCallback((chainTaps: number) => {
    if (chainTaps <= localTaps.current) return;
    localTaps.current = chainTaps;
    setState((s) => ({ ...s, taps: chainTaps }));
  }, []);

  return { ...state, tap: doTap, holdStart, holdEnd, reconcile };
}

async function requestFunding(
  address: Address,
  cancelled: { current: boolean },
  setState: Dispatch<SetStateAction<PlayerState>>,
  armedAt: { current: number }
) {
  try {
    const res = await fetch("/api/fund", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ address }),
      signal: AbortSignal.timeout(12_000),
    });
    const data = (await res.json()) as {
      ok?: boolean;
      armAfterMs?: number;
      message?: string;
      error?: string;
    };

    if (cancelled.current) return;

    if (!data.ok) {
      // A refused top-up is not fatal. The burner may still hold enough to
      // play, and the coalescing rung exists precisely for this.
      setState((s) => ({
        ...s,
        phase: "ready",
        notice: data.message ?? "The faucet is busy. Taps will settle in batches.",
      }));
      armedAt.current = Date.now();
      return;
    }

    armedAt.current = Date.now() + (data.armAfterMs ?? 0);
    setState((s) => ({ ...s, phase: "ready", notice: null }));
  } catch {
    if (!cancelled.current) {
      setState((s) => ({
        ...s,
        phase: "ready",
        notice: "Could not reach the faucet. Taps may not settle.",
      }));
      armedAt.current = Date.now();
    }
  }
}

/* -------------------------------------------------------------------------
   The payout address
   -------------------------------------------------------------------------
   Remembered locally so a returning player does not retype it, and never sent
   anywhere except the claim request.
   ------------------------------------------------------------------------- */

export function usePayoutAddress() {
  const [payout, setPayout] = useState("");

  useEffect(() => {
    try {
      setPayout(window.localStorage.getItem(PAYOUT_STORAGE_KEY) ?? "");
    } catch {
      /* private mode; the field just starts empty */
    }
  }, []);

  const update = useCallback((value: string) => {
    setPayout(value);
    try {
      window.localStorage.setItem(PAYOUT_STORAGE_KEY, value);
    } catch {
      /* not remembering it is a small loss, not a failure */
    }
  }, []);

  return [payout, update] as const;
}
