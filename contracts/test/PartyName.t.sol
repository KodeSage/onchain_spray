// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {SprayParty} from "../src/SprayParty.sol";

/// The party name is written as bytes32 and decoded in the browser by
/// lib/party.ts. If the two disagree the projector shows garbage, so this pins
/// the encoding the deploy script uses against a literal.
contract PartyNameTest is Test {
    SprayParty internal spray;
    address internal host = makeAddr("host");
    address internal dancer = makeAddr("dancer");

    function setUp() public {
        spray = new SprayParty();
    }

    function test_envStringEncodingMatchesLiteral() public pure {
        string memory fromEnv = "Monad Blitz Abuja";
        assertEq(
            bytes32(bytes(fromEnv)),
            bytes32("Monad Blitz Abuja"),
            "deploy script encoding must match a bytes32 literal"
        );
    }

    function test_nameRoundTrips() public {
        string memory name = "Owambe at Blitz";
        vm.prank(host);
        uint256 id = spray.createParty(bytes32(bytes(name)), dancer);

        (address h, address r, bytes32 stored, bool active, , , ) = spray.partyInfo(id);
        assertEq(h, host, "host created the party");
        assertEq(r, dancer, "recipient is the wallet sprays are payable to");
        assertTrue(active);
        assertEq(stored, bytes32("Owambe at Blitz"));

        // left-aligned, null-padded — what hexToString(size: 32) expects
        assertEq(uint8(stored[0]), uint8(bytes1("O")));
        assertEq(uint8(stored[14]), uint8(bytes1("z")), "last char of a 15-char name");
        assertEq(uint8(stored[15]), 0, "padding must be trailing nulls");
        assertEq(uint8(stored[31]), 0);
    }

    function test_maxLengthNameFits() public {
        // 31 chars, the deploy script's documented limit
        string memory name = "1234567890123456789012345678901";
        assertEq(bytes(name).length, 31);
        vm.prank(host);
        uint256 id = spray.createParty(bytes32(bytes(name)), dancer);
        (, , bytes32 stored, , , , ) = spray.partyInfo(id);
        assertEq(uint8(stored[30]), uint8(bytes1("1")));
        assertEq(uint8(stored[31]), 0);
    }
}
