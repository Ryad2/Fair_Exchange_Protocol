// SPDX-License-Identifier: GPL 3.0
pragma solidity ^0.8.0;

/**
 * @title CommitmentOpener
 * @notice A library for opening commitments.
 * @dev This library provides a function to open a commitment by verifying the opening value.
 */
library CommitmentOpener {
    /**
     * @notice Opens a commitment by verifying the opening value.
     * @dev This function checks if the hashed opening value matches the commitment.
     * @param _commitment The commitment to open.
     * @param _openingValue The value used to open the commitment.
     * @return The opening value without the last 16 bytes.
     */
    function open(
        bytes32 _commitment,
        bytes calldata _openingValue
    ) external pure returns (bytes memory) {
        bytes32 hashed = keccak256(_openingValue);
        require(
            hashed == _commitment,
            "Commitment and opening value do not match"
        );

        return _openingValue[:(_openingValue.length - 16)];
    }
}
