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
    compute_proofs_v2,
    compute_proofs_left_v2,
    compute_proof_right_v2,
    evaluate_circuit_v2_wasm,
    hpre_v2,
    initSync,
} from "../../app/lib/crypto_lib/crypto_lib";
import EntryPointArtifact from "@account-abstraction/contracts/artifacts/EntryPoint.json";

const DISPUTE_FEES = 10n;
const SPONSOR_FEES = 5n;

const DISPUTE_STATE_NAMES = [
    "ChallengeBuyer",
    "WaitVendorOpinion",
    "WaitVendorData",
    "WaitVendorDataLeft",
    "WaitVendorDataRight",
    "Complete",
    "Cancel",
    "End",
];

function stateName(state: number): string {
    return DISPUTE_STATE_NAMES[state] || `Unknown(${state})`;
}

async function main() {
    const [sponsor, buyer, vendor, sbSponsor, svSponsor] = await hre.ethers.getSigners();
    const provider = ethers.provider;

    console.log("=".repeat(80));
    console.log("🧪 TEST DISPUTE COMPLÈTE AVEC FICHIER test_65bytes.bin");
    console.log("=".repeat(80));
    console.log("\n📋 Comptes:");
    console.log("  Sponsor:", await sponsor.getAddress());
    console.log("  Buyer:", await buyer.getAddress());
    console.log("  Vendor:", await vendor.getAddress());
    console.log("  Buyer Dispute Sponsor:", await sbSponsor.getAddress());
    console.log("  Vendor Dispute Sponsor:", await svSponsor.getAddress());
    console.log("");

    // ============================================
    // ÉTAPE 0: Initialiser WASM et préparer le fichier
    // ============================================
    console.log("📁 ÉTAPE 0: Initialisation WASM et préparation du fichier test_65bytes.bin...");
    
    // Initialiser WASM
    const modulePath = join(__dirname, "../../app/lib/crypto_lib/crypto_lib_bg.wasm");
    const module = await readFile(modulePath);
    initSync({ module: module });
    console.log("  ✅ WASM module initialisé");
    
    // Lire le fichier
    const filePath = path.join(__dirname, "../../../test_65bytes.bin");
    if (!fs.existsSync(filePath)) {
        throw new Error(`❌ Fichier non trouvé: ${filePath}`);
    }
    
    const fileBuffer = fs.readFileSync(filePath);
    const fileContent = new Uint8Array(fileBuffer);
    console.log(`  ✅ Fichier lu: ${fileContent.length} bytes`);
    
    // Générer la clé et calculer le precontract
    let key = new Uint8Array(16);
    for (let i = 0; i < key.length; i++) {
        key[i] = (i * 17) % 256;
    }
    console.log("  🔑 Clé générée");
    
    console.log("  📝 Calcul du precontract (chiffrement + circuit + commitment)...");
    const precontract = compute_precontract_values_v2(fileContent, key);
    const commitment = precontract.commitment; // { c: Uint8Array, o: Uint8Array }
    const commitmentHex = bytes_to_hex(commitment.c);
    const openingValueHex = bytes_to_hex(commitment.o);
    const numBlocks = precontract.num_blocks;
    const numGates = precontract.num_gates;
    const circuitBytes = precontract.circuit_bytes;
    const ct = precontract.ct;
    
    console.log(`  ✅ Precontract calculé:`);
    console.log(`     numBlocks: ${numBlocks}`);
    console.log(`     numGates: ${numGates}`);
    console.log(`     commitment: ${commitmentHex.slice(0, 20)}...`);
    console.log(`     opening_value: ${openingValueHex.slice(0, 20)}...`);
    
    // Évaluer le circuit (nécessaire pour les preuves)
    console.log("  📝 Évaluation du circuit...");
    const evaluatedBytes = evaluate_circuit_v2_wasm(
        circuitBytes,
        ct,
        bytes_to_hex(key)
    ).to_bytes();
    console.log("  ✅ Circuit évalué");
    console.log("");

    // ============================================
    // ÉTAPE 1: Déployer EntryPoint
    // ============================================
    console.log("🔐 ÉTAPE 1: Déploiement EntryPoint...");
    const EntryPointFactory = new ethers.ContractFactory(
        EntryPointArtifact.abi,
        EntryPointArtifact.bytecode,
        sponsor
    );
    const entryPoint = await EntryPointFactory.deploy();
    await entryPoint.waitForDeployment();
    const entryPointAddress = await entryPoint.getAddress();
    console.log("  ✅ EntryPoint déployé à:", entryPointAddress);
    console.log("");

    // ============================================
    // ÉTAPE 2: Déployer les libraries
    // ============================================
    console.log("📚 ÉTAPE 2: Déploiement des libraries...");
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

    console.log("  ✅ Libraries déployées");
    console.log("");

    // ============================================
    // ÉTAPE 3: Déployer DisputeDeployer
    // ============================================
    console.log("📦 ÉTAPE 3: Déploiement de DisputeDeployer...");
    const DisputeDeployerFactory = await ethers.getContractFactory("DisputeDeployer", {
        libraries: {
            AccumulatorVerifier: await accumulatorVerifier.getAddress(),
            CommitmentOpener: await commitmentOpener.getAddress(),
            SHA256Evaluator: await sha256Evaluator.getAddress(),
        },
    });
    const disputeDeployer = await DisputeDeployerFactory.deploy();
    await disputeDeployer.waitForDeployment();
    console.log("  ✅ DisputeDeployer:", await disputeDeployer.getAddress());
    console.log("");

    // ============================================
    // ÉTAPE 4: Déployer OptimisticSOXAccount et déclencher la dispute
    // ============================================
    console.log("🚀 ÉTAPE 4: Déploiement et configuration jusqu'à la dispute...");
    const OptimisticSOXAccountFactory = await ethers.getContractFactory("OptimisticSOXAccount", {
        libraries: {
            DisputeDeployer: await disputeDeployer.getAddress(),
        },
    });

    const sponsorAmount = parseEther("1");
    const agreedPrice = parseEther("0.001");
    const completionTip = parseEther("0.0001");
    const disputeTip = parseEther("0.0001");
    const timeoutIncrement = 3600n;
    
    const commitmentBytes32 = commitmentHex;

    const optimisticAccount = await OptimisticSOXAccountFactory.connect(sponsor).deploy(
        entryPointAddress,
        await vendor.getAddress(),
        await buyer.getAddress(),
        agreedPrice,
        completionTip,
        disputeTip,
        timeoutIncrement,
        commitmentBytes32,
        numBlocks,
        numGates,
        await vendor.getAddress(),
        { value: sponsorAmount }
    );
    await optimisticAccount.waitForDeployment();
    const optimisticAddress = await optimisticAccount.getAddress();
    console.log("  ✅ OptimisticSOXAccount déployé à:", optimisticAddress);

    // Buyer envoie le paiement
    const paymentAmount = agreedPrice + completionTip;
    await optimisticAccount.connect(buyer).sendPayment({ value: paymentAmount });
    console.log("  ✅ Buyer a payé");

    // Vendor envoie la clé
    const keyHex = bytes_to_hex(key);
    const keyBytes = ethers.getBytes(keyHex);
    await optimisticAccount.connect(vendor).sendKey(keyBytes);
    console.log("  ✅ Vendor a envoyé la clé");

    // Buyer dispute sponsor paie
    const sbAmount = DISPUTE_FEES + disputeTip;
    await optimisticAccount.connect(sbSponsor).sendBuyerDisputeSponsorFee({
        value: sbAmount,
    });
    console.log("  ✅ Buyer dispute sponsor a payé");

    // Vendor dispute sponsor paie (déclenche la dispute)
    const svAmount = DISPUTE_FEES + disputeTip + agreedPrice;
    await optimisticAccount.connect(svSponsor).sendVendorDisputeSponsorFee({
        value: svAmount,
    });
    console.log("  ✅ Vendor dispute sponsor a payé - DISPUTE DÉCLENCHÉE");
    
    const disputeAddress = await optimisticAccount.disputeContract();
    const dispute = await ethers.getContractAt("DisputeSOXAccount", disputeAddress);
    console.log("  ✅ DisputeSOXAccount:", disputeAddress);
    console.log("");

    // ============================================
    // ÉTAPE 5: Résoudre la dispute complètement
    // ============================================
    console.log("⚔️  ÉTAPE 5: Résolution complète de la dispute (comme l'interface)...");
    console.log("-".repeat(80));
    
    let state = Number(await dispute.currState());
    console.log(`  📊 État initial: ${stateName(state)}`);
    
    const maxRounds = Math.ceil(Math.log2(numGates)) + 10; // Limite de sécurité
    let roundCount = 0;
    
    // Phase 1: Rounds de challenge-response jusqu'à un état de preuve
    while (state === 0 && roundCount < maxRounds) { // State 0 = ChallengeBuyer
        const challenge = Number(await dispute.chall());
        console.log(`  🔄 Round ${roundCount + 1}: challenge = ${challenge} (1-indexed)`);
        
        // Buyer répond au challenge avec hpre_v2 (comme l'interface)
        const response = hpre_v2(evaluatedBytes, numBlocks, challenge);
        const responseHex = bytes_to_hex(response);
        await dispute.connect(buyer).respondChallenge(responseHex);
        console.log(`    ✅ Buyer a répondu: ${responseHex.slice(0, 20)}...`);
        
        // Vendor calcule sa réponse et donne son opinion (comme l'interface)
        const computedResponse = hpre_v2(evaluatedBytes, numBlocks, challenge);
        const computedResponseHex = bytes_to_hex(computedResponse);
        const latestResponse = await dispute.getLatestBuyerResponse();
        const vendorAgrees = computedResponseHex === latestResponse;
        
        await dispute.connect(vendor).giveOpinion(vendorAgrees);
        console.log(`    ${vendorAgrees ? "✅" : "❌"} Vendor ${vendorAgrees ? "agreed" : "disagreed"}`);
        
        state = Number(await dispute.currState());
        console.log(`    📊 Nouvel état: ${stateName(state)}`);
        roundCount++;
        
        if (state !== 0) {
            break; // On est sorti de ChallengeBuyer
        }
    }
    
    if (state === 0) {
        throw new Error(`❌ Trop de rounds (${roundCount}). État toujours ChallengeBuyer.`);
    }
    
    console.log(`  ✅ Sortie des rounds après ${roundCount} rounds. État: ${stateName(state)}`);
    console.log("");
    
    // Phase 2: Envoyer les preuves selon l'état
    const maxPhases = 10; // Limite de sécurité
    let phaseCount = 0;
    
    while ((state === 2 || state === 3 || state === 4) && phaseCount < maxPhases) {
        phaseCount++;
        console.log(`  📤 Phase ${phaseCount}: Envoi des preuves pour état ${stateName(state)}...`);
        
        const gateNum = Number(await dispute.a());
        console.log(`    Gate number: ${gateNum} (1-indexed)`);
        
        if (state === 4) {
            // WaitVendorDataRight - submitCommitmentRight
            // Note: Quand on arrive à WaitVendorDataRight, chall = numGates + 1
            // Le contrat utilise buyerResponses[numGates] car hpre(numGates + 1) = hpre(numGates)
            console.log("    📝 Calcul de la preuve avec compute_proof_right_v2...");
            const proof = compute_proof_right_v2(evaluatedBytes, numBlocks, numGates);
            
            // Convertir la preuve en format bytes32[][]
            const proofBytes32: string[][] = proof.map((layer: Uint8Array[]) =>
                layer.map((item: Uint8Array) => ethers.hexlify(new Uint8Array(item)))
            );
            
            console.log("    📤 Envoi de submitCommitmentRight...");
            await dispute.connect(vendor).submitCommitmentRight(proofBytes32);
            console.log("    ✅ submitCommitmentRight envoyé");
            
        } else if (state === 3) {
            // WaitVendorDataLeft - submitCommitmentLeft
            console.log("    📝 Calcul des preuves avec compute_proofs_left_v2...");
            const proofs = compute_proofs_left_v2(circuitBytes, evaluatedBytes, ct, gateNum);
            
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
            
            console.log("    📤 Envoi de submitCommitmentLeft...");
            await dispute.connect(vendor).submitCommitmentLeft(
                commitment.o,
                gateNum,
                gateBytesArray,
                valuesArray,
                currAccArray,
                proof1Array,
                proof2Array,
                proofExtArray
            );
            console.log("    ✅ submitCommitmentLeft envoyé");
            
        } else {
            // WaitVendorData - submitCommitment
            console.log("    📝 Calcul des preuves avec compute_proofs_v2...");
            const proofs = compute_proofs_v2(circuitBytes, evaluatedBytes, ct, gateNum);
            
            const gateBytesArray = new Uint8Array(proofs.gate_bytes);
            const valuesArray = proofs.values.map((v: Uint8Array) => new Uint8Array(v));
            const currAccArray = new Uint8Array(proofs.curr_acc);
            const proof1Array = proofs.proof1.map((level: Uint8Array[]) =>
                level.map((v: Uint8Array) => ethers.hexlify(new Uint8Array(v)))
            );
            const proof2Array = proofs.proof2.map((level: Uint8Array[]) =>
                level.map((v: Uint8Array) => ethers.hexlify(new Uint8Array(v)))
            );
            const proof3Array = proofs.proof3.map((level: Uint8Array[]) =>
                level.map((v: Uint8Array) => ethers.hexlify(new Uint8Array(v)))
            );
            const proofExtArray = proofs.proof_ext.map((level: Uint8Array[]) =>
                level.map((v: Uint8Array) => ethers.hexlify(new Uint8Array(v)))
            );
            
            console.log("    📤 Envoi de submitCommitment...");
            await dispute.connect(vendor).submitCommitment(
                commitment.o,
                gateNum,
                gateBytesArray,
                valuesArray,
                currAccArray,
                proof1Array,
                proof2Array,
                proof3Array,
                proofExtArray
            );
            console.log("    ✅ submitCommitment envoyé");
        }
        
        state = Number(await dispute.currState());
        console.log(`    📊 Nouvel état: ${stateName(state)}`);
        
        // Si on est dans un état final, arrêter la boucle de preuves
        if (state === 5 || state === 6) {
            break;
        }
    }
    
    console.log("");
    console.log(`  📊 État final après preuves: ${stateName(state)}`);
    
    // Phase 3: Finaliser la dispute
    if (state === 5) {
        // Complete - Buyer doit compléter
        console.log("  ✅ État Complete - Buyer complète la dispute...");
        await dispute.connect(buyer).completeDispute();
        state = Number(await dispute.currState());
        console.log(`  📊 État après completeDispute: ${stateName(state)}`);
    } else if (state === 6) {
        // Cancel - Vendor doit annuler
        console.log("  ❌ État Cancel - Vendor annule la dispute...");
        await dispute.connect(vendor).cancelDispute();
        state = Number(await dispute.currState());
        console.log(`  📊 État après cancelDispute: ${stateName(state)}`);
    }
    
    const lastLosingPartyWasVendor = await dispute.lastLosingPartyWasVendor();
    
    console.log("");
    console.log("=".repeat(80));
    console.log("✅ TEST TERMINÉ - Dispute résolue complètement!");
    console.log("=".repeat(80));
    console.log("\n📝 Résumé:");
    console.log(`  - Fichier testé: test_65bytes.bin (${fileContent.length} bytes)`);
    console.log(`  - OptimisticSOXAccount: ${optimisticAddress}`);
    console.log(`  - DisputeSOXAccount: ${disputeAddress}`);
    console.log(`  - État final: ${stateName(state)}`);
    console.log(`  - Rounds de challenge: ${roundCount}`);
    console.log(`  - Phases de preuve: ${phaseCount}`);
    console.log(`  - Dernier perdant: ${lastLosingPartyWasVendor ? "Vendor" : "Buyer"}`);
    console.log(`  - Clé utilisée: ${keyHex}`);
    
    if (state === 7) {
        if (lastLosingPartyWasVendor) {
            console.log("\n🎉 Résultat: BUYER GAGNE (vendor a perdu)");
        } else {
            console.log("\n🎉 Résultat: VENDOR GAGNE (buyer a perdu)");
        }
    } else {
        console.log(`\n⚠️  État final inattendu: ${stateName(state)}`);
    }
    console.log("");
}

main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error(error);
        process.exit(1);
    });

