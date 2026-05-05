// SPDX-License-Identifier: GPL-3.0
pragma solidity ^0.8.0;

import {OptimisticState} from "./OptimisticSOXAccount.sol";

interface IOptimisticSOXNormal {
    function buyer() external view returns (address);
    function vendor() external view returns (address);
    function sponsor() external view returns (address);
    function buyerDisputeSponsor() external view returns (address);
    function vendorDisputeSponsor() external view returns (address);
    function key() external view returns (bytes16);
    function agreedPrice() external view returns (uint256);
    function timeoutIncrement() external view returns (uint256);
    function currState() external view returns (OptimisticState);
    function endDispute() external;
}
