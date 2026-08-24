// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {TapArena} from "../src/TapArena.sol";

/// Gas measurement for tap(), done honestly.
///
/// The trap: measuring two taps inside one test function measures the second
/// one with a WARM, already-dirty storage slot (~100 gas a pop). In production
/// every tap is its own transaction and pays cold access again, so that number
/// is fiction. setUp() runs as a separate transaction, so state written there
/// persists while the access list resets — which is exactly the real
/// steady-state case: cold slot, non-zero value.
///
/// One measurement per test function, because the EVM access list resets per
/// transaction and each test function is a transaction.
///
/// Every number below is *this* Foundry build's Ethereum pricing, then adjusted
/// for Monad, where a cold SLOAD costs 8,100 rather than 2,100. tap() touches
/// exactly one cold slot — the caller's own Player record — so the surcharge is
/// a single +6,000. That "exactly one" is the entire storage design; see
/// ColdStoragePricing.t.sol for the proof that this build prices cold access
/// the Ethereum way.
contract TapGasTest is Test {
    TapArena internal arena;
    address internal alice = makeAddr("alice");

    /// Monad's cold SLOAD surcharge over Ethereum, per distinct cold slot.
    uint256 internal constant MONAD_COLD_SURCHARGE = 6_000;
    uint256 internal constant BASE_TX = 21_000;

    function setUp() public {
        vm.warp(1_787_000_000);
        arena = new TapArena(address(this));

        // Warm-up tap in setUp, so the measurements below see a cold-but-
        // non-zero slot, which is what tap number 7 actually costs.
        vm.prank(alice);
        arena.tap();
    }

    function _report(string memory label, uint256 callGas, uint256 taps) internal {
        uint256 total = callGas + BASE_TX + MONAD_COLD_SURCHARGE;
        emit log_named_uint(string.concat(label, " call gas (EVM pricing)"), callGas);
        emit log_named_uint(string.concat(label, " + base + Monad cold  "), total);
        // 100 MON-gwei is the floor base fee on Monad testnet, and the sender
        // pays on the LIMIT, so this is the real per-transaction cost.
        emit log_named_uint(string.concat(label, " wei @100gwei on limit"), total * 100 gwei);
        if (taps > 1) {
            emit log_named_uint(string.concat(label, " wei PER TAP          "), (total * 100 gwei) / taps);
        }
    }

    /// Tap 2..N for a given address: one cold slot, already non-zero.
    /// This is the number the faucet's cost-per-player is derived from.
    function test_gas_steadyStateTap() public {
        vm.prank(alice);
        uint256 g = gasleft();
        arena.tap();
        uint256 used = g - gasleft();
        _report("tap() steady-state", used, 1);
    }

    /// An address's very first tap: the Player slot goes zero -> non-zero,
    /// which is an SSTORE_SET (20,000) rather than an update (2,900).
    function test_gas_firstTapForAddress() public {
        address fresh = makeAddr("fresh");
        vm.prank(fresh);
        uint256 g = gasleft();
        arena.tap();
        uint256 used = g - gasleft();
        _report("tap() first-for-addr", used, 1);
    }

    /// The first tap of a NEW round for an existing player. The slot is already
    /// non-zero, so this is an update and should cost the same as steady state
    /// — a round rolling over must not cost the player a premium.
    function test_gas_firstTapOfNewRound() public {
        vm.warp(block.timestamp + 1 days);
        vm.prank(alice);
        uint256 g = gasleft();
        arena.tap();
        uint256 used = g - gasleft();
        _report("tap() new-round     ", used, 1);
    }

    /// Degradation mode. Same score, a fraction of the gas, because 21,000 base
    /// and one cold SLOAD are paid once instead of N times.
    function test_gas_tapBatch8() public {
        vm.prank(alice);
        uint256 g = gasleft();
        arena.tapBatch(8);
        uint256 used = g - gasleft();
        _report("tapBatch(8)        ", used, 8);
    }

    function test_gas_tapBatch64() public {
        vm.prank(alice);
        uint256 g = gasleft();
        arena.tapBatch(64);
        uint256 used = g - gasleft();
        _report("tapBatch(64)       ", used, 64);
    }

    function test_gas_settleClaim() public {
        vm.prank(alice);
        arena.tapBatch(30);

        address payout = makeAddr("payout");
        uint32 round = arena.currentRound();
        uint256 g = gasleft();
        arena.settleClaim{value: 0.1 ether}(alice, payout, round, 0.1 ether);
        uint256 used = g - gasleft();
        emit log_named_uint("settleClaim() call gas", used);
    }

    receive() external payable {}
}
