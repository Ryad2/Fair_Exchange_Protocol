// SPDX-License-Identifier: GPL-3.0
pragma solidity ^0.8.0;

import {OptimisticState} from "./OptimisticSOXAccount.sol";
import {OptimisticSOXAccountCloneBase} from "./OptimisticSOXAccountCloneBase.sol";

contract OptimisticSOXCloneNormal is OptimisticSOXAccountCloneBase {
    function initialize(InitArgs calldata _args, address _sponsor) external payable {
        _initializeBase(_args, _sponsor);
        require(msg.value >= SPONSOR_FEES, "Not enough money to cover fees");

        sponsorDeposit = msg.value;
        nextState(OptimisticState.WaitPayment);
    }

    function preContractVariant() external pure override returns (uint8) {
        return 0;
    }
}
