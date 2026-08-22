import type { Abi, Address } from "viem";

/**
 * Generated from contracts/out/SprayParty.sol/SprayParty.json.
 * Regenerate with `npm run gen:abi` after any contract change.
 */

/** Deployed address. Read from env — never hardcode it in source. */
export const SPRAY_CONTRACT = (process.env.NEXT_PUBLIC_SPRAY_CONTRACT ??
  "") as Address;

export function assertContractConfigured(): Address {
  if (!SPRAY_CONTRACT || !SPRAY_CONTRACT.startsWith("0x")) {
    throw new Error(
      "NEXT_PUBLIC_SPRAY_CONTRACT is not set. Run `npm run deploy` first."
    );
  }
  return SPRAY_CONTRACT;
}

export const sprayPartyAbi = [
  {
    "type": "function",
    "name": "createParty",
    "inputs": [
      {
        "name": "name",
        "type": "bytes32",
        "internalType": "bytes32"
      },
      {
        "name": "recipient",
        "type": "address",
        "internalType": "address"
      }
    ],
    "outputs": [
      {
        "name": "partyId",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "endParty",
    "inputs": [
      {
        "name": "partyId",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "parties",
    "inputs": [
      {
        "name": "",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "outputs": [
      {
        "name": "host",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "withdrawn",
        "type": "uint96",
        "internalType": "uint96"
      },
      {
        "name": "recipient",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "name",
        "type": "bytes32",
        "internalType": "bytes32"
      },
      {
        "name": "active",
        "type": "bool",
        "internalType": "bool"
      },
      {
        "name": "total",
        "type": "uint128",
        "internalType": "uint128"
      },
      {
        "name": "count",
        "type": "uint64",
        "internalType": "uint64"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "partyCount",
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
    "name": "partyInfo",
    "inputs": [
      {
        "name": "partyId",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "outputs": [
      {
        "name": "host",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "recipient",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "name",
        "type": "bytes32",
        "internalType": "bytes32"
      },
      {
        "name": "active",
        "type": "bool",
        "internalType": "bool"
      },
      {
        "name": "total",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "count",
        "type": "uint64",
        "internalType": "uint64"
      },
      {
        "name": "pending",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "payout",
    "inputs": [
      {
        "name": "partyId",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "spray",
    "inputs": [
      {
        "name": "partyId",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "outputs": [],
    "stateMutability": "payable"
  },
  {
    "type": "function",
    "name": "sprayedBy",
    "inputs": [
      {
        "name": "",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "",
        "type": "address",
        "internalType": "address"
      }
    ],
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
    "type": "event",
    "name": "PaidOut",
    "inputs": [
      {
        "name": "partyId",
        "type": "uint256",
        "indexed": true,
        "internalType": "uint256"
      },
      {
        "name": "recipient",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      },
      {
        "name": "amount",
        "type": "uint256",
        "indexed": false,
        "internalType": "uint256"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "PartyCreated",
    "inputs": [
      {
        "name": "partyId",
        "type": "uint256",
        "indexed": true,
        "internalType": "uint256"
      },
      {
        "name": "host",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      },
      {
        "name": "recipient",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      },
      {
        "name": "name",
        "type": "bytes32",
        "indexed": false,
        "internalType": "bytes32"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "PartyEnded",
    "inputs": [
      {
        "name": "partyId",
        "type": "uint256",
        "indexed": true,
        "internalType": "uint256"
      },
      {
        "name": "total",
        "type": "uint256",
        "indexed": false,
        "internalType": "uint256"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "Sprayed",
    "inputs": [
      {
        "name": "partyId",
        "type": "uint256",
        "indexed": true,
        "internalType": "uint256"
      },
      {
        "name": "sprayer",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      },
      {
        "name": "amount",
        "type": "uint256",
        "indexed": false,
        "internalType": "uint256"
      },
      {
        "name": "newTotal",
        "type": "uint256",
        "indexed": false,
        "internalType": "uint256"
      },
      {
        "name": "count",
        "type": "uint64",
        "indexed": false,
        "internalType": "uint64"
      }
    ],
    "anonymous": false
  },
  {
    "type": "error",
    "name": "NotHost",
    "inputs": []
  },
  {
    "type": "error",
    "name": "NothingToWithdraw",
    "inputs": []
  },
  {
    "type": "error",
    "name": "PartyInactive",
    "inputs": []
  },
  {
    "type": "error",
    "name": "TransferFailed",
    "inputs": []
  },
  {
    "type": "error",
    "name": "ZeroRecipient",
    "inputs": []
  },
  {
    "type": "error",
    "name": "ZeroValue",
    "inputs": []
  }
] as const satisfies Abi;

/** The event the stage rebuilds every number on screen from. */
export const sprayedEvent = sprayPartyAbi.find(
  (item) => item.type === "event" && item.name === "Sprayed"
)!;
