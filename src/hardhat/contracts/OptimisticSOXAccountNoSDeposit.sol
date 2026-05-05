// SPDX-License-Identifier: GPL-3.0
pragma solidity ^0.8.0;

import {OptimisticState} from "./OptimisticSOXAccount.sol";
import {OptimisticSOXAccountDirectBase} from "./OptimisticSOXAccountDirectBase.sol";

contract OptimisticSOXAccountNoSDeposit is OptimisticSOXAccountDirectBase {
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
        address _vendorSigner
    )
        payable
        OptimisticSOXAccountDirectBase(
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
        require(msg.value == 0, "No S deposit expected");
        nextState(OptimisticState.WaitPayment);
    }

    function noSponsorDeposit() external pure override returns (bool) {
        return true;
    }

    function preContractVariant() external pure override returns (uint8) {
        return 1;
    }

    function _buyerPaymentRequired() internal view override returns (uint256) {
        return agreedPrice;
    }

    function _recordSponsorTipAfterPayment(uint256) internal override {
        sponsorTip = 0;
    }
}
