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

        // The party name is whoever is actually being sprayed tonight, so it
        // comes from the environment rather than being compiled in.
        string memory name = vm.envOr("PARTY_NAME", string("Monad Blitz Abuja"));
        require(bytes(name).length <= 31, "PARTY_NAME must fit in bytes32");

        vm.startBroadcast(pk);
        deployed = new SprayParty();

        // Open the first party in the same broadcast, so the stage has
        // something to point at the moment the deploy finishes. The host is the
        // deployer — that is the wallet the sprays accumulate for.
        uint256 partyId = deployed.createParty(bytes32(bytes(name)));
        vm.stopBroadcast();

        console.log("party    :", name);
        console.log("host     :", deployer);

        console.log("SprayParty:", address(deployed));
        console.log("partyId   :", partyId);
        console.log("");
        console.log("Add to .env.local:");
        console.log(
            string.concat("NEXT_PUBLIC_SPRAY_CONTRACT=", vm.toString(address(deployed)))
        );
    }
}
