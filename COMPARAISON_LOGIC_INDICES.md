# Comparaison de la logique de calcul des indices : Ancien (V1) vs Nouveau (V2)

## Format des gates

### Ancien code (DisputeSOX.sol - V1)
- **Format**: `uint32[]` (array de uint32)
- **Structure**: `[op, s_1, ..., s_a]` où les `s_i` sont les indices des fils
- **Constantes**: Utilise `CONSTANT_FLAG = 1 << 31` pour marquer les constantes
- **Vérification constante**: `isConstantIdx(i)` retourne `true` si `i & CONSTANT_FLAG != 0`

### Nouveau code (DisputeSOXAccount.sol - V2)
- **Format**: `bytes` (64 bytes encodés)
- **Structure**: Format binaire avec `int64[]` pour les fils (via `decodeGate`)
- **Constantes**: Pas de flag spécial, les fils sont des indices signés
- **Vérification constante**: Les fils négatifs = ciphertext blocks, positifs = gates

## Extraction des non-constants (Step 8b - submitCommitmentLeft)

### Ancien code (`extractNonConstantSons`)
```solidity
function extractNonConstantSons(
    uint32[] memory _gate,
    bytes32[] memory _valuesKeccak
) internal pure returns (
    uint32[] memory nonConstantSons,
    bytes32[] memory nonConstantValuesKeccak
) {
    uint countNonConstant = 0;
    for (uint i = 1; i < _gate.length; ++i) {
        if (!isConstantIdx(_gate[i])) {
            ++countNonConstant;
        }
    }
    // ... remplir les arrays
    for (uint i = 1; i < _gate.length; ++i) {
        if (!isConstantIdx(_gate[i])) {
            nonConstantSons[j] = _gate[i];  // ⚠️ Utilise l'index tel quel
            nonConstantValuesKeccak[j] = _valuesKeccak[i - 1];
            ++j;
        }
    }
}
```

**Logique**:
- Filtre les fils où `!isConstantIdx(_gate[i])`
- Utilise l'index directement: `nonConstantSons[j] = _gate[i]`

### Nouveau code (`_extractNonConstantSons_V2`)
```solidity
function _extractNonConstantSons_V2(
    bytes calldata _gateBytes,
    bytes32[] memory _valuesKeccak,
    uint32 _numBlocks
) internal pure returns (
    uint32[] memory nonConstantSons,
    bytes32[] memory nonConstantValuesKeccak
) {
    (, int64[] memory sons, ) = EvaluatorSOX_V2.decodeGate(_gateBytes, _valuesKeccak.length);
    
    // Compter seulement les fils négatifs (ciphertext blocks)
    uint countNonConstant = 0;
    for (uint i = 0; i < sons.length; ++i) {
        if (sons[i] < 0) {
            uint32 ctIdx = uint32(uint64(-sons[i]));
            if (ctIdx >= 1 && ctIdx <= _numBlocks) {
                ++countNonConstant;
            }
        }
    }
    // ... remplir les arrays
    for (uint i = 0; i < sons.length; ++i) {
        if (sons[i] < 0) {
            uint32 ctIdx = uint32(uint64(-sons[i]));
            if (ctIdx >= 1 && ctIdx <= _numBlocks) {
                nonConstantSons[j] = ctIdx - 1;  // ✅ Convertit 1-indexed → 0-indexed
                nonConstantValuesKeccak[j] = _valuesKeccak[valueIdx];
                ++j;
            }
            ++valueIdx;
        } else {
            ++valueIdx;  // Skip les gates (positifs)
        }
    }
}
```

**Logique**:
- Filtre les fils négatifs (ciphertext blocks): `sons[i] < 0`
- **Convertit 1-indexed → 0-indexed**: `nonConstantSons[j] = ctIdx - 1`
- Vérifie la validité: `ctIdx >= 1 && ctIdx <= _numBlocks`

## Extraction InAndNotInL (Step 8a - submitCommitment)

### Ancien code (`extractInAndNotInL`)
```solidity
function extractInAndNotInL(
    uint32[] memory _gate,
    bytes32[] memory _valuesKeccak
) internal view returns (
    uint32[] memory sInL,
    bytes32[] memory vInL,
    uint32[] memory sNotInLMinusM,
    bytes32[] memory vNotInL
) {
    // Compter
    for (uint i = 1; i < _gate.length; ++i) {
        if (isConstantIdx(_gate[i])) continue;
        if (_gate[i] < numBlocks) {
            ++countInL;
        } else {
            ++countNotInL;
        }
    }
    // Remplir
    for (uint i = 1; i < _gate.length; ++i) {
        if (isConstantIdx(_gate[i])) continue;
        if (_gate[i] < numBlocks) {
            sInL[iterInL] = _gate[i];  // ⚠️ Index tel quel
            vInL[iterInL] = _valuesKeccak[i - 1];
            ++iterInL;
        } else {
            sNotInLMinusM[iterNotInL] = _gate[i] - numBlocks;  // ⚠️ Soustrait numBlocks
            vNotInL[iterNotInL] = _valuesKeccak[i - 1];
            ++iterNotInL;
        }
    }
}
```

