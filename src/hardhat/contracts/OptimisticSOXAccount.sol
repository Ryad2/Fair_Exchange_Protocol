// SPDX-License-Identifier: GPL-3.0
pragma solidity ^0.8.0;

import {DisputeDeployer} from "./DisputeDeployer.sol";

enum OptimisticState {
    WaitPayment,
    WaitKey,
    WaitSB,
    WaitSV,
    InDispute,
    End
}

enum PreContractVariant {
    Normal,
    NoSDeposit,
    SponsorIsBuyer,
    SponsorIsVendor
}

interface IOptimisticSOX {
    function buyer() external view returns (address);
    function vendor() external view returns (address);
    function sponsor() external view returns (address);
    function buyerDisputeSponsor() external view returns (address);
    function vendorDisputeSponsor() external view returns (address);
    function key() external view returns (bytes16);
    function agreedPrice() external view returns (uint256);
    function timeoutIncrement() external view returns (uint256);
    function currState() external view returns (OptimisticState);
    function hardcodedSha256Circuit() external view returns (bool);
    function hardcodedDescriptionHash() external view returns (bytes32);
    function hardcodedPlaintextLength() external view returns (uint64);
    function hardcodedCiphertextIv() external view returns (bytes16);
    function endDispute() external;
}

struct PackedUserOperation {
    address sender;
    uint256 nonce;
    bytes initCode;
    bytes callData;
    bytes32 accountGasLimits; // verificationGasLimit (high 128) + callGasLimit (low 128)
    uint256 preVerificationGas;
    bytes32 gasFees; // maxPriorityFeePerGas (high 128) + maxFeePerGas (low 128)
    bytes paymasterAndData;
    bytes signature;
}

interface IEntryPoint {
    function depositTo(address account) external payable;
    function withdrawTo(address payable withdrawAddress, uint256 amount) external;
    function balanceOf(address account) external view returns (uint256);
}

library ECDSA {
    function toEthSignedMessageHash(bytes32 hash) internal pure returns (bytes32) {
        return keccak256(abi.encodePacked("\x19Ethereum Signed Message:\n32", hash));
    }

    function recover(bytes32 hash, bytes memory signature) internal pure returns (address) {
        require(signature.length == 65, "ECDSA: invalid signature length");

        bytes32 r;
        bytes32 s;
        uint8 v;

        assembly {
            r := mload(add(signature, 0x20))
            s := mload(add(signature, 0x40))
            v := byte(0, mload(add(signature, 0x60)))
        }

        require(v == 27 || v == 28, "ECDSA: invalid signature 'v' value");
        require(
            uint256(s) <= 0x7fffffffffffffffffffffffffffffff5d576e7357a4501ddfe92f46681b20a0,
            "ECDSA: invalid signature 's' value"
        );

        address signer = ecrecover(hash, v, r, s);
        require(signer != address(0), "ECDSA: invalid signature");

        return signer;
    }
}

