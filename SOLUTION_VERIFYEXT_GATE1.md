# Solution pour verifyExt gate 1

## Problème

Pour la gate 1, `verifyExt` est appelé avec `prevRoot = bytes32(0)` et `proof_ext` qui devrait être vide (car `prove_ext` avec un seul élément génère une preuve vide).

Dans `verifyPrevious`, si la preuve est vide, `computedRoot` reste non initialisé (donc `bytes32(0)`), et `return computedRoot == prevRoot` devrait retourner `true`.

Cependant, l'erreur `TransactionReverted()` se produit, ce qui suggère qu'une assertion/revert se produit quelque part.

## Solution potentielle

Pour la gate 1, `verifyExt` ne devrait peut-être pas vérifier le `prevRoot` puisque c'est la première gate (i=1) et qu'il n'y a pas de w_0.

Ou bien, le problème vient du fait que `verifyExt` appelle `verify(currRoot, iArr, addedValKeccakArr, proof)` puis `verifyPrevious(prevRoot, proof)`, et si la preuve est vide, `verify` pourrait échouer.

Vérifier si `verify` gère correctement les preuves vides ou les preuves avec un seul élément.
