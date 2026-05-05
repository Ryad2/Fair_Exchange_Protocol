// SPDX-License-Identifier: GPL-3.0
pragma solidity ^0.8.0;

import {DisputeDeployerNormal} from "./DisputeDeployerNormal.sol";
import {DisputeDeployerSelfSponsored} from "./DisputeDeployerSelfSponsored.sol";
import {IOptimisticSOXNormal} from "./IOptimisticSOXNormal.sol";
import {OptimisticState, ECDSA} from "./OptimisticSOXAccount.sol";

abstract contract OptimisticSOXAccountCloneBase is IOptimisticSOXNormal {
    using ECDSA for bytes32;

    struct InitArgs {
        address entryPoint;
        address vendor;
        address buyer;
        uint256 agreedPrice;
        uint256 completionTip;
        uint256 disputeTip;
        uint256 timeoutIncrement;
        bytes32 commitment;
        uint32 numBlocks;
        uint32 numGates;
        address vendorSigner;
    }

    uint32 public constant circuitVersion = 1;
    uint256 internal constant SPONSOR_FEES = 5 wei;
    uint256 internal constant DISPUTE_FEES = 10 wei;

    bool private initialized;
    address public entryPoint;
    address public buyer;
    address public vendor;
    address public sponsor;
    address public buyerDisputeSponsor;
    address public vendorDisputeSponsor;
    address public disputeContract;

    OptimisticState public currState;
    bytes16 public key;
    uint256 public agreedPrice;
    uint256 public completionTip;
    uint256 public disputeTip;
    uint256 public timeoutIncrement;
    bytes32 public commitment;
    uint32 public numGates;
    uint32 public numBlocks;

    uint256 public sponsorDeposit;
    uint256 public buyerDeposit;
    uint256 public sbDeposit;
    uint256 public svDeposit;
    uint256 public sponsorTip;
    uint256 public sbTip;
    uint256 public svTip;
    uint256 public nextTimeoutTime;

    event BuyerSelfSponsoredDispute(address indexed buyer, uint256 amount);
    event BuyerDisputeSponsoredWithAuthorization(
        address indexed buyer,
        address indexed buyerDisputeSponsor,
        uint256 amount
    );
    event VendorSelfSponsoredDispute(address indexed vendor, uint256 amount, address disputeContract);

    modifier onlyExpected(address _sender, OptimisticState _state) {
        require(currState == _state, "Wrong state");
        require(msg.sender == _sender, "Unexpected sender");
        _;
    }

    function noSponsorDeposit() external pure virtual returns (bool) {
        return false;
    }

    function sponsorIsBuyer() external pure virtual returns (bool) {
        return false;
    }

    function sponsorIsVendor() external pure virtual returns (bool) {
        return false;
    }

    function preContractVariant() external pure virtual returns (uint8);

    function supportsERC4337() external pure returns (bool) {
        return false;
    }

    receive() external payable {}

    function _initializeBase(InitArgs calldata _args, address _sponsor) internal {
        require(!initialized, "Already initialized");
        require(_args.entryPoint != address(0), "EntryPoint required");
        initialized = true;

        entryPoint = _args.entryPoint;
        sponsor = _sponsor;
        buyer = _args.buyer;
        vendor = _args.vendor;
        agreedPrice = _args.agreedPrice;
        completionTip = _args.completionTip;
        disputeTip = _args.disputeTip;
        timeoutIncrement = _args.timeoutIncrement;
        commitment = _args.commitment;
        numBlocks = _args.numBlocks;
        numGates = _args.numGates;
    }

    function sendPayment()
        public
        payable
        onlyExpected(buyer, OptimisticState.WaitPayment)
    {
        uint256 requiredDeposit = _buyerPaymentRequired();
        require(msg.value >= requiredDeposit, "Payment deposit is too low");

        buyerDeposit = requiredDeposit;
        _recordSponsorTipAfterPayment(requiredDeposit);

        if (msg.value > requiredDeposit) {
            payable(buyer).transfer(msg.value - requiredDeposit);
        }

        nextState(OptimisticState.WaitKey);
    }

    function sendKey(bytes16 _key) public onlyExpected(vendor, OptimisticState.WaitKey) {
        key = _key;
        nextState(OptimisticState.WaitSB);
    }

    function sendBuyerDisputeSponsorFee()
        public
        payable
        onlyExpected(buyer, OptimisticState.WaitSB)
    {
        _sendBuyerDisputeSponsorFee(buyer);
        emit BuyerSelfSponsoredDispute(buyer, msg.value);
    }

    function sendBuyerSelfDisputeSponsorFee()
        public
        payable
        onlyExpected(buyer, OptimisticState.WaitSB)
    {
        _sendBuyerDisputeSponsorFee(buyer);
        emit BuyerSelfSponsoredDispute(buyer, msg.value);
    }

    function sendBuyerDisputeSponsorFeeWithAuthorization(
        bytes calldata _buyerAuthorization
    ) public payable {
        address authorizedBuyer = buyerUnhappyAuthorizationHash(msg.sender)
            .toEthSignedMessageHash()
            .recover(_buyerAuthorization);
        require(authorizedBuyer == buyer, "Invalid buyer unhappy authorization");

        _sendBuyerDisputeSponsorFee(msg.sender);
        emit BuyerDisputeSponsoredWithAuthorization(buyer, msg.sender, msg.value);
    }

    function buyerUnhappyAuthorizationHash(
        address _buyerDisputeSponsor
    ) public view returns (bytes32) {
        return keccak256(
            abi.encodePacked(
                "SOX_BUYER_UNHAPPY",
                block.chainid,
                address(this),
                buyer,
                _buyerDisputeSponsor,
                commitment
            )
        );
    }

    function sendVendorDisputeSponsorFee() public payable {
        _sendVendorDisputeSponsorFee(msg.sender, msg.sender);
    }

    function sendVendorSelfDisputeSponsorFee()
        public
        payable
        onlyExpected(vendor, OptimisticState.WaitSV)
    {
        _sendVendorDisputeSponsorFee(vendor, vendor);
        emit VendorSelfSponsoredDispute(vendor, msg.value, disputeContract);
    }

    function endDispute() public onlyExpected(disputeContract, OptimisticState.InDispute) {
        nextState(OptimisticState.End);
    }

    function completeTransaction() public onlyExpected(buyer, OptimisticState.WaitSB) {
        payable(vendor).transfer(agreedPrice);
        payable(sponsor).transfer(address(this).balance);
        nextState(OptimisticState.End);
    }

    function cancelTransaction() public {
        require(timeoutHasPassed(), "Timeout has not passed");

        if (currState == OptimisticState.WaitPayment) {
            payable(sponsor).transfer(address(this).balance);
            return nextState(OptimisticState.End);
        } else if (currState == OptimisticState.WaitKey) {
            payable(buyer).transfer(agreedPrice);
            payable(sponsor).transfer(address(this).balance);
            return nextState(OptimisticState.End);
        } else if (currState == OptimisticState.WaitSV) {
            payable(buyerDisputeSponsor).transfer(sbDeposit);
            payable(buyer).transfer(agreedPrice);
            payable(sponsor).transfer(address(this).balance);
            return nextState(OptimisticState.End);
        }

        revert("Not in a state in which the transaction can be cancelled");
    }

    function timeoutHasPassed() public view returns (bool) {
        return block.timestamp >= nextTimeoutTime;
    }

    function _buyerPaymentRequired() internal view virtual returns (uint256) {
        return agreedPrice + completionTip;
    }

    function _recordSponsorTipAfterPayment(uint256 requiredDeposit) internal virtual {
        sponsorTip = requiredDeposit - agreedPrice;
    }

    function _sendBuyerDisputeSponsorFee(address _buyerDisputeSponsor) internal {
        require(currState == OptimisticState.WaitSB, "Cannot run this function in the current state");
        require(msg.value >= DISPUTE_FEES + disputeTip, "Not enough money deposited to cover dispute fees + tip");

        buyerDisputeSponsor = _buyerDisputeSponsor;
        sbDeposit = msg.value;
        sbTip = msg.value - DISPUTE_FEES;
        nextState(OptimisticState.WaitSV);
    }

    function _sendVendorDisputeSponsorFee(
        address _vendorDisputeSponsor,
        address _vendorDisputeSponsorSigner
    ) internal {
        require(currState == OptimisticState.WaitSV, "Cannot run this function in the current state");
        require(
            msg.value >= DISPUTE_FEES + disputeTip + agreedPrice,
            "Not enough money deposited to cover dispute fees + tip + agreedPrice"
        );

        vendorDisputeSponsor = _vendorDisputeSponsor;
        svDeposit = msg.value;
        svTip = msg.value - DISPUTE_FEES - agreedPrice;

        if (
            buyerDisputeSponsor == buyer &&
            _vendorDisputeSponsor == vendor &&
            _vendorDisputeSponsorSigner == vendor
        ) {
            disputeContract = DisputeDeployerSelfSponsored.deployDispute(
                entryPoint,
                address(this),
                numBlocks,
                numGates,
                commitment,
                buyer,
                vendor,
                buyerDisputeSponsor,
                _vendorDisputeSponsor,
                _vendorDisputeSponsorSigner
            );
        } else {
            disputeContract = DisputeDeployerNormal.deployDispute(
                entryPoint,
                address(this),
                numBlocks,
                numGates,
                commitment,
                buyer,
                vendor,
                buyerDisputeSponsor,
                _vendorDisputeSponsor,
                _vendorDisputeSponsorSigner
            );
        }

        nextState(OptimisticState.InDispute);
    }

    function nextState(OptimisticState _s) internal {
        currState = _s;
        nextTimeoutTime = block.timestamp + timeoutIncrement;
    }
}
