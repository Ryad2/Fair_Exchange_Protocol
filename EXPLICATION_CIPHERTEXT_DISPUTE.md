# Quel ciphertext utiliser dans la dispute ?

## Réponse courte
**OUI, c'est le ciphertext échangé lors de la création du contrat (commitment).**

## Explication détaillée

### 1. Ciphertext utilisé dans la dispute
Le ciphertext utilisé dans la dispute est **celui qui a été envoyé dans le commitment initial** lors de la création du contrat.

- Le vendor chiffre le fichier plaintext avec une clé
- Le vendor génère un commitment (hash du circuit + hash du ciphertext)
- Le commitment est stocké dans le contrat OptimisticSOXAccount
- **Ce même ciphertext est utilisé pour tous les calculs de la dispute**

### 2. Pourquoi le vendor a perdu alors que les fichiers sont identiques ?

Si le vendor a perdu alors que les fichiers sont identiques, c'est probablement parce que :

**Problème 1 : Ciphertext différent**
- Le vendor utilise un ciphertext différent de celui du commitment
- Le buyer et le vendor utilisent des ciphertext différents
- **Solution :** Le vendor doit utiliser le MÊME ciphertext que celui utilisé pour générer le commitment

**Problème 2 : Calcul incorrect** (corrigé dans le code)
- Le code Rust utilisait `actual_num_gates` au lieu de `num_gates`
- **Solution :** Correction appliquée dans `compute_proof_right_v2`

**Problème 3 : Circuit évalué incorrect**
- Le `evaluated_circuit` doit être calculé avec :
  - Le MÊME ciphertext que celui du commitment
  - La MÊME clé que celle envoyée au buyer
  - Le MÊME circuit que celui utilisé pour le commitment

### 3. Comment vérifier que le bon ciphertext est utilisé ?

Pour le vendor dans la dispute :
1. Récupérer le ciphertext depuis `/api/files/{contractId}` (celui qui a été stocké lors de la création)
2. Utiliser ce ciphertext pour :
   - Compiler le circuit : `compile_circuit_v2_wasm(ct, description)`
   - Évaluer le circuit : `evaluate_circuit_v2_wasm(circuit, ct, key)`
   - Générer les preuves : `compute_proof_right_v2(evaluated_circuit, num_blocks, num_gates)`

### 4. Fichiers nécessaires pour la dispute

**Vendor doit avoir :**
- ✅ Le ciphertext original (celui du commitment) - **OBLIGATOIRE**
- ✅ La clé de chiffrement (celle envoyée au buyer)
- ✅ Le fichier plaintext original (pour référence, mais pas utilisé dans les calculs)

**Buyer doit avoir :**
- ✅ Le MÊME ciphertext que le vendor (reçu lors de la création du contrat)
- ✅ La clé de déchiffrement (reçue du vendor)
- ✅ Le fichier plaintext décrypté (pour référence)

### 5. Points critiques

⚠️ **IMPORTANT :** 
- Le ciphertext utilisé dans la dispute DOIT être identique à celui utilisé pour générer le commitment
- Si le vendor utilise un ciphertext différent, la dispute échouera même si les fichiers sont identiques
- Le buyer et le vendor doivent utiliser le MÊME ciphertext pour leurs calculs respectifs

### 6. Vérification dans le code

Dans `OngoingContractModal.tsx`, ligne 1092-1136, la fonction `getLargeData()` :
- Demande au vendor de sélectionner le fichier chiffré
- Utilise ce fichier pour compiler et évaluer le circuit
- **IMPORTANT :** Ce doit être le MÊME fichier que celui utilisé lors de la création du contrat

Si le vendor sélectionne un fichier différent, les calculs seront incorrects et la dispute échouera.


