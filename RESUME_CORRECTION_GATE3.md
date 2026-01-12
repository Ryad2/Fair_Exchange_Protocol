# Résumé de la correction pour la gate 3

## Problème identifié

Pour la gate 3 (et toutes les gates > 1), `submitCommitment` utilise:
- `buyerResponses[_gateNum - 1]` pour `proof3` et `verifyExt` (pour la gate 3, c'est `buyerResponses[2]`)
- `buyerResponses[_gateNum]` pour la condition `w_i != w'_i` (pour la gate 3, c'est `buyerResponses[3]`)

Si ces valeurs ne sont pas définies (le buyer n'a pas répondu aux challenges requis), les vérifications échouent silencieusement, causant l'erreur `TransactionReverted()`.

## Correction appliquée

Ajout de vérifications explicites dans `submitCommitment` (dans `DisputeSOXAccount.sol` et `DisputeSOX.sol`) pour s'assurer que:
1. `buyerResponses[_gateNum - 1]` est défini (non-zero) avant utilisation
2. `buyerResponses[_gateNum]` est défini (non-zero) avant utilisation

Ces vérifications permettront d'identifier clairement si le problème vient du fait que le buyer n'a pas répondu aux challenges requis.

## Pour la gate 3 spécifiquement

Le buyer doit avoir répondu pour:
- Challenge 2 (pour `buyerResponses[2]`, utilisé dans `proof3` et `verifyExt`)
- Challenge 3 (pour `buyerResponses[3]`, utilisé dans la condition `w_3 != w'_3`)

## Prochaines étapes

1. Recompiler les contrats
2. Redéployer les contrats si nécessaire
3. Tester avec un contrat de dispute où le buyer a bien répondu aux challenges 2 et 3
