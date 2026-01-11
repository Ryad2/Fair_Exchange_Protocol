// SPDX-License-Identifier: GPL 3.0
pragma solidity ^0.8.0;

/**
 * @title AccumulatorVerifier
 * @notice A library for verifying accumulator proofs.
 * @dev This library provides functions to verify the correctness of accumulator proofs.
 * It includes helper functions to sort arrays, compute hashes, and verify proofs.
 */
library AccumulatorVerifier {
    /**
     * @dev Struct representing a key-value pair.
     * @param key The key as a uint32.
     * @param value The value as a bytes32.
     */
    struct Pair {
        uint32 key;
        bytes32 value;
    }

    /**
     * @notice Gets the neighbor index of a given index.
     * @dev If the index is even, returns the next index; if the index is odd, returns the previous index.
     * @param index The index to find the neighbor for.
     * @return The neighbor index.
     */
    function getNeighbor(uint32 index) internal pure returns (uint32) {
        if (index % 2 == 0) return index + 1;
        else return index - 1;
    }

    /**
     * @notice Computes the hash of two bytes32 values.
     * @dev Uses keccak256 to hash the concatenation of the two values.
     * @param left The first bytes32 value.
     * @param right The second bytes32 value.
     * @return The hash of the concatenated values.
     */
    function hash(bytes32 left, bytes32 right) internal pure returns (bytes32) {
        return keccak256(bytes.concat(left, right));
    }

    /**
     * @notice Verifies an accumulator proof.
     * @dev This function checks if the provided values and proof correctly verify against the given root.
     * @param root The root of the accumulator.
     * @param indices The indices of the values to verify.
     * @param valuesKeccak The keccak hashes of the values to verify.
     * @param proof The proof to verify.
     * @return True if the proof is valid, false otherwise.
     */
    function verify(
        bytes32 root,
        uint32[] memory indices,
        bytes32[] memory valuesKeccak,
        bytes32[][] memory proof
    ) public pure returns (bool) {
        // From https://arxiv.org/pdf/2002.07648, slighlty modified
        // by taking the proof in reverse order to use pop() instead of
        // dealing with the removal of the first element of the proof
        // also uses a 2d proof in order to deal with "lonely" elements
        if (indices.length != valuesKeccak.length) return false;

        // we consider that if no values are supplied, the proof is correct
        // because the proof will be empty anyways. Also covers the case of
        // step 8a for proof p_2 if the gate doesn't use any input from the
        // ciphertext directly (no sInL)
        if (indices.length == 0) return true;

        (indices, valuesKeccak) = sortAligned(indices, valuesKeccak);

        for (uint32 l = 0; l < proof.length; l++) {
            uint32[2][] memory b = new uint32[2][](indices.length);
            uint32 bPrunedLength = 0;
            for (uint32 i = 0; i < indices.length; i++) {
                uint32 currIdx = indices[i];
                uint32 neighborIdx = getNeighbor(currIdx);

                if (neighborIdx < currIdx) b[i] = [neighborIdx, currIdx];
                else b[i] = [currIdx, neighborIdx];

                if (i == 0 || b[i][0] != b[i - 1][0]) {
                    bPrunedLength++;
                }
            }

            uint32[] memory nextIndices = new uint32[](bPrunedLength);
            bytes32[] memory nextValues = new bytes32[](bPrunedLength);
            // proofs were initially reversed to use .pop() but it only works on storage
            // which uses more gas
            // we also take the +1 to avoid conversions between uint and int
            uint256 nextElementPlusOne = proof[l].length;
            uint32 indicesI = 0;
            uint32 valuesI = 0;
            for (uint32 i = 0; i < b.length; i++) {
                if (i + 1 < b.length && b[i][0] == b[i + 1][0]) {
                    // duplicate found
                    // this means that b[i][0] and b[i][1] are elements of
                    // nextIndices. Furthermore, b[i] is computed based on
                    // nextIndices[i] and since we skip the duplicates,
                    // it can only be that b[i][0] == nextIndices[i]
                    // => the corresponding values are valuesKeccak[i]
                    // and valuesKeccak[i+1]
                    nextValues[valuesI] = hash(
                        valuesKeccak[i],
                        valuesKeccak[i + 1]
                    );
                    valuesI++;

                    i++; // skip next element (duplicate)
                } else if (nextElementPlusOne > 0) {
                    // index needed to hash elements in the correct order
                    uint32 correspondingIdx = indices[i];
                    uint32 neighborIdx = getNeighbor(correspondingIdx);

                    if (neighborIdx < correspondingIdx) {
                        nextValues[valuesI] = hash(
                            proof[l][nextElementPlusOne - 1],
                            valuesKeccak[i]
                        );
                        valuesI++;
                        nextElementPlusOne--;
                    } else {
                        nextValues[valuesI] = hash(
                            valuesKeccak[i],
                            proof[l][nextElementPlusOne - 1]
                        );
                        valuesI++;
                        nextElementPlusOne--;
                    }
                } else {
                    // proof layer is empty, move the element that must be combined to the next layer
                    nextValues[valuesI] = valuesKeccak[i];
                    valuesI++;
                }

                nextIndices[indicesI] = (indices[i] >> 1);
                indicesI++;
            }
            valuesKeccak = nextValues;
            indices = nextIndices;
        }
        require(
            valuesKeccak.length == 1,
            "Something went wrong during the verification"
        );

        return valuesKeccak[0] == root;
    }

    /**
     * @notice Verifies the previous root of an accumulator.
     * @dev This function checks if the provided proof correctly verifies against the previous root.
     * @param prevRoot The previous root of the accumulator.
     * @param proof The proof to verify.
     * @return True if the proof is valid, false otherwise.
     */
    function verifyPrevious(
        bytes32 prevRoot,
        bytes32[][] calldata proof
    ) internal pure returns (bool) {
        bool firstFound = false;
        bytes32 computedRoot;
        for (uint32 i = 0; i < proof.length; i++) {
            uint256 nextElementPlusOne = proof[i].length;
            while (nextElementPlusOne > 0) {
                if (!firstFound) {
                    computedRoot = proof[i][nextElementPlusOne - 1];
                    nextElementPlusOne--;
                    firstFound = true;
                } else {
                    computedRoot = keccak256(
                        bytes.concat(
                            proof[i][nextElementPlusOne - 1],
                            computedRoot
                        )
                    );
                    nextElementPlusOne--;
                }
            }
        }
        return computedRoot == prevRoot;
    }

    /**
     * @notice Verifies an extension proof.
     * @dev This function checks if the provided value and proof correctly verify against the current and previous roots.
     * @param i The index of the added value.
     * @param prevRoot The previous root of the accumulator.
     * @param currRoot The current root of the accumulator.
     * @param addedValKeccak The keccak hash of the added value.
     * @param proof The proof to verify.
     * @return True if the proof is valid, false otherwise.
     */
    function verifyExt(
        uint32 i,
        bytes32 prevRoot,
        bytes32 currRoot,
        bytes32 addedValKeccak,
        bytes32[][] calldata proof
    ) public pure returns (bool) {
        uint32[] memory iArr = new uint32[](1);
        iArr[0] = i;

        bytes32[] memory addedValKeccakArr = new bytes32[](1);
        addedValKeccakArr[0] = addedValKeccak;

        return
            verify(currRoot, iArr, addedValKeccakArr, proof) &&
            verifyPrevious(prevRoot, proof);
    }

    /**
     * @notice Sorts two arrays in alignment with each other.
     * @dev This function sorts the indices array and aligns the values array accordingly.
     * @param indices The array of indices to sort.
     * @param values The array of values to align with the sorted indices.
     * @return sortedIndices The sorted array of indices.
     * @return sortedValues The array of values aligned with the sorted indices.
     */
    function sortAligned(
        uint32[] memory indices,
        bytes32[] memory values
    )
        internal
        pure
        returns (uint32[] memory sortedIndices, bytes32[] memory sortedValues)
    {
        require(indices.length == values.length, "Mismatched input lengths");

        uint256 len = indices.length;
        Pair[] memory pairs = new Pair[](len);

        for (uint256 i = 0; i < len; i++) {
            pairs[i] = Pair(indices[i], values[i]);
        }

        // Insertion sort for simplicity (gas-efficient for small arrays)
        for (uint256 i = 1; i < len; i++) {
            Pair memory current = pairs[i];
            uint256 j = i;
            while (j > 0 && pairs[j - 1].key > current.key) {
                pairs[j] = pairs[j - 1];
                j--;
            }
            pairs[j] = current;
        }

        sortedIndices = new uint32[](len);
        sortedValues = new bytes32[](len);
        for (uint256 i = 0; i < len; i++) {
            sortedIndices[i] = pairs[i].key;
            sortedValues[i] = pairs[i].value;
        }
    }
}
