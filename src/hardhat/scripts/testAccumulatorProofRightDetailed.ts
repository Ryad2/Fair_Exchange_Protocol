import hre from "hardhat";
import { ethers } from "hardhat";
import { parseEther } from "ethers";
import fs from "fs";
import path from "path";
import { join } from "node:path";
import { readFile } from "node:fs/promises";
import {
    bytes_to_hex,
    compute_precontract_values_v2,
    compute_proof_right_v2,
    evaluate_circuit_v2_wasm,
    hpre_v2,
    initSync,
} from "../../app/lib/crypto_lib/crypto_lib";
import EntryPointArtifact from "@account-abstraction/contracts/artifacts/EntryPoint.json";

const DISPUTE_FEES = 10n;
const SPONSOR_FEES = 5n;

async function main() {
    const [sponsor, buyer, vendor, sbSponsor, svSponsor] = await hre.ethers.getSigners();
    const provider = ethers.provider;

    console.log("=".repeat(80));
    console.log("🔬 TEST DÉTAILLÉ ACCUMULATOR PROOF RIGHT - ANALYSE COMPLÈTE");
    console.log("=".repeat(80));
    console.log("");

    // ============================================
    // ÉTAPE 0: Initialiser WASM et préparer le fichier
    // ============================================
    console.log("📁 ÉTAPE 0: Initialisation WASM...");
    
    const modulePath = join(__dirname, "../../app/lib/crypto_lib/crypto_lib_bg.wasm");
    const module = await readFile(modulePath);
    initSync({ module: module });
    
    const filePath = path.join(__dirname, "../../../test_65bytes.bin");
    const fileContent = new Uint8Array(fs.readFileSync(filePath));
    
    let key = new Uint8Array(16);
    for (let i = 0; i < key.length; i++) {
        key[i] = (i * 17) % 256;
    }
    
    const precontract = compute_precontract_values_v2(fileContent, key);
    const commitment = precontract.commitment;
    const commitmentHex = bytes_to_hex(commitment.c);
    const numBlocks = precontract.num_blocks;
    const numGates = precontract.num_gates;
    const circuitBytes = precontract.circuit_bytes;
    const ct = precontract.ct;
    
    const evaluatedBytes = evaluate_circuit_v2_wasm(
        circuitBytes,
        ct,
        bytes_to_hex(key)
    ).to_bytes();
    
    console.log(`  ✅ numBlocks: ${numBlocks}, numGates: ${numGates}`);
    console.log("");

    // ============================================
    // ÉTAPE 1: Analyser les valeurs évaluées
    // ============================================
    console.log("🔍 ÉTAPE 1: Analyse des valeurs évaluées...");
    
    // Décoder les valeurs évaluées (format: [inputs (num_blocks), gate_outputs (num_gates)])
    // Pour V2, c'est un format sérialisé, on doit utiliser la structure EvaluatedCircuitV2
    // Mais on peut calculer hpre manuellement pour vérifier
    
    // Calculer hpre(9) et hpre(10)
    const hpre9 = hpre_v2(evaluatedBytes, numBlocks, 9);
    const hpre10 = hpre_v2(evaluatedBytes, numBlocks, 10);
    const hpre9Hex = bytes_to_hex(hpre9);
    const hpre10Hex = bytes_to_hex(hpre10);
    
    console.log(`  hpre(9): ${hpre9Hex}`);
    console.log(`  hpre(10): ${hpre10Hex}`);
    console.log(`  hpre(9) === hpre(10): ${hpre9Hex === hpre10Hex}`);
    console.log("");

    // ============================================
    // ÉTAPE 2: Générer la preuve
    // ============================================
    console.log("📝 ÉTAPE 2: Génération de la preuve...");
    const proof = compute_proof_right_v2(evaluatedBytes, numBlocks, numGates);
    console.log(`  ✅ Preuve générée: ${proof.length} niveaux`);
    console.log("");

    // ============================================
    // ÉTAPE 3: Déployer les contrats nécessaires
    // ============================================
    console.log("🔐 ÉTAPE 3: Déploiement des contrats...");
    
    const EntryPointFactory = new ethers.ContractFactory(
        EntryPointArtifact.abi,
        EntryPointArtifact.bytecode,
        sponsor
    );
    const entryPoint = await EntryPointFactory.deploy();
    await entryPoint.waitForDeployment();

    const AccumulatorVerifierFactory = await ethers.getContractFactory("AccumulatorVerifier");
    const accumulatorVerifier = await AccumulatorVerifierFactory.deploy();
    await accumulatorVerifier.waitForDeployment();

    const SHA256EvaluatorFactory = await ethers.getContractFactory("SHA256Evaluator");
    const sha256Evaluator = await SHA256EvaluatorFactory.deploy();
    await sha256Evaluator.waitForDeployment();

    const CommitmentOpenerFactory = await ethers.getContractFactory("CommitmentOpener");
    const commitmentOpener = await CommitmentOpenerFactory.deploy();
    await commitmentOpener.waitForDeployment();

    const DisputeSOXHelpersFactory = await ethers.getContractFactory("DisputeSOXHelpers");
    const disputeHelpers = await DisputeSOXHelpersFactory.deploy();
    await disputeHelpers.waitForDeployment();

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

    const optimisticAccount = await OptimisticSOXAccountFactory.connect(sponsor).deploy(
        await entryPoint.getAddress(),
        await vendor.getAddress(),
        await buyer.getAddress(),
        parseEther("0.001"),
        parseEther("0.0001"),
        parseEther("0.0001"),
        3600n,
        commitmentHex,
        numBlocks,
        numGates,
        await vendor.getAddress(),
        { value: parseEther("1") }
    );
    await optimisticAccount.waitForDeployment();

    await optimisticAccount.connect(buyer).sendPayment({ value: parseEther("0.0011") });
    const keyHex = bytes_to_hex(key);
    const keyBytes = ethers.getBytes(keyHex);
    await optimisticAccount.connect(vendor).sendKey(keyBytes);
    await optimisticAccount.connect(sbSponsor).sendBuyerDisputeSponsorFee({
        value: DISPUTE_FEES + parseEther("0.0001"),
    });
    await optimisticAccount.connect(svSponsor).sendVendorDisputeSponsorFee({
        value: DISPUTE_FEES + parseEther("0.0001") + parseEther("0.001"),
    });
    
    const disputeAddress = await optimisticAccount.disputeContract();
    const dispute = await ethers.getContractAt("DisputeSOXAccount", disputeAddress);

    // Naviguer jusqu'à WaitVendorDataRight
    let state = Number(await dispute.currState());
    while (state === 0) {
        const challenge = Number(await dispute.chall());
        const response = hpre_v2(evaluatedBytes, numBlocks, challenge);
        const responseHex = bytes_to_hex(response);
        await dispute.connect(buyer).respondChallenge(responseHex);
        
        const computedResponse = hpre_v2(evaluatedBytes, numBlocks, challenge);
        const computedResponseHex = bytes_to_hex(computedResponse);
        const latestResponse = await dispute.getLatestBuyerResponse();
        const vendorAgrees = computedResponseHex === latestResponse;
        
        await dispute.connect(vendor).giveOpinion(vendorAgrees);
        state = Number(await dispute.currState());
        
        if (state === 4) break;
    }
    
    const root = await dispute.buyerResponses(numGates);
    console.log("  ✅ Contrats déployés et dispute configurée");
    console.log(`  Root (buyerResponses[${numGates}]): ${root}`);
    console.log("");

    // ============================================
    // ÉTAPE 4: Test de vérification avec différents indices
    // ============================================
    console.log("🧪 ÉTAPE 4: Tests de vérification avec différents indices...");
    
    const TestAccumulatorVerifierFactory = await ethers.getContractFactory("TestAccumulatorVerifier", {
        libraries: {
            AccumulatorVerifier: await accumulatorVerifier.getAddress(),
        },
    });
    const testVerifier = await TestAccumulatorVerifierFactory.deploy();
    await testVerifier.waitForDeployment();
    
    // COMP gate retourne 64 bytes: [0x01, 0x00, ..., 0x00] si égal
    const trueBytes = new Uint8Array(64);
    trueBytes[0] = 0x01;
    const trueBytesHex = bytes_to_hex(trueBytes);
    const expectedValue = ethers.keccak256(trueBytesHex);
    
    const proofBytes32: string[][] = proof.map((layer: Uint8Array[]) =>
        layer.map((item: Uint8Array) => ethers.hexlify(new Uint8Array(item)))
    );
    
    console.log(`  Valeur attendue (keccak256(0x01)): ${expectedValue}`);
    console.log(`  Root: ${root}`);
    console.log("");
    
    // Tester avec différents indices
    for (let idx = 0; idx < numGates; idx++) {
        const idxArr = [idx];
        const trueKeccakArr = [expectedValue];
        
        try {
            const verified = await testVerifier.verify(
                root,
                idxArr,
                trueKeccakArr,
                proofBytes32
            );
            
            console.log(`  Index ${idx}: ${verified ? "✅ RÉUSSI" : "❌ ÉCHOUÉ"}`);
        } catch (error: any) {
            console.log(`  Index ${idx}: ❌ ERREUR - ${error.message.slice(0, 50)}`);
        }
    }
    console.log("");

    // ============================================
    // ÉTAPE 5: Tester avec la valeur réelle du dernier gate
    // ============================================
    console.log("🔍 ÉTAPE 5: Calcul de la valeur réelle du dernier gate...");
    
    // Le dernier gate devrait être un COMP gate
    // On peut essayer de calculer sa valeur en évaluant le circuit
    // Mais pour l'instant, testons avec différentes valeurs possibles
    
    // COMP gate retourne 64 bytes
    const possibleValues = [
        (() => { const v = new Uint8Array(64); v[0] = 0x01; return v; })(), // Si les fichiers sont identiques
        new Uint8Array(64), // Si les fichiers sont différents (tous zeros)
    ];
    
    for (const val of possibleValues) {
        const valHex = bytes_to_hex(val);
        const valKeccak = ethers.keccak256(valHex);
        const idxArr = [numGates - 1];
        const valKeccakArr = [valKeccak];
        
        try {
            const verified = await testVerifier.verify(
                root,
                idxArr,
                valKeccakArr,
                proofBytes32
            );
            
            console.log(`  Valeur ${bytes_to_hex(val)} (keccak: ${valKeccak.slice(0, 20)}...): ${verified ? "✅ RÉUSSI" : "❌ ÉCHOUÉ"}`);
        } catch (error: any) {
            console.log(`  Valeur ${bytes_to_hex(val)}: ❌ ERREUR`);
        }
    }
    console.log("");

    // ============================================
    // ÉTAPE 6: Vérifier la structure de la preuve
    // ============================================
    console.log("📊 ÉTAPE 6: Structure de la preuve...");
    for (let i = 0; i < proofBytes32.length; i++) {
        console.log(`  Niveau ${i}: ${proofBytes32[i].length} éléments`);
        if (proofBytes32[i].length > 0) {
            console.log(`    Premier élément: ${proofBytes32[i][0].slice(0, 20)}...`);
        }
    }
    console.log("");

    console.log("=".repeat(80));
    console.log("✅ TEST TERMINÉ");
    console.log("=".repeat(80));
}

main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error(error);
        process.exit(1);
    });

