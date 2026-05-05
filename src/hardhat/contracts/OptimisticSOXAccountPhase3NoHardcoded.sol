// SPDX-License-Identifier: GPL-3.0
pragma solidity ^0.8.0;

import {DisputeDeployerNormal} from "./DisputeDeployerNormal.sol";
import {
    OptimisticState,
    PackedUserOperation,
    IEntryPoint,
    ECDSA
} from "./OptimisticSOXAccount.sol";
import {IOptimisticSOXNormal} from "./IOptimisticSOXNormal.sol";

enum PreContractVariantNoHardcoded {
    Normal,
    NoSDeposit,
    SponsorIsBuyer,
    SponsorIsVendor
}

contract OptimisticSOXAccountPhase3NoHardcoded is IOptimisticSOXNormal {
    using ECDSA for bytes32;

    IEntryPoint public immutable entryPoint;
    address public vendorSigner;
    uint256 public nonce;
    address private lastValidatedSigner;
    uint256 private lastValidatedNonce;

    uint32 public constant circuitVersion = 1;

    uint256 constant SPONSOR_FEES = 5 wei;
    uint256 constant DISPUTE_FEES = 10 wei;

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
    bool public noSponsorDeposit;
    bool public sponsorIsBuyer;
    bool public sponsorIsVendor;
    PreContractVariantNoHardcoded public preContractVariant;

    uint256 public sponsorDeposit;
    uint256 public buyerDeposit;
    uint256 public sbDeposit;
    uint256 public svDeposit;
    uint256 public sponsorTip;
    uint256 public sbTip;
    uint256 public svTip;
    uint256 public nextTimeoutTime;

    event VendorSignerUpdated(address indexed previousSigner, address indexed newSigner);
    event EntryPointDeposit(address indexed from, uint256 amount);
    event EntryPointWithdrawal(address indexed to, uint256 amount);
    event BuyerSelfSponsoredDispute(address indexed buyer, uint256 amount);
    event BuyerDisputeSponsoredWithAuthorization(
        address indexed buyer,
        address indexed buyerDisputeSponsor,
        uint256 amount
    );
    event VendorSelfSponsoredDispute(address indexed vendor, uint256 amount, address disputeContract);

    modifier onlyEntryPoint() {
        require(msg.sender == address(entryPoint), "Not from EntryPoint");
        _;
    }

    modifier onlyVendor() {
        require(msg.sender == vendor, "Only vendor");
        _;
    }

    modifier onlyEntryPointOrVendor() {
        require(
            msg.sender == address(entryPoint) || msg.sender == vendorSigner,
            "Not authorized executor"
        );
        _;
    }

    modifier onlyExpected(address _sender, OptimisticState _state) {
        require(currState == _state, "Wrong state");

        if (msg.sender == _sender) {
            _;
            return;
        }

        if (msg.sender == address(this)) {
            require(_isValidUserOpContext(_sender), "Invalid UserOp context");
            _;
            return;
        }

        revert("Unexpected sender");
    }

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
    ) payable {
        require(_entryPoint != address(0), "EntryPoint required");

        entryPoint = IEntryPoint(_entryPoint);
        vendorSigner = _vendorSigner == address(0) ? _vendor : _vendorSigner;

        sponsorDeposit = msg.value;
        sponsor = msg.sender;
        buyer = _buyer;
        vendor = _vendor;
        agreedPrice = _agreedPrice;
        completionTip = _completionTip;
        disputeTip = _disputeTip;
        timeoutIncrement = _timeoutIncrement;
        commitment = _commitment;
        numBlocks = _numBlocks;
        numGates = _numGates;

        if (msg.value == 0) {
            noSponsorDeposit = true;
            preContractVariant = PreContractVariantNoHardcoded.NoSDeposit;
            nextState(OptimisticState.WaitPayment);
            return;
        }

        if (msg.sender == _buyer) {
            require(
                msg.value >= _agreedPrice + _completionTip + SPONSOR_FEES,
                "Not enough money for fused S=B deposits"
            );
            sponsorIsBuyer = true;
            preContractVariant = PreContractVariantNoHardcoded.SponsorIsBuyer;
            buyerDeposit = _agreedPrice + _completionTip;
            sponsorTip = _completionTip;
            sponsorDeposit = msg.value - buyerDeposit;
            nextState(OptimisticState.WaitKey);
            return;
        }

        require(msg.value >= SPONSOR_FEES, "Not enough money to cover fees");
        sponsorDeposit = msg.value;
        if (msg.sender == _vendor) {
            sponsorIsVendor = true;
            preContractVariant = PreContractVariantNoHardcoded.SponsorIsVendor;
        }

        nextState(OptimisticState.WaitPayment);
    }

    function setVendorSigner(address _newSigner) external onlyVendor {
        require(_newSigner != address(0), "Signer cannot be zero");
        emit VendorSignerUpdated(vendorSigner, _newSigner);
        vendorSigner = _newSigner;
    }

    function getDeposit() external view returns (uint256) {
        return entryPoint.balanceOf(address(this));
    }

    function depositToEntryPoint() external payable {
        require(!noSponsorDeposit, "Sponsoring disabled");
        entryPoint.depositTo{value: msg.value}(address(this));
        emit EntryPointDeposit(msg.sender, msg.value);
    }

    function withdrawFromEntryPoint(address payable _to, uint256 _amount) external onlyVendor {
        entryPoint.withdrawTo(_to, _amount);
        emit EntryPointWithdrawal(_to, _amount);
    }

    function validateUserOp(
        PackedUserOperation calldata userOp,
        bytes32 userOpHash,
        uint256 missingAccountFunds
    ) external payable onlyEntryPoint returns (uint256 validationData) {
        require(userOp.nonce == nonce, "Bad nonce");
        address signer = _validateSignature(userOpHash, userOp.signature);
        lastValidatedSigner = signer;
        lastValidatedNonce = userOp.nonce;

        nonce++;

        if (missingAccountFunds > 0) {
            require(!noSponsorDeposit, "Sponsoring disabled");
            entryPoint.depositTo{value: missingAccountFunds}(address(this));
            emit EntryPointDeposit(msg.sender, missingAccountFunds);
        }

        return 0;
    }

    function execute(
        address _target,
        uint256 _value,
        bytes calldata _data
    ) external onlyEntryPointOrVendor {
        _call(_target, _value, _data);
        _clearUserOpContext();
    }

    function executeBatch(
        address[] calldata _targets,
        uint256[] calldata _values,
        bytes[] calldata _calldata
    ) external onlyEntryPointOrVendor {
        require(
            _targets.length == _values.length && _targets.length == _calldata.length,
            "Mismatched batch lengths"
        );

        for (uint256 i = 0; i < _targets.length; i++) {
            _call(_targets[i], _values[i], _calldata[i]);
        }

        _clearUserOpContext();
    }

    function supportsERC4337() external pure returns (bool) {
        return true;
    }

    receive() external payable {}

    function sendPayment()
        public
        payable
        onlyExpected(buyer, OptimisticState.WaitPayment)
    {
        uint256 requiredDeposit = noSponsorDeposit ? agreedPrice : agreedPrice + completionTip;
        require(msg.value >= requiredDeposit, "Payment deposit is too low");

        buyerDeposit = requiredDeposit;
        sponsorTip = noSponsorDeposit ? 0 : buyerDeposit - agreedPrice;

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

        uint256 entryPointDeposit = entryPoint.balanceOf(address(this));
        if (!noSponsorDeposit && entryPointDeposit > 0) {
            entryPoint.withdrawTo(payable(sponsor), entryPointDeposit);
        }

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

    function _sendBuyerDisputeSponsorFee(address _buyerDisputeSponsor) internal {
        require(
            currState == OptimisticState.WaitSB,
            "Cannot run this function in the current state"
        );
        require(
            msg.value >= DISPUTE_FEES + disputeTip,
            "Not enough money deposited to cover dispute fees + tip"
        );

        buyerDisputeSponsor = _buyerDisputeSponsor;
        sbDeposit = msg.value;
        sbTip = msg.value - DISPUTE_FEES;
        nextState(OptimisticState.WaitSV);
    }

    function _sendVendorDisputeSponsorFee(
        address _vendorDisputeSponsor,
        address _vendorDisputeSponsorSigner
    ) internal {
        require(
            currState == OptimisticState.WaitSV,
            "Cannot run this function in the current state"
        );
        require(
            msg.value >= DISPUTE_FEES + disputeTip + agreedPrice,
            "Not enough money deposited to cover dispute fees + tip + agreedPrice"
        );

        vendorDisputeSponsor = _vendorDisputeSponsor;
        svDeposit = msg.value;
        svTip = msg.value - DISPUTE_FEES - agreedPrice;

        disputeContract = _deployDispute(_vendorDisputeSponsor, _vendorDisputeSponsorSigner);

        nextState(OptimisticState.InDispute);
    }

    function _deployDispute(
        address _vendorDisputeSponsor,
        address _vendorDisputeSponsorSigner
    ) internal virtual returns (address) {
        return
            DisputeDeployerNormal.deployDispute(
                address(entryPoint),
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

    function nextState(OptimisticState _s) internal {
        currState = _s;
        nextTimeoutTime = block.timestamp + timeoutIncrement;
    }

    function _isValidUserOpContext(address expected) internal view returns (bool) {
        if (nonce == 0) {
            return false;
        }
        if (lastValidatedNonce != nonce - 1) {
            return false;
        }
        if (expected == vendor) {
            return lastValidatedSigner == vendorSigner || lastValidatedSigner == vendor;
        }
        if (expected == buyer) {
            return lastValidatedSigner == buyer;
        }
        return false;
    }

    function _clearUserOpContext() internal {
        lastValidatedSigner = address(0);
        lastValidatedNonce = 0;
    }

    function _call(address _target, uint256 _value, bytes calldata _data) internal {
        (bool success, bytes memory result) = _target.call{value: _value}(_data);
        require(success, _getRevertMsg(result));
    }

    function _validateSignature(
        bytes32 userOpHash,
        bytes calldata signature
    ) internal view returns (address) {
        bytes32 digest = userOpHash.toEthSignedMessageHash();
        address recovered = ECDSA.recover(digest, signature);
        require(
            recovered == vendorSigner || recovered == vendor || recovered == buyer,
            "Invalid signature"
        );
        return recovered;
    }

    function _getRevertMsg(bytes memory returnData) internal pure returns (string memory) {
        if (returnData.length < 68) return "Call failed";
        assembly {
            returnData := add(returnData, 0x04)
        }
        return abi.decode(returnData, (string));
    }
}
