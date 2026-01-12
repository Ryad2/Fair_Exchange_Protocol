import { ethers } from "hardhat";
import {
    initSync,
    compute_proofs_left_v2,
    bytes_to_hex,
    compute_precontract_values_v2,
    evaluate_circuit_v2_wasm,
} from "../../app/lib/crypto_lib/crypto_lib";
import { join } from "path";
import { readFileSync } from "fs";

/**
 * Script pour comparer la conversion des indices entre l'ancien et le nouveau code
 */
async function main() {
    console.log("🔍 COMPARAISON: Conversion des indices pour proof2");
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

    // Calculate proofs for gate 1
    const gateNum = 1;
    const proofs = compute_proofs_left_v2(
        circuit,
        evaluatedCircuitBytes,
        ct,
        gateNum
    );

    // Prepare arguments
    const gateBytesArray = new Uint8Array(proofs.gate_bytes);
    const valuesArray = proofs.values.map((v: Uint8Array) => new Uint8Array(v));

    // Deploy helpers
    const [deployer] = await ethers.getSigners();
    const DisputeSOXHelpersFactory = await ethers.getContractFactory("DisputeSOXHelpers");
    const helpers = await DisputeSOXHelpersFactory.deploy();
    await helpers.waitForDeployment();

    // Hash values
    const valuesKeccak: string[] = [];
    for (const value of valuesArray) {
        valuesKeccak.push(ethers.keccak256(ethers.hexlify(value)));
    }

    // Extract nonConstantSons
    const result = await helpers.extractNonConstantSons_V2(
        gateBytesArray,
        valuesKeccak
    );
    
    const nonConstantSons = result[0].map((x: bigint) => Number(x));
    
    // Calculate ct_blocks manually
    const numBlocks = Math.ceil((ct.length - 16) / 64);
    const ctBlocks: Uint8Array[] = [];
    let start = 16; // Skip IV
    for (let i = 0; i < numBlocks; i++) {
        const end = Math.min(start + 64, ct.length);
        const block = new Uint8Array(64);
        block.set(ct.slice(start, end), 0);
        ctBlocks.push(block);
        start = end;
    }
    
    console.log("🔍 ANALYSE DE LA CONVERSION DES INDICES:\n");
    console.log(`   numBlocks: ${numBlocks}`);
    console.log(`   ct_blocks count: ${ctBlocks.length}`);
    console.log();
    
    // Decode gate to see sons
    const EvaluatorSOX_V2Factory = await ethers.getContractFactory("EvaluatorSOX_V2");
    const evaluator = await EvaluatorSOX_V2Factory.deploy();
    await evaluator.waitForDeployment();
    
    // We can't call decodeGate directly, but we can analyze the logic
    console.log("📊 CORRESPONDANCE DES INDICES:\n");
    console.log("   Dans get_evaluated_sons_v2 (Rust):");
    console.log("   - Si son_idx = -1 → input_idx = (-(-1) - 1) = 0 → inputs[0] (premier bloc)");
    console.log("   - Si son_idx = -2 → input_idx = (-(-2) - 1) = 1 → inputs[1] (deuxième bloc)");
    console.log("   - Si son_idx = -3 → input_idx = (-(-3) - 1) = 2 → inputs[2] (troisième bloc)");
    console.log();
    
    console.log("   Dans split_sons_indices_v2 (Rust - utilisé par compute_proofs_v2):");
    console.log("   - Si s = -1 → ct_idx = (-(-1)) = 1 (1-indexed)");
    console.log("     → Si 1 >= 1 && 1 <= num_blocks, alors in_l.push(1 - 1) = in_l.push(0)");
    console.log("   - Si s = -2 → ct_idx = (-(-2)) = 2 (1-indexed)");
    console.log("     → Si 2 >= 1 && 2 <= num_blocks, alors in_l.push(2 - 1) = in_l.push(1)");
    console.log();
    
    console.log("   Dans l'ancien compute_proofs_left_v2 (Rust - AVANT correction):");
    console.log("   - Si s = -1 → block_indices = [(-(-1) - 1) = (1 - 1) = 0]");
    console.log("   - Si s = -2 → block_indices = [(-(-2) - 1) = (2 - 1) = 1]");
    console.log();
    
    console.log("   Dans _extractNonConstantSons_V2 (Solidity):");
    console.log("   - Si sons[i] = -1 → ctIdx = uint32(uint64(-(-1))) = 1");
    console.log("     → Si 1 >= 1 && 1 <= num_blocks, alors nonConstantSons[j] = 1 - 1 = 0");
    console.log("   - Si sons[i] = -2 → ctIdx = uint32(uint64(-(-2))) = 2");
    console.log("     → Si 2 >= 1 && 2 <= num_blocks, alors nonConstantSons[j] = 2 - 1 = 1");
    console.log();
    
    console.log("✅ CONCLUSION:");
    console.log("   Les deux approches donnent le même résultat:");
    console.log("   - son_idx = -1 → block index 0 (premier bloc)");
    console.log("   - son_idx = -2 → block index 1 (deuxième bloc)");
    console.log("   - son_idx = -3 → block index 2 (troisième bloc)");
    console.log();
    
    console.log("   La différence est que split_sons_indices_v2 FILTRE les indices invalides:");
    console.log("   - Si ct_idx > num_blocks, l'index n'est PAS inclus");
    console.log("   - L'ancien code incluait TOUS les indices négatifs sans vérification");
    console.log();
    
    console.log("   Solidity extrait:");
    console.log(`   - nonConstantSons: [${nonConstantSons.join(', ')}]`);
    console.log();
    
    // Test avec différents sons pour voir la différence
    console.log("🧪 TEST: Comparaison avec différents sons\n");
    const testSons = [-1, -2, -3, -4, -5];
    console.log("   Sons testés:", testSons);
    console.log();
    
    console.log("   Ancien code (compute_proofs_left_v2 - AVANT):");
    const oldBlockIndices = testSons
        .filter(s => s < 0)
        .map(s => -s - 1);
    console.log(`     block_indices: [${oldBlockIndices.join(', ')}]`);
    console.log();
    
    console.log("   Nouveau code (split_sons_indices_v2 - APRÈS):");
    const newBlockIndices: number[] = [];
    for (const s of testSons) {
        if (s < 0) {
            const ctIdx = -s; // 1-indexed
            if (ctIdx >= 1 && ctIdx <= numBlocks) {
                newBlockIndices.push(ctIdx - 1); // Convert to 0-indexed
            }
        }
    }
    console.log(`     s_in_l: [${newBlockIndices.join(', ')}]`);
    console.log();
    
    if (JSON.stringify(oldBlockIndices) === JSON.stringify(newBlockIndices)) {
        console.log("   ✅ Les deux approches donnent le même résultat pour ces sons\n");
    } else {
        console.log("   ⚠️  Les deux approches donnent des résultats DIFFÉRENTS!\n");
        console.log("   💡 Cela signifie que certains sons ont des indices invalides (> num_blocks)\n");
    }

    console.log("=".repeat(80));
    console.log("✅ COMPARAISON TERMINÉE");
    console.log("=".repeat(80));
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});

