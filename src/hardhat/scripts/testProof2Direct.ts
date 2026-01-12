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
 * Script pour tester directement AccumulatorVerifier.verify pour proof2
 */
async function main() {
    console.log("🧪 TEST DIRECT: AccumulatorVerifier.verify pour proof2");
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
    
    // Get hCt from openCommitment
    const openingValueBytes = new Uint8Array(openingValue);
    const openingValueHex = ethers.hexlify(openingValueBytes);
    
    const CommitmentOpenerFactory = await ethers.getContractFactory("CommitmentOpener");
    const commitmentOpener = await CommitmentOpenerFactory.deploy();
    await commitmentOpener.waitForDeployment();
    
    const opened = await commitmentOpener.open.staticCall(
        commitment.c,
        openingValueHex
    );
    const openedBytes = ethers.getBytes(opened);
    const hCt = ethers.hexlify(openedBytes.slice(32, 64)); // hCircuitCt[1]
    
    // Deploy AccumulatorVerifier
    const AccumulatorVerifierFactory = await ethers.getContractFactory("AccumulatorVerifier");
    const accumulatorVerifier = await AccumulatorVerifierFactory.deploy();
    await accumulatorVerifier.waitForDeployment();
    
    console.log("🔍 TEST DIRECT: AccumulatorVerifier.verify pour proof2\n");
    console.log(`   - Root (hCt): ${hCt}`);
    console.log(`   - nonConstantSons: [${nonConstantSons.join(', ')}]`);
    console.log(`   - nonConstantValuesKeccak: ${nonConstantValuesKeccak.length} valeurs`);
    for (let i = 0; i < nonConstantValuesKeccak.length; i++) {
        console.log(`     [${i}]: ${nonConstantValuesKeccak[i]}`);
    }
    console.log(`   - proof2 layers: ${proof2Array.length}`);
    for (let i = 0; i < proof2Array.length; i++) {
        console.log(`     Layer ${i}: ${proof2Array[i].length} éléments`);
    }
    console.log();
    
    // Test verify directly
    try {
        // Convert nonConstantSons to proper format (uint32[])
        const nonConstantSonsArray: number[] = [];
        for (const x of nonConstantSons) {
            nonConstantSonsArray.push(x);
        }
        
        const verifyResult = await accumulatorVerifier.verify.staticCall(
            hCt,
            nonConstantSonsArray,
            nonConstantValuesKeccak,
            proof2Array
        );
        
        if (verifyResult) {
            console.log("✅✅✅ SUCCÈS! ✅✅✅");
            console.log(`   AccumulatorVerifier.verify retourne: ${verifyResult}\n`);
            console.log("   ✅ proof2 est correct avec la correction!\n");
        } else {
            console.log("❌ ÉCHEC:");
            console.log(`   AccumulatorVerifier.verify retourne: ${verifyResult}\n`);
            console.log("   ⚠️  proof2 échoue toujours. Il faut investiguer plus en profondeur.\n");
        }
    } catch (error: any) {
        console.error(`❌ Erreur lors de l'appel: ${error.message}\n`);
        if (error.data) {
            console.error(`   Error data: ${error.data}`);
        }
    }
    
    // Calculate expected root from ct_blocks
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
    
    console.log("🔍 COMPARAISON DES ROOTS:\n");
    console.log(`   hCt depuis openCommitment: ${hCt}`);
    console.log(`   ct_blocks count: ${ctBlocks.length}`);
    for (let i = 0; i < ctBlocks.length; i++) {
        const blockKeccak = ethers.keccak256(ethers.hexlify(ctBlocks[i]));
        console.log(`     Block ${i}: ${blockKeccak}`);
    }
    console.log();
    
    // Try to calculate root with all blocks
    const allBlockIndices = Array.from({ length: ctBlocks.length }, (_, i) => BigInt(i));
    const allBlockKeccaks = ctBlocks.map(block => ethers.keccak256(ethers.hexlify(block)));
    
    try {
        // We can't directly get the root, but we can verify with all blocks
        const allBlocksVerify = await accumulatorVerifier.verify.staticCall(
            hCt,
            allBlockIndices,
            allBlockKeccaks,
            [] // Empty proof for all blocks
        );
        console.log(`   Test avec tous les blocks (root devrait correspondre): ${allBlocksVerify}\n`);
    } catch (error: any) {
        console.log(`   ⚠️  Impossible de tester avec tous les blocks: ${error.message}\n`);
    }

    console.log("=".repeat(80));
    console.log("✅ TEST TERMINÉ");
    console.log("=".repeat(80));
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});

