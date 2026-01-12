# Analyse du problème sur la gate 1 (submitCommitmentLeft)

## Résumé

L'erreur `TransactionReverted()` (0x9167c27a) se produit lors de l'envoi des preuves pour la gate 1, ce qui signifie que `submitCommitmentLeft` est appelé.

## Causes possibles

### 1. Opening value incorrect
Si l'opening value ne correspond pas au commitment, `CommitmentOpener.open()` revert avec le message "Commitment and opening value do not match". Cela causerait un revert de la transaction, mais pas nécessairement `TransactionReverted()`.

**Vérification**: Assurez-vous que l'opening value utilisé correspond au commitment initial.

### 2. Vérifications de preuve échouées
Les vérifications suivantes doivent toutes réussir:
- `_currAcc != buyerResponses[_gateNum]`
- `AccumulatorVerifier.verify(hCircuitCt[0], gateNumArray, gateKeccak, _proof1)`
- `AccumulatorVerifier.verify(hCircuitCt[1], nonConstantSons, nonConstantValuesKeccak, _proof2)`
- `AccumulatorVerifier.verifyExt(0, bytes32(0), _currAcc, keccak256(gateRes), _proofExt)`

Si une de ces vérifications échoue, `verifyCommitmentLeft` retourne `false`, et le vendor perd. Mais cela ne causerait pas `TransactionReverted()`.

### 3. Problème avec l'appel externe
`getAesKey()` appelle `optimisticContract.key()`, qui est un appel externe. Si cet appel échoue (par exemple, si la clé n'est pas encore définie), cela causerait un revert.

**Vérification**: Assurez-vous que la clé AES est définie dans le contrat OptimisticSOXAccount.

### 4. Problème avec l'indice de la gate
Pour la gate 1 (1-indexed), l'indice utilisé pour `AccumulatorVerifier.verify` est `_gateNum - 1 = 0` (0-indexed). Si les preuves sont générées avec un mauvais indice, les vérifications échoueront.

**Vérification**: Assurez-vous que `compute_proofs_left_v2` est appelé avec `challenge = 1` et que les preuves sont générées pour la gate 0 (0-indexed).

## Actions recommandées

1. **Vérifier l'opening value**: Assurez-vous qu'il correspond au commitment initial
2. **Vérifier la clé AES**: Assurez-vous qu'elle est définie dans le contrat OptimisticSOXAccount
3. **Vérifier les paramètres**: Assurez-vous que `gateNum` est bien `1` et que les preuves sont générées pour la gate 0 (0-indexed)
4. **Vérifier l'état du contrat**: Assurez-vous que le contrat est dans l'état `WaitVendorDataLeft` (3)
5. **Vérifier les réponses du buyer**: Assurez-vous que `buyerResponses[1]` est défini

## Script de diagnostic

```bash
cd src/hardhat
DISPUTE_ADDR=<ADRESSE_DISPUTE> npx hardhat run scripts/diagnoseProofSubmission.ts
```
