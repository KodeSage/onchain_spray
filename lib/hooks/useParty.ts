"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { fetchParty, placeholderParty, type Party } from "../party";

/**
 * Loads a party's identity and its authoritative totals.
 *
 * Identity (name, host, recipient) never changes. The totals do, and they are
 * the reason this can refresh: `total`, `count` and `pending` are the only
 * reload-proof source for what the room has sprayed and what the dancer has
 * actually been paid. Accumulating those in React state instead means a browser
 * reload shows zero until the next spray arrives, which on a projector reads as
 * the demo having crashed.
 *
 * `refreshMs` is a deliberate, bounded exception to "the stage never polls
 * contract state". The hot numbers still come from Sprayed events, hundreds a
 * second, and none of them are polled. This is one eth_call every few seconds
 * to re-anchor the running totals to chain truth.
 */
export function useParty(
  partyId: number,
  opts: { fallbackName?: string; refreshMs?: number } = {}
): { party: Party; loading: boolean; refresh: () => void } {
  const [party, setParty] = useState<Party>(() => placeholderParty(partyId));
  const [loading, setLoading] = useState(true);
  const cancelled = useRef(false);

  const { fallbackName, refreshMs } = opts;

  const load = useCallback(async () => {
    const result = await fetchParty(partyId);
    if (cancelled.current) return;

    if (result) {
      setParty((prev) => ({
        ...result,
        // Totals must never go backwards on screen. A read served by a lagging
        // RPC node can legitimately return a lower total than one we already
        // showed; clamping here means an unlucky node cannot make the
        // projector count down mid-demo.
        total: result.total > prev.total ? result.total : prev.total,
        count: result.count > prev.count ? result.count : prev.count,
      }));
    } else if (fallbackName) {
      setParty((prev) =>
        prev.name ? prev : { ...placeholderParty(partyId), name: fallbackName }
      );
    }
  }, [partyId, fallbackName]);

  useEffect(() => {
    cancelled.current = false;
    setLoading(true);

    void load().finally(() => {
      if (!cancelled.current) setLoading(false);
    });

    if (!refreshMs) {
      return () => {
        cancelled.current = true;
      };
    }

    const timer = setInterval(() => void load(), refreshMs);
    return () => {
      cancelled.current = true;
      clearInterval(timer);
    };
  }, [load, refreshMs]);

  const refresh = useCallback(() => {
    void load();
  }, [load]);

  return { party, loading, refresh };
}
