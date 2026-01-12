// SPDX-License-Identifier: GPL-3.0
pragma solidity ^0.8.0;

contract TestEmptyString {
    function test() public pure returns (bytes32) {
        // bytes32 x = "";  // ❌ Ne compile pas
        bytes32 y = bytes32(0);  // ✅ Compile
        return y;
    }
}
