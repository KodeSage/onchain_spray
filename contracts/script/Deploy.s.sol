// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console} from "forge-std/Script.sol";
import {TapArena} from "../src/TapArena.sol";

/// forge script script/Deploy.s.sol:Deploy --rpc-url $MONAD_RPC_URL --broadcast
contract Deploy is Script {
    function run() external returns (TapArena deployed) {
        uint256 pk = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(pk);

        console.log("deployer :", deployer);
        console.log("balance  :", deployer.balance);
        require(deployer.balance > 0, "deployer has no MON - fund it at faucet.monad.xyz");

        // The operator is the house server's hot wallet — the only address that
        // can settle a claim. It is separate from the owner on purpose: the key
        // that sits in a serverless environment variable should not also be the
        // key that can hand ownership away. Defaults to the deployer so a local
        // deploy works with no extra setup.
        address operator = vm.envOr("OPERATOR_ADDRESS", deployer);

        vm.startBroadcast(pk);
        deployed = new TapArena(operator);
        vm.stopBroadcast();

        console.log("TapArena :", address(deployed));
        console.log("owner    :", deployer);
        console.log("operator :", operator);
        console.log("round    :", deployed.currentRound());
        console.log("");
        console.log("Add to .env.local:");
        console.log(string.concat("NEXT_PUBLIC_ARENA_CONTRACT=", vm.toString(address(deployed))));

        if (operator == deployer) {
            console.log("");
            console.log("NOTE: operator == owner. Set OPERATOR_ADDRESS to split them in production.");
        }
    }
}
