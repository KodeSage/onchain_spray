"use client";

import { useEffect, useState } from "react";
import { fetchParty, placeholderParty, type Party } from "../party";

/**
 * Loads a party's identity once. Both surfaces use this so the name and the
 * host address on screen are whatever is actually on chain for that id.
 *
 * In demo mode there is no contract to read, so the caller supplies a fallback
 * rather than showing an empty header.
 */
export function useParty(
  partyId: number,
  opts: { fallbackName?: string } = {}
): { party: Party; loading: boolean } {
  const [party, setParty] = useState<Party>(() => placeholderParty(partyId));
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);

    fetchParty(partyId)
      .then((result) => {
        if (cancelled) return;
        if (result) setParty(result);
        else if (opts.fallbackName) {
          setParty({ ...placeholderParty(partyId), name: opts.fallbackName });
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [partyId, opts.fallbackName]);

  return { party, loading };
}
