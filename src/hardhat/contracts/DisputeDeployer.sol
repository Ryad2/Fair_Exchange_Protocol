// SPDX-License-Identifier: GPL-3.0
pragma solidity ^0.8.0;

import {DisputeSOXAccount} from "./DisputeSOXAccount.sol";

/**
 * @title DisputeDeployer
 * @notice Library for deploying dispute contracts.
 * @dev This library provides a function to deploy a new dispute contract.
 * Deploys DisputeSOXAccount (ERC-4337 compatible) only.
 * 
 * As explained in the SOX protocol paper, using a library allows OptimisticSOXAccount
 * to deploy DisputeSOXAccount without including its bytecode, reducing the
 * deployment cost of OptimisticSOXAccount. The library is deployed once and its address
 * is linked to OptimisticSOXAccount before deployment.
 */
library DisputeDeployer {
    /**
     * @notice Deploys a new dispute contract.
     * @dev This function creates a new instance of DisputeSOXAccount (V2 only).
     * @param _entryPoint The EntryPoint address for ERC-4337.
     * @param _optimisticContract The address of the OptimisticSOX contract.
     * @param _numBlocks The number of blocks in the ciphertext.
     * @param _numGates The number of gates in the circuit.
     * @param _commitment The commitment value.
     * @param _buyerSigner The signer address for buyer operations (0x0 to use buyer address).
     * @param _vendorSigner The signer address for vendor operations (0x0 to use vendor address).
     * @param _buyerDisputeSponsorSigner The signer address for buyer dispute sponsor operations (0x0 to use sponsor address).
     * @param _vendorDisputeSponsor The vendor dispute sponsor address (0x0 to fallback to optimistic contract).
     * @param _vendorDisputeSponsorSigner The signer address for vendor dispute sponsor operations (0x0 to use sponsor address).
     * @return The address of the newly deployed dispute contract.
     */
    function deployDispute(
        address _entryPoint,
        address _optimisticContract,
        uint32 _numBlocks,
        uint32 _numGates,
        bytes32 _commitment,
        address _buyerSigner,
        address _vendorSigner,
        address _buyerDisputeSponsorSigner,
        address _vendorDisputeSponsor,
        address _vendorDisputeSponsorSigner
    ) public returns (address) {
        return
            address(
                new DisputeSOXAccount{value: address(this).balance}(
                    _entryPoint,
                    _optimisticContract,
                    _numBlocks,
                    _numGates,
                    _commitment,
                    1, // circuitVersion = 1 (V2 only)
                    _buyerSigner,
                    _vendorSigner,
                    _buyerDisputeSponsorSigner,
                    _vendorDisputeSponsor,
                    _vendorDisputeSponsorSigner
                )
            );
    }
}
