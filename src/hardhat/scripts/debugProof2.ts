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
 * Script pour déboguer pourquoi proof2 échoue
 */
async function main() {
    console.log("🔍 DEBUG: Pourquoi proof2 échoue");
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
    console.log(`✅ Fichier lu: ${fileData.length} bytes\n`);

    // Generate a test key (16 bytes)
    const key = new Uint8Array(16);
    for (let i = 0; i < 16; i++) {
        key[i] = i + 1;
    }
    const keyHex = bytes_to_hex(key);
    console.log(`📊 AES Key: ${keyHex}\n`);

    // Compute precontract
    console.log("🔢 Calcul du precontract...");
    const precontract = compute_precontract_values_v2(fileData, key);
    const circuit = new Uint8Array(precontract.circuit_bytes);
    const ct = new Uint8Array(precontract.ct);
    const commitment = precontract.commitment;
    const openingValue = precontract.commitment.o;
    
    console.log(`✅ Precontract calculé:`);
    console.log(`   - Commitment: ${bytes_to_hex(commitment.c)}`);
    console.log(`   - Opening value: ${bytes_to_hex(openingValue)}\n`);

    // Evaluate circuit
    console.log("🔢 Évaluation du circuit...");
    const evaluatedCircuit = evaluate_circuit_v2_wasm(circuit, ct, keyHex);
    const evaluatedCircuitBytes = evaluatedCircuit.to_bytes();
    console.log(`✅ Circuit évalué (${evaluatedCircuitBytes.length} bytes)\n`);

    // Calculate proofs for gate 1
    const gateNum = 1; // Gate 1 (1-indexed, notation papier)
    console.log(`📐 Calcul des preuves pour gate ${gateNum} (1-indexed) avec WASM...\n`);

    const proofs = compute_proofs_left_v2(
        circuit,
        evaluatedCircuitBytes,
        ct,
        gateNum // 1-indexed, WASM convertit en interne
    );
    console.log(`✅ Preuves calculées par WASM:`);
    console.log(`   - gate_bytes: ${proofs.gate_bytes.length} bytes`);
    console.log(`   - values: ${proofs.values.length} éléments`);
    console.log(`   - proof2: ${proofs.proof2.length} layers\n`);

    // Analyze gate_bytes to understand what sons are in the gate
    const gateBytesArray = new Uint8Array(proofs.gate_bytes);
    console.log("🔍 ANALYSE DE LA GATE:");
    console.log(`   - gate_bytes (hex): ${bytes_to_hex(gateBytesArray).slice(0, 80)}...`);
    
    // Decode gate to see sons
    // We need to use EvaluatorSOX_V2.decodeGate, but we can't call it directly from here
    // Let's check the values instead
    console.log(`   - values count: ${proofs.values.length}`);
    for (let i = 0; i < proofs.values.length; i++) {
        const value = new Uint8Array(proofs.values[i]);
        console.log(`     values[${i}]: ${ethers.hexlify(value).slice(0, 40)}... (${value.length} bytes)`);
    }
    console.log();

    // Prepare arguments for contract
    const valuesArray = proofs.values.map((v: Uint8Array) => new Uint8Array(v));
    const proof2Array = proofs.proof2.map((level: Uint8Array[]) =>
        level.map((v: Uint8Array) => ethers.hexlify(new Uint8Array(v)))
    );

    // Deploy test contracts (simplified - just for testing extractNonConstantSons)
    console.log("📦 Déploiement des contrats de test...\n");
    
    const [deployer] = await ethers.getSigners();
    
    // Deploy DisputeSOXHelpers to test extractNonConstantSons_V2
    const DisputeSOXHelpersFactory = await ethers.getContractFactory("DisputeSOXHelpers");
    const helpers = await DisputeSOXHelpersFactory.deploy();
    await helpers.waitForDeployment();
    console.log(`✅ DisputeSOXHelpers: ${await helpers.getAddress()}\n`);

    // Hash values
    const valuesKeccak: string[] = [];
    for (const value of valuesArray) {
        valuesKeccak.push(ethers.keccak256(ethers.hexlify(value)));
    }
    console.log("🔍 VALEURS KECCAK:");
    for (let i = 0; i < valuesKeccak.length; i++) {
        console.log(`   valuesKeccak[${i}]: ${valuesKeccak[i]}`);
    }
    console.log();

    // Test extractNonConstantSons_V2
    console.log("🔍 TEST: extractNonConstantSons_V2");
    try {
        const result = await helpers.extractNonConstantSons_V2(
            gateBytesArray,
            valuesKeccak
        );
        console.log(`   ✅ Résultat:`);
        console.log(`      - nonConstantSons: [${result[0].map((x: bigint) => Number(x)).join(', ')}]`);
        console.log(`      - nonConstantValuesKeccak count: ${result[1].length}`);
        for (let i = 0; i < result[1].length; i++) {
            console.log(`        [${i}]: ${result[1][i]}`);
        }
        console.log();
        
        // Compare with what WASM generated for proof2
        console.log("🔍 COMPARAISON:");
        console.log(`   - WASM proof2 layers: ${proof2Array.length}`);
        console.log(`   - Solidity nonConstantSons: [${result[0].map((x: bigint) => Number(x)).join(', ')}]`);
        console.log(`   - Solidity nonConstantValuesKeccak: ${result[1].length} valeurs\n`);
        
        // Check if indices are 0-indexed
        console.log("💡 ANALYSE:");
        console.log(`   Dans Rust (compute_proofs_left_v2):`);
        console.log(`   - proof2 = prove(&ct_blocks, &block_indices)`);
        console.log(`   - block_indices sont 0-indexed (car ct_blocks est un array 0-indexed)\n`);
        
        console.log(`   Dans Solidity (_extractNonConstantSons_V2):`);
        console.log(`   - nonConstantSons[j] = ctIdx - 1 (conversion 1→0)`);
        console.log(`   - Cela devrait correspondre aux block_indices de Rust\n`);
        
        // Check if the issue is with numBlocks
        const numBlocks = Math.ceil((ct.length - 16) / 64);
        console.log(`   - numBlocks estimé: ${numBlocks}`);
        console.log(`   - ct.length: ${ct.length} bytes`);
        console.log(`   - ct.length - 16 (sans IV): ${ct.length - 16} bytes\n`);
        
    } catch (error: any) {
        console.error(`   ❌ Erreur: ${error.message}\n`);
    }

    console.log("=".repeat(80));
    console.log("✅ DEBUG TERMINÉ");
    console.log("=".repeat(80));
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});

