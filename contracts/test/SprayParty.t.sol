// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {SprayParty} from "../src/SprayParty.sol";

contract SprayPartyTest is Test {
    SprayParty internal spray;

    address internal host = makeAddr("host");
    address internal dancer = makeAddr("dancer");
    address internal alice = makeAddr("alice");
    address internal bob = makeAddr("bob");

    uint256 internal partyId;

    event Sprayed(
        uint256 indexed partyId,
        address indexed sprayer,
        uint256 amount,
        uint256 newTotal,
        uint64 count
    );

    function setUp() public {
        spray = new SprayParty();
        vm.prank(host);
        partyId = spray.createParty(bytes32("Blitz Abuja"), dancer);
        vm.deal(alice, 100 ether);
        vm.deal(bob, 100 ether);
    }

    function test_createParty_setsHostRecipientAndActive() public view {
        (
            address h,
            address r,
            bytes32 name,
            bool active,
            uint256 total,
            uint64 count,
            uint256 pending
        ) = spray.partyInfo(partyId);
        assertEq(h, host);
        assertEq(r, dancer, "the person being sprayed, not the creator");
        assertEq(name, bytes32("Blitz Abuja"));
        assertTrue(active);
        assertEq(total, 0);
        assertEq(count, 0);
        assertEq(pending, 0);
    }

    function test_createParty_zeroRecipientReverts() public {
        vm.prank(host);
        vm.expectRevert(SprayParty.ZeroRecipient.selector);
        spray.createParty(bytes32("Nobody"), address(0));
    }

    function test_spray_accumulatesTotalAndCount() public {
        vm.prank(alice);
        spray.spray{value: 0.01 ether}(partyId);
        vm.prank(bob);
        spray.spray{value: 0.02 ether}(partyId);
        vm.prank(alice);
        spray.spray{value: 0.03 ether}(partyId);

        (, , , , uint256 total, uint64 count, ) = spray.partyInfo(partyId);
        assertEq(total, 0.06 ether);
        assertEq(count, 3);
        assertEq(address(spray).balance, 0.06 ether, "funds stay in contract");
    }

    function test_sprayedBy_tracksPerAddress() public {
        vm.prank(alice);
        spray.spray{value: 0.01 ether}(partyId);
        vm.prank(alice);
        spray.spray{value: 0.04 ether}(partyId);
        vm.prank(bob);
        spray.spray{value: 0.02 ether}(partyId);

        assertEq(spray.sprayedBy(partyId, alice), 0.05 ether);
        assertEq(spray.sprayedBy(partyId, bob), 0.02 ether);
        assertEq(spray.sprayedBy(partyId, address(0xDEAD)), 0);
    }

    /// The event is the entire read API — the stage rebuilds every number on
    /// screen from it. If this test breaks, the projector goes blank.
    function test_spray_emitsFullEventPayload() public {
        vm.prank(alice);
        spray.spray{value: 0.01 ether}(partyId);

        vm.expectEmit(true, true, true, true);
        emit Sprayed(partyId, bob, 0.02 ether, 0.03 ether, 2);
        vm.prank(bob);
        spray.spray{value: 0.02 ether}(partyId);
    }

    function test_spray_zeroValueReverts() public {
        vm.prank(alice);
        vm.expectRevert(SprayParty.ZeroValue.selector);
        spray.spray{value: 0}(partyId);
    }

    function test_spray_onInactivePartyReverts() public {
        vm.prank(host);
        spray.endParty(partyId);

        vm.prank(alice);
        vm.expectRevert(SprayParty.PartyInactive.selector);
        spray.spray{value: 0.01 ether}(partyId);
    }

    function test_spray_onUnknownPartyReverts() public {
        vm.prank(alice);
        vm.expectRevert(SprayParty.PartyInactive.selector);
        spray.spray{value: 0.01 ether}(999);
    }

    /// payout is permissionless on purpose — the funds can only ever reach the
    /// recipient, so anyone triggering the push is harmless and lets the stage
    /// sweep on a timer without the dancer needing gas.
    function test_payout_anyoneCanTriggerButOnlyRecipientIsPaid() public {
        vm.prank(alice);
        spray.spray{value: 1 ether}(partyId);

        uint256 dancerBefore = dancer.balance;
        uint256 callerBefore = bob.balance;

        vm.prank(bob);
        spray.payout(partyId);

        assertEq(dancer.balance - dancerBefore, 1 ether, "recipient receives");
        assertEq(bob.balance, callerBefore, "caller receives nothing");
    }

    function test_payout_hostCannotTakeTheMoney() public {
        vm.prank(alice);
        spray.spray{value: 1 ether}(partyId);

        uint256 hostBefore = host.balance;
        vm.prank(host);
        spray.payout(partyId);

        assertEq(host.balance, hostBefore, "host is not the recipient");
        assertEq(dancer.balance, 1 ether);
    }

    function test_payout_sendsAccumulatedToRecipient() public {
        vm.prank(alice);
        spray.spray{value: 1 ether}(partyId);
        vm.prank(bob);
        spray.spray{value: 2 ether}(partyId);

        uint256 before = dancer.balance;
        spray.payout(partyId);

        assertEq(dancer.balance - before, 3 ether);
        assertEq(address(spray).balance, 0);

        // total is the display number and must survive a payout — the stage
        // total can never go backwards.
        (, , , , uint256 total, , ) = spray.partyInfo(partyId);
        assertEq(total, 3 ether);
    }

    /// The stage sweeps on a timer, so repeated payouts with nothing new in
    /// between are the normal case, not an edge case.
    function test_payout_twiceTakesOnlyNewFunds() public {
        vm.prank(alice);
        spray.spray{value: 1 ether}(partyId);
        spray.payout(partyId);

        vm.expectRevert(SprayParty.NothingToWithdraw.selector);
        spray.payout(partyId);

        vm.prank(bob);
        spray.spray{value: 0.5 ether}(partyId);

        uint256 before = dancer.balance;
        spray.payout(partyId);
        assertEq(dancer.balance - before, 0.5 ether, "only the new sprays");
    }

    /// Two parties must not be able to drain each other's funds.
    function test_payout_isolatedBetweenParties() public {
        address otherDancer = makeAddr("otherDancer");
        vm.prank(bob);
        uint256 second = spray.createParty(bytes32("Other"), otherDancer);

        vm.prank(alice);
        spray.spray{value: 1 ether}(partyId);
        vm.prank(alice);
        spray.spray{value: 5 ether}(second);

        uint256 before = dancer.balance;
        spray.payout(partyId);
        assertEq(dancer.balance - before, 1 ether, "only its own party");
        assertEq(otherDancer.balance, 0, "other recipient untouched");
        assertEq(address(spray).balance, 5 ether);
    }

    function test_endParty_nonHostReverts() public {
        vm.prank(alice);
        vm.expectRevert(SprayParty.NotHost.selector);
        spray.endParty(partyId);
    }

    function testFuzz_sprayAccumulates(uint96 a, uint96 b) public {
        vm.assume(a > 0 && b > 0);
        vm.deal(alice, uint256(a) + uint256(b));

        vm.startPrank(alice);
        spray.spray{value: a}(partyId);
        spray.spray{value: b}(partyId);
        vm.stopPrank();

        (, , , , uint256 total, uint64 count, ) = spray.partyInfo(partyId);
        assertEq(total, uint256(a) + uint256(b));
        assertEq(count, 2);
        assertEq(spray.sprayedBy(partyId, alice), uint256(a) + uint256(b));
    }
}
