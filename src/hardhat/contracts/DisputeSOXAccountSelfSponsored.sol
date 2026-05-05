// SPDX-License-Identifier: GPL-3.0
pragma solidity ^0.8.0;

import {DisputeSOXAccountNormal} from "./DisputeSOXAccountNormal.sol";

contract DisputeSOXAccountSelfSponsored is DisputeSOXAccountNormal {
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

    function step9IsSpecialized() external pure returns (bool) {
        return true;
    }

    function handleStep9(bool _vendorLost) internal override {
        lastLosingPartyWasVendor = _vendorLost;
        if (_vendorLost) {
            nextState(State.Cancel);
        } else {
            nextState(State.Complete);
        }
    }
}