**Logique**:
- **L (ciphertext blocks)**: `_gate[i] < numBlocks` → utilise `_gate[i]` directement
- **Not in L (gates)**: `_gate[i] >= numBlocks` → utilise `_gate[i] - numBlocks`

### Nouveau code (`_extractInAndNotInL_V2`)
```solidity
function _extractInAndNotInL_V2(
    bytes calldata _gateBytes,
    bytes32[] memory _valuesKeccak,
    uint32 _numBlocks
) internal pure returns (
    uint32[] memory sInL,
    bytes32[] memory vInL,
    uint32[] memory sNotInLMinusM,
    bytes32[] memory vNotInL
) {
    (, int64[] memory sons, ) = EvaluatorSOX_V2.decodeGate(_gateBytes, _valuesKeccak.length);
    
    // Compter
    for (uint i = 0; i < sons.length; ++i) {
        if (sons[i] < 0) {
            uint32 ctIdx = uint32(uint64(-sons[i]));
            if (ctIdx >= 1 && ctIdx <= _numBlocks) {
                ++countInL;
            }
        } else {
            ++countNotInL;
        }
    }
    // Remplir
    for (uint i = 0; i < sons.length; ++i) {
        if (sons[i] < 0) {
            uint32 ctIdx = uint32(uint64(-sons[i]));
            if (ctIdx >= 1 && ctIdx <= _numBlocks) {
                sInL[iterInL] = ctIdx - 1;  // ✅ Convertit 1-indexed → 0-indexed
                vInL[iterInL] = _valuesKeccak[valueIdx];
                ++iterInL;
            }
            ++valueIdx;
        } else {
            uint32 gateIdx = uint32(uint64(sons[i] - 1));  // ✅ Convertit (sonIdx - 1)
            sNotInLMinusM[iterNotInL] = gateIdx;
            vNotInL[iterNotInL] = _valuesKeccak[valueIdx];
            ++iterNotInL;
            ++valueIdx;
        }
    }
}
```

**Logique**:
- **L (ciphertext blocks)**: `sons[i] < 0` → `sInL[iterInL] = ctIdx - 1` (1-indexed → 0-indexed)
- **Not in L (gates)**: `sons[i] >= 0` → `sNotInLMinusM[iterNotInL] = gateIdx` où `gateIdx = sons[i] - 1`

## verifyCommitmentLeft (Step 8b)

### Ancien code
```solidity
function verifyCommitmentLeft(...) internal view returns (bool) {
    uint32[] memory gateNumArray = new uint32[](1);
    gateNumArray[0] = _gateNum;  // ⚠️ 0-indexed directement
    
    AccumulatorVerifier.verifyExt(
        1,           // ⚠️ i = 1
        "",          // ⚠️ prevRoot = "" (empty string)
        _currAcc,
        keccak256(gateRes),
        _proofExt
    );
}
```

### Nouveau code
```solidity
function verifyCommitmentLeft(...) internal view returns (bool) {
    uint32[] memory gateNumArray = new uint32[](1);
    gateNumArray[0] = _gateNum - 1;  // ✅ Convertit 1-indexed → 0-indexed
    
    AccumulatorVerifier.verifyExt(
        0,                    // ✅ i = 0 (Step 8b)
        bytes32(0),           // ✅ prevRoot = bytes32(0) (pas de précédent)
        _currAcc,
        keccak256(gateRes),
        _proofExt
    );
}
```

## Différences clés

### 1. Indexation
- **Ancien (V1)**: Utilise les indices **tels quels** (pas de conversion)
- **Nouveau (V2)**: Convertit **1-indexed → 0-indexed** pour les indices ciphertext et gates

### 2. Format des fils
- **Ancien (V1)**: `uint32[]` avec flag de constante
- **Nouveau (V2)**: `int64[]` où négatifs = ciphertext, positifs = gates

### 3. Extraction des non-constants
- **Ancien (V1)**: Filtre `!isConstantIdx(_gate[i])`
- **Nouveau (V2)**: Filtre `sons[i] < 0` (ciphertext blocks uniquement)

### 4. verifyExt pour Step 8b
- **Ancien (V1)**: `i = 1`, `prevRoot = ""`
- **Nouveau (V2)**: `i = 0`, `prevRoot = bytes32(0)`

## Conclusion

**❌ NON, la logique n'est PAS identique**, mais elle est **cohérente avec le format V2** :

1. Le nouveau code convertit systématiquement **1-indexed → 0-indexed** pour correspondre aux preuves Merkle générées par Rust (qui utilisent des arrays 0-indexed).

2. Le format V2 utilise des indices signés (`int64`) au lieu de flags de constante, ce qui simplifie la logique mais nécessite des conversions différentes.

3. Le nouveau code est aligné avec le code Rust/WASM qui génère les preuves, garantissant la cohérence entre le frontend (WASM) et le smart contract (Solidity).

