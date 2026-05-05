// SPDX-License-Identifier: GPL-3.0
pragma solidity ^0.8.0;

import {OptimisticSOXAccountCloneBase} from "./OptimisticSOXAccountCloneBase.sol";

interface IOptimisticSOXClone {
    function initialize(
        OptimisticSOXAccountCloneBase.InitArgs calldata _args,
        address _sponsor
    ) external payable;
}

contract SOXFactory {
    address public immutable normalImplementation;
    address public immutable noSDepositImplementation;
    address public immutable sponsorIsBuyerImplementation;
    address public immutable sponsorIsVendorImplementation;

    event OptimisticCloneDeployed(
        address indexed clone,
        address indexed sponsor,
        uint8 indexed variant
    );

    constructor(
        address _normalImplementation,
        address _noSDepositImplementation,
        address _sponsorIsBuyerImplementation,
        address _sponsorIsVendorImplementation
    ) {
        require(_normalImplementation != address(0), "Missing normal implementation");
        require(_noSDepositImplementation != address(0), "Missing no_S implementation");
        require(_sponsorIsBuyerImplementation != address(0), "Missing S=B implementation");
        require(_sponsorIsVendorImplementation != address(0), "Missing S=V implementation");

        normalImplementation = _normalImplementation;
        noSDepositImplementation = _noSDepositImplementation;
        sponsorIsBuyerImplementation = _sponsorIsBuyerImplementation;
        sponsorIsVendorImplementation = _sponsorIsVendorImplementation;
    }

    function createNormal(
        OptimisticSOXAccountCloneBase.InitArgs calldata _args
    ) external payable returns (address clone) {
        clone = _cloneAndInitialize(normalImplementation, _args, msg.sender, 0);
    }

    function createNoSDeposit(
        OptimisticSOXAccountCloneBase.InitArgs calldata _args
    ) external payable returns (address clone) {
        require(msg.value == 0, "No S deposit expected");
        clone = _cloneAndInitialize(noSDepositImplementation, _args, msg.sender, 1);
    }

    function createSponsorIsBuyer(
        OptimisticSOXAccountCloneBase.InitArgs calldata _args
    ) external payable returns (address clone) {
        require(msg.sender == _args.buyer, "Sponsor must be buyer");
        clone = _cloneAndInitialize(sponsorIsBuyerImplementation, _args, msg.sender, 2);
    }

    function createSponsorIsVendor(
        OptimisticSOXAccountCloneBase.InitArgs calldata _args
    ) external payable returns (address clone) {
        require(msg.sender == _args.vendor, "Sponsor must be vendor");
        clone = _cloneAndInitialize(sponsorIsVendorImplementation, _args, msg.sender, 3);
    }

    function _cloneAndInitialize(
        address _implementation,
        OptimisticSOXAccountCloneBase.InitArgs calldata _args,
        address _sponsor,
        uint8 _variant
    ) internal returns (address clone) {
        clone = _clone(_implementation);
        IOptimisticSOXClone(clone).initialize{value: msg.value}(_args, _sponsor);
        emit OptimisticCloneDeployed(clone, _sponsor, _variant);
    }

    function _clone(address _implementation) internal returns (address instance) {
        bytes memory code = abi.encodePacked(
            hex"3d602d80600a3d3981f3",
            hex"363d3d373d3d3d363d73",
            _implementation,
            hex"5af43d82803e903d91602b57fd5bf3"
        );

        assembly {
            instance := create(0, add(code, 0x20), mload(code))
        }

        require(instance != address(0), "Clone deployment failed");
    }
}
