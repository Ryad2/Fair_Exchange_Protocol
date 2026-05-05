// SPDX-License-Identifier: GPL-3.0
pragma solidity ^0.8.0;

import {OptimisticState} from "./OptimisticSOXAccount.sol";
import {OptimisticSOXAccountCloneBase} from "./OptimisticSOXAccountCloneBase.sol";

contract OptimisticSOXCloneSponsorIsVendor is OptimisticSOXAccountCloneBase {
    function initialize(InitArgs calldata _args, address _sponsor) external payable {
        _initializeBase(_args, _sponsor);
        require(_sponsor == _args.vendor, "Sponsor must be vendor");
        require(msg.value >= SPONSOR_FEES, "Not enough money to cover fees");

        sponsorDeposit = msg.value;
        nextState(OptimisticState.WaitPayment);
    }

    function sponsorIsVendor() external pure override returns (bool) {
        return true;
    }

    function preContractVariant() external pure override returns (uint8) {
        return 3;
    }
}
