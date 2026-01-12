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
 * Script pour tester proof2 en calculant le root manuellement
 * et en vérifiant si les indices correspondent
 */
async function main() {
    console.log("🔍 TEST: proof2 avec calcul manuel du root");
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
    const commitment = precontract.commitment;
    const openingValue = precontract.commitment.o;
    const h_ct = precontract.h_ct;
    
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
    const proof2Array = proofs.proof2.map((level: Uint8Array[]) =>
        level.map((v: Uint8Array) => ethers.hexlify(new Uint8Array(v)))
    );

    // Calculate blocks
    const numBlocks = Math.ceil((ct.length - 16) / 64);
    const ctBlocksWithIV: Uint8Array[] = [];
    ctBlocksWithIV.push(new Uint8Array(ct.slice(0, 16))); // IV
    let start = 16;
    for (let i = 0; i < numBlocks; i++) {
        const end = Math.min(start + 64, ct.length);
        const block = new Uint8Array(64);
        block.set(ct.slice(start, end), 0);
        ctBlocksWithIV.push(block);
        start = end;
    }

    const ctBlocksWithoutIV: Uint8Array[] = [];
    start = 16;
    for (let i = 0; i < numBlocks; i++) {
        const end = Math.min(start + 64, ct.length);
        const block = new Uint8Array(64);
        block.set(ct.slice(start, end), 0);
        ctBlocksWithoutIV.push(block);
        start = end;
    }

    // Hash values
    const valuesKeccak: string[] = [];
    for (const value of valuesArray) {
        valuesKeccak.push(ethers.keccak256(ethers.hexlify(value)));
    }

    // Simulate _extractNonConstantSons_V2 logic
    // For gate 1, sons[0] is typically -1 (first block)
    // ctIdx = -(-1) = 1
    // nonConstantSons[0] = ctIdx = 1 (with our fix)
    const nonConstantSons = [1]; // First block, index 1 in ctBlocksWithIV
    const nonConstantValuesKeccak = valuesKeccak;

    console.log("📊 DONNÉES:");
    console.log(`   Root hCt (depuis precontract): ${ethers.hexlify(h_ct)}`);
    console.log(`   nonConstantSons: [${nonConstantSons.join(', ')}]`);
    console.log(`   nonConstantValuesKeccak[0]: ${nonConstantValuesKeccak[0]}`);
    console.log(`   ctBlocksWithIV[${nonConstantSons[0]}]: ${ethers.keccak256(ethers.hexlify(ctBlocksWithIV[nonConstantSons[0]])).slice(0, 20)}...`);
    console.log();

    // Deploy AccumulatorVerifier
    const [deployer] = await ethers.getSigners();
    const AccumulatorVerifierFactory = await ethers.getContractFactory("AccumulatorVerifier");
    const accumulatorVerifier = await AccumulatorVerifierFactory.deploy();
    await accumulatorVerifier.waitForDeployment();

    // Test verification
    console.log("🧪 TEST DE VÉRIFICATION:\n");
    try {
        const verifyResult = await accumulatorVerifier.verify.staticCall(
            ethers.hexlify(h_ct),
            nonConstantSons,
            nonConstantValuesKeccak,
            proof2Array
        );
        
        if (verifyResult) {
            console.log("✅✅✅ SUCCÈS! ✅✅✅");
            console.log(`   AccumulatorVerifier.verify retourne: ${verifyResult}\n`);
        } else {
            console.log("❌ ÉCHEC:");
            console.log(`   AccumulatorVerifier.verify retourne: ${verifyResult}\n`);
        }
    } catch (error: any) {
        console.error(`❌ Erreur: ${error.message}\n`);
    }

    // Test with index 0 (without IV fix)
    console.log("🧪 TEST AVEC INDEX 0 (sans fix):\n");
    try {
        const verifyResult0 = await accumulatorVerifier.verify.staticCall(
            ethers.hexlify(h_ct),
            [0],
            nonConstantValuesKeccak,
            proof2Array
        );
        console.log(`   Avec index 0: ${verifyResult0 ? '✅' : '❌'}\n`);
    } catch (error: any) {
        console.log(`   Avec index 0: ❌ ${error.message.slice(0, 50)}...\n`);
    }

    console.log("=".repeat(80));
    console.log("✅ TEST TERMINÉ");
    console.log("=".repeat(80));
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});


