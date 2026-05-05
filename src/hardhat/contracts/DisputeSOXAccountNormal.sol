// SPDX-License-Identifier: GPL-3.0
pragma solidity ^0.8.0;

import {AccumulatorVerifier} from "./AccumulatorSOX.sol";
import {EvaluatorSOX_V2} from "./EvaluatorSOX_V2.sol";
import {CommitmentOpener} from "./CommitmentSOX.sol";
import {OptimisticState} from "./OptimisticSOXAccount.sol";
import {IOptimisticSOXNormal} from "./IOptimisticSOXNormal.sol";
import {
    PackedUserOperation,
    IEntryPoint,
    ECDSA,
    EntryPointRequired,
    UnsupportedCircuitVersion,
    InvalidNumGates,
    InvalidOptimisticState,
    InsufficientFunds,
    InvalidSignatureLength,
    InvalidSignatureV,
    InvalidSignatureS,
    InvalidSignature,
    NotFromEntryPoint,
    NotAuthorizedRole,
    NotAuthorizedExecutor,
    UnexpectedSender,
    InvalidState,
    SignerCannotBeZero,
    OnlyBuyer,
    OnlyVendor,
    OnlyBuyerDisputeSponsor,
    OnlyVendorDisputeSponsor,
    InvalidRole,
    BadNonce,
    MismatchedBatchLengths,
    InvalidGateBytes,
    InvalidV2SonIndex,
    TransactionReverted
} from "./DisputeSOXAccount.sol";

