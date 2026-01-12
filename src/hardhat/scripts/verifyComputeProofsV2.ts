import { ethers } from "hardhat";
import {
    initSync,
    compute_proofs_v2,
    bytes_to_hex,
    compute_precontract_values_v2,
    evaluate_circuit_v2_wasm,
} from "../../app/lib/crypto_lib/crypto_lib";
import { join } from "path";
import { readFileSync } from "fs";

/**
 * Script pour vérifier si compute_proofs_v2 génère proof2 avec ou sans IV
 */
async function main() {
    console.log("🔍 VÉRIFICATION: compute_proofs_v2 et proof2");
    console.log("=".repeat(80));
    console.log("📁 Fichier: test_65bytes.bin\n");

    // Initialize WASM
    const wasmPath = join(__dirname, "../../app/lib/crypto_lib/crypto_lib_bg.wasm");
    const wasmBytes = readFileSync(wasmPath);
    initSync({ module: wasmBytes });
    console.log("✅ WASM initialisé\n");

    // Read test file
    const testFilePath = join(__dirname, "../../../test_65bytes.bin");
    const fileData = readFileSync(testFilePath);
    
    // Generate a test key (16 bytes)
    const key = new Uint8Array(16);
    for (let i = 0; i < 16; i++) {
        key[i] = i + 1;
    }
    const keyHex = bytes_to_hex(key);

    // Compute precontract
    const precontract = compute_precontract_values_v2(fileData, key);
    const circuit = new Uint8Array(precontract.circuit_bytes);
    const ct = new Uint8Array(precontract.ct);
    
    // Evaluate circuit
    const evaluatedCircuit = evaluate_circuit_v2_wasm(circuit, ct, keyHex);
    const evaluatedCircuitBytes = evaluatedCircuit.to_bytes();

    // Test with challenge = 259 (gate du milieu, comme dans le test)
    const challenge = 259;
    console.log(`🧪 TEST: compute_proofs_v2 avec challenge=${challenge}\n`);
    
    const proofs = compute_proofs_v2(
        circuit,
        evaluatedCircuitBytes,
        ct,
        challenge
    );

    console.log(`📊 RÉSULTATS:`);
    console.log(`   - proof1 layers: ${proofs.proof1.length}`);
    console.log(`   - proof2 layers: ${proofs.proof2.length}`);
    if (proofs.proof2.length > 0) {
        console.log(`   - proof2[0] length: ${proofs.proof2[0]?.length || 0} éléments`);
        console.log(`   ⚠️  proof2 est généré! Il faut vérifier s'il est avec ou sans IV.`);
    } else {
        console.log(`   ✅ proof2 est vide (pas de blocs de ciphertext utilisés)`);
        console.log(`   ✅ C'est pourquoi compute_proofs_v2 fonctionne sans décalage!`);
    }
    console.log(`   - proof3 layers: ${proofs.proof3.length}`);
    console.log(`   - proof_ext layers: ${proofs.proof_ext.length}`);
    console.log();

    // Test with challenge = 1 (première gate, comme compute_proofs_left_v2)
    const challenge1 = 1;
    console.log(`🧪 TEST: compute_proofs_v2 avec challenge=${challenge1}\n`);
    
    const proofs1 = compute_proofs_v2(
        circuit,
        evaluatedCircuitBytes,
        ct,
        challenge1
    );

    console.log(`📊 RÉSULTATS:`);
    console.log(`   - proof1 layers: ${proofs1.proof1.length}`);
    console.log(`   - proof2 layers: ${proofs1.proof2.length}`);
    if (proofs1.proof2.length > 0) {
        console.log(`   - proof2[0] length: ${proofs1.proof2[0]?.length || 0} éléments`);
        console.log(`   ⚠️  proof2 est généré pour challenge=1!`);
        console.log(`   ⚠️  Il faut vérifier si compute_proofs_v2 génère proof2 AVEC ou SANS IV.`);
    } else {
        console.log(`   ✅ proof2 est vide`);
    }
    console.log(`   - proof3 layers: ${proofs1.proof3.length}`);
    console.log(`   - proof_ext layers: ${proofs1.proof_ext.length}`);
    console.log();

    console.log("=".repeat(80));
    console.log("✅ VÉRIFICATION TERMINÉE");
    console.log("=".repeat(80));
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});


