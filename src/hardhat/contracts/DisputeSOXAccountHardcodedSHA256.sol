// SPDX-License-Identifier: GPL-3.0
pragma solidity ^0.8.0;

import {
    DisputeSOXAccountNormal
} from "./DisputeSOXAccountNormal.sol";
import {HardcodedSha256CircuitLib} from "./HardcodedSha256CircuitLib.sol";

contract DisputeSOXAccountHardcodedSHA256 is DisputeSOXAccountNormal {
    constructor(
        address _entryPoint,
        address _optimisticContract,
        uint32 _numBlocks,
        uint32 _numGates,
        bytes32 _commitment,
        uint32 _circuitVersion,
        address _buyerSigner,
        address _vendorSigner,
        address _buyerDisputeSponsorSigner,
        address _vendorDisputeSponsor,
        address _vendorDisputeSponsorSigner
    )
        payable
        DisputeSOXAccountNormal(
            _entryPoint,
            _optimisticContract,
            _numBlocks,
            _numGates,
            _commitment,
            _circuitVersion,
            _buyerSigner,
            _vendorSigner,
            _buyerDisputeSponsorSigner,
            _vendorDisputeSponsor,
            _vendorDisputeSponsorSigner
        )
    {}

    function submitCommitment(
        bytes calldata _openingValue,
        uint32 _gateNum,
        bytes calldata,
        bytes[] calldata _values,
        bytes32 _currAcc,
        bytes32[][] memory,
        bytes32[][] memory _proof2,
        bytes32[][] memory _proof3,
        bytes32[][] memory _proofExt
    ) public override onlyExpected(vendor, State.WaitVendorData) {
        bytes32[2] memory hCircuitCt = openCommitment(_openingValue);
        bool verified = HardcodedSha256CircuitLib.verifyCommitmentFromOptimistic(
            address(optimisticContract),
            _gateNum,
            numBlocks,
            hCircuitCt[1],
            buyerResponses[_gateNum - 1],
            buyerResponses[_gateNum],
            _values,
            _currAcc,
            _proof2,
            _proof3,
            _proofExt,
            getAesKey()
        );

        if (verified) {
            handleStep9(false);
        } else {
            handleStep9(true);
        }
    }

    function submitCommitmentLeft(
        bytes calldata _openingValue,
        uint32 _gateNum,
        bytes calldata,
        bytes[] calldata _values,
        bytes32 _currAcc,
        bytes32[][] memory,
        bytes32[][] memory _proof2,
        bytes32[][] memory _proofExt
    ) public override onlyExpected(vendor, State.WaitVendorDataLeft) {
        bytes32[2] memory hCircuitCt = openCommitment(_openingValue);
        bool verified = HardcodedSha256CircuitLib.verifyCommitmentLeftFromOptimistic(
            address(optimisticContract),
            _gateNum,
            numBlocks,
            hCircuitCt[1],
            _values,
            _currAcc,
            _proof2,
            _proofExt,
            getAesKey()
        );

        if (verified) {
            handleStep9(false);
        } else {
            handleStep9(true);
        }
    }

    function _verifyCircuitGate(
        uint32 _gateNum,
        bytes32,
        bytes32 _gateHash,
        bytes32[][] memory
    ) internal view override returns (bool) {
        return
            HardcodedSha256CircuitLib.verifyGateHashFromOptimistic(
                address(optimisticContract),
                _gateNum,
                numBlocks,
                _gateHash
            );
    }
}
