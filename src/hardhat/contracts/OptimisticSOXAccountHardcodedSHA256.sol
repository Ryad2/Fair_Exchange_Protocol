// SPDX-License-Identifier: GPL-3.0
pragma solidity ^0.8.0;

import {OptimisticSOXAccountPhase3NoHardcoded} from "./OptimisticSOXAccountPhase3NoHardcoded.sol";
import {DisputeDeployerHardcodedSHA256} from "./DisputeDeployerHardcodedSHA256.sol";
import {HardcodedSha256CircuitLib} from "./HardcodedSha256CircuitLib.sol";

contract OptimisticSOXAccountHardcodedSHA256 is OptimisticSOXAccountPhase3NoHardcoded {
    bool public constant hardcodedSha256Circuit = true;
    bytes32 public immutable hardcodedDescriptionHash;
    uint64 public immutable hardcodedPlaintextLength;
    bytes16 public immutable hardcodedCiphertextIv;

    constructor(
        address _entryPoint,
        address _vendor,
        address _buyer,
        uint256 _agreedPrice,
        uint256 _completionTip,
        uint256 _disputeTip,
        uint256 _timeoutIncrement,
        bytes32 _commitment,
        uint32 _numBlocks,
        uint32 _numGates,
        address _vendorSigner,
        bytes32 _descriptionHash,
        uint64 _plaintextLength,
        bytes16 _ciphertextIv
    )
        payable
        OptimisticSOXAccountPhase3NoHardcoded(
            _entryPoint,
            _vendor,
            _buyer,
            _agreedPrice,
            _completionTip,
            _disputeTip,
            _timeoutIncrement,
            _commitment,
            _numBlocks,
            _numGates,
            _vendorSigner
        )
    {
        require(_plaintextLength > 0, "Plaintext length required");
        require(_plaintextLength <= type(uint64).max / 8, "Plaintext length too large");
        require(
            HardcodedSha256CircuitLib.numBlocksForPlaintextLength(_plaintextLength) == numBlocks,
            "Plaintext length mismatch"
        );
        require(
            HardcodedSha256CircuitLib.hardcodedSha256GateCount(_plaintextLength, numBlocks) ==
                numGates,
            "Hardcoded gate count mismatch"
        );

        hardcodedDescriptionHash = _descriptionHash;
        hardcodedPlaintextLength = _plaintextLength;
        hardcodedCiphertextIv = _ciphertextIv;
    }

    function expectedHardcodedSha256NumBlocks(uint64 _plaintextLength) public pure returns (uint32) {
        return HardcodedSha256CircuitLib.numBlocksForPlaintextLength(_plaintextLength);
    }

    function expectedHardcodedSha256NumGates(uint64 _plaintextLength) public pure returns (uint32) {
        uint32 blocks = HardcodedSha256CircuitLib.numBlocksForPlaintextLength(_plaintextLength);
        return HardcodedSha256CircuitLib.hardcodedSha256GateCount(_plaintextLength, blocks);
    }

    function hardcodedMetadata() external view returns (bytes32, uint64, bytes16) {
        return (hardcodedDescriptionHash, hardcodedPlaintextLength, hardcodedCiphertextIv);
    }

    function _deployDispute(
        address _vendorDisputeSponsor,
        address _vendorDisputeSponsorSigner
    ) internal override returns (address) {
        return
            DisputeDeployerHardcodedSHA256.deployDispute(
                address(entryPoint),
                address(this),
                numBlocks,
                numGates,
                commitment,
                buyer,
                vendor,
                buyerDisputeSponsor,
                _vendorDisputeSponsor,
                _vendorDisputeSponsorSigner
            );
    }
}
