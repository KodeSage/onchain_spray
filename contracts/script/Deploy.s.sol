// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console} from "forge-std/Script.sol";
import {SprayParty} from "../src/SprayParty.sol";

/// forge script script/Deploy.s.sol:Deploy --rpc-url $MONAD_RPC_URL --broadcast
contract Deploy is Script {
    function run() external returns (SprayParty deployed) {
        uint256 pk = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(pk);

        console.log("deployer :", deployer);
        console.log("balance  :", deployer.balance);
        require(deployer.balance > 0, "deployer has no MON - fund it at faucet.monad.xyz");

        vm.startBroadcast(pk);
        deployed = new SprayParty();

        // Open party 0 in the same broadcast, so the stage has something to
        // point at the moment the deploy finishes.
        uint256 partyId = deployed.createParty(bytes32("Monad Blitz Abuja"));
        vm.stopBroadcast();

        console.log("SprayParty:", address(deployed));
        console.log("partyId   :", partyId);
        console.log("");
        console.log("Add to .env.local:");
        console.log(
            string.concat("NEXT_PUBLIC_SPRAY_CONTRACT=", vm.toString(address(deployed)))
        );
    }
}
