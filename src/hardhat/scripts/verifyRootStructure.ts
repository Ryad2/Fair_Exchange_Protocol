import { ethers } from "hardhat";
import {
    initSync,
    bytes_to_hex,
    compute_precontract_values_v2,
} from "../../app/lib/crypto_lib/crypto_lib";
import { join } from "path";
import { readFileSync } from "fs";

/**
 * Script pour vérifier si le root hCt inclut l'IV ou non
 */
async function main() {
    console.log("🔍 VÉRIFICATION: Structure du root hCt");
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

    // Compute precontract
    const precontract = compute_precontract_values_v2(fileData, key);
    const ct = new Uint8Array(precontract.ct);
    const commitment = precontract.commitment;
    const h_ct = precontract.h_ct;
    
    console.log("📊 ROOT hCt depuis compute_precontract_values_v2:");
    console.log(`   ${ethers.hexlify(h_ct)}\n`);

    // Calculate blocks manually
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

    console.log("📊 BLOCS:");
    console.log(`   Avec IV: ${ctBlocksWithIV.length} blocs`);
    for (let i = 0; i < ctBlocksWithIV.length; i++) {
        const blockKeccak = ethers.keccak256(ethers.hexlify(ctBlocksWithIV[i]));
        console.log(`     [${i}]: ${blockKeccak.slice(0, 20)}...`);
    }
    console.log(`   Sans IV: ${ctBlocksWithoutIV.length} blocs`);
    for (let i = 0; i < ctBlocksWithoutIV.length; i++) {
        const blockKeccak = ethers.keccak256(ethers.hexlify(ctBlocksWithoutIV[i]));
        console.log(`     [${i}]: ${blockKeccak.slice(0, 20)}...`);
    }
    console.log();

    // Deploy AccumulatorVerifier to calculate roots
    const [deployer] = await ethers.getSigners();
    const AccumulatorVerifierFactory = await ethers.getContractFactory("AccumulatorVerifier");
    const accumulatorVerifier = await AccumulatorVerifierFactory.deploy();
    await accumulatorVerifier.waitForDeployment();

    // Calculate root with IV
    const allIndicesWithIV = Array.from({ length: ctBlocksWithIV.length }, (_, i) => BigInt(i));
    const allKeccaksWithIV = ctBlocksWithIV.map(block => ethers.keccak256(ethers.hexlify(block)));
    
    // Calculate root without IV
    const allIndicesWithoutIV = Array.from({ length: ctBlocksWithoutIV.length }, (_, i) => BigInt(i));
    const allKeccaksWithoutIV = ctBlocksWithoutIV.map(block => ethers.keccak256(ethers.hexlify(block)));

    console.log("📊 COMPARAISON DES ROOTS:");
    console.log(`   Root attendu (h_ct): ${ethers.hexlify(h_ct)}`);
    console.log();
    console.log("   Pour vérifier quel root correspond, on peut utiliser computeRoot:");
    console.log(`   (Mais computeRoot n'est pas exposé, donc on ne peut pas le tester directement)`);
    console.log();
    console.log("💡 CONCLUSION:");
    console.log(`   Si le root inclut l'IV, alors:`);
    console.log(`     - ctBlocksWithIV[0] = IV`);
    console.log(`     - ctBlocksWithIV[1] = premier bloc de données`);
    console.log(`     - Les indices dans nonConstantSons doivent être décalés de +1`);
    console.log();
    console.log(`   Si le root n'inclut PAS l'IV, alors:`);
    console.log(`     - ctBlocksWithoutIV[0] = premier bloc de données`);
    console.log(`     - Les indices dans nonConstantSons sont corrects (ctIdx - 1)`);
    console.log();
    console.log("   Le code Rust montre que acc_ct utilise split_ct_blocks qui INCLUT l'IV,");
    console.log("   donc le root DOIT inclure l'IV. Mais compute_proofs_v2 fonctionne,");
    console.log("   donc il doit y avoir un décalage quelque part.");

    console.log("=".repeat(80));
    console.log("✅ VÉRIFICATION TERMINÉE");
    console.log("=".repeat(80));
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});


