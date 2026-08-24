#!/usr/bin/env bash
# Deploy TapArena to Monad testnet, verify on all explorers, and write the
# address into .env.local. One command, because on the day there is no time.
set -euo pipefail

cd "$(dirname "$0")/.."
if [ -f .env ]; then set -a; . ./.env; set +a; fi

: "${PRIVATE_KEY:?set PRIVATE_KEY in .env (a funded Monad testnet key)}"
MONAD_RPC_URL="${MONAD_RPC_URL:-https://testnet-rpc.monad.xyz}"
export PRIVATE_KEY MONAD_RPC_URL

echo "==> deploying to Monad testnet (10143)"
cd contracts
forge script script/Deploy.s.sol:Deploy \
  --rpc-url "$MONAD_RPC_URL" \
  --broadcast \
  -vvv | tee /tmp/tap-deploy.log

ADDR=$(grep -Eo 'TapArena: 0x[0-9a-fA-F]{40}' /tmp/tap-deploy.log | tail -1 | awk '{print $2}')
if [ -z "$ADDR" ]; then echo "could not parse deployed address"; exit 1; fi
echo "==> deployed at $ADDR"

echo "==> verifying on all explorers (MonadVision, Socialscan, Monadscan)"
forge verify-contract "$ADDR" src/TapArena.sol:TapArena \
  --chain 10143 --show-standard-json-input > /tmp/tap-standard-input.json
jq '.metadata' out/TapArena.sol/TapArena.json > /tmp/tap-metadata.json

SOLC=$(jq -r '.metadata.compiler.version' out/TapArena.sol/TapArena.json)
jq -n \
  --arg addr "$ADDR" \
  --arg solc "v$SOLC" \
  --slurpfile input /tmp/tap-standard-input.json \
  --slurpfile meta /tmp/tap-metadata.json \
  '{chainId:10143, contractAddress:$addr, contractName:"src/TapArena.sol:TapArena",
    compilerVersion:$solc, standardJsonInput:$input[0], foundryMetadata:$meta[0]}' \
  > /tmp/tap-verify.json

curl -sS -X POST https://agents.devnads.com/v1/verify \
  -H "Content-Type: application/json" -d @/tmp/tap-verify.json || true
echo

cd ..
echo "==> writing NEXT_PUBLIC_ARENA_CONTRACT to .env.local"
touch .env.local
grep -v '^NEXT_PUBLIC_ARENA_CONTRACT=' .env.local > .env.local.tmp || true
echo "NEXT_PUBLIC_ARENA_CONTRACT=$ADDR" >> .env.local.tmp
mv .env.local.tmp .env.local

npm run gen:abi

echo ""
echo "done."
echo "  contract : $ADDR"
echo "  explorer : https://testnet.monadvision.com/address/$ADDR"
echo "  stage    : /stage/0"