contract OptimisticSOXAccount is IOptimisticSOX {
    using ECDSA for bytes32;

    // =============== ERC-4337 FIELDS ===============
    IEntryPoint public immutable entryPoint;
    address public vendorSigner;
    uint256 public nonce;
    address private lastValidatedSigner;
    uint256 private lastValidatedNonce;

    // =============== OPTIMISTIC PHASE FIELDS (from OptimisticSOX) ===============
    uint32 public constant circuitVersion = 1;
    
    uint256 constant SPONSOR_FEES = 5 wei; // dummy value
    uint256 constant DISPUTE_FEES = 10 wei; // dummy value

    // Addresses
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
    PreContractVariant public preContractVariant;
    bool public hardcodedSha256Circuit;
    bytes32 public hardcodedDescriptionHash;
    uint64 public hardcodedPlaintextLength;
    bytes16 public hardcodedCiphertextIv;

    // Money states
    uint256 public sponsorDeposit;
    uint256 public buyerDeposit;
    uint256 public sbDeposit;
    uint256 public svDeposit;
    uint256 public sponsorTip;
    uint256 public sbTip;
    uint256 public svTip;
    uint256 public nextTimeoutTime;

    // =============== EVENTS ===============
    event VendorSignerUpdated(address indexed previousSigner, address indexed newSigner);
    event EntryPointDeposit(address indexed from, uint256 amount);
    event EntryPointWithdrawal(address indexed to, uint256 amount);
    event HardcodedSha256CircuitConfigured(
        bytes32 indexed descriptionHash,
        uint64 plaintextLength,
        bytes16 ciphertextIv,
        uint32 numGates
    );
    event BuyerSelfSponsoredDispute(address indexed buyer, uint256 amount);
    event BuyerDisputeSponsoredWithAuthorization(
        address indexed buyer,
        address indexed buyerDisputeSponsor,
        uint256 amount
    );
    event VendorSelfSponsoredDispute(address indexed vendor, uint256 amount, address disputeContract);

    // =============== MODIFIERS ===============
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
        
        // Accepter si appel direct depuis le sender attendu
        if (msg.sender == _sender) {
            _;
            return;
        }
        
        // Accepter si appel via execute (msg.sender == address(this)) et contexte UserOp valide
        if (msg.sender == address(this)) {
            bool isValid = _isValidUserOpContext(_sender);
            require(isValid, "Invalid UserOp context");
            _;
            return;
        }
        
        revert("Unexpected sender");
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

    function _stateToString(OptimisticState _state) internal pure returns (string memory) {
        if (_state == OptimisticState.WaitPayment) return "WaitPayment";
        if (_state == OptimisticState.WaitKey) return "WaitKey";
        if (_state == OptimisticState.WaitSB) return "WaitSB";
        if (_state == OptimisticState.WaitSV) return "WaitSV";
        if (_state == OptimisticState.InDispute) return "InDispute";
        if (_state == OptimisticState.End) return "End";
        return "Unknown";
    }

    function _addressToString(address _addr) internal pure returns (string memory) {
        bytes32 value = bytes32(uint256(uint160(_addr)));
        bytes memory alphabet = "0123456789abcdef";
        bytes memory str = new bytes(42);
        str[0] = '0';
        str[1] = 'x';
        for (uint i = 0; i < 20; i++) {
            str[2+i*2] = alphabet[uint(uint8(value[i + 12] >> 4))];
            str[3+i*2] = alphabet[uint(uint8(value[i + 12] & 0x0f))];
        }
        return string(str);
    }

    function _uint256ToString(uint256 _value) internal pure returns (string memory) {
        if (_value == 0) {
            return "0";
        }
        uint256 temp = _value;
        uint256 digits;
        while (temp != 0) {
            digits++;
            temp /= 10;
        }
        bytes memory buffer = new bytes(digits);
        while (_value != 0) {
            digits -= 1;
            buffer[digits] = bytes1(uint8(48 + uint256(_value % 10)));
            _value /= 10;
        }
        return string(buffer);
    }

    // =============== CONSTRUCTOR ===============
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
            preContractVariant = PreContractVariant.NoSDeposit;
            nextState(OptimisticState.WaitPayment);
            return;
        }

        if (msg.sender == _buyer) {
            require(
                msg.value >= _agreedPrice + _completionTip + SPONSOR_FEES,
                "Not enough money for fused S=B deposits"
            );
            sponsorIsBuyer = true;
            preContractVariant = PreContractVariant.SponsorIsBuyer;
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
            preContractVariant = PreContractVariant.SponsorIsVendor;
        }

        nextState(OptimisticState.WaitPayment);
    }

    // =============== ERC-4337 FUNCTIONS ===============
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

    function _clearUserOpContext() internal {
        // Nettoyer le contexte après l'exécution pour éviter la réutilisation
        // Le nonce a déjà été incrémenté dans validateUserOp
        lastValidatedSigner = address(0);
        lastValidatedNonce = 0;
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

    /**
     * @notice Enables the Phase 3 hard-coded circuit variant for desc = SHA256(file).
     * @dev The metadata is enough to derive every V2 gate on-chain. This avoids
     *      accepting arbitrary gate bytes when the hCircuit Merkle proof is skipped.
     */
    function configureHardcodedSha256Circuit(
        bytes32 _descriptionHash,
        uint64 _plaintextLength,
        bytes16 _ciphertextIv
    ) external {
        bool canConfigureBeforePayment = currState == OptimisticState.WaitPayment;
        bool canConfigureFusedSponsorBuyer =
            sponsorIsBuyer && currState == OptimisticState.WaitKey && msg.sender == sponsor;
        require(
            canConfigureBeforePayment || canConfigureFusedSponsorBuyer,
            "Configure before payment or key"
        );
        require(msg.sender == sponsor || msg.sender == vendor, "Only sponsor or vendor");
        require(_plaintextLength > 0, "Plaintext length required");
        require(_plaintextLength <= type(uint64).max / 8, "Plaintext length too large");
        require(
            _numBlocksForPlaintextLength(_plaintextLength) == numBlocks,
            "Plaintext length mismatch"
        );
        require(
            _hardcodedSha256GateCount(_plaintextLength, numBlocks) == numGates,
            "Hardcoded gate count mismatch"
        );

        hardcodedSha256Circuit = true;
        hardcodedDescriptionHash = _descriptionHash;
        hardcodedPlaintextLength = _plaintextLength;
        hardcodedCiphertextIv = _ciphertextIv;

        emit HardcodedSha256CircuitConfigured(
            _descriptionHash,
            _plaintextLength,
            _ciphertextIv,
            numGates
        );
    }

    function expectedHardcodedSha256NumBlocks(uint64 _plaintextLength) public pure returns (uint32) {
        return _numBlocksForPlaintextLength(_plaintextLength);
    }

    function expectedHardcodedSha256NumGates(uint64 _plaintextLength) public pure returns (uint32) {
        uint32 blocks = _numBlocksForPlaintextLength(_plaintextLength);
        return _hardcodedSha256GateCount(_plaintextLength, blocks);
    }

    // =============== OPTIMISTIC PHASE FUNCTIONS (from OptimisticSOX) ===============
    function sendPayment()
        public
        payable
        onlyExpected(buyer, OptimisticState.WaitPayment)
    {
        uint256 requiredDeposit = noSponsorDeposit ? agreedPrice : agreedPrice + completionTip;
        require(
            msg.value >= requiredDeposit,
            "Payment deposit is too low"
        );

        buyerDeposit = requiredDeposit;
        sponsorTip = noSponsorDeposit ? 0 : buyerDeposit - agreedPrice;

        if (msg.value > requiredDeposit) {
            payable(buyer).transfer(msg.value - requiredDeposit);
        }

        nextState(OptimisticState.WaitKey);
    }

    function sendKey(
        bytes16 _key
    ) public onlyExpected(vendor, OptimisticState.WaitKey) {
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

        // Définir vendorDisputeSponsor AVANT de déployer, et passer le sponsor
        // explicitement au constructeur pour éviter toute ambiguïté sur le storage.
        vendorDisputeSponsor = _vendorDisputeSponsor;
        svDeposit = msg.value;
        svTip = msg.value - DISPUTE_FEES - agreedPrice;

        // Use DisputeDeployer library to deploy DisputeSOXAccount
        // This avoids including DisputeSOXAccount bytecode in OptimisticSOXAccount
        disputeContract = DisputeDeployer.deployDispute(
            address(entryPoint),  // _entryPoint (ERC-4337)
            address(this), // _optimisticContract
            numBlocks,
            numGates,
            commitment,
            buyer,  // _buyerSigner
            vendor,  // _vendorSigner
            buyerDisputeSponsor,  // _buyerDisputeSponsorSigner
            _vendorDisputeSponsor,  // _vendorDisputeSponsor (sponsor explicite)
            _vendorDisputeSponsorSigner  // _vendorDisputeSponsorSigner
        );

        nextState(OptimisticState.InDispute);
    }

    function endDispute()
        public
        onlyExpected(disputeContract, OptimisticState.InDispute)
    {
        nextState(OptimisticState.End);
    }

    function completeTransaction() public onlyExpected(buyer, OptimisticState.WaitSB) {
        payable(vendor).transfer(agreedPrice);
        
        // Withdraw any remaining EntryPoint deposit to the sponsor before transferring balance
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

    // =============== INTERNAL FUNCTIONS ===============
    function nextState(OptimisticState _s) internal {
        currState = _s;
        nextTimeoutTime = block.timestamp + timeoutIncrement;
    }

    function _numBlocksForPlaintextLength(uint64 _plaintextLength) internal pure returns (uint32) {
        require(_plaintextLength > 0, "Plaintext length required");
        uint256 blocks = (uint256(_plaintextLength) + 63) / 64;
        require(blocks <= type(uint32).max, "Too many blocks");
        return uint32(blocks);
    }

    function _hardcodedSha256GateCount(
        uint64 _plaintextLength,
        uint32 _numBlocks
    ) internal pure returns (uint32) {
        require(_numBlocks <= (type(uint32).max - 8) / 2, "Too many gates");
        uint64 rem = _plaintextLength % 64;
        if (rem > 55) {
            return _numBlocks * 2 + 8;
        }
        return _numBlocks * 2 + 5;
    }

    function _call(address _target, uint256 _value, bytes calldata _data) internal {
        (bool success, bytes memory result) = _target.call{value: _value}(_data);
        require(success, _getRevertMsg(result));
    }

    function _validateSignature(bytes32 userOpHash, bytes calldata signature) internal view returns (address) {
        bytes32 digest = userOpHash.toEthSignedMessageHash();
        address recovered = ECDSA.recover(digest, signature);
        // Accepter vendorSigner, vendor (si différent), ou buyer comme signataires valides
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
