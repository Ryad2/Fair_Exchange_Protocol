// SPDX-License-Identifier: GPL-3.0
pragma solidity ^0.8.0;

import {
    HardcodedCircuitMetadataMismatch,
    HardcodedGateMismatch
} from "./DisputeSOXAccount.sol";
import {AccumulatorVerifier} from "./AccumulatorSOX.sol";
import {EvaluatorSOX_V2} from "./EvaluatorSOX_V2.sol";

interface IHardcodedSha256MetadataSource {
    function hardcodedMetadata() external view returns (bytes32, uint64, bytes16);
}

library HardcodedSha256CircuitLib {
    struct HardcodedLayout {
        uint8 paddingCase;
        uint32 shaStart;
        uint32 blockCount;
        uint32 descGate;
        uint32 compGate;
        uint32 paddedBlockGate;
        uint32 extraBlockGate;
    }

    function numBlocksForPlaintextLength(uint64 _plaintextLength) public pure returns (uint32) {
        if (_plaintextLength == 0) revert HardcodedCircuitMetadataMismatch();
        if (_plaintextLength > type(uint64).max / 8) {
            revert HardcodedCircuitMetadataMismatch();
        }

        uint256 blocks = (uint256(_plaintextLength) + 63) / 64;
        if (blocks > type(uint32).max) revert HardcodedCircuitMetadataMismatch();
        return uint32(blocks);
    }

    function hardcodedSha256GateCount(
        uint64 _plaintextLength,
        uint32 _numBlocks
    ) public pure returns (uint32) {
        if (_plaintextLength == 0) revert HardcodedCircuitMetadataMismatch();
        if (_plaintextLength > type(uint64).max / 8) {
            revert HardcodedCircuitMetadataMismatch();
        }
        if (_numBlocks > (type(uint32).max - 8) / 2) revert HardcodedCircuitMetadataMismatch();

        uint64 rem = _plaintextLength % 64;
        if (rem > 55) {
            return _numBlocks * 2 + 8;
        }
        return _numBlocks * 2 + 5;
    }

    function expectedGateHash(
        uint32 _gateNum,
        uint32 _numBlocks,
        bytes32 _descriptionHash,
        uint64 _plaintextLength,
        bytes16 _ciphertextIv
    ) public pure returns (bytes32) {
        return keccak256(
            expectedGateBytes(
                _gateNum,
                _numBlocks,
                _descriptionHash,
                _plaintextLength,
                _ciphertextIv
            )
        );
    }

    function expectedGateBytes(
        uint32 _gateNum,
        uint32 _numBlocks,
        bytes32 _descriptionHash,
        uint64 _plaintextLength,
        bytes16 _ciphertextIv
    ) public pure returns (bytes memory) {
        HardcodedLayout memory layout = _hardcodedLayout(_numBlocks, _plaintextLength);

        if (_gateNum >= 1 && _gateNum <= _numBlocks) {
            return _encodeAesGate(_gateNum, _plaintextLength, _ciphertextIv);
        }

        if (layout.paddingCase == 0) {
            if (_gateNum == _numBlocks + 1) {
                (bytes32 head, ) = _extraPaddingWords(_plaintextLength, true);
                return _encodeConstGate0(head);
            }
            if (_gateNum == _numBlocks + 2) {
                (, bytes32 tail) = _extraPaddingWords(_plaintextLength, true);
                return _encodeConstGate1(_numBlocks + 1, tail);
            }
        } else {
            if (_gateNum == _numBlocks + 1) {
                (bytes32 head, ) = _paddingMaskWords(_plaintextLength);
                return _encodeConstGate0(head);
            }
            if (_gateNum == _numBlocks + 2) {
                (, bytes32 tail) = _paddingMaskWords(_plaintextLength);
                return _encodeConstGate1(_numBlocks + 1, tail);
            }
            if (_gateNum == _numBlocks + 3) {
                return _encodeBinaryGate(0x04, _numBlocks, _numBlocks + 2);
            }
            if (layout.paddingCase == 2) {
                if (_gateNum == _numBlocks + 4) {
                    (bytes32 head, ) = _extraPaddingWords(_plaintextLength, false);
                    return _encodeConstGate0(head);
                }
                if (_gateNum == _numBlocks + 5) {
                    (, bytes32 tail) = _extraPaddingWords(_plaintextLength, false);
                    return _encodeConstGate1(_numBlocks + 4, tail);
                }
            }
        }

        if (_gateNum >= layout.shaStart && _gateNum < layout.descGate) {
            uint32 step = _gateNum - layout.shaStart + 1;
            uint32 blockGate = _hardcodedBlockOutputGate(step, layout, _numBlocks);
            if (step == 1) {
                return _encodeUnaryGate(0x02, blockGate);
            }
            return _encodeBinaryGate(0x02, _gateNum - 1, blockGate);
        }

        if (_gateNum == layout.descGate) {
            return _encodeConstGate0(_descriptionHash);
        }

        if (_gateNum == layout.compGate) {
            return _encodeBinaryGate(0x05, layout.descGate - 1, layout.descGate);
        }

        revert HardcodedGateMismatch();
    }

    function expectedGateBytesFromOptimistic(
        address _optimisticContract,
        uint32 _gateNum,
        uint32 _numBlocks
    ) public view returns (bytes memory) {
        (
            bytes32 hardcodedDescriptionHash,
            uint64 hardcodedPlaintextLength,
            bytes16 hardcodedCiphertextIv
        ) = IHardcodedSha256MetadataSource(_optimisticContract).hardcodedMetadata();

        return
            expectedGateBytes(
                _gateNum,
                _numBlocks,
                hardcodedDescriptionHash,
                hardcodedPlaintextLength,
                hardcodedCiphertextIv
            );
    }

    function verifyGateHashFromOptimistic(
        address _optimisticContract,
        uint32 _gateNum,
        uint32 _numBlocks,
        bytes32 _gateHash
    ) public view returns (bool) {
        (
            bytes32 hardcodedDescriptionHash,
            uint64 hardcodedPlaintextLength,
            bytes16 hardcodedCiphertextIv
        ) = IHardcodedSha256MetadataSource(_optimisticContract).hardcodedMetadata();

        return
            _gateHash ==
            expectedGateHash(
                _gateNum,
                _numBlocks,
                hardcodedDescriptionHash,
                hardcodedPlaintextLength,
                hardcodedCiphertextIv
            );
    }

    function verifyCommitmentFromOptimistic(
        address _optimisticContract,
        uint32 _gateNum,
        uint32 _numBlocks,
        bytes32 _hCt,
        bytes32 _prevAcc,
        bytes32 _nextAcc,
        bytes[] memory _values,
        bytes32 _currAcc,
        bytes32[][] memory _proof2,
        bytes32[][] memory _proof3,
        bytes32[][] memory _proofExt,
        bytes16 _aesKey
    ) public view returns (bool) {
        bytes memory gateBytes = expectedGateBytesFromOptimistic(
            _optimisticContract,
            _gateNum,
            _numBlocks
        );
        bytes32[] memory valuesKeccak = _hashBytesArray(_values);
        bytes memory gateRes = EvaluatorSOX_V2.evaluateGateFromSonsMemory(
            gateBytes,
            _values,
            _aesKey
        );

        (
            uint32[] memory sInL,
            bytes32[] memory vInL,
            uint32[] memory sNotInLMinusM,
            bytes32[] memory vNotInL
        ) = _extractInAndNotInL(gateBytes, valuesKeccak, _numBlocks);

        return
            _nextAcc != _currAcc &&
            AccumulatorVerifier.verify(_hCt, sInL, vInL, _proof2) &&
            AccumulatorVerifier.verify(_prevAcc, sNotInLMinusM, vNotInL, _proof3) &&
            AccumulatorVerifier.verifyExt(
                _gateNum - 1,
                _prevAcc,
                _currAcc,
                keccak256(gateRes),
                _proofExt
            );
    }

    function verifyCommitmentLeftFromOptimistic(
        address _optimisticContract,
        uint32 _gateNum,
        uint32 _numBlocks,
        bytes32 _hCt,
        bytes[] memory _values,
        bytes32 _currAcc,
        bytes32[][] memory _proof2,
        bytes32[][] memory _proofExt,
        bytes16 _aesKey
    ) public view returns (bool) {
        bytes memory gateBytes = expectedGateBytesFromOptimistic(
            _optimisticContract,
            _gateNum,
            _numBlocks
        );
        bytes32[] memory valuesKeccak = _hashBytesArray(_values);
        bytes memory gateRes = EvaluatorSOX_V2.evaluateGateFromSonsMemory(
            gateBytes,
            _values,
            _aesKey
        );
        (
            uint32[] memory nonConstantSons,
            bytes32[] memory nonConstantValuesKeccak
        ) = _extractNonConstantSons(gateBytes, valuesKeccak, _numBlocks);

        return
            AccumulatorVerifier.verify(
                _hCt,
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
            );
    }

    function _hardcodedLayout(
        uint32 _numBlocks,
        uint64 _plaintextLength
    ) private pure returns (HardcodedLayout memory layout) {
        uint64 rem = _plaintextLength % 64;
        if (rem == 0) {
            layout.paddingCase = 0;
            layout.paddedBlockGate = _numBlocks + 2;
            layout.shaStart = _numBlocks + 3;
            layout.blockCount = _numBlocks + 1;
        } else if (rem > 55) {
            layout.paddingCase = 2;
            layout.paddedBlockGate = _numBlocks + 3;
            layout.extraBlockGate = _numBlocks + 5;
            layout.shaStart = _numBlocks + 6;
            layout.blockCount = _numBlocks + 1;
        } else {
            layout.paddingCase = 1;
            layout.paddedBlockGate = _numBlocks + 3;
            layout.shaStart = _numBlocks + 4;
            layout.blockCount = _numBlocks;
        }

        layout.descGate = layout.shaStart + layout.blockCount;
        layout.compGate = layout.descGate + 1;
    }

    function _hashBytesArray(bytes[] memory values) private pure returns (bytes32[] memory hashed) {
        hashed = new bytes32[](values.length);
        for (uint256 i = 0; i < values.length; i++) {
            hashed[i] = keccak256(values[i]);
        }
    }

    function _extractInAndNotInL(
        bytes memory _gateBytes,
        bytes32[] memory _values,
        uint32 _numBlocks
    )
        private
        pure
        returns (
            uint32[] memory sInL,
            bytes32[] memory vInL,
            uint32[] memory sNotInLMinusM,
            bytes32[] memory vNotInL
        )
    {
        (, int64[] memory sons, ) = EvaluatorSOX_V2.decodeGateMemory(_gateBytes, _values.length);

        uint32 inLCount = 0;
        uint32 notInLCount = 0;

        for (uint256 i = 0; i < sons.length; i++) {
            int64 son = sons[i];
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

    function _extractNonConstantSons(
        bytes memory _gateBytes,
        bytes32[] memory _values,
        uint32 _numBlocks
    )
        private
        pure
        returns (uint32[] memory nonConstantSons, bytes32[] memory nonConstantValuesKeccak)
    {
        (, int64[] memory sons, ) = EvaluatorSOX_V2.decodeGateMemory(_gateBytes, _values.length);

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
                nonConstantSons[idx] = ctIdx;
                nonConstantValuesKeccak[idx] = _values[i];
                idx++;
            }
        }
    }

    function _hardcodedBlockOutputGate(
        uint32 _blockNumber,
        HardcodedLayout memory _layout,
        uint32 _numBlocks
    ) private pure returns (uint32) {
        if (_layout.paddingCase == 0) {
            if (_blockNumber <= _numBlocks) return _blockNumber;
            return _layout.paddedBlockGate;
        }

        if (_blockNumber < _numBlocks) return _blockNumber;
        if (_blockNumber == _numBlocks) return _layout.paddedBlockGate;
        return _layout.extraBlockGate;
    }

    function _encodeAesGate(
        uint32 _gateNum,
        uint64 _plaintextLength,
        bytes16 _ciphertextIv
    ) private pure returns (bytes memory gate) {
        gate = new bytes(64);
        gate[0] = bytes1(uint8(0x01));
        _writeSon(gate, 1, -int256(uint256(_gateNum)));

        uint128 ivValue = uint128(_ciphertextIv);
        uint128 increment = uint128((uint256(_gateNum) - 1) * 4);
        _writeBytes16(gate, 7, bytes16(ivValue + increment));

        uint256 consumed = (uint256(_gateNum) - 1) * 64;
        uint256 remaining = uint256(_plaintextLength) - consumed;
        uint256 blockBytes = remaining > 64 ? 64 : remaining;
        uint16 lenBits = uint16(blockBytes * 8);
        gate[23] = bytes1(uint8(lenBits >> 8));
        gate[24] = bytes1(uint8(lenBits));
    }

    function _encodeConstGate0(bytes32 _word) private pure returns (bytes memory gate) {
        gate = new bytes(64);
        gate[0] = bytes1(uint8(0x03));
        _writeBytes32(gate, 1, _word);
    }

    function _encodeConstGate1(uint32 _son, bytes32 _word) private pure returns (bytes memory gate) {
        gate = new bytes(64);
        gate[0] = bytes1(uint8(0x03));
        _writeSon(gate, 1, int256(uint256(_son)));
        _writeBytes32(gate, 7, _word);
    }

    function _encodeUnaryGate(uint8 _opcode, uint32 _son) private pure returns (bytes memory gate) {
        gate = new bytes(64);
        gate[0] = bytes1(_opcode);
        _writeSon(gate, 1, int256(uint256(_son)));
    }

    function _encodeBinaryGate(
        uint8 _opcode,
        uint32 _son1,
        uint32 _son2
    ) private pure returns (bytes memory gate) {
        gate = new bytes(64);
        gate[0] = bytes1(_opcode);
        _writeSon(gate, 1, int256(uint256(_son1)));
        _writeSon(gate, 7, int256(uint256(_son2)));
    }

    function _paddingMaskWords(
        uint64 _plaintextLength
    ) private pure returns (bytes32 head, bytes32 tail) {
        bytes memory blockData = new bytes(64);
        uint64 rem = _plaintextLength % 64;
        blockData[uint256(rem)] = bytes1(uint8(0x80));
        if (rem <= 55) {
            _writeUint64(blockData, 56, uint64(uint256(_plaintextLength) * 8));
        }
        return (_wordFromBytes(blockData, 0), _wordFromBytes(blockData, 32));
    }

    function _extraPaddingWords(
        uint64 _plaintextLength,
        bool _fullBlockCase
    ) private pure returns (bytes32 head, bytes32 tail) {
        bytes memory blockData = new bytes(64);
        if (_fullBlockCase) {
            blockData[0] = bytes1(uint8(0x80));
        }
        _writeUint64(blockData, 56, uint64(uint256(_plaintextLength) * 8));
        return (_wordFromBytes(blockData, 0), _wordFromBytes(blockData, 32));
    }

    function _writeSon(bytes memory _out, uint256 _offset, int256 _value) private pure {
        uint256 encoded = _value < 0
            ? uint256(int256(0x1000000000000) + _value)
            : uint256(_value);

        for (uint256 i = 0; i < 6; i++) {
            _out[_offset + i] = bytes1(uint8(encoded >> (8 * (5 - i))));
        }
    }

    function _writeBytes16(bytes memory _out, uint256 _offset, bytes16 _value) private pure {
        for (uint256 i = 0; i < 16; i++) {
            _out[_offset + i] = _value[i];
        }
    }

    function _writeBytes32(bytes memory _out, uint256 _offset, bytes32 _value) private pure {
        for (uint256 i = 0; i < 32; i++) {
            _out[_offset + i] = _value[i];
        }
    }

    function _writeUint64(bytes memory _out, uint256 _offset, uint64 _value) private pure {
        for (uint256 i = 0; i < 8; i++) {
            _out[_offset + i] = bytes1(uint8(_value >> (8 * (7 - i))));
        }
    }

    function _wordFromBytes(bytes memory _data, uint256 _offset) private pure returns (bytes32) {
        uint256 word = 0;
        for (uint256 i = 0; i < 32; i++) {
            word = (word << 8) | uint8(_data[_offset + i]);
        }
        return bytes32(word);
    }
}
