// SPDX-License-Identifier: GPL-3.0
pragma solidity ^0.8.0;

import {OptimisticState} from "./OptimisticSOXAccount.sol";
import {OptimisticSOXAccountCloneBase} from "./OptimisticSOXAccountCloneBase.sol";

contract OptimisticSOXCloneNoSDeposit is OptimisticSOXAccountCloneBase {
    function initialize(InitArgs calldata _args, address _sponsor) external payable {
        _initializeBase(_args, _sponsor);
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
