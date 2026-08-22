// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";

contract Slot {
    // deliberately never written, so the slot is cold on first read
    uint256 internal untouched;
    uint256 internal alsoUntouched;

    function readNone() external pure returns (uint256) { return 7; }
    function readOne() external view returns (uint256) { return untouched; }
    function readTwoDistinct() external view returns (uint256) {
        return untouched + alsoUntouched;
    }
}

/// Does this Foundry build price storage the Ethereum way (cold SLOAD 2,100)
/// or the Monad way (cold SLOAD 8,100)? lib/constants.ts depends on the answer.
contract ColdStoragePricingTest is Test {
    Slot internal s;

    function setUp() public {
        // deploy in setUp so the deployment tx does not warm slots for the
        // measurement tx
        s = new Slot();
    }

    function test_coldSloadPrice() public {
        // warm the account first, otherwise the first call also pays the cold
        // account-access charge (2,600 on Ethereum, 10,100 on Monad) and swamps
        // the storage measurement
        s.readNone();

        uint256 g = gasleft();
        s.readNone();
        uint256 none = g - gasleft();

        g = gasleft();
        s.readTwoDistinct();
        uint256 two = g - gasleft();

        // readTwoDistinct does 2 cold SLOADs, readNone does 0.
        // Ethereum: ~4,200 delta.  Monad: ~16,200 delta.
        emit log_named_uint("readNone gas        ", none);
        emit log_named_uint("readTwoDistinct gas ", two);
        emit log_named_uint("=> 2x cold SLOAD    ", two - none);
        emit log_named_uint("=> 1x cold SLOAD    ", (two - none) / 2);
    }
}
