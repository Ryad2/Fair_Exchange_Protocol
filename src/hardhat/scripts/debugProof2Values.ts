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
 * Script pour déboguer pourquoi proof2 échoue - focus sur les valeurs
 */
async function main() {
    console.log("🔍 DEBUG: Valeurs pour proof2");
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
    const nonConstantValuesKeccak = result[1];
    
    console.log("🔍 ANALYSE DES VALEURS:\n");
    console.log(`   WASM values:`);
    for (let i = 0; i < valuesArray.length; i++) {
        const value = valuesArray[i];
        const valueKeccak = ethers.keccak256(ethers.hexlify(value));
        console.log(`     values[${i}]: ${ethers.hexlify(value).slice(0, 40)}...`);
        console.log(`     keccak256(values[${i}]): ${valueKeccak}`);
    }
    console.log();
    
    console.log(`   Solidity nonConstantValuesKeccak:`);
    for (let i = 0; i < nonConstantValuesKeccak.length; i++) {
        console.log(`     [${i}]: ${nonConstantValuesKeccak[i]}`);
    }
    console.log();
    
    // Calculate ct_blocks manually to see what values should be
    const numBlocks = Math.ceil((ct.length - 16) / 64);
    console.log(`   Ciphertext blocks (calculés manuellement):`);
    const ctBlocks: Uint8Array[] = [];
    let start = 16; // Skip IV
    for (let i = 0; i < numBlocks; i++) {
        const end = Math.min(start + 64, ct.length);
        const block = new Uint8Array(64);
        block.set(ct.slice(start, end), 0);
        ctBlocks.push(block);
        const blockKeccak = ethers.keccak256(ethers.hexlify(block));
        console.log(`     Block ${i} (0-indexed): ${blockKeccak}`);
        start = end;
    }
    console.log();
    
    // Compare
    console.log("🔍 COMPARAISON:\n");
    console.log(`   nonConstantSons: [${nonConstantSons.join(', ')}]`);
    console.log(`   Valeurs attendues (depuis ct_blocks):`);
    for (let i = 0; i < nonConstantSons.length; i++) {
        const blockIdx = nonConstantSons[i];
        if (blockIdx < ctBlocks.length) {
            const expectedKeccak = ethers.keccak256(ethers.hexlify(ctBlocks[blockIdx]));
            console.log(`     Block ${blockIdx}: ${expectedKeccak}`);
            console.log(`     nonConstantValuesKeccak[${i}]: ${nonConstantValuesKeccak[i]}`);
            if (expectedKeccak.toLowerCase() === nonConstantValuesKeccak[i].toLowerCase()) {
                console.log(`       ✅ Correspond!\n`);
            } else {
                console.log(`       ❌ NE correspond PAS!\n`);
            }
        }
    }

    console.log("=".repeat(80));
    console.log("✅ DEBUG TERMINÉ");
    console.log("=".repeat(80));
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});

