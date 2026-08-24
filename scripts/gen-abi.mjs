// Regenerates lib/contract.ts from the Foundry build output.
import fs from "node:fs";

const artifactPath = "contracts/out/TapArena.sol/TapArena.json";
if (!fs.existsSync(artifactPath)) {
  console.error(`Missing ${artifactPath}. Run \`forge build\` in contracts/ first.`);
  process.exit(1);
}

const { abi } = JSON.parse(fs.readFileSync(artifactPath, "utf8"));

fs.writeFileSync(
  "lib/contract.ts",
  `import type { Abi, Address } from "viem";

/**
 * Generated from ${artifactPath}.
 * Regenerate with \`npm run gen:abi\` after any contract change.
 */

/** Deployed address. Read from env — never hardcode it in source. */
export const ARENA_CONTRACT = (process.env.NEXT_PUBLIC_ARENA_CONTRACT ??
  "") as Address;

export function assertContractConfigured(): Address {
  if (!ARENA_CONTRACT || !ARENA_CONTRACT.startsWith("0x")) {
    throw new Error(
      "NEXT_PUBLIC_ARENA_CONTRACT is not set. Run \`npm run deploy\` first."
    );
  }
  return ARENA_CONTRACT;
}

export const tapArenaAbi = ${JSON.stringify(abi, null, 2)} as const satisfies Abi;

/** The event the arena rebuilds every number on screen from. */
export const tappedEvent = tapArenaAbi.find(
  (item) => item.type === "event" && item.name === "Tapped"
)!;
`
);
console.log(`lib/contract.ts regenerated (${abi.length} ABI entries)`);
