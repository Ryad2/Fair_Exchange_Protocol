# Analyse de verifyExt pour la gate 1

## Problème identifié

L'erreur `TransactionReverted()` se produit lors de `submitCommitmentLeft` pour la gate 1, mais `submitCommitmentRight` fonctionne. La différence principale est dans `verifyExt` :

### Pour submitCommitmentLeft (gate 1):
```solidity
AccumulatorVerifier.verifyExt(
    0,              // i = 0 (gate 0 en 0-indexed)
    bytes32(0),     // prevRoot = 0 (pas de w_{i-1} car i=1)
    _currAcc,       // currRoot = w_1
    keccak256(gateRes),
    _proofExt
)
```

### Pour submitCommitment (gate > 1):
```solidity
AccumulatorVerifier.verifyExt(
    _gateNum - 1,   // i (gate index en 0-indexed)
    buyerResponses[_gateNum - 1],  // prevRoot = w_{i-1} (défini)
    _currAcc,       // currRoot = w_i
    keccak256(gateRes),
    _proofExt
)
```

## Fonction verifyPrevious

`verifyExt` appelle `verifyPrevious(prevRoot, proof)` qui calcule un root depuis la preuve et le compare à `prevRoot` :

```solidity
function verifyPrevious(
    bytes32 prevRoot,
    bytes32[][] calldata proof
) internal pure returns (bool) {
    bool firstFound = false;
    bytes32 computedRoot;
    for (uint32 i = 0; i < proof.length; i++) {
        uint256 nextElementPlusOne = proof[i].length;
        while (nextElementPlusOne > 0) {
            if (!firstFound) {
                computedRoot = proof[i][nextElementPlusOne - 1];
                nextElementPlusOne--;
                firstFound = true;
            } else {
                computedRoot = keccak256(
                    bytes.concat(
                        proof[i][nextElementPlusOne - 1],
                        computedRoot
                    )
                );
                nextElementPlusOne--;
            }
        }
    }
    return computedRoot == prevRoot;
}
```

## Problème potentiel

Pour la gate 1 avec `prevRoot = bytes32(0)`, `verifyPrevious` doit calculer `computedRoot == bytes32(0)`.

Si `proof_ext` est vide ou mal formée, `verifyPrevious` pourrait :
1. Retourner `false` si `computedRoot != bytes32(0)`
2. Causer un revert si la preuve est mal formatée

## Solution

Vérifier que `compute_proofs_left_v2` génère correctement `proof_ext` pour la gate 1 avec `prevRoot = 0`.

La preuve `proof_ext` doit permettre à `verifyPrevious(bytes32(0), proof_ext)` de retourner `true`.

Si la preuve est vide (car il n'y a pas de w_0), `verifyPrevious` devrait retourner `false` au lieu de `true`, ce qui causerait l'échec de `verifyExt`.

Peut-être que pour la gate 1, `verifyExt` ne devrait pas vérifier le `prevRoot` puisque c'est la première gate (i=1) et qu'il n'y a pas de w_0 ?
