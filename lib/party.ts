"use client";

import { hexToString, type Address, type Hex } from "viem";
import { httpClientFor } from "./chain";
import { ENDPOINTS } from "./rpc";
import { SPRAY_CONTRACT, sprayPartyAbi } from "./contract";

/**
 * Party identity, read from the chain rather than hardcoded.
 *
 * Both surfaces need to know what party they are showing and whose wallet is
 * receiving the sprays. That comes from the contract — the name written by
 * createParty and the host address the PartyCreated event was emitted for — not
 * from a string in a component.
 *
 * This is ONE eth_call at mount, not a poll. The rule that the stage never polls
 * contract state still holds: every number that changes still comes from Sprayed
 * events. This reads the two things that do not change.
 */

export type Party = {
  id: number;
  /** decoded from bytes32; empty if the host left it blank */
  name: string;
  /** whoever opened the party */
  host: Address;
  /**
   * The person being sprayed. Every naira sprayed here is payable to this
   * address and nobody else — it is submitted by the recipient themselves
   * through the UI, fixed at creation, and immutable after.
   */
  recipient: Address;
  active: boolean;
  total: bigint;
  count: bigint;
  /** sprayed but not yet swept to the recipient */
  pending: bigint;
  exists: boolean;
};

const ZERO = "0x0000000000000000000000000000000000000000";

/** bytes32 -> string, minus the null padding createParty wrote. */
export function decodePartyName(raw: Hex): string {
  try {
    return hexToString(raw, { size: 32 }).replace(/\0+$/, "").trim();
  } catch {
    return "";
  }
}

export async function fetchParty(partyId: number): Promise<Party | null> {
  if (!SPRAY_CONTRACT || !SPRAY_CONTRACT.startsWith("0x")) return null;

  try {
    const client = httpClientFor(ENDPOINTS[0].http);
    const [host, recipient, name, active, total, count, pending] =
      await client.readContract({
        address: SPRAY_CONTRACT,
        abi: sprayPartyAbi,
        functionName: "partyInfo",
        args: [BigInt(partyId)],
      });

    return {
      id: partyId,
      name: decodePartyName(name),
      host,
      recipient,
      active,
      total,
      count,
      pending,
      // a party that was never created reads back as the zero address
      exists: recipient.toLowerCase() !== ZERO,
    };
  } catch {
    return null;
  }
}

/** What to show while the read is in flight, or when there is no contract. */
export function placeholderParty(partyId: number): Party {
  return {
    id: partyId,
    name: "",
    host: ZERO as Address,
    recipient: ZERO as Address,
    active: true,
    total: 0n,
    count: 0n,
    pending: 0n,
    exists: false,
  };
}
