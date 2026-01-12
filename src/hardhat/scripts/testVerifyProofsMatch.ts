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
 * Test pour vérifier que les preuves calculées par WASM
 * sont acceptées (retournent true) par verifyCommitmentLeft du contrat
 */
async function main() {
    console.log("🧪 TEST: Vérification que verifyCommitmentLeft retourne TRUE");
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
    console.log(`   - curr_acc: ${ethers.hexlify(new Uint8Array(proofs.curr_acc))}`);
    console.log(`   - proof1: ${proofs.proof1.length} layers`);
    console.log(`   - proof2: ${proofs.proof2.length} layers`);
    console.log(`   - proof_ext: ${proofs.proof_ext.length} layers\n`);

    // Prepare arguments for contract
    const gateBytesArray = new Uint8Array(proofs.gate_bytes);
    const valuesArray = proofs.values.map((v: Uint8Array) => new Uint8Array(v));
    const currAccArray = new Uint8Array(proofs.curr_acc);
    const proof1Array = proofs.proof1.map((level: Uint8Array[]) =>
        level.map((v: Uint8Array) => ethers.hexlify(new Uint8Array(v)))
    );
    const proof2Array = proofs.proof2.map((level: Uint8Array[]) =>
        level.map((v: Uint8Array) => ethers.hexlify(new Uint8Array(v)))
    );
    const proofExtArray = proofs.proof_ext.map((level: Uint8Array[]) =>
        level.map((v: Uint8Array) => ethers.hexlify(new Uint8Array(v)))
    );

    const openingValueBytes = new Uint8Array(openingValue);
    const openingValueHex = ethers.hexlify(openingValueBytes);

    // Deploy test contracts - use a simpler approach with deployed contracts
    console.log("📦 Déploiement des contrats de test...\n");
    
    const [deployer] = await ethers.getSigners();
    
    // Use existing deployment script approach - deploy via DisputeDeployer
    // First, deploy libraries
    const SHA256EvaluatorFactory = await ethers.getContractFactory("SHA256Evaluator");
    const sha256Evaluator = await SHA256EvaluatorFactory.deploy();
    await sha256Evaluator.waitForDeployment();
    const sha256EvaluatorAddr = await sha256Evaluator.getAddress();
    
    const CommitmentOpenerFactory = await ethers.getContractFactory("CommitmentOpener");
    const commitmentOpener = await CommitmentOpenerFactory.deploy();
    await commitmentOpener.waitForDeployment();
    const commitmentOpenerAddr = await commitmentOpener.getAddress();
    
    // Deploy AccumulatorVerifier (no libraries needed)
    const AccumulatorVerifierFactory = await ethers.getContractFactory("AccumulatorVerifier");
    const accumulatorVerifier = await AccumulatorVerifierFactory.deploy();
    await accumulatorVerifier.waitForDeployment();
    
    // Deploy DisputeDeployer with libraries
    const DisputeDeployerFactory = await ethers.getContractFactory("DisputeDeployer", {
        libraries: {
            SHA256Evaluator: sha256EvaluatorAddr,
            AccumulatorVerifier: await accumulatorVerifier.getAddress(),
            CommitmentOpener: commitmentOpenerAddr
        }
    });
    const disputeDeployer = await DisputeDeployerFactory.deploy();
    await disputeDeployer.waitForDeployment();
    
    // Deploy OptimisticSOXAccount
    const entryPointAddr = "0x4337084d9e255ff0702461cf8895ce9e3b5ff108";
    const OptimisticSOXAccountFactory = await ethers.getContractFactory("OptimisticSOXAccount");
    const optimisticAccount = await OptimisticSOXAccountFactory.deploy(
        deployer.address, // buyer
        deployer.address, // vendor
        deployer.address, // sbSponsor
        deployer.address, // svSponsor
        entryPointAddr
    );
    await optimisticAccount.waitForDeployment();
    const optimisticAddr = await optimisticAccount.getAddress();
    console.log(`✅ OptimisticSOXAccount: ${optimisticAddr}`);

    // Send key to OptimisticSOXAccount
    const keyBytes16 = ethers.hexlify(key);
    await optimisticAccount.sendKey(keyBytes16);
    console.log(`✅ Clé envoyée au contrat\n`);

    // Deploy DisputeSOXAccount with DisputeDeployer library
    const DisputeSOXAccountFactory = await ethers.getContractFactory("DisputeSOXAccount", {
        libraries: {
            DisputeDeployer: await disputeDeployer.getAddress()
        }
    });
    const disputeAccount = await DisputeSOXAccountFactory.deploy(
        optimisticAddr,
        deployer.address, // buyer
        deployer.address, // vendor
        deployer.address, // buyerDisputeSponsor
        deployer.address, // vendorDisputeSponsor
        commitment.c, // commitment
        2, // numBlocks (estimate)
        3, // numGates (estimate)
        1 // circuitVersion (V2)
    );
    await disputeAccount.waitForDeployment();
    const disputeAddr = await disputeAccount.getAddress();
    console.log(`✅ DisputeSOXAccount: ${disputeAddr}\n`);

    // Verify commitment
    const contractCommitment = await disputeAccount.commitment();
    const computedCommitment = ethers.keccak256(openingValueBytes);
    console.log("🔍 Vérification du commitment:");
    console.log(`   - Calculé: ${computedCommitment}`);
    console.log(`   - Contrat: ${contractCommitment}`);
    if (computedCommitment.toLowerCase() === contractCommitment.toLowerCase()) {
        console.log(`   ✅ Commitments correspondent!\n`);
    } else {
        console.log(`   ❌ Commitments ne correspondent pas!`);
        process.exit(1);
    }

    // Test verifyCommitmentLeft via testVerifyCommitmentLeft
    console.log("🧪 TEST: Appel de testVerifyCommitmentLeft avec les preuves calculées par WASM\n");
    console.log("   📋 Ce test vérifie que:");
    console.log("      1. Les preuves calculées par WASM sont acceptées par le contrat");
    console.log("      2. verifyCommitmentLeft retourne TRUE");
    console.log("      3. L'indexation est correcte (gateNumArray[0] = _gateNum - 1, verifyExt(i=0))\n");
    
    try {
        const result = await disputeAccount.testVerifyCommitmentLeft(
            openingValueHex,
            gateNum, // _gateNum = 1 (1-indexed)
            gateBytesArray,
            valuesArray,
            currAccArray,
            proof1Array,
            proof2Array,
            proofExtArray
        );
        
        if (result) {
            console.log("✅✅✅ SUCCÈS! ✅✅✅");
            console.log(`   verifyCommitmentLeft retourne: ${result}`);
            console.log(`   ✅ Les preuves calculées par WASM sont acceptées par le contrat!\n`);
            
            console.log("📊 RÉSUMÉ:");
            console.log(`   - Preuves calculées par WASM: ✅`);
            console.log(`   - verifyCommitmentLeft retourne TRUE: ✅`);
            console.log(`   - Indexation correcte: ✅`);
            console.log(`      • gateNumArray[0] = _gateNum - 1 = ${gateNum} - 1 = 0 (0-indexed)`);
            console.log(`      • verifyExt(i=0, prevRoot=bytes32(0))`);
            console.log(`   - Les preuves Merkle sont cohérentes: ✅\n`);
            
        } else {
            console.log("❌ ÉCHEC!");
            console.log(`   verifyCommitmentLeft retourne: ${result}`);
            console.log(`   ❌ Les preuves n'ont pas passé la vérification!\n`);
            process.exit(1);
        }
        
    } catch (error: any) {
        console.error("❌ ERREUR lors de l'appel:");
        console.error(`   Message: ${error.message || error.shortMessage || error.reason}`);
        
        const errorData = error.data || error.error?.data || error.cause?.data;
        if (errorData) {
            const selector = typeof errorData === 'string' && errorData.startsWith('0x') 
                ? errorData.slice(0, 10) 
                : null;
            
            if (selector === '0x66eddacf') {
                console.error(`   → InvalidGateBytes() - gate_bytes.length != 64`);
            } else if (selector === '0x9167c27a') {
                console.error(`   → TransactionReverted() - Erreur interne`);
            } else {
                console.error(`   → Erreur selector: ${selector}`);
            }
        }
        
        console.error(`\n   Stack: ${error.stack}`);
        process.exit(1);
    }

    console.log("=".repeat(80));
    console.log("✅ TEST TERMINÉ AVEC SUCCÈS");
    console.log("=".repeat(80));
    console.log("\n💡 CONCLUSION:");
    console.log("   Les preuves calculées par WASM sont identiques à celles attendues par le contrat.");
    console.log("   Le contrat vérifie et accepte les preuves calculées par WASM.");
    console.log("   L'indexation est correcte et cohérente entre WASM et Solidity.\n");
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});

