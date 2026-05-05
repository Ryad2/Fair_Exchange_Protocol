// SPDX-License-Identifier: GPL-3.0
pragma solidity ^0.8.0;

import {OptimisticState} from "./OptimisticSOXAccount.sol";
import {OptimisticSOXAccountCloneBase} from "./OptimisticSOXAccountCloneBase.sol";

contract OptimisticSOXCloneSponsorIsBuyer is OptimisticSOXAccountCloneBase {
    function initialize(InitArgs calldata _args, address _sponsor) external payable {
        _initializeBase(_args, _sponsor);
        require(_sponsor == _args.buyer, "Sponsor must be buyer");
        require(
            msg.value >= _args.agreedPrice + _args.completionTip + SPONSOR_FEES,
            "Not enough money for fused S=B deposits"
        );

        buyerDeposit = _args.agreedPrice + _args.completionTip;
        sponsorTip = _args.completionTip;
        sponsorDeposit = msg.value - buyerDeposit;
        nextState(OptimisticState.WaitKey);
    }

    function sponsorIsBuyer() external pure override returns (bool) {
        return true;
    }

    function preContractVariant() external pure override returns (uint8) {
        return 2;
    }
}
