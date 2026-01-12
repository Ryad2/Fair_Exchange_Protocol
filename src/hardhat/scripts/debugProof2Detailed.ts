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
 * Script pour déboguer en détail pourquoi proof2 échoue
 * Compare la conversion des indices entre Rust et Solidity
 */
async function main() {
    console.log("🔍 DEBUG DÉTAILLÉ: Conversion des indices pour proof2");
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

    // Test extractNonConstantSons_V2
    console.log("🔍 ANALYSE DE LA CONVERSION DES INDICES:\n");
    const result = await helpers.extractNonConstantSons_V2(
        gateBytesArray,
        valuesKeccak
    );
    
    const nonConstantSons = result[0].map((x: bigint) => Number(x));
    const nonConstantValuesKeccak = result[1];
    
    console.log(`   Solidity extrait:`);
    console.log(`   - nonConstantSons: [${nonConstantSons.join(', ')}]`);
    console.log(`   - nonConstantValuesKeccak: ${nonConstantValuesKeccak.length} valeurs\n`);
    
    // Decode gate to see the actual sons using DisputeSOXHelpers
    // DisputeSOXHelpers has extractNonConstantSons_V2 which uses decodeGate internally
    // We can't call decodeGate directly, but we can analyze the gate_bytes structure
    // For now, let's just compare the conversion logic
    
    // Compare Rust conversion vs Solidity conversion
    console.log("🔍 COMPARAISON RUST vs SOLIDITY:\n");
    console.log(`   Dans Rust (compute_proofs_left_v2, ligne 1069):`);
    console.log(`   - block_indices = non_constant_sons.filter_map(|&s| if s < 0 { Some((-s - 1) as u32) })`);
    console.log(`   - Si s = -1 → block_indices = [(-(-1) - 1) = (1 - 1) = 0]`);
    console.log(`   - Si s = -2 → block_indices = [(-(-2) - 1) = (2 - 1) = 1]`);
    console.log(`   - proof2 = prove(&ct_blocks, &block_indices)\n`);
    
    console.log(`   Dans Solidity (_extractNonConstantSons_V2, ligne 1175):`);
    console.log(`   - ctIdx = uint32(uint64(-sons[i]))`);
    console.log(`   - Si sons[i] = -1 → ctIdx = 1`);
    console.log(`   - nonConstantSons[j] = ctIdx - 1 = 0`);
    console.log(`   - Si sons[i] = -2 → ctIdx = 2`);
    console.log(`   - nonConstantSons[j] = ctIdx - 1 = 1\n`);
    
    console.log(`   ✅ Les conversions sont identiques: (-s - 1) en Rust = (ctIdx - 1) en Solidity\n`);
    
    console.log(`   Calcul Solidity (réel):`);
    console.log(`   - nonConstantSons: [${nonConstantSons.join(', ')}]\n`);
    
    // Check ct_blocks structure
    const numBlocks = Math.ceil((ct.length - 16) / 64);
    console.log(`   Structure du ciphertext:`);
    console.log(`   - ct.length: ${ct.length} bytes`);
    console.log(`   - IV: 16 bytes (indices 0-15)`);
    console.log(`   - Blocks: ${numBlocks} blocs de 64 bytes`);
    console.log(`   - Block 1 (1-indexed) = indices 16-79 (0-indexed: 0)`);
    console.log(`   - Block 2 (1-indexed) = indices 80-143 (0-indexed: 1)`);
    console.log();
    
    // Test with AccumulatorVerifier directly
    console.log("🔍 TEST DIRECT: AccumulatorVerifier.verify pour proof2\n");
    
    // We need hCircuitCt[1] (hCt) from openCommitment
    const openingValueBytes = new Uint8Array(openingValue);
    const openingValueHex = ethers.hexlify(openingValueBytes);
    
    // Deploy CommitmentOpener
    const CommitmentOpenerFactory = await ethers.getContractFactory("CommitmentOpener");
    const commitmentOpener = await CommitmentOpenerFactory.deploy();
    await commitmentOpener.waitForDeployment();
    
    const opened = await commitmentOpener.open.staticCall(
        commitment.c,
        openingValueHex
    );
    // opened is bytes, we need to extract the second 32 bytes (hCt)
    const openedBytes = ethers.getBytes(opened);
    const hCt = ethers.hexlify(openedBytes.slice(32, 64)); // hCircuitCt[1]
    
    console.log(`   - hCt (root): ${hCt}`);
    console.log(`   - nonConstantSons: [${nonConstantSons.join(', ')}]`);
    console.log(`   - nonConstantValuesKeccak: ${nonConstantValuesKeccak.length} valeurs`);
    console.log(`   - proof2 layers: ${proof2Array.length}\n`);
    
    // Deploy AccumulatorVerifier
    const AccumulatorVerifierFactory = await ethers.getContractFactory("AccumulatorVerifier");
    const accumulatorVerifier = await AccumulatorVerifierFactory.deploy();
    await accumulatorVerifier.waitForDeployment();
    
    try {
        const result = await accumulatorVerifier.verify.staticCall(
            hCt,
            nonConstantSons,
            nonConstantValuesKeccak,
            proof2Array
        );
        console.log(`   ✅ AccumulatorVerifier.verify retourne: ${result}\n`);
    } catch (error: any) {
        console.log(`   ❌ AccumulatorVerifier.verify échoue: ${error.message}\n`);
    }

    console.log("=".repeat(80));
    console.log("✅ DEBUG TERMINÉ");
    console.log("=".repeat(80));
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});

