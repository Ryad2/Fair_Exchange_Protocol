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
 * Script pour investiguer pourquoi verifyCommitmentLeft retourne false
 * Teste chaque étape individuellement pour identifier le problème
 */
async function main() {
    console.log("🔍 INVESTIGATION: Pourquoi verifyCommitmentLeft retourne false");
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

    // Deploy test contracts
    console.log("📦 Déploiement des contrats de test...\n");
    
    const [deployer] = await ethers.getSigners();
    
    // Deploy EntryPoint
    const EntryPointArtifact = require("@account-abstraction/contracts/artifacts/EntryPoint.json");
    const EntryPointFactory = new ethers.ContractFactory(
        EntryPointArtifact.abi,
        EntryPointArtifact.bytecode,
        deployer
    );
    const entryPoint = await EntryPointFactory.deploy();
    await entryPoint.waitForDeployment();
    
    // Deploy libraries
    const AccumulatorVerifierFactory = await ethers.getContractFactory("AccumulatorVerifier");
    const accumulatorVerifier = await AccumulatorVerifierFactory.deploy();
    await accumulatorVerifier.waitForDeployment();
    
    const CommitmentOpenerFactory = await ethers.getContractFactory("CommitmentOpener");
    const commitmentOpener = await CommitmentOpenerFactory.deploy();
    await commitmentOpener.waitForDeployment();
    
    const SHA256EvaluatorFactory = await ethers.getContractFactory("SHA256Evaluator");
    const sha256Evaluator = await SHA256EvaluatorFactory.deploy();
    await sha256Evaluator.waitForDeployment();
    
    const DisputeDeployerFactory = await ethers.getContractFactory("DisputeDeployer", {
        libraries: {
            AccumulatorVerifier: await accumulatorVerifier.getAddress(),
            CommitmentOpener: await commitmentOpener.getAddress(),
            SHA256Evaluator: await sha256Evaluator.getAddress(),
        },
    });
    const disputeDeployer = await DisputeDeployerFactory.deploy();
    await disputeDeployer.waitForDeployment();
    
    const OptimisticSOXAccountFactory = await ethers.getContractFactory("OptimisticSOXAccount", {
        libraries: {
            DisputeDeployer: await disputeDeployer.getAddress(),
        },
    });
    const optimisticAccount = await OptimisticSOXAccountFactory.deploy(
        await entryPoint.getAddress(),
        deployer.address, // vendor
        deployer.address, // buyer
        ethers.parseEther("1.0"), // agreedPrice
        ethers.parseEther("0.1"), // completionTip
        ethers.parseEther("0.12"), // disputeTip
        3600n, // timeoutIncrement
        commitment.c, // commitment
        2, // numBlocks
        3, // numGates
        deployer.address, // sbSponsor
        { value: 5n }
    );
    await optimisticAccount.waitForDeployment();
    const optimisticAddr = await optimisticAccount.getAddress();
    console.log(`✅ OptimisticSOXAccount: ${optimisticAddr}`);

    // Send payment first
    await optimisticAccount.sendPayment({ value: ethers.parseEther("1.1") });
    console.log(`✅ Paiement envoyé`);

    // Send key to OptimisticSOXAccount
    const keyBytes16 = ethers.hexlify(key);
    await optimisticAccount.sendKey(keyBytes16);
    console.log(`✅ Clé envoyée au contrat\n`);

    // Deploy DisputeSOXAccount directly
    const DisputeSOXAccountFactory = await ethers.getContractFactory("DisputeSOXAccount", {
        libraries: {
            AccumulatorVerifier: await accumulatorVerifier.getAddress(),
            CommitmentOpener: await commitmentOpener.getAddress(),
            SHA256Evaluator: await sha256Evaluator.getAddress(),
        },
    });
    
    const entryPointAddr = await entryPoint.getAddress();
    const disputeAccount = await DisputeSOXAccountFactory.deploy(
        entryPointAddr,
        optimisticAddr,
        2, // numBlocks
        3, // numGates
        commitment.c, // commitment
        1, // circuitVersion (V2)
        deployer.address, // buyerSigner (0x0 = use buyer address)
        deployer.address, // vendorSigner (0x0 = use vendor address)
        deployer.address, // buyerDisputeSponsorSigner
        deployer.address, // vendorDisputeSponsor
        deployer.address, // vendorDisputeSponsorSigner
        { value: 0 }
    );
    await disputeAccount.waitForDeployment();
    console.log(`✅ DisputeSOXAccount: ${await disputeAccount.getAddress()}\n`);

    // Verify commitment
    const contractCommitment = await disputeAccount.commitment();
    const computedCommitment = ethers.keccak256(openingValueBytes);
    console.log("🔍 ÉTAPE 1: Vérification du commitment");
    console.log(`   - Calculé: ${computedCommitment}`);
    console.log(`   - Contrat: ${contractCommitment}`);
    if (computedCommitment.toLowerCase() === contractCommitment.toLowerCase()) {
        console.log(`   ✅ Commitments correspondent!\n`);
    } else {
        console.log(`   ❌ Commitments ne correspondent pas!\n`);
        return;
    }

    // Test openCommitment
    console.log("🔍 ÉTAPE 2: Test de openCommitment");
    try {
        const hCircuitCt = await disputeAccount.openCommitment.staticCall(openingValueHex);
        console.log(`   ✅ openCommitment réussit`);
        console.log(`   - hCircuitCt[0] (hCircuit): ${ethers.hexlify(hCircuitCt[0])}`);
        console.log(`   - hCircuitCt[1] (hCt): ${ethers.hexlify(hCircuitCt[1])}\n`);
    } catch (error: any) {
        console.log(`   ❌ openCommitment échoue: ${error.message}\n`);
        return;
    }

    // Test gate bytes length
    console.log("🔍 ÉTAPE 3: Vérification du gate bytes");
    console.log(`   - gate_bytes.length: ${gateBytesArray.length} bytes`);
    if (gateBytesArray.length === 64) {
        console.log(`   ✅ gate_bytes.length est correct (64 bytes)\n`);
    } else {
        console.log(`   ❌ gate_bytes.length est incorrect (devrait être 64)\n`);
        return;
    }

    // Test evaluateGateFromSons (via a helper function if available, or manually)
    console.log("🔍 ÉTAPE 4: Test de evaluateGateFromSons");
    try {
        // Get AES key from OptimisticSOXAccount
        const contractKey = await optimisticAccount.key();
        console.log(`   - Clé du contrat: ${ethers.hexlify(contractKey)}`);
        console.log(`   - Clé utilisée: ${keyHex}`);
        
        // We can't directly test evaluateGateFromSons, but we can check if the key matches
        if (ethers.hexlify(contractKey).toLowerCase() === keyHex.toLowerCase()) {
            console.log(`   ✅ La clé correspond\n`);
        } else {
            console.log(`   ⚠️  La clé ne correspond pas (mais cela pourrait être normal si le format est différent)\n`);
        }
    } catch (error: any) {
        console.log(`   ⚠️  Erreur lors de la vérification de la clé: ${error.message}\n`);
    }

    // Test verifyCommitmentLeft step by step
    console.log("🔍 ÉTAPE 5: Test de verifyCommitmentLeft (complet)");
    try {
        const result = await disputeAccount.testVerifyCommitmentLeft(
            openingValueHex,
            gateNum,
            gateBytesArray,
            valuesArray,
            currAccArray,
            proof1Array,
            proof2Array,
            proofExtArray
        );
        
        if (result) {
            console.log(`   ✅ verifyCommitmentLeft retourne: ${result}\n`);
        } else {
            console.log(`   ❌ verifyCommitmentLeft retourne: ${result}\n`);
            console.log(`   📋 Cela signifie qu'une des vérifications a échoué:\n`);
            console.log(`      1. AccumulatorVerifier.verify pour proof1`);
            console.log(`      2. AccumulatorVerifier.verify pour proof2`);
            console.log(`      3. AccumulatorVerifier.verifyExt pour proofExt\n`);
        }
    } catch (error: any) {
        console.log(`   ❌ Erreur lors de l'appel: ${error.message}\n`);
    }

    // Test individual accumulator verifications
    console.log("🔍 ÉTAPE 6: Test des vérifications individuelles");
    
    // Get hCircuitCt
    const hCircuitCt = await disputeAccount.openCommitment.staticCall(openingValueHex);
    
    // Prepare gateNumArray
    const gateNumArray = [gateNum - 1]; // Convert to 0-indexed
    const gateKeccak = [ethers.keccak256(gateBytesArray)];
    
    // Test proof1 verification
    console.log(`   Test 1: AccumulatorVerifier.verify pour proof1`);
    console.log(`      - Root: ${ethers.hexlify(hCircuitCt[0])}`);
    console.log(`      - gateNumArray: [${gateNumArray[0]}] (0-indexed, gate ${gateNum})`);
    console.log(`      - gateKeccak: ${gateKeccak[0]}`);
    console.log(`      - proof1 layers: ${proof1Array.length}`);
    try {
        const result1 = await accumulatorVerifier.verify.staticCall(
            hCircuitCt[0],
            gateNumArray,
            gateKeccak,
            proof1Array
        );
        console.log(`      ✅ proof1 verification: ${result1}\n`);
    } catch (error: any) {
        console.log(`      ❌ proof1 verification échoue: ${error.message}\n`);
    }

    // For proof2, we need to extract nonConstantSons and values
    // This is complex, so let's just test verifyExt
    console.log(`   Test 2: AccumulatorVerifier.verifyExt pour proofExt`);
    console.log(`      - i: 0 (0-indexed, Step 8b)`);
    console.log(`      - prevRoot: bytes32(0)`);
    console.log(`      - currRoot: ${ethers.hexlify(currAccArray)}`);
    console.log(`      - proof_ext layers: ${proofExtArray.length}`);
    
    // We need to compute keccak256(gateRes) for verifyExt
    // But we don't have gateRes directly, so we'll test with a placeholder
    // Actually, let's test verifyExt with the actual values from the contract
    try {
        // We need to get the gateRes from evaluateGateFromSons
        // For now, let's just test if verifyExt can be called
        const gateResKeccak = ethers.keccak256(ethers.hexlify(new Uint8Array(32))); // Placeholder
        console.log(`      - gateResKeccak (placeholder): ${gateResKeccak}`);
        
        const resultExt = await accumulatorVerifier.verifyExt.staticCall(
            0, // i=0 (0-indexed)
            ethers.ZeroHash, // prevRoot = bytes32(0)
            currAccArray, // currRoot
            gateResKeccak, // addedValKeccak (this is wrong, but let's see the error)
            proofExtArray
        );
        console.log(`      ✅ proofExt verification: ${resultExt}\n`);
    } catch (error: any) {
        console.log(`      ❌ proofExt verification échoue: ${error.message}\n`);
    }

    console.log("=".repeat(80));
    console.log("✅ INVESTIGATION TERMINÉE");
    console.log("=".repeat(80));
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});

