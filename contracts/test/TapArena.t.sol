// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {TapArena} from "../src/TapArena.sol";

contract TapArenaTest is Test {
    TapArena internal arena;

    address internal owner = makeAddr("owner");
    address internal operator = makeAddr("operator");
    address internal alice = makeAddr("alice");
    address internal bob = makeAddr("bob");
    address internal payout = makeAddr("payout");

    /// Cached in setUp rather than read inline. `maxBatch` sitting in
    /// an argument list is itself a call, and it eats the pending vm.prank
    /// before the call under test ever runs.
    uint32 internal minTaps;
    uint32 internal maxBatch;
    uint256 internal maxClaim;

    /// A real-world timestamp. Round arithmetic is meaningless at t=0 and the
    /// tests should never lean on a clock the chain will never have.
    uint256 internal constant DAY_ZERO = 1_787_000_000;

    event Tapped(
        address indexed player,
        uint32 indexed round,
        uint32 taps,
        uint32 roundTaps,
        uint64 totalTaps
    );

    event Claimed(
        address indexed player,
        address indexed payout,
        uint32 indexed round,
        uint256 amount,
        uint32 roundTaps
    );

    function setUp() public {
        vm.warp(DAY_ZERO);
        vm.prank(owner);
        arena = new TapArena(operator);
        vm.deal(operator, 100 ether);

        minTaps = arena.MIN_TAPS_TO_CLAIM();
        maxBatch = arena.MAX_BATCH();
        maxClaim = arena.MAX_CLAIM();
    }

    function _tap(address who, uint32 times) internal {
        for (uint32 i = 0; i < times; i++) {
            vm.prank(who);
            arena.tap();
        }
    }

    function _roundTaps(address who) internal view returns (uint32) {
        (, uint32 roundTaps,,,) = arena.players(who);
        return roundTaps;
    }

    function _totalTaps(address who) internal view returns (uint64) {
        (,, uint64 totalTaps,,) = arena.players(who);
        return totalTaps;
    }

    /* ------------------------------------------------------------------
       Tapping
       ------------------------------------------------------------------ */

    function test_tap_incrementsRoundAndTotal() public {
        _tap(alice, 3);
        assertEq(_roundTaps(alice), 3);
        assertEq(_totalTaps(alice), 3);
    }

    function test_tap_emitsFullEventPayload() public {
        _tap(alice, 1);

        vm.expectEmit(true, true, true, true);
        emit Tapped(alice, arena.currentRound(), 1, 2, 2);

        vm.prank(alice);
        arena.tap();
    }

    function test_tap_stampsCurrentRound() public {
        _tap(alice, 1);
        (uint32 round,,,,) = arena.players(alice);
        assertEq(round, arena.currentRound());
    }

    /// The whole parallel-execution argument rests on this: two players share
    /// no storage, so nothing either of them does can be observed by the other.
    function test_tap_playersAreFullyIndependent() public {
        _tap(alice, 5);
        _tap(bob, 2);

        assertEq(_roundTaps(alice), 5);
        assertEq(_roundTaps(bob), 2);
        assertEq(_totalTaps(alice), 5);
        assertEq(_totalTaps(bob), 2);
    }

    function test_tapBatch_creditsWholeBatch() public {
        vm.prank(alice);
        arena.tapBatch(10);
        assertEq(_roundTaps(alice), 10);
        assertEq(_totalTaps(alice), 10);
    }

    function test_tapBatch_mixesWithSingleTaps() public {
        _tap(alice, 3);
        vm.prank(alice);
        arena.tapBatch(7);
        _tap(alice, 2);
        assertEq(_roundTaps(alice), 12);
    }

    function test_tapBatch_zeroReverts() public {
        vm.prank(alice);
        vm.expectRevert(TapArena.BadBatch.selector);
        arena.tapBatch(0);
    }

    function test_tapBatch_aboveMaxReverts() public {
        vm.prank(alice);
        vm.expectRevert(TapArena.BadBatch.selector);
        arena.tapBatch(maxBatch + 1);
    }

    function test_tapBatch_atMaxIsAllowed() public {
        vm.prank(alice);
        arena.tapBatch(maxBatch);
        assertEq(_roundTaps(alice), maxBatch);
    }

    /* ------------------------------------------------------------------
       Rounds
       ------------------------------------------------------------------ */

    function test_round_rollsOverDaily() public {
        uint32 today = arena.currentRound();
        vm.warp(block.timestamp + 1 days);
        assertEq(arena.currentRound(), today + 1);
    }

    function test_round_isNeverZero() public {
        vm.warp(0);
        assertGt(arena.currentRound(), 0);
    }

    /// A new round zeroes the leaderboard tally without any rollover
    /// transaction having run — the round is derived, not stored.
    function test_round_resetsRoundTapsButNotTotal() public {
        _tap(alice, 6);
        vm.warp(block.timestamp + 1 days);

        _tap(alice, 2);
        assertEq(_roundTaps(alice), 2, "round tally restarts");
        assertEq(_totalTaps(alice), 8, "lifetime tally survives");
    }

    function test_round_staleTapsDoNotCountTowardToday() public {
        _tap(alice, 30);
        vm.warp(block.timestamp + 1 days);

        (bool ok,, uint32 roundTaps, uint32 tapsNeeded) = arena.claimable(alice);
        assertFalse(ok);
        assertEq(roundTaps, 0);
        assertEq(tapsNeeded, minTaps);
    }

    /* ------------------------------------------------------------------
       claimable()
       ------------------------------------------------------------------ */

    function test_claimable_falseBelowThreshold() public {
        _tap(alice, minTaps - 1);
        (bool ok,,, uint32 tapsNeeded) = arena.claimable(alice);
        assertFalse(ok);
        assertEq(tapsNeeded, 1);
    }

    function test_claimable_trueAtThreshold() public {
        _tap(alice, minTaps);
        (bool ok,,, uint32 tapsNeeded) = arena.claimable(alice);
        assertTrue(ok);
        assertEq(tapsNeeded, 0);
    }

    function test_claimable_falseAfterClaiming() public {
        _tap(alice, 30);
        uint32 round = arena.currentRound();
        vm.prank(operator);
        arena.settleClaim{value: 0.1 ether}(alice, payout, round, 0.1 ether);

        (bool ok,,,) = arena.claimable(alice);
        assertFalse(ok);
    }

    /* ------------------------------------------------------------------
       settleClaim()
       ------------------------------------------------------------------ */

    function test_settleClaim_paysThePayoutAddress() public {
        _tap(alice, 30);
        uint256 before = payout.balance;

        uint32 round = arena.currentRound();
        vm.prank(operator);
        arena.settleClaim{value: 0.25 ether}(alice, payout, round, 0.25 ether);

        assertEq(payout.balance - before, 0.25 ether);
    }

    /// The drip rides in as msg.value, so the arena is not a pool anyone can
    /// drain and never needs topping up.
    function test_settleClaim_leavesNoBalanceInTheContract() public {
        _tap(alice, 30);
        uint32 round = arena.currentRound();
        vm.prank(operator);
        arena.settleClaim{value: 0.25 ether}(alice, payout, round, 0.25 ether);

        assertEq(address(arena).balance, 0);
    }

    function test_settleClaim_recordsRoundAndRunningTotal() public {
        _tap(alice, 30);
        uint32 round = arena.currentRound();

        vm.prank(operator);
        arena.settleClaim{value: 0.25 ether}(alice, payout, round, 0.25 ether);

        (,,, uint32 claimedRound, uint96 claimedTotal) = arena.players(alice);
        assertEq(claimedRound, round);
        assertEq(claimedTotal, 0.25 ether);
    }

    function test_settleClaim_emitsClaimed() public {
        _tap(alice, 30);
        uint32 round = arena.currentRound();

        vm.expectEmit(true, true, true, true);
        emit Claimed(alice, payout, round, 0.25 ether, 30);

        vm.prank(operator);
        arena.settleClaim{value: 0.25 ether}(alice, payout, round, 0.25 ether);
    }

    /// Double-claim prevention lives here, on chain, so it survives the
    /// off-chain rate limiter being wiped or cold-started.
    function test_settleClaim_twiceInOneRoundReverts() public {
        _tap(alice, 30);
        uint32 round = arena.currentRound();

        vm.prank(operator);
        arena.settleClaim{value: 0.1 ether}(alice, payout, round, 0.1 ether);

        vm.prank(operator);
        vm.expectRevert(TapArena.AlreadyClaimed.selector);
        arena.settleClaim{value: 0.1 ether}(alice, payout, round, 0.1 ether);
    }

    function test_settleClaim_moreTapsDoNotReopenAClaimedRound() public {
        _tap(alice, 30);
        uint32 round = arena.currentRound();

        vm.prank(operator);
        arena.settleClaim{value: 0.1 ether}(alice, payout, round, 0.1 ether);

        _tap(alice, 50);

        vm.prank(operator);
        vm.expectRevert(TapArena.AlreadyClaimed.selector);
        arena.settleClaim{value: 0.1 ether}(alice, payout, round, 0.1 ether);
    }

    function test_settleClaim_nextRoundIsClaimableAgain() public {
        _tap(alice, 30);
        uint32 round = arena.currentRound();
        vm.prank(operator);
        arena.settleClaim{value: 0.1 ether}(alice, payout, round, 0.1 ether);

        vm.warp(block.timestamp + 1 days);
        _tap(alice, 30);

        uint32 tomorrow = arena.currentRound();
        assertEq(tomorrow, round + 1);
        vm.prank(operator);
        arena.settleClaim{value: 0.2 ether}(alice, payout, tomorrow, 0.2 ether);

        (,,,, uint96 claimedTotal) = arena.players(alice);
        assertEq(claimedTotal, 0.3 ether, "lifetime claimed accumulates across rounds");
    }

    function test_settleClaim_belowThresholdReverts() public {
        _tap(alice, 24);
        uint32 round = arena.currentRound();
        vm.prank(operator);
        vm.expectRevert(TapArena.NotEnoughTaps.selector);
        arena.settleClaim{value: 0.1 ether}(alice, payout, round, 0.1 ether);
    }

    function test_settleClaim_wrongRoundReverts() public {
        _tap(alice, 30);
        uint32 nextRound = arena.currentRound() + 1;
        vm.prank(operator);
        vm.expectRevert(TapArena.WrongRound.selector);
        arena.settleClaim{value: 0.1 ether}(alice, payout, nextRound, 0.1 ether);
    }

    function test_settleClaim_nonOperatorReverts() public {
        _tap(alice, 30);
        uint32 round = arena.currentRound();
        vm.deal(alice, 1 ether);
        vm.prank(alice);
        vm.expectRevert(TapArena.NotOperator.selector);
        arena.settleClaim{value: 0.1 ether}(alice, payout, round, 0.1 ether);
    }

    /// msg.value is the money that actually moves; `amount` is what gets
    /// recorded and emitted. If they can disagree the event log lies.
    function test_settleClaim_valueMismatchReverts() public {
        _tap(alice, 30);
        uint32 round = arena.currentRound();
        vm.prank(operator);
        vm.expectRevert(TapArena.AmountMismatch.selector);
        arena.settleClaim{value: 0.1 ether}(alice, payout, round, 0.2 ether);
    }

    function test_settleClaim_aboveMaxClaimReverts() public {
        _tap(alice, 30);
        uint256 tooMuch = maxClaim + 1;
        uint32 round = arena.currentRound();
        vm.deal(operator, tooMuch);
        vm.prank(operator);
        vm.expectRevert(TapArena.ClaimTooLarge.selector);
        arena.settleClaim{value: tooMuch}(alice, payout, round, tooMuch);
    }

    function test_settleClaim_zeroPayoutReverts() public {
        _tap(alice, 30);
        uint32 round = arena.currentRound();
        vm.prank(operator);
        vm.expectRevert(TapArena.ZeroAddress.selector);
        arena.settleClaim{value: 0.1 ether}(alice, address(0), round, 0.1 ether);
    }

    function test_settleClaim_isolatedBetweenPlayers() public {
        _tap(alice, 30);
        _tap(bob, 30);
        uint32 round = arena.currentRound();

        vm.prank(operator);
        arena.settleClaim{value: 0.1 ether}(alice, payout, round, 0.1 ether);

        (bool bobOk,,,) = arena.claimable(bob);
        assertTrue(bobOk, "alice claiming must not consume bob's round");
    }

    /* ------------------------------------------------------------------
       Administration
       ------------------------------------------------------------------ */

    function test_setOperator_movesSettlementRights() public {
        address next = makeAddr("next");
        vm.prank(owner);
        arena.setOperator(next);

        _tap(alice, 30);
        uint32 round = arena.currentRound();
        vm.deal(next, 1 ether);
        vm.prank(next);
        arena.settleClaim{value: 0.1 ether}(alice, payout, round, 0.1 ether);

        assertEq(payout.balance, 0.1 ether);
    }

    function test_setOperator_oldOperatorLosesRights() public {
        vm.prank(owner);
        arena.setOperator(makeAddr("next"));

        _tap(alice, 30);
        uint32 round = arena.currentRound();
        vm.prank(operator);
        vm.expectRevert(TapArena.NotOperator.selector);
        arena.settleClaim{value: 0.1 ether}(alice, payout, round, 0.1 ether);
    }

    function test_setOperator_nonOwnerReverts() public {
        vm.prank(alice);
        vm.expectRevert(TapArena.NotOwner.selector);
        arena.setOperator(alice);
    }

    function test_transferOwnership_nonOwnerReverts() public {
        vm.prank(alice);
        vm.expectRevert(TapArena.NotOwner.selector);
        arena.transferOwnership(alice);
    }

    function test_constructor_zeroOperatorFallsBackToDeployer() public {
        vm.prank(owner);
        TapArena fresh = new TapArena(address(0));
        assertEq(fresh.operator(), owner);
    }

    function test_sweep_recoversForcedBalance() public {
        vm.deal(address(arena), 3 ether);
        address sink = makeAddr("sink");

        vm.prank(owner);
        arena.sweep(sink);

        assertEq(sink.balance, 3 ether);
        assertEq(address(arena).balance, 0);
    }

    function test_sweep_nonOwnerReverts() public {
        vm.deal(address(arena), 1 ether);
        vm.prank(alice);
        vm.expectRevert(TapArena.NotOwner.selector);
        arena.sweep(alice);
    }

    /* ------------------------------------------------------------------
       Fuzz
       ------------------------------------------------------------------ */

    function testFuzz_tapBatch_tallyMatchesInput(uint32 a, uint32 b) public {
        a = uint32(bound(a, 1, maxBatch));
        b = uint32(bound(b, 1, maxBatch));

        vm.prank(alice);
        arena.tapBatch(a);
        vm.prank(alice);
        arena.tapBatch(b);

        assertEq(_roundTaps(alice), uint32(a) + b);
        assertEq(_totalTaps(alice), uint64(a) + b);
    }

    function testFuzz_settleClaim_neverStrandsValue(uint96 amount) public {
        amount = uint96(bound(amount, 1, maxClaim));
        _tap(alice, 30);
        vm.deal(operator, amount);

        uint32 round = arena.currentRound();
        vm.prank(operator);
        arena.settleClaim{value: amount}(alice, payout, round, amount);

        assertEq(payout.balance, amount);
        assertEq(address(arena).balance, 0);
    }
}
