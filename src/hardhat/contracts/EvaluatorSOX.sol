// SPDX-License-Identifier: GPL 3.0
pragma solidity ^0.8.0;

import {SHA256Evaluator} from "./SHA256Evaluator.sol";
import {SimpleOperationsEvaluator} from "./SimpleOperationsEvaluator.sol";
import {AES128CtrEvaluator} from "./AES128CtrEvaluator.sol";

/**
 * @dev Struct representing an instruction in the circuit evaluator.
 * @param f The function associated with the instruction.
 */
struct Instruction {
    function(bytes[] memory) internal pure returns (bytes memory) f;
}

/**
 * @title CircuitEvaluator
 * @notice A library for evaluating circuit gates.
 * @dev This library provides functions to evaluate gates in a circuit using a set of instructions.
 */
library CircuitEvaluator {
    /**
     * @notice Gets the set of instructions for the circuit evaluator.
     * @dev This function returns an array of instruction sets for different versions.
     * @return The instruction sets for the circuit evaluator.
     */
    function getInstructionSet()
        internal
        pure
        returns (Instruction[8][1] memory)
    {
        return [
            /* version 0 */ [
                Instruction(sha256CompressionInstruction),
                Instruction(encryptBlock),
                Instruction(decryptBlock),
                Instruction(binAdd),
                Instruction(binMult),
                Instruction(equal),
                Instruction(concat),
                Instruction(sha256FinalCompressionInstruction)
            ]
        ];
    }

    /**
     * @notice Evaluates a gate in the circuit.
     * @dev This function evaluates a gate using the provided data and instruction set version.
     * @param _gate The gate to evaluate, represented as an array of integers.
     * @param _data The data to use in the evaluation, represented as an array of bytes.
     * @param _version The version of the instruction set to use.
     * @return The result of the gate evaluation as bytes.
     */
    function evaluateGate(
        uint32[] calldata _gate, // == [op, s_1, ..., s_a]
        bytes[] memory _data, // == [v_1, ..., v_a]
        uint32 _version
    ) public pure returns (bytes memory) {
        Instruction[8][1] memory VERSION_INSTRUCTIONS = getInstructionSet();
        require(
            _version < VERSION_INSTRUCTIONS.length,
            "Invalid version number"
        );

        require(
            _data.length == _gate.length - 1,
            "Values doesn't have the required length"
        );

        return VERSION_INSTRUCTIONS[_version][_gate[0]].f(_data);
    }

    // wrappers
    // Internal wrapper for SHA256Evaluator.sha256CompressionInstruction
    function sha256CompressionInstruction(
        bytes[] memory _data
    ) internal pure returns (bytes memory) {
        return SHA256Evaluator.sha256CompressionInstruction(_data);
    }

    // Internal wrapper for SimpleOperationsEvaluator.binAdd
    function binAdd(bytes[] memory _data) internal pure returns (bytes memory) {
        return SimpleOperationsEvaluator.binAdd(_data);
    }

    // Internal wrapper for SimpleOperationsEvaluator.binMult
    function binMult(
        bytes[] memory _data
    ) internal pure returns (bytes memory) {
        return SimpleOperationsEvaluator.binMult(_data);
    }

    // Internal wrapper for SimpleOperationsEvaluator.equal
    function equal(bytes[] memory _data) internal pure returns (bytes memory) {
        return SimpleOperationsEvaluator.equal(_data);
    }

    // Internal wrapper for SimpleOperationsEvaluator.concat
    function concat(bytes[] memory _data) internal pure returns (bytes memory) {
        return SimpleOperationsEvaluator.concat(_data);
    }

    // Internal wrapper for SHA256Evaluator.sha256FinalCompressionInstruction
    function sha256FinalCompressionInstruction(
        bytes[] memory _data
    ) internal pure returns (bytes memory) {
        return SHA256Evaluator.sha256FinalCompressionInstruction(_data);
    }

    // Internal wrapper for AES128CtrEvaluator.encryptBlock
    function encryptBlock(
        bytes[] memory _data
    ) internal pure returns (bytes memory) {
        return AES128CtrEvaluator.encryptBlock(_data);
    }

    // Internal wrapper for AES128CtrEvaluator.decryptBlock
    function decryptBlock(
        bytes[] memory _data
    ) internal pure returns (bytes memory) {
        return AES128CtrEvaluator.decryptBlock(_data);
    }
}
