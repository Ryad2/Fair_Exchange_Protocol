# Analyse du problème de dispute - Vendor perd alors que fichiers identiques

## Problème
Le buyer et le vendor ont envoyé le même fichier encrypté (test_65bytes.bin), mais la dispute a déclaré que le vendor a perdu (Cancel).

## Logique attendue
Si les fichiers sont identiques :
- La gate COMP finale devrait retourner `0x01` (true)
- `buyerResponses[numGates]` devrait contenir le hash de `0x01` à l'index `numGates - 1`
- `AccumulatorVerifier.verify` devrait retourner `true`
- Le vendor devrait gagner (Complete)

## Code actuel

### `submitCommitmentRight` (DisputeSOXAccount.sol:744-768)
```solidity
function submitCommitmentRight(bytes32[][] memory _proof) {
    bytes memory trueBytes = hex"01";
    bytes32[] memory trueKeccakArr = new bytes32[](1);
    trueKeccakArr[0] = keccak256(trueBytes);

    uint32[] memory idxArr = new uint32[](1);
    idxArr[0] = numGates - 1;

    if (AccumulatorVerifier.verify(
        buyerResponses[numGates],
        idxArr,
        trueKeccakArr,
        _proof
    )) {
        // Vendor wins, buyer loses
        handleStep9(false); // false = buyer lost → Complete
    } else {
        // Buyer wins, vendor loses
        handleStep9(true); // true = vendor lost → Cancel
    }
}
```

### `compute_proof_right_v2` (lib.rs:1113-1157)
```rust
pub fn compute_proof_right_v2(
    evaluated_circuit_bytes: &[u8],
    num_blocks: u32,
    num_gates: u32,
) -> Array {
    let evaluated = EvaluatedCircuitV2::from_bytes(evaluated_circuit_bytes);
    let gate_outputs = &evaluated.values[num_blocks_usize..];
    let actual_num_gates = gate_outputs.len();
    let last_gate_idx = (actual_num_gates - 1) as u32;
    
    proof_to_js_array(prove(
        gate_outputs,
        &[last_gate_idx],
    ))
}
```

## Points à vérifier

1. **buyerResponses[numGates] est-il correct ?**
   - Le buyer a-t-il bien envoyé sa réponse pour `chall = numGates + 1` ?
   - `buyerResponses[numGates]` est-il l'accumulateur correct ?

2. **La preuve est-elle générée correctement ?**
   - `compute_proof_right_v2` génère-t-elle la preuve pour la bonne gate ?
   - L'index utilisé (`last_gate_idx = numGates - 1`) correspond-il à celui vérifié dans le contrat ?

3. **Les fichiers sont-ils vraiment identiques ?**
   - Le buyer et le vendor utilisent-ils exactement le même ciphertext ?
   - Le même circuit est-il utilisé ?
   - Le même `evaluated_circuit` est-il utilisé ?

4. **La gate COMP finale retourne-t-elle bien 0x01 ?**
   - Si les fichiers sont identiques, `evalCOMP` devrait retourner `0x01` dans le premier byte
   - Le hash de `0x01` devrait être dans l'accumulateur

## Actions recommandées

1. Ajouter des logs/debug dans `submitCommitmentRight` pour voir :
   - La valeur de `buyerResponses[numGates]`
   - Le résultat de `AccumulatorVerifier.verify`
   - La valeur de `trueKeccakArr[0]`

2. Vérifier que `compute_proof_right_v2` utilise bien `num_gates` (pas `actual_num_gates`) pour être cohérent avec le contrat

3. Vérifier que le buyer envoie bien la bonne réponse pour `chall = numGates + 1`


