// SPDX-License-Identifier: GPL-3.0
pragma solidity ^0.8.0;

import {EvaluatorSOX_V2} from "../EvaluatorSOX_V2.sol";

/**
 * @title TestEvaluatorSOX_V2
 * @notice Test contract to verify EvaluatorSOX_V2 functions
 */
contract TestEvaluatorSOX_V2 {
    /**
     * @notice Evaluates a V2 gate from son values
     * @param gateBytes The 64-byte encoded gate
     * @param sonValues Array of evaluated son values
     * @param aesKey The AES-128 key (16 bytes)
     * @return The result of the gate evaluation
     */
    function evaluateGateFromSons(
        bytes calldata gateBytes,
        bytes[] calldata sonValues,
        bytes16 aesKey
    ) external pure returns (bytes memory) {
        return EvaluatorSOX_V2.evaluateGateFromSons(gateBytes, sonValues, aesKey);
    }

    /**
     * @notice Decodes a gate from 64 bytes
     * @param gateBytes The 64-byte encoded gate
     * @return opcode The gate's opcode
     * @return sons Array of son indices
     * @return params The gate's parameters
     */
    function decodeGate(bytes calldata gateBytes)
        external
        pure
        returns (uint8 opcode, int64[] memory sons, bytes memory params)
    {
        return EvaluatorSOX_V2.decodeGate(gateBytes);
    }

    /**
     * @notice Decodes a son index from 6 bytes
     * @param data The 6-byte array containing the encoded son index
     * @return The decoded son index as int64
     */
    function decodeSon(bytes6 data) external pure returns (int64) {
        return EvaluatorSOX_V2.decodeSon(data);
    }
}



