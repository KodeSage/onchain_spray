// Regenerates lib/contract.ts from the Foundry build output.
import fs from "node:fs";

const artifactPath = "contracts/out/SprayParty.sol/SprayParty.json";
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
export const SPRAY_CONTRACT = (process.env.NEXT_PUBLIC_SPRAY_CONTRACT ??
  "") as Address;

export function assertContractConfigured(): Address {
  if (!SPRAY_CONTRACT || !SPRAY_CONTRACT.startsWith("0x")) {
    throw new Error(
      "NEXT_PUBLIC_SPRAY_CONTRACT is not set. Run \`npm run deploy\` first."
    );
  }
  return SPRAY_CONTRACT;
}

export const sprayPartyAbi = ${JSON.stringify(abi, null, 2)} as const satisfies Abi;

/** The event the stage rebuilds every number on screen from. */
export const sprayedEvent = sprayPartyAbi.find(
  (item) => item.type === "event" && item.name === "Sprayed"
)!;
`
);
console.log(`lib/contract.ts regenerated (${abi.length} ABI entries)`);
