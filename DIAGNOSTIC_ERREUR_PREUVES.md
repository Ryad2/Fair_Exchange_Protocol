# Diagnostic de l'erreur `TransactionReverted()` (0x9167c27a)

## Résumé

L'erreur `TransactionReverted()` avec le selector `0x9167c27a` se produit lors de l'envoi des preuves (`submitCommitment*`). Cette erreur indique qu'un appel interne au contrat a échoué.

## Causes possibles

### 1. Vérification de preuve échouée
- Les preuves fournies ne sont pas valides
- Les valeurs attendues ne correspondent pas aux valeurs calculées
- Les indices des gates sont incorrects

### 2. État du contrat incorrect
- Le buyer n'a pas répondu aux challenges requis
- L'état du contrat n'est pas celui attendu (WaitVendorData, WaitVendorDataLeft, ou WaitVendorDataRight)
- `buyerResponses[numGates]` n'est pas défini (pour `submitCommitmentRight`)

### 3. Données incorrectes
- Le format des preuves est incorrect
- Les valeurs calculées (gateRes, values, etc.) ne correspondent pas aux preuves

## Diagnostic

### Étape 1: Vérifier l'état du contrat de dispute

Pour obtenir l'adresse du contrat de dispute depuis l'interface frontend ou la base de données, puis:

```bash
cd src/hardhat
DISPUTE_ADDR=<ADRESSE_DU_CONTRAT_DISPUTE> npx hardhat run scripts/diagnoseProofSubmission.ts
```

### Étape 2: Vérifier les réponses du buyer

Le script de diagnostic vérifiera:
- L'état actuel du contrat
- Les réponses du buyer pour chaque challenge
- Les conditions nécessaires pour envoyer les preuves

### Étape 3: Vérifier les preuves générées

Assurez-vous que:
- Les preuves sont générées avec les bons paramètres (numBlocks, numGates)
- Le circuit évalué correspond au circuit utilisé pour le commitment initial
- Les indices des gates sont corrects (0-indexed pour les preuves, 1-indexed pour le contrat)

## Solutions

### Pour `submitCommitmentRight`
1. Vérifier que le buyer a répondu pour le challenge `numGates`
2. Vérifier que `buyerResponses[numGates]` est défini (non-zero)
3. Vérifier que la preuve est générée pour le bon gate (index `numGates - 1` en 0-indexed)
4. Vérifier que la valeur attendue est `keccak256([0x01, 0x00, ..., 0x00])` (64 bytes)

### Pour `submitCommitment` et `submitCommitmentLeft`
1. Vérifier que le buyer a répondu pour les challenges requis
2. Vérifier que les preuves sont générées avec les bons paramètres
3. Vérifier que les valeurs calculées correspondent aux preuves

## Commandes utiles

```bash
# Obtenir l'adresse du contrat de dispute depuis OptimisticSOXAccount
cd src/hardhat
OPTIMISTIC_ADDR=<ADRESSE_OPTIMISTIC> npx hardhat run scripts/getDisputeFromOptimistic.ts

# Diagnostiquer le contrat de dispute
DISPUTE_ADDR=<ADRESSE_DISPUTE> npx hardhat run scripts/diagnoseProofSubmission.ts

# Vérifier l'état du contrat
DISPUTE_ADDR=<ADRESSE_DISPUTE> npx hardhat run scripts/checkDisputeState.ts
```
