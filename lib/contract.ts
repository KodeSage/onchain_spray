import type { Abi, Address } from "viem";

/**
 * Generated from contracts/out/TapArena.sol/TapArena.json.
 * Regenerate with `npm run gen:abi` after any contract change.
 */

/** Deployed address. Read from env — never hardcode it in source. */
export const ARENA_CONTRACT = (process.env.NEXT_PUBLIC_ARENA_CONTRACT ??
  "") as Address;

export function assertContractConfigured(): Address {
  if (!ARENA_CONTRACT || !ARENA_CONTRACT.startsWith("0x")) {
    throw new Error(
      "NEXT_PUBLIC_ARENA_CONTRACT is not set. Run `npm run deploy` first."
    );
  }
  return ARENA_CONTRACT;
}

export const tapArenaAbi = [
  {
    "type": "constructor",
    "inputs": [
      {
        "name": "operator_",
        "type": "address",
        "internalType": "address"
      }
    ],
    "stateMutability": "nonpayable"
  },
  {
    "type": "receive",
    "stateMutability": "payable"
  },
  {
    "type": "function",
    "name": "MAX_BATCH",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "uint32",
        "internalType": "uint32"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "MAX_CLAIM",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "MIN_TAPS_TO_CLAIM",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "uint32",
        "internalType": "uint32"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "claimable",
    "inputs": [
      {
        "name": "player",
        "type": "address",
        "internalType": "address"
      }
    ],
    "outputs": [
      {
        "name": "ok",
        "type": "bool",
        "internalType": "bool"
      },
      {
        "name": "round",
        "type": "uint32",
        "internalType": "uint32"
      },
      {
        "name": "roundTaps",
        "type": "uint32",
        "internalType": "uint32"
      },
      {
        "name": "tapsNeeded",
        "type": "uint32",
        "internalType": "uint32"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "currentRound",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "uint32",
        "internalType": "uint32"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "operator",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "address",
        "internalType": "address"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "owner",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "address",
        "internalType": "address"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "players",
    "inputs": [
      {
        "name": "",
        "type": "address",
        "internalType": "address"
      }
    ],
    "outputs": [
      {
        "name": "round",
        "type": "uint32",
        "internalType": "uint32"
      },
      {
        "name": "roundTaps",
        "type": "uint32",
        "internalType": "uint32"
      },
      {
        "name": "totalTaps",
        "type": "uint64",
        "internalType": "uint64"
      },
      {
        "name": "claimedRound",
        "type": "uint32",
        "internalType": "uint32"
      },
      {
        "name": "claimedTotal",
        "type": "uint96",
        "internalType": "uint96"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "setOperator",
    "inputs": [
      {
        "name": "operator_",
        "type": "address",
        "internalType": "address"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "settleClaim",
    "inputs": [
      {
        "name": "player",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "payout",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "round",
        "type": "uint32",
        "internalType": "uint32"
      },
      {
        "name": "amount",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "outputs": [],
    "stateMutability": "payable"
  },
  {
    "type": "function",
    "name": "sweep",
    "inputs": [
      {
        "name": "to",
        "type": "address",
        "internalType": "address"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "tap",
    "inputs": [],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "tapBatch",
    "inputs": [
      {
        "name": "taps",
        "type": "uint32",
        "internalType": "uint32"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "transferOwnership",
    "inputs": [
      {
        "name": "owner_",
        "type": "address",
        "internalType": "address"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "event",
    "name": "Claimed",
    "inputs": [
      {
        "name": "player",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      },
      {
        "name": "payout",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      },
      {
        "name": "round",
        "type": "uint32",
        "indexed": true,
        "internalType": "uint32"
      },
      {
        "name": "amount",
        "type": "uint256",
        "indexed": false,
        "internalType": "uint256"
      },
      {
        "name": "roundTaps",
        "type": "uint32",
        "indexed": false,
        "internalType": "uint32"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "OperatorChanged",
    "inputs": [
      {
        "name": "operator",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "OwnerChanged",
    "inputs": [
      {
        "name": "owner",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "Tapped",
    "inputs": [
      {
        "name": "player",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      },
      {
        "name": "round",
        "type": "uint32",
        "indexed": true,
        "internalType": "uint32"
      },
      {
        "name": "taps",
        "type": "uint32",
        "indexed": false,
        "internalType": "uint32"
      },
      {
        "name": "roundTaps",
        "type": "uint32",
        "indexed": false,
        "internalType": "uint32"
      },
      {
        "name": "totalTaps",
        "type": "uint64",
        "indexed": false,
        "internalType": "uint64"
      }
    ],
    "anonymous": false
  },
  {
    "type": "error",
    "name": "AlreadyClaimed",
    "inputs": []
  },
  {
    "type": "error",
    "name": "AmountMismatch",
    "inputs": []
  },
  {
    "type": "error",
    "name": "BadBatch",
    "inputs": []
  },
  {
    "type": "error",
    "name": "ClaimTooLarge",
    "inputs": []
  },
  {
    "type": "error",
    "name": "NotEnoughTaps",
    "inputs": []
  },
  {
    "type": "error",
    "name": "NotOperator",
    "inputs": []
  },
  {
    "type": "error",
    "name": "NotOwner",
    "inputs": []
  },
  {
    "type": "error",
    "name": "TransferFailed",
    "inputs": []
  },
  {
    "type": "error",
    "name": "WrongRound",
    "inputs": []
  },
  {
    "type": "error",
    "name": "ZeroAddress",
    "inputs": []
  }
] as const satisfies Abi;

/** The event the arena rebuilds every number on screen from. */
export const tappedEvent = tapArenaAbi.find(
  (item) => item.type === "event" && item.name === "Tapped"
)!;
