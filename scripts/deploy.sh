#!/usr/bin/env bash
# Deploy SprayParty to Monad testnet, verify on all explorers, and write the
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
  -vvv | tee /tmp/spray-deploy.log

ADDR=$(grep -Eo 'SprayParty: 0x[0-9a-fA-F]{40}' /tmp/spray-deploy.log | tail -1 | awk '{print $2}')
if [ -z "$ADDR" ]; then echo "could not parse deployed address"; exit 1; fi
echo "==> deployed at $ADDR"

echo "==> verifying on all explorers (MonadVision, Socialscan, Monadscan)"
forge verify-contract "$ADDR" src/SprayParty.sol:SprayParty \
  --chain 10143 --show-standard-json-input > /tmp/spray-standard-input.json
jq '.metadata' out/SprayParty.sol/SprayParty.json > /tmp/spray-metadata.json

SOLC=$(jq -r '.metadata.compiler.version' out/SprayParty.sol/SprayParty.json)
jq -n \
  --arg addr "$ADDR" \
  --arg solc "v$SOLC" \
  --slurpfile input /tmp/spray-standard-input.json \
  --slurpfile meta /tmp/spray-metadata.json \
  '{chainId:10143, contractAddress:$addr, contractName:"src/SprayParty.sol:SprayParty",
    compilerVersion:$solc, standardJsonInput:$input[0], foundryMetadata:$meta[0]}' \
  > /tmp/spray-verify.json

curl -sS -X POST https://agents.devnads.com/v1/verify \
  -H "Content-Type: application/json" -d @/tmp/spray-verify.json || true
echo

cd ..
echo "==> writing NEXT_PUBLIC_SPRAY_CONTRACT to .env.local"
touch .env.local
grep -v '^NEXT_PUBLIC_SPRAY_CONTRACT=' .env.local > .env.local.tmp || true
echo "NEXT_PUBLIC_SPRAY_CONTRACT=$ADDR" >> .env.local.tmp
mv .env.local.tmp .env.local

npm run gen:abi

echo ""
echo "done."
echo "  contract : $ADDR"
echo "  explorer : https://testnet.monadvision.com/address/$ADDR"
echo "  stage    : /stage/0"
