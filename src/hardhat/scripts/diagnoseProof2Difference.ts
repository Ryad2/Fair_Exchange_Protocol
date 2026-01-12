import { ethers } from "hardhat";
import {
    initSync,
    compute_proofs_v2,
    compute_proofs_left_v2,
    bytes_to_hex,
    compute_precontract_values_v2,
    evaluate_circuit_v2_wasm,
} from "../../app/lib/crypto_lib/crypto_lib";
import { join } from "path";
import { readFileSync } from "fs";

/**
 * Script pour diagnostiquer la différence entre compute_proofs_v2 (qui fonctionne)
 * et compute_proofs_left_v2 (qui ne fonctionne pas) pour proof2
 */
async function main() {
    console.log("🔍 DIAGNOSTIC: Différence entre compute_proofs_v2 et compute_proofs_left_v2");
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

    // Calculate ct_blocks manually to see the structure
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

    console.log("📊 STRUCTURE DES BLOCS:");
    console.log(`   - ct_blocks avec IV: ${ctBlocksWithIV.length} blocs`);
    console.log(`     [0] = IV (16 bytes)`);
    for (let i = 1; i < ctBlocksWithIV.length; i++) {
        const blockKeccak = ethers.keccak256(ethers.hexlify(ctBlocksWithIV[i]));
        console.log(`     [${i}] = Block ${i} (64 bytes): ${blockKeccak.slice(0, 20)}...`);
    }
    console.log(`   - ct_blocks sans IV: ${ctBlocksWithoutIV.length} blocs`);
    for (let i = 0; i < ctBlocksWithoutIV.length; i++) {
        const blockKeccak = ethers.keccak256(ethers.hexlify(ctBlocksWithoutIV[i]));
        console.log(`     [${i}] = Block ${i + 1} (64 bytes): ${blockKeccak.slice(0, 20)}...`);
    }
    console.log();

    // Test with compute_proofs_v2 (challenge = 9, which works)
    const challenge9 = 9;
    console.log(`🧪 TEST 1: compute_proofs_v2 avec challenge=${challenge9}\n`);
    const proofsV2 = compute_proofs_v2(
        circuit,
        evaluatedCircuitBytes,
        ct,
        challenge9
    );

    console.log(`   proof2 layers: ${proofsV2.proof2.length}`);
    console.log(`   proof2[0] length: ${proofsV2.proof2[0]?.length || 0} éléments`);
    if (proofsV2.proof2[0] && proofsV2.proof2[0].length > 0) {
        console.log(`   proof2[0][0]: ${ethers.hexlify(proofsV2.proof2[0][0]).slice(0, 20)}...`);
    }
    console.log();

    // Test with compute_proofs_left_v2 (challenge = 1, which fails)
    const challenge1 = 1;
    console.log(`🧪 TEST 2: compute_proofs_left_v2 avec challenge=${challenge1}\n`);
    const proofsLeftV2 = compute_proofs_left_v2(
        circuit,
        evaluatedCircuitBytes,
        ct,
        challenge1
    );

    console.log(`   proof2 layers: ${proofsLeftV2.proof2.length}`);
    console.log(`   proof2[0] length: ${proofsLeftV2.proof2[0]?.length || 0} éléments`);
    if (proofsLeftV2.proof2[0] && proofsLeftV2.proof2[0].length > 0) {
        console.log(`   proof2[0][0]: ${ethers.hexlify(proofsLeftV2.proof2[0][0]).slice(0, 20)}...`);
    }
    console.log();

    // Deploy contracts for verification
    const [deployer] = await ethers.getSigners();
    
    const EntryPointArtifact = require("@account-abstraction/contracts/artifacts/EntryPoint.json");
    const EntryPointFactory = new ethers.ContractFactory(
        EntryPointArtifact.abi,
        EntryPointArtifact.bytecode,
        deployer
    );
    const entryPoint = await EntryPointFactory.deploy();
    await entryPoint.waitForDeployment();
    
    const AccumulatorVerifierFactory = await ethers.getContractFactory("AccumulatorVerifier");
    const accumulatorVerifier = await AccumulatorVerifierFactory.deploy();
    await accumulatorVerifier.waitForDeployment();
    
    const CommitmentOpenerFactory = await ethers.getContractFactory("CommitmentOpener");
    const commitmentOpener = await CommitmentOpenerFactory.deploy();
    await commitmentOpener.waitForDeployment();
    
    const SHA256EvaluatorFactory = await ethers.getContractFactory("SHA256Evaluator");
    const sha256Evaluator = await SHA256EvaluatorFactory.deploy();
    await sha256Evaluator.waitForDeployment();
    
    const DisputeSOXHelpersFactory = await ethers.getContractFactory("DisputeSOXHelpers");
    const helpers = await DisputeSOXHelpersFactory.deploy();
    await helpers.waitForDeployment();

    // Get hCt from commitment
    const openingValueBytes = new Uint8Array(openingValue);
    const openingValueHex = ethers.hexlify(openingValueBytes);
    
    const opened = await commitmentOpener.open.staticCall(
        commitment.c,
        openingValueHex
    );
    const openedBytes = ethers.getBytes(opened);
    const hCt = ethers.hexlify(openedBytes.slice(32, 64)); // hCircuitCt[1]
    
    console.log("📊 ROOT hCt:");
    console.log(`   ${hCt}\n`);

    // Test proof2 for compute_proofs_left_v2
    const gateBytesArray = new Uint8Array(proofsLeftV2.gate_bytes);
    const valuesArray = proofsLeftV2.values.map((v: Uint8Array) => new Uint8Array(v));
    const proof2Array = proofsLeftV2.proof2.map((level: Uint8Array[]) =>
        level.map((v: Uint8Array) => ethers.hexlify(new Uint8Array(v)))
    );

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
    
    console.log("📊 EXTRACTION SOLIDITY:");
    console.log(`   nonConstantSons: [${nonConstantSons.join(', ')}]`);
    console.log(`   nonConstantValuesKeccak: ${nonConstantValuesKeccak.length} valeurs`);
    for (let i = 0; i < nonConstantValuesKeccak.length; i++) {
        console.log(`     [${i}]: ${nonConstantValuesKeccak[i]}`);
    }
    console.log();

    // Calculate expected block indices from Rust
    console.log("📊 COMPARAISON DES INDICES:");
    console.log(`   Solidity nonConstantSons: [${nonConstantSons.join(', ')}]`);
    console.log(`   Ces indices pointent vers:`);
    for (const idx of nonConstantSons) {
        if (idx < ctBlocksWithIV.length) {
            const blockKeccak = ethers.keccak256(ethers.hexlify(ctBlocksWithIV[idx]));
            console.log(`     [${idx}] = ${blockKeccak.slice(0, 20)}...`);
        } else {
            console.log(`     [${idx}] = OUT OF BOUNDS!`);
        }
    }
    console.log();

    // Try to verify with different index interpretations
    console.log("🧪 TEST DE VÉRIFICATION:\n");
    
    // Test 1: With current nonConstantSons (after our +1 fix)
    try {
        const verifyResult1 = await accumulatorVerifier.verify.staticCall(
            hCt,
            nonConstantSons,
            nonConstantValuesKeccak,
            proof2Array
        );
        console.log(`   Test 1 (nonConstantSons actuel): ${verifyResult1 ? '✅' : '❌'}`);
    } catch (error: any) {
        console.log(`   Test 1 (nonConstantSons actuel): ❌ ${error.message.slice(0, 50)}...`);
    }

    // Test 2: With nonConstantSons - 1 (before our fix)
    const nonConstantSonsMinus1 = nonConstantSons.map(x => x - 1);
    try {
        const verifyResult2 = await accumulatorVerifier.verify.staticCall(
            hCt,
            nonConstantSonsMinus1,
            nonConstantValuesKeccak,
            proof2Array
        );
        console.log(`   Test 2 (nonConstantSons - 1): ${verifyResult2 ? '✅' : '❌'}`);
    } catch (error: any) {
        console.log(`   Test 2 (nonConstantSons - 1): ❌ ${error.message.slice(0, 50)}...`);
    }

    // Test 3: Calculate root manually from ctBlocksWithIV
    console.log();
    console.log("📊 CALCUL MANUEL DU ROOT:");
    const allBlockKeccaks = ctBlocksWithIV.map(block => ethers.keccak256(ethers.hexlify(block)));
    console.log(`   Root calculé depuis ctBlocksWithIV: ${allBlockKeccaks.length} blocs`);
    console.log(`   Root attendu (hCt): ${hCt}`);
    console.log();

    console.log("=".repeat(80));
    console.log("✅ DIAGNOSTIC TERMINÉ");
    console.log("=".repeat(80));
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});


