// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {SprayParty} from "../src/SprayParty.sol";

/// Gas measurement for spray(), done honestly.
///
/// The trap: measuring two sprays inside one test function measures the second
/// one with WARM, already-dirty storage slots (~100 gas a pop). In production
/// every tap is its own transaction and pays cold access again, so that number
/// is fiction. setUp() runs as a separate transaction, so state written there
/// persists while the access list resets — which is exactly the real
/// steady-state case: cold slot, non-zero value.
///
/// One measurement per test function, because the EVM access list resets per
/// transaction and each test function is a transaction.
contract SprayGasTest is Test {
    SprayParty internal spray;
    address internal host = makeAddr("host");
    address internal alice = makeAddr("alice");
    uint256 internal partyId;

    function setUp() public {
        spray = new SprayParty();
        vm.prank(host);
        partyId = spray.createParty(bytes32("Blitz Abuja"), makeAddr("dancer"));
        vm.deal(alice, 100 ether);

        // Warm-up spray in setUp, so the measurement below sees cold-but-
        // non-zero slots, which is what tap number 7 actually costs.
        vm.prank(alice);
        spray.spray{value: 0.001 ether}(partyId);
    }

    /// Tap 2..N for a given address: both slots cold, both already non-zero.
    function test_gas_steadyStateSpray() public {
        vm.prank(alice);
        uint256 g = gasleft();
        spray.spray{value: 0.001 ether}(partyId);
        uint256 used = g - gasleft();
        emit log_named_uint("spray() steady-state (call gas, EVM pricing)", used);
        emit log_named_uint("  + 21000 base tx                           ", used + 21000);
        // Monad charges 8,100 for a cold SLOAD vs 2,100 here. spray() touches
        // 2 cold slots, so add 2 x 6,000.
        emit log_named_uint("  Monad-adjusted (+12000 cold surcharge)    ", used + 21000 + 12000);
    }

    /// An address's very first tap: sprayedBy goes zero -> non-zero, which is
    /// an SSTORE_SET (20,000) rather than an update (2,900).
    function test_gas_firstSprayForAddress() public {
        address fresh = makeAddr("fresh");
        vm.deal(fresh, 1 ether);

        vm.prank(fresh);
        uint256 g = gasleft();
        spray.spray{value: 0.001 ether}(partyId);
        uint256 used = g - gasleft();
        emit log_named_uint("spray() first-for-address (call gas)        ", used);
        emit log_named_uint("  + 21000 base tx                           ", used + 21000);
        emit log_named_uint("  Monad-adjusted (+12000 cold surcharge)    ", used + 21000 + 12000);
    }
}