contract DisputeSOXAccountNormal {
    using ECDSA for bytes32;

    IEntryPoint public immutable entryPoint;

    address public buyerSigner;
    address public vendorSigner;
    address public buyerDisputeSponsorSigner;
    address public vendorDisputeSponsorSigner;

    enum Role {
        None,
        Buyer,
        Vendor,
        BuyerDisputeSponsor,
        VendorDisputeSponsor
    }

    Role private lastValidatedRole;
    uint256 private lastValidatedNonce;

    uint256 public nonce;
    IOptimisticSOXNormal public optimisticContract;

    enum State {
        ChallengeBuyer,
        WaitVendorOpinion,
        WaitVendorData,
        WaitVendorDataLeft,
        WaitVendorDataRight,
        Complete,
        Cancel,
        End
    }

    State public currState;
    address public buyer;
    address public vendor;
    address public buyerDisputeSponsor;
    address public vendorDisputeSponsor;
    uint32 public numBlocks;
    uint32 public numGates;
    bytes32 public commitment;
    uint32 public constant circuitVersion = 1;
    uint32 public a;
    uint32 public b;
    uint32 public chall;
    mapping(uint32 => bytes32) public buyerResponses;
    uint256 public nextTimeoutTime;
    uint256 public timeoutIncrement;
    uint256 public agreedPrice;
    uint256 public step9Count;
    bool public lastLosingPartyWasVendor;

    struct Step9State {
        uint256 step9Count;
        bool lastLosingPartyWasVendor;
        address buyer;
        address vendor;
        address buyerDisputeSponsor;
        address vendorDisputeSponsor;
        uint32 numBlocks;
        uint32 numGates;
    }

    struct Step9Result {
        uint256 newStep9Count;
        bool newLastLosingPartyWasVendor;
        address newBuyer;
        address newVendor;
        bool shouldContinue;
        bool vendorLost;
        uint32 a;
        uint32 b;
        uint32 chall;
    }

    event SignerUpdated(uint8 indexed role, address indexed previousSigner, address indexed newSigner);
    event EntryPointDeposit(address indexed from, uint256 amount);
    event EntryPointWithdrawal(address indexed to, uint256 amount);

    modifier onlyEntryPoint() {
        if (msg.sender != address(entryPoint)) revert NotFromEntryPoint();
        _;
    }

    modifier onlyAuthorizedRole() {
        if (
            msg.sender != buyer &&
            msg.sender != vendor &&
            msg.sender != buyerDisputeSponsor &&
            msg.sender != vendorDisputeSponsor
        ) {
            revert NotAuthorizedRole();
        }
        _;
    }

    modifier onlyEntryPointOrAuthorized() {
        if (
            msg.sender != address(entryPoint) &&
            msg.sender != buyerSigner &&
            msg.sender != vendorSigner &&
            msg.sender != buyerDisputeSponsorSigner &&
            msg.sender != vendorDisputeSponsorSigner
        ) {
            revert NotAuthorizedExecutor();
        }
        _;
    }

    modifier onlyExpected(address _sender, State _state) {
        if (!_isExpectedSender(_sender)) revert UnexpectedSender();
        if (currState != _state) revert InvalidState();
        _;
    }

    constructor(
        address _entryPoint,
        address _optimisticContract,
        uint32 _numBlocks,
        uint32 _numGates,
        bytes32 _commitment,
        uint32 _circuitVersion,
        address _buyerSigner,
        address _vendorSigner,
        address _buyerDisputeSponsorSigner,
        address _vendorDisputeSponsor,
        address _vendorDisputeSponsorSigner
    ) payable {
        if (_entryPoint == address(0)) revert EntryPointRequired();
        if (_circuitVersion != 1) revert UnsupportedCircuitVersion();
        if (_numGates == 0) revert InvalidNumGates();

        entryPoint = IEntryPoint(_entryPoint);

        optimisticContract = IOptimisticSOXNormal(_optimisticContract);
        if (optimisticContract.currState() != OptimisticState.WaitSV) revert InvalidOptimisticState();
        if (msg.value < optimisticContract.agreedPrice()) revert InsufficientFunds();

        buyer = optimisticContract.buyer();
        vendor = optimisticContract.vendor();
        buyerDisputeSponsor = optimisticContract.buyerDisputeSponsor();
        timeoutIncrement = optimisticContract.timeoutIncrement();
        agreedPrice = optimisticContract.agreedPrice();

        if (buyerDisputeSponsor == address(0)) {
            revert InvalidOptimisticState();
        }

        if (_vendorDisputeSponsor != address(0)) {
            vendorDisputeSponsor = _vendorDisputeSponsor;
        } else if (_vendorDisputeSponsorSigner != address(0)) {
            vendorDisputeSponsor = _vendorDisputeSponsorSigner;
        } else {
            vendorDisputeSponsor = optimisticContract.vendorDisputeSponsor();
        }

        if (vendorDisputeSponsor == address(0)) {
            revert InvalidOptimisticState();
        }

        numBlocks = _numBlocks;
        numGates = _numGates;
        commitment = _commitment;

        a = 1;
        b = _numGates + 1;
        chall = (a + b) / 2;

        buyerSigner = _buyerSigner != address(0) ? _buyerSigner : buyer;
        vendorSigner = _vendorSigner != address(0) ? _vendorSigner : vendor;
        buyerDisputeSponsorSigner =
            _buyerDisputeSponsorSigner != address(0)
                ? _buyerDisputeSponsorSigner
                : buyerDisputeSponsor;
        vendorDisputeSponsorSigner =
            _vendorDisputeSponsorSigner != address(0)
                ? _vendorDisputeSponsorSigner
                : vendorDisputeSponsor;

        nextState(State.ChallengeBuyer);
    }

    function setSigner(uint8 role, address _newSigner) external {
        if (_newSigner == address(0)) revert SignerCannotBeZero();

        if (role == uint8(Role.Buyer)) {
            if (msg.sender != buyer) revert OnlyBuyer();
            emit SignerUpdated(role, buyerSigner, _newSigner);
            buyerSigner = _newSigner;
        } else if (role == uint8(Role.Vendor)) {
            if (msg.sender != vendor) revert OnlyVendor();
            emit SignerUpdated(role, vendorSigner, _newSigner);
            vendorSigner = _newSigner;
        } else if (role == uint8(Role.BuyerDisputeSponsor)) {
            if (msg.sender != buyerDisputeSponsor) revert OnlyBuyerDisputeSponsor();
            emit SignerUpdated(role, buyerDisputeSponsorSigner, _newSigner);
            buyerDisputeSponsorSigner = _newSigner;
        } else if (role == uint8(Role.VendorDisputeSponsor)) {
            if (msg.sender != vendorDisputeSponsor) revert OnlyVendorDisputeSponsor();
            emit SignerUpdated(role, vendorDisputeSponsorSigner, _newSigner);
            vendorDisputeSponsorSigner = _newSigner;
        } else {
            revert InvalidRole();
        }
    }

    function depositToEntryPoint() external payable {
        entryPoint.depositTo{value: msg.value}(address(this));
        emit EntryPointDeposit(msg.sender, msg.value);
    }

    function withdrawFromEntryPoint(address payable _to, uint256 _amount) external onlyAuthorizedRole {
        entryPoint.withdrawTo(_to, _amount);
        emit EntryPointWithdrawal(_to, _amount);
    }

    function validateUserOp(
        PackedUserOperation calldata userOp,
        bytes32 userOpHash,
        uint256 missingAccountFunds
    ) external payable onlyEntryPoint returns (uint256 validationData) {
        if (userOp.nonce != nonce) revert BadNonce();
        Role role = _validateSignature(userOpHash, userOp.signature);
        lastValidatedRole = role;
        lastValidatedNonce = userOp.nonce;

        nonce++;

        if (missingAccountFunds > 0) {
            entryPoint.depositTo{value: missingAccountFunds}(address(this));
            emit EntryPointDeposit(msg.sender, missingAccountFunds);
        }

        return 0;
    }

    function execute(
        address _target,
        uint256 _value,
        bytes calldata _data
    ) external onlyEntryPointOrAuthorized {
        _call(_target, _value, _data);
        _clearUserOpContext();
    }

    function executeBatch(
        address[] calldata _targets,
        uint256[] calldata _values,
        bytes[] calldata _calldata
    ) external onlyEntryPointOrAuthorized {
        if (_targets.length != _values.length || _targets.length != _calldata.length) {
            revert MismatchedBatchLengths();
        }

        for (uint256 i = 0; i < _targets.length; i++) {
            _call(_targets[i], _values[i], _calldata[i]);
        }
        _clearUserOpContext();
    }

    receive() external payable {}

    function respondChallenge(bytes32 _response) public onlyExpected(buyer, State.ChallengeBuyer) {
        buyerResponses[chall] = _response;
        nextState(State.WaitVendorOpinion);
    }

    function giveOpinion(bool _vendorAgrees) public onlyExpected(vendor, State.WaitVendorOpinion) {
        if (_vendorAgrees) {
            a = chall + 1;
        } else {
            b = chall;
        }

        if (a != b) {
            chall = (a + b) / 2;
            return nextState(State.ChallengeBuyer);
        }

        chall = a;
        if (chall == 1) {
            return nextState(State.WaitVendorDataLeft);
        } else if (chall == numGates + 1) {
            return nextState(State.WaitVendorDataRight);
        } else if (chall <= numGates) {
            return nextState(State.WaitVendorData);
        }

        revert();
    }

    function submitCommitment(
        bytes calldata _openingValue,
        uint32 _gateNum,
        bytes calldata _gateBytes,
        bytes[] calldata _values,
        bytes32 _currAcc,
        bytes32[][] memory _proof1,
        bytes32[][] memory _proof2,
        bytes32[][] memory _proof3,
        bytes32[][] memory _proofExt
    ) public virtual onlyExpected(vendor, State.WaitVendorData) {
        bytes32[2] memory hCircuitCt = openCommitment(_openingValue);

        bytes32[] memory valuesKeccak = _hashBytesArray(_values);
        if (_gateBytes.length != 64) revert InvalidGateBytes();
        bytes32 gateHash = keccak256(_gateBytes);
        bytes16 aesKey = getAesKey();
        bytes memory gateRes = EvaluatorSOX_V2.evaluateGateFromSons(_gateBytes, _values, aesKey);

        (
            uint32[] memory sInL,
            bytes32[] memory vInL,
            uint32[] memory sNotInLMinusM,
            bytes32[] memory vNotInL
        ) = _extractInAndNotInL_V2(_gateBytes, valuesKeccak, numBlocks);

        if (
            buyerResponses[_gateNum] != _currAcc &&
            _verifyCircuitGate(_gateNum, hCircuitCt[0], gateHash, _proof1) &&
            AccumulatorVerifier.verify(hCircuitCt[1], sInL, vInL, _proof2) &&
            AccumulatorVerifier.verify(
                buyerResponses[_gateNum - 1],
                sNotInLMinusM,
                vNotInL,
                _proof3
            ) &&
            AccumulatorVerifier.verifyExt(
                _gateNum - 1,
                buyerResponses[_gateNum - 1],
                _currAcc,
                keccak256(gateRes),
                _proofExt
            )
        ) {
            handleStep9(false);
        } else {
            handleStep9(true);
        }
    }

    function submitCommitmentLeft(
        bytes calldata _openingValue,
        uint32 _gateNum,
        bytes calldata _gateBytes,
        bytes[] calldata _values,
        bytes32 _currAcc,
        bytes32[][] memory _proof1,
        bytes32[][] memory _proof2,
        bytes32[][] memory _proofExt
    ) public virtual onlyExpected(vendor, State.WaitVendorDataLeft) {
        bool verified = verifyCommitmentLeft(
            _openingValue,
            _gateNum,
            _gateBytes,
            _values,
            _currAcc,
            _proof1,
            _proof2,
            _proofExt
        );

        if (verified) {
            handleStep9(false);
        } else {
            handleStep9(true);
        }
    }

    function verifyCommitmentLeft(
        bytes calldata _openingValue,
        uint32 _gateNum,
        bytes calldata _gateBytes,
        bytes[] calldata _values,
        bytes32 _currAcc,
        bytes32[][] memory _proof1,
        bytes32[][] memory _proof2,
        bytes32[][] memory _proofExt
    ) internal view returns (bool) {
        bytes32[2] memory hCircuitCt = openCommitment(_openingValue);

        if (_gateBytes.length != 64) revert InvalidGateBytes();

        bytes32[] memory valuesKeccak = _hashBytesArray(_values);
        bytes32 gateHash = keccak256(_gateBytes);

        bytes16 aesKey = getAesKey();
        bytes memory gateRes = EvaluatorSOX_V2.evaluateGateFromSons(_gateBytes, _values, aesKey);
        (
            uint32[] memory nonConstantSons,
            bytes32[] memory nonConstantValuesKeccak
        ) = _extractNonConstantSons_V2(_gateBytes, valuesKeccak, numBlocks);

        return (
            _verifyCircuitGate(_gateNum, hCircuitCt[0], gateHash, _proof1) &&
            AccumulatorVerifier.verify(
                hCircuitCt[1],
                nonConstantSons,
                nonConstantValuesKeccak,
                _proof2
            ) &&
            AccumulatorVerifier.verifyExt(
                0,
                bytes32(0),
                _currAcc,
                keccak256(gateRes),
                _proofExt
            )
        );
    }

    function submitCommitmentRight(
        bytes32[][] memory _proof
    ) public onlyExpected(vendor, State.WaitVendorDataRight) {
        bytes memory trueBytes = new bytes(64);
        trueBytes[0] = 0x01;
        bytes32 expectedValue = keccak256(trueBytes);
        bytes32[] memory trueKeccakArr = new bytes32[](1);
        trueKeccakArr[0] = expectedValue;

        uint32[] memory idxArr = new uint32[](1);
        idxArr[0] = numGates - 1;
        bytes32 root = buyerResponses[numGates];
        if (root == bytes32(0)) {
            revert InvalidState();
        }

        bool verified = AccumulatorVerifier.verify(root, idxArr, trueKeccakArr, _proof);
        if (verified) {
            handleStep9(false);
        } else {
            handleStep9(true);
        }
    }

    function completeDispute() public {
        if (currState != State.ChallengeBuyer && currState != State.Complete) revert InvalidState();

        if (currState == State.Complete && !_isBuyer()) {
            if (block.timestamp < nextTimeoutTime) revert InvalidState();
        }

        payable(vendor).transfer(agreedPrice);
        payable(vendorDisputeSponsor).transfer(address(this).balance);

        optimisticContract.endDispute();
        nextState(State.End);
    }

    function cancelDispute() public {
        if (
            currState != State.Cancel &&
            currState != State.WaitVendorOpinion &&
            currState != State.WaitVendorData &&
            currState != State.WaitVendorDataLeft &&
            currState != State.WaitVendorDataRight
        ) {
            revert InvalidState();
        }

        if (currState != State.Cancel && !_isVendor()) {
            if (block.timestamp < nextTimeoutTime) revert InvalidState();
        }

        payable(buyer).transfer(agreedPrice);
        payable(buyerDisputeSponsor).transfer(address(this).balance);

        optimisticContract.endDispute();
        nextState(State.End);
    }

    function nextState(State _s) internal {
        currState = _s;
        nextTimeoutTime = block.timestamp + timeoutIncrement;
    }

    function getAesKey() internal view returns (bytes16) {
        return optimisticContract.key();
    }

    function openCommitment(
        bytes calldata _openingValue
    ) internal view returns (bytes32[2] memory hCircuitCt) {
        bytes memory opened = CommitmentOpener.open(commitment, _openingValue);

        assembly {
            mstore(hCircuitCt, mload(add(opened, 32)))
            mstore(add(hCircuitCt, 32), mload(add(opened, 64)))
        }
    }

    function handleStep9(bool _vendorLost) internal virtual {
        Step9State memory s = Step9State({
            step9Count: step9Count,
            lastLosingPartyWasVendor: lastLosingPartyWasVendor,
            buyer: buyer,
            vendor: vendor,
            buyerDisputeSponsor: buyerDisputeSponsor,
            vendorDisputeSponsor: vendorDisputeSponsor,
            numBlocks: numBlocks,
            numGates: numGates
        });

        Step9Result memory r = _handleStep9Logic(_vendorLost, s);

        step9Count = r.newStep9Count;
        lastLosingPartyWasVendor = r.newLastLosingPartyWasVendor;
        buyer = r.newBuyer;
        vendor = r.newVendor;

        if (r.newBuyer == buyerDisputeSponsor && buyerSigner != buyerDisputeSponsorSigner) {
            buyerSigner = buyerDisputeSponsorSigner;
        }
        if (r.newVendor == vendorDisputeSponsor && vendorSigner != vendorDisputeSponsorSigner) {
            vendorSigner = vendorDisputeSponsorSigner;
        }

        if (r.shouldContinue) {
            a = r.a;
            b = r.b;
            chall = r.chall;
            nextState(State.ChallengeBuyer);
        } else if (r.vendorLost) {
            nextState(State.Cancel);
        } else {
            nextState(State.Complete);
        }
    }

    function _handleStep9Logic(
        bool _vendorLost,
        Step9State memory s
    ) internal pure returns (Step9Result memory r) {
        bool qEqualsSq = _vendorLost
            ? s.vendor == s.vendorDisputeSponsor
            : s.buyer == s.buyerDisputeSponsor;

        if (!qEqualsSq) {
            r.newStep9Count = s.step9Count + 1;
            r.newLastLosingPartyWasVendor = _vendorLost;
            r.newBuyer = _vendorLost ? s.buyer : s.buyerDisputeSponsor;
            r.newVendor = _vendorLost ? s.vendorDisputeSponsor : s.vendor;
            r.shouldContinue = true;
            r.vendorLost = _vendorLost;
            r.a = 1;
            r.b = s.numGates + 1;
            r.chall = (r.a + r.b) / 2;
            return r;
        }

        r.newStep9Count = s.step9Count;
        r.newLastLosingPartyWasVendor = _vendorLost;
        r.newBuyer = s.buyer;
        r.newVendor = s.vendor;
        r.shouldContinue = false;
        r.vendorLost = _vendorLost;
    }

    function _activeUserOpRole() internal view returns (Role) {
        if (nonce == 0 || lastValidatedNonce != nonce - 1) return Role.None;
        return lastValidatedRole;
    }

    function _verifyCircuitGate(
        uint32 _gateNum,
        bytes32 _hCircuit,
        bytes32 _gateHash,
        bytes32[][] memory _proof1
    ) internal view virtual returns (bool) {
        uint32[] memory gateNumArray = new uint32[](1);
        gateNumArray[0] = _gateNum - 1;

        bytes32[] memory gateKeccak = new bytes32[](1);
        gateKeccak[0] = _gateHash;

        return AccumulatorVerifier.verify(_hCircuit, gateNumArray, gateKeccak, _proof1);
    }

    function _roleForExpected(address expected) internal view returns (Role) {
        if (expected == buyer) return Role.Buyer;
        if (expected == vendor) return Role.Vendor;
        if (expected == buyerDisputeSponsor) return Role.BuyerDisputeSponsor;
        if (expected == vendorDisputeSponsor) return Role.VendorDisputeSponsor;
        return Role.None;
    }

    function _isExpectedSender(address expected) internal view returns (bool) {
        if (msg.sender == expected) return true;
        if (msg.sender != address(this)) return false;
        Role role = _roleForExpected(expected);
        return role != Role.None && _activeUserOpRole() == role;
    }

    function _isBuyer() internal view returns (bool) {
        return _isExpectedSender(buyer);
    }

    function _isVendor() internal view returns (bool) {
        return _isExpectedSender(vendor);
    }

    function _clearUserOpContext() internal {
        lastValidatedRole = Role.None;
        lastValidatedNonce = 0;
    }

    function _validateSignature(
        bytes32 userOpHash,
        bytes calldata signature
    ) internal view returns (Role) {
        bytes32 digest = userOpHash.toEthSignedMessageHash();
        address recovered = ECDSA.recover(digest, signature);
        if (recovered == buyerSigner || recovered == buyer) return Role.Buyer;
        if (recovered == vendorSigner || recovered == vendor) return Role.Vendor;
        if (recovered == buyerDisputeSponsorSigner || recovered == buyerDisputeSponsor) {
            return Role.BuyerDisputeSponsor;
        }
        if (recovered == vendorDisputeSponsorSigner || recovered == vendorDisputeSponsor) {
            return Role.VendorDisputeSponsor;
        }
        revert InvalidSignature();
    }

    function _call(address _target, uint256 _value, bytes calldata _data) internal {
        (bool success, bytes memory result) = _target.call{value: _value}(_data);
        if (!success) {
            if (result.length < 68) revert TransactionReverted();
            assembly {
                result := add(result, 0x04)
            }
            revert(abi.decode(result, (string)));
        }
    }

    function _hashBytesArray(bytes[] memory values) internal pure returns (bytes32[] memory hashed) {
        hashed = new bytes32[](values.length);
        for (uint256 i = 0; i < values.length; i++) {
            hashed[i] = keccak256(values[i]);
        }
    }

    function _extractInAndNotInL_V2(
        bytes calldata _gateBytes,
        bytes32[] memory _values,
        uint32 _numBlocks
    )
        internal
        pure
        returns (
            uint32[] memory sInL,
            bytes32[] memory vInL,
            uint32[] memory sNotInLMinusM,
            bytes32[] memory vNotInL
        )
    {
        (, int64[] memory sons, ) = EvaluatorSOX_V2.decodeGate(_gateBytes, _values.length);

        uint32 inLCount = 0;
        uint32 notInLCount = 0;

        for (uint256 i = 0; i < sons.length; i++) {
            int64 son = sons[i];
            if (son == 0) revert InvalidV2SonIndex();
            if (son < 0) {
                uint32 ctIdx = uint32(uint64(-son));
                if (ctIdx >= 1 && ctIdx <= _numBlocks) {
                    inLCount++;
                }
            } else {
                notInLCount++;
            }
        }

        sInL = new uint32[](inLCount);
        vInL = new bytes32[](inLCount);
        sNotInLMinusM = new uint32[](notInLCount);
        vNotInL = new bytes32[](notInLCount);

        uint32 inLIdx = 0;
        uint32 notInLIdx = 0;

        for (uint256 i = 0; i < sons.length; i++) {
            int64 son = sons[i];
            if (son < 0) {
                uint32 ctIdx = uint32(uint64(-son));
                if (ctIdx < 1 || ctIdx > _numBlocks) continue;
                // h_ct is accumulated over [IV, ct_1, ct_2, ...], so ctIdx is
                // already the 0-indexed leaf position once the IV occupies 0.
                sInL[inLIdx] = ctIdx;
                vInL[inLIdx] = _values[i];
                inLIdx++;
            } else {
                sNotInLMinusM[notInLIdx] = uint32(uint64(son - 1));
                vNotInL[notInLIdx] = _values[i];
                notInLIdx++;
            }
        }
    }

    function _extractNonConstantSons_V2(
        bytes calldata _gateBytes,
        bytes32[] memory _values,
        uint32 _numBlocks
    )
        internal
        pure
        returns (uint32[] memory nonConstantSons, bytes32[] memory nonConstantValuesKeccak)
    {
        (, int64[] memory sons, ) = EvaluatorSOX_V2.decodeGate(_gateBytes, _values.length);

        uint32 count = 0;
        for (uint256 i = 0; i < sons.length; i++) {
            if (sons[i] < 0) {
                uint32 ctIdx = uint32(uint64(-sons[i]));
                if (ctIdx >= 1 && ctIdx <= _numBlocks) {
                    count++;
                }
            }
        }

        nonConstantSons = new uint32[](count);
        nonConstantValuesKeccak = new bytes32[](count);

        uint32 idx = 0;
        for (uint256 i = 0; i < sons.length; i++) {
            if (sons[i] >= 0) continue;
            uint32 ctIdx = uint32(uint64(-sons[i]));
            if (ctIdx >= 1 && ctIdx <= _numBlocks) {
                // h_ct is accumulated over [IV, ct_1, ct_2, ...].
                nonConstantSons[idx] = ctIdx;
                nonConstantValuesKeccak[idx] = _values[i];
                idx++;
            }
        }
    }

    function _getAllSonsV2(bytes memory _gateBytes) internal pure returns (uint32[] memory sons) {
        uint8 opcode = uint8(_gateBytes[0]);

        if (opcode == 0x01) {
            sons = new uint32[](1);
            sons[0] = _decodeV2Son(_gateBytes, 1);
            return sons;
        } else if (opcode == 0x02) {
            sons = new uint32[](16);
            for (uint256 i = 0; i < 16; i++) {
                sons[i] = _decodeV2Son(_gateBytes, 1 + i * 3);
            }
            return sons;
        } else if (opcode == 0x03) {
            sons = new uint32[](2);
            sons[0] = _decodeV2Son(_gateBytes, 1);
            sons[1] = _decodeV2Son(_gateBytes, 7);
            return sons;
        } else if (opcode == 0x04 || opcode == 0x05) {
            sons = new uint32[](2);
            sons[0] = _decodeV2Son(_gateBytes, 1);
            sons[1] = _decodeV2Son(_gateBytes, 7);
            return sons;
        }

        revert InvalidGateBytes();
    }

    function _decodeV2Son(bytes memory gate, uint256 offset) internal pure returns (uint32) {
        if (offset + 6 > gate.length) revert InvalidV2SonIndex();
        int48 signed;
        assembly {
            let word := mload(add(add(gate, 0x20), offset))
            signed := sar(208, word)
        }
        if (signed < 0) return type(uint32).max;
        return uint32(uint48(signed));
    }
}
