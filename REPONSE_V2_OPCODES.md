# Réponses aux questions sur le codage V2

## 1. Porte AES et boîte en pointillés

**Porte AES-CTR (opcode 0x01) :**

La porte AES-CTR fonctionne en mode Counter (CTR) pour déchiffrer un bloc de ciphertext :

- **Entrée (1 son)** : Un bloc de ciphertext (minimum 32 bytes, normalisé à 64 bytes)
- **Paramètres (18 bytes)** :
  - Counter : 16 bytes (valeur initiale du compteur pour le mode CTR)
  - Length : 2 bytes (big-endian) - longueur en bits du message valide à déchiffrer
- **Clé AES** : 16 bytes (fournie séparément, pas dans la gate)

**Fonctionnement :**
1. Le ciphertext est normalisé à 64 bytes (padding avec zéros si nécessaire)
2. Le mode CTR fonctionne en chiffrant le counter avec AES pour générer un keystream
3. Le keystream est XORé avec le ciphertext pour obtenir le plaintext
4. Si plusieurs blocs de 16 bytes sont nécessaires, le counter est incrémenté pour chaque bloc
5. Si `lengthBits < 512`, les bytes au-delà de la longueur valide sont mis à zéro

```solidity
// Code Solidity (EvaluatorSOX_V2.sol:282-351)
// AES-CTR decrypts by encrypting the counter and XORing with ciphertext
bytes16 keystream = AES128CtrEvaluator.encryptBlockInternal(currentCounter, aesKey);
plaintext[i] = ciphertext[i] ^ keystream[i];
```

**La "boîte en pointillés"** sur la Figure 1 fait probablement référence au fait que l'AES-CTR prend le ciphertext comme entrée (peut être un bloc partiel), le normalise à 64 bytes, puis déchiffre uniquement les bits valides (selon `lengthBits`), en mettant à zéro le reste.

---

## 2. SHA256 avec entrée IV ou sans entrée IV ?

**SHA2 (opcode 0x02) supporte deux modes selon l'arity :**

### Arity 1 (sans IV explicite) :
- **Entrée** : 1 son de 64 bytes (bloc de données à compresser)
- **Fonctionnement** : Utilise l'IV par défaut de SHA-256 (les constantes initiales standard : `0x6a09e667, 0xbb67ae85, ...`)
- **Code Rust** (`circuits_v2.rs:561-565`):
  ```rust
  // SHA2 arity 1: compression SHA2 de IV et de l'entrée de 64B
  // sha256_compress with 1 element uses default IV (SHA256 constants)
  sha256_compress(&vec![&normalize_64(sons[0].clone())])
  ```

### Arity 2 (avec hash précédent comme IV) :
- **Entrée 1** : 32 bytes (hash précédent, tronqué depuis les 32 premiers bytes du premier son)
- **Entrée 2** : 64 bytes (bloc de données à compresser)
- **Fonctionnement** : Utilise le hash précédent (tronqué à 32B) comme "IV" au lieu des constantes initiales
- **Code Rust** (`circuits_v2.rs:566-575`):
  ```rust
  // SHA2 arity 2: compression SHA2 de l'entrée 1 réduite sur 32B avec l'entrée 2 de 64B
  // compress(truncate32(in1) || in2)
  let prev_hash = in1_norm[..32].to_vec(); // truncate32(in1)
  sha256_compress(&vec![&prev_hash, &in2_norm])
  ```

**En résumé :**
- **Arity 1** : Utilise l'IV par défaut de SHA-256 (constantes initiales)
- **Arity 2** : Utilise le premier son (32B) comme hash précédent (remplace l'IV)

Cette approche permet de chaîner plusieurs compressions SHA-256 (comme dans une chaîne de hachage).

---

## 3. XOR avec un CONST de 32B et un Cn de 64B

**CONST (opcode 0x03) :**

Le gate CONST produit toujours 64 bytes en sortie :

- **Arity 0 ou 1** : `output = params[0..32] || zeros[32..64]`
  - Les 32 premiers bytes viennent des params
  - Les 32 derniers bytes sont des zéros
  
- **Arity 2** : `output = sons[0][0..32] || params[0..32]`
  - Les 32 premiers bytes viennent du premier son (tronqué à 32B)
  - Les 32 derniers bytes viennent des params

**XOR (opcode 0x04) :**

Le gate XOR prend 2 sons et effectue :
1. XOR bit-à-bit jusqu'à la longueur minimale des deux entrées
2. Copie les bytes restants de l'entrée la plus longue

```solidity
// Code Solidity (EvaluatorSOX_V2.sol:416-444)
// XOR up to the minimum length
for (uint256 i = 0; i < minLen; i++) {
    result[i] = bytes1(uint8(sons[0][i]) ^ uint8(sons[1][i]));
}
// Copy remaining bytes from the longer input
if (sons[1].length > sons[0].length) {
    for (uint256 i = minLen; i < maxLen; i++) {
        result[i] = sons[1][i];
    }
}
```

**Exemple concret : XOR(CONST 32B, Cn 64B)**

Supposons :
- `CONST` avec arity 0/1 produit : `[params_0..31] || [0..0]` (64 bytes)
- `Cn` est un bloc de ciphertext de 64 bytes

Alors `XOR(CONST, Cn)` :
1. XOR les 64 premiers bytes de CONST avec les 64 bytes de Cn
2. Résultat : `[params_0..31 ^ Cn_0..31] || [0 ^ Cn_32..63]` = `[params_0..31 ^ Cn_0..31] || [Cn_32..63]`

**Note :** En pratique, dans le circuit V2, les gates CONST avec arity 0/1 produisent déjà 64 bytes (32B params + 32B zéros), donc XOR avec un Cn de 64B fonctionne naturellement. Si CONST avait vraiment seulement 32 bytes (ce qui n'arrive pas avec l'implémentation actuelle), XOR copierait les 32 bytes restants de Cn.

---

## Références dans le code

- **EvaluatorSOX_V2.sol** : `/Applications/sox_implementation/src/hardhat/contracts/EvaluatorSOX_V2.sol`
- **circuits_v2.rs** : `/Applications/sox_implementation/src/wasm/src/circuits_v2.rs`
- **SHA256Evaluator.sol** : `/Applications/sox_implementation/src/hardhat/contracts/SHA256Evaluator.sol`
- **AES128CtrEvaluator.sol** : `/Applications/sox_implementation/src/hardhat/contracts/AES128CtrEvaluator.sol`



