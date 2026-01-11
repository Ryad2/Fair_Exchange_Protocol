// Script pour tester le hashage de gates V2 avec Solidity
// Usage: cd src/hardhat && npx hardhat run ../test_solidity_gate_hash.js

const hre = require("hardhat");

async function main() {
    console.log("=== Test de hashage de gates V2 (Solidity) ===\n");
    
    // Déployer SHA256Evaluator d'abord
    const SHA256EvaluatorFactory = await hre.ethers.getContractFactory("SHA256Evaluator");
    const sha256Evaluator = await SHA256EvaluatorFactory.deploy();
    await sha256Evaluator.waitForDeployment();
    console.log("SHA256Evaluator déployé à:", await sha256Evaluator.getAddress());
    
    // Déployer TestGateHash avec la bibliothèque liée
    const TestGateHash = await hre.ethers.getContractFactory("TestGateHash", {
        libraries: {
            SHA256Evaluator: await sha256Evaluator.getAddress(),
        },
    });
    const test = await TestGateHash.deploy();
    await test.waitForDeployment();
    
    console.log("Contrat déployé à:", await test.getAddress());
    console.log();
    
    // Gate 1: AES-CTR (opcode 0x01), son g_{-1} = -1
    const gate1 = "0x01ffffffffffff000000000000000000000000000000000040000000000000000000000000000000000000000000000000000000000000000000000000000000";
    const hash1 = await test.sha256GateV2(gate1);
    const expectedHash1 = "0xcce128d36e00bb7af7c5178f90b4a2cdf53d73a9b1ec3b9f14c9b0d28f5ef461";
    console.log("Gate 1 (AES-CTR):");
    console.log("  Hash Solidity:", hash1);
    console.log("  Hash Rust:    ", expectedHash1);
    console.log("  Match:", hash1.toLowerCase() === expectedHash1.toLowerCase() ? "✅" : "❌");
    console.log();
    
    // Gate 2: SHA2 (opcode 0x02), son g_1 = 1
    const gate2 = "0x02000000000001000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000";
    const hash2 = await test.sha256GateV2(gate2);
    const expectedHash2 = "0xf33d5479d7846de0011754e9a28b8f8c9bea04b65a74a600c5b3daadcff27c53";
    console.log("Gate 2 (SHA2):");
    console.log("  Hash Solidity:", hash2);
    console.log("  Hash Rust:    ", expectedHash2);
    console.log("  Match:", hash2.toLowerCase() === expectedHash2.toLowerCase() ? "✅" : "❌");
    console.log();
    
    // Gate 3: CONST (opcode 0x03)
    const gate3 = "0x03800000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000";
    const hash3 = await test.sha256GateV2(gate3);
    const expectedHash3 = "0x67171a1e9c85caf3f8cc3ee8bf09b1775e1f1fbe9d7cf36cdaada71241bc8ff6";
    console.log("Gate 3 (CONST):");
    console.log("  Hash Solidity:", hash3);
    console.log("  Hash Rust:    ", expectedHash3);
    console.log("  Match:", hash3.toLowerCase() === expectedHash3.toLowerCase() ? "✅" : "❌");
    console.log();
    
    const allMatch = 
        hash1.toLowerCase() === expectedHash1.toLowerCase() &&
        hash2.toLowerCase() === expectedHash2.toLowerCase() &&
        hash3.toLowerCase() === expectedHash3.toLowerCase();
    
    if (allMatch) {
        console.log("✅ Tous les hash correspondent entre Rust et Solidity!");
    } else {
        console.log("❌ Certains hash ne correspondent pas!");
        process.exit(1);
    }
}

main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error(error);
        process.exit(1);
    });

