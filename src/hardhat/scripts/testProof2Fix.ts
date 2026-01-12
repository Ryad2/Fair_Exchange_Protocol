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
 * Script pour tester si la correction de proof2 fonctionne
 * Compare les résultats avant et après la correction
 */
async function main() {
    console.log("🧪 TEST: Correction de proof2 dans compute_proofs_left_v2");
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
    console.log(`📐 Calcul des preuves pour gate ${gateNum} (1-indexed) avec WASM...\n`);
    
    const proofs = compute_proofs_left_v2(
        circuit,
        evaluatedCircuitBytes,
        ct,
        gateNum
    );

    console.log(`✅ Preuves calculées par WASM:`);
    console.log(`   - gate_bytes: ${proofs.gate_bytes.length} bytes`);
    console.log(`   - values: ${proofs.values.length} éléments`);
    console.log(`   - proof1: ${proofs.proof1.length} layers`);
    console.log(`   - proof2: ${proofs.proof2.length} layers`);
    console.log(`   - proof_ext: ${proofs.proof_ext.length} layers\n`);

    // Prepare arguments
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

    // Test verifyCommitmentLeft step by step
    console.log("🧪 TEST: testVerifyCommitmentLeftStepByStep\n");
    try {
        const stepResults = await disputeAccount.testVerifyCommitmentLeftStepByStep(
            openingValueHex,
            gateNum,
            gateBytesArray,
            valuesArray,
            currAccArray,
            proof1Array,
            proof2Array,
            proofExtArray
        );
        
        console.log(`📊 Résultats détaillés:`);
        console.log(`   - Overall: ${stepResults[0]}`);
        console.log(`   - proof1: ${stepResults[1]}`);
        console.log(`   - proof2: ${stepResults[2]}`);
        console.log(`   - proofExt: ${stepResults[3]}\n`);
        
        if (stepResults[0]) {
            console.log("✅✅✅ SUCCÈS! ✅✅✅");
            console.log(`   verifyCommitmentLeft retourne TRUE avec la correction!\n`);
        } else {
            console.log("❌ ÉCHEC:");
            if (!stepResults[1]) {
                console.log(`   ❌ proof1 verification échoue`);
            }
            if (!stepResults[2]) {
                console.log(`   ❌ proof2 verification échoue`);
            }
            if (!stepResults[3]) {
                console.log(`   ❌ proofExt verification échoue`);
            }
            console.log();
            
            if (stepResults[2]) {
                console.log("✅ proof2 passe maintenant! La correction fonctionne!\n");
            } else {
                console.log("⚠️  proof2 échoue toujours. Le WASM n'a peut-être pas été recompilé avec la correction.\n");
            }
        }
        
    } catch (error: any) {
        console.error(`❌ Erreur: ${error.message}\n`);
    }

    console.log("=".repeat(80));
    console.log("✅ TEST TERMINÉ");
    console.log("=".repeat(80));
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});

