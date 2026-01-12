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

const TARGET_GATE = 5; // Porte 5 que nous voulons tester

async function main() {
    const [sponsor, buyer, vendor, sbSponsor, svSponsor] = await hre.ethers.getSigners();
    const provider = ethers.provider;

    console.log("=".repeat(80));
    console.log(`🧪 TEST SPÉCIFIQUE - PORTE ${TARGET_GATE} AVEC test_65bytes.bin`);
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

    // Vérifier que TARGET_GATE est valide
    if (TARGET_GATE < 1 || TARGET_GATE > numGates) {
        throw new Error(`❌ TARGET_GATE (${TARGET_GATE}) doit être entre 1 et ${numGates}`);
    }
    console.log(`  🎯 Cible: Porte ${TARGET_GATE} (1-indexed)`);
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
    // ÉTAPE 5: Naviguer jusqu'à la porte TARGET_GATE
    // ============================================
    console.log(`⚔️  ÉTAPE 5: Navigation jusqu'à la porte ${TARGET_GATE}...`);
    console.log("-".repeat(80));
    
    let state = Number(await dispute.currState());
    console.log(`  📊 État initial: ${stateName(state)}`);
    
    const maxRounds = Math.ceil(Math.log2(numGates)) + 10; // Limite de sécurité
    let roundCount = 0;
    
    // Phase 1: Rounds de challenge-response jusqu'à atteindre TARGET_GATE exactement
    while (roundCount < maxRounds) {
        state = Number(await dispute.currState());
        
        // Si on est déjà à WaitVendorData avec la bonne porte, on sort
        if (state === 2) {
            const gateNum = Number(await dispute.a());
            if (gateNum === TARGET_GATE) {
                console.log(`    ✅ PORTE ${TARGET_GATE} ATTEINTE!`);
                break;
            }
        }
        
        // Si on n'est pas en ChallengeBuyer, on ne peut pas continuer
        if (state !== 0) {
            const gateNum = Number(await dispute.a());
            console.log(`    ⚠️  Sorti de ChallengeBuyer à l'état ${stateName(state)}, porte ${gateNum}`);
            if (gateNum !== TARGET_GATE) {
                console.log(`    ⚠️  Porte ${gateNum} != ${TARGET_GATE}, on ne peut pas continuer la navigation`);
                break;
            }
        }
        
        // On doit être en ChallengeBuyer pour continuer
        if (state !== 0) break;
        
        const challenge = Number(await dispute.chall());
        const a = Number(await dispute.a());
        const b = Number(await dispute.b());
        console.log(`  🔄 Round ${roundCount + 1}: challenge = ${challenge}, a = ${a}, b = ${b} (1-indexed)`);
        
        // Buyer répond au challenge avec hpre_v2
        // IMPORTANT: À la porte TARGET_GATE, on force le buyer à donner une MAUVAISE réponse
        // pour tester que le vendor gagne avec les bonnes preuves
        let response: Uint8Array;
        if (challenge === TARGET_GATE) {
            // Donner une mauvaise réponse (tous les bits à 1)
            response = new Uint8Array(32);
            response.fill(0xFF);
            console.log(`    ⚠️  Buyer donne une MAUVAISE réponse intentionnelle à la porte ${TARGET_GATE}`);
        } else {
            // Donner la bonne réponse pour les autres challenges
            response = hpre_v2(evaluatedBytes, numBlocks, challenge);
        }
        const responseHex = bytes_to_hex(response);
        await dispute.connect(buyer).respondChallenge(responseHex);
        console.log(`    ✅ Buyer a répondu: ${responseHex.slice(0, 20)}...`);
        
        // Vendor calcule sa réponse et donne son opinion
        const computedResponse = hpre_v2(evaluatedBytes, numBlocks, challenge);
        const computedResponseHex = bytes_to_hex(computedResponse);
        const latestResponse = await dispute.getLatestBuyerResponse();
        const vendorAgrees = computedResponseHex === latestResponse;
        
        // Stratégie pour atteindre TARGET_GATE exactement
        // On veut que a = TARGET_GATE et b = TARGET_GATE, donc chall = TARGET_GATE
        let vendorShouldAgree = vendorAgrees;
        if (challenge < TARGET_GATE) {
            // On veut augmenter a, donc vendor doit être d'accord
            vendorShouldAgree = true;
        } else if (challenge > TARGET_GATE) {
            // On veut diminuer b, donc vendor doit être en désaccord
            vendorShouldAgree = false;
        } else {
            // challenge == TARGET_GATE, on veut que vendor soit d'accord pour fixer a = TARGET_GATE
            // Mais si vendor est d'accord, alors a = chall + 1 = TARGET_GATE + 1, ce qui n'est pas bon
            // Si vendor est en désaccord, alors b = chall = TARGET_GATE, ce qui est mieux
            // En fait, pour que a = b = TARGET_GATE, on a besoin que:
            // - Si challenge == TARGET_GATE et vendor est d'accord: a = TARGET_GATE + 1, b reste
            // - Si challenge == TARGET_GATE et vendor est en désaccord: b = TARGET_GATE, a reste
            // On veut a = TARGET_GATE, donc on doit avoir été en désaccord avant pour fixer b = TARGET_GATE
            // puis être d'accord pour fixer a = TARGET_GATE
            // Mais en fait, si challenge == TARGET_GATE, on veut que vendor soit en désaccord pour fixer b = TARGET_GATE
            // puis au round suivant, si challenge == TARGET_GATE - 1, vendor doit être d'accord pour fixer a = TARGET_GATE
            // C'est compliqué... Essayons une approche plus simple: on force vendor à être en désaccord si challenge >= TARGET_GATE
            vendorShouldAgree = false; // Force disagreement pour fixer b = TARGET_GATE
        }
        
        await dispute.connect(vendor).giveOpinion(vendorShouldAgree);
        console.log(`    ${vendorShouldAgree ? "✅" : "❌"} Vendor ${vendorShouldAgree ? "agreed" : "disagreed"} (stratégie pour atteindre porte ${TARGET_GATE})`);
        
        state = Number(await dispute.currState());
        const newA = Number(await dispute.a());
        const newB = Number(await dispute.b());
        console.log(`    📊 Nouvel état: ${stateName(state)}, a = ${newA}, b = ${newB}`);
        roundCount++;
        
        // Vérifier si on a atteint TARGET_GATE
        if (state === 2 && newA === TARGET_GATE) {
            console.log(`    ✅ PORTE ${TARGET_GATE} ATTEINTE!`);
            break;
        }
    }
    
    state = Number(await dispute.currState());
    const finalGateNum = Number(await dispute.a());
    console.log(`  ✅ Navigation terminée après ${roundCount} rounds. État: ${stateName(state)}, Gate: ${finalGateNum}`);
    
    if (finalGateNum !== TARGET_GATE) {
        console.log(`  ⚠️  ATTENTION: On est à la porte ${finalGateNum} au lieu de ${TARGET_GATE}`);
        console.log(`  ⚠️  Le test continue quand même pour déboguer...`);
    }
    console.log("");

    // ============================================
    // ÉTAPE 6: Générer et soumettre les preuves pour la porte TARGET_GATE
    // ============================================
    console.log(`🔍 ÉTAPE 6: Génération et soumission des preuves pour la porte ${TARGET_GATE}...`);
    console.log("-".repeat(80));
    
    if (state !== 2) {
        throw new Error(`❌ État attendu: WaitVendorData (2), mais obtenu: ${stateName(state)}`);
    }
    
    const gateNum = Number(await dispute.a());
    console.log(`  📊 Gate number du contrat: ${gateNum} (1-indexed)`);
    
    if (gateNum !== TARGET_GATE) {
        console.log(`  ⚠️  ATTENTION: Gate number (${gateNum}) != TARGET_GATE (${TARGET_GATE})`);
    }
    
    // Récupérer buyerResponses[gateNum] du contrat
    const buyerResponseAtGate = await dispute.buyerResponses(gateNum);
    console.log(`  📝 buyerResponses[${gateNum}] (du contrat): ${buyerResponseAtGate}`);
    
    // Générer les preuves
    console.log("  📝 Calcul des preuves avec compute_proofs_v2...");
    const proofs = compute_proofs_v2(circuitBytes, evaluatedBytes, ct, gateNum);
    
    console.log(`  ✅ Preuves générées:`);
    console.log(`     - gate_bytes: ${proofs.gate_bytes.length} bytes`);
    console.log(`     - values: ${proofs.values.length} valeurs`);
    console.log(`     - curr_acc: ${bytes_to_hex(proofs.curr_acc)}`);
    console.log(`     - proof1: ${proofs.proof1.length} niveaux`);
    console.log(`     - proof2: ${proofs.proof2.length} niveaux`);
    console.log(`     - proof3: ${proofs.proof3.length} niveaux`);
    console.log(`     - proof_ext: ${proofs.proof_ext.length} niveaux`);
    
    // Vérifier la condition critique: buyerResponses[gateNum] != currAcc
    const currAccHex = bytes_to_hex(proofs.curr_acc);
    const currAccBytes32 = ethers.hexlify(proofs.curr_acc);
    console.log(`  🔍 VÉRIFICATION CRITIQUE:`);
    console.log(`     buyerResponses[${gateNum}]: ${buyerResponseAtGate}`);
    console.log(`     currAcc (calculé): ${currAccBytes32}`);
    console.log(`     Sont-ils différents? ${buyerResponseAtGate !== currAccBytes32}`);
    
    if (buyerResponseAtGate === currAccBytes32) {
        console.log(`  ⚠️  ATTENTION: buyerResponses[${gateNum}] == currAcc`);
        console.log(`  ⚠️  Cela signifie que le buyer a donné la bonne réponse!`);
        console.log(`  ⚠️  Dans ce cas, le vendor devrait perdre même avec les bonnes preuves.`);
    } else {
        console.log(`  ✅ buyerResponses[${gateNum}] != currAcc - Le buyer a donné une mauvaise réponse`);
    }
    
    // Convertir les preuves au format du contrat
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
    
    console.log("");
    console.log("  📤 Envoi de submitCommitment...");
    
    try {
        // Essayer d'abord avec staticCall pour voir si ça échoue
        console.log("  🔍 Test avec staticCall d'abord...");
        try {
            await dispute.connect(vendor).submitCommitment.staticCall(
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
            console.log("  ✅ staticCall réussi - La transaction devrait passer");
        } catch (staticCallError: any) {
            console.log(`  ❌ staticCall échoué: ${staticCallError.message}`);
            console.log(`  ❌ Cela signifie que submitCommitment va échouer`);
        }
        
        // Maintenant, soumettre vraiment
        const tx = await dispute.connect(vendor).submitCommitment(
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
        const receipt = await tx.wait();
        console.log("  ✅ submitCommitment envoyé et confirmé");
        console.log(`     Transaction hash: ${receipt?.hash}`);
        
        // Vérifier le nouvel état
        state = Number(await dispute.currState());
        console.log(`  📊 Nouvel état après submitCommitment: ${stateName(state)}`);
        
        const lastLosingPartyWasVendor = await dispute.lastLosingPartyWasVendor();
        console.log(`  📊 lastLosingPartyWasVendor: ${lastLosingPartyWasVendor}`);
        
        if (lastLosingPartyWasVendor) {
            console.log(`  ❌ RÉSULTAT: VENDOR A PERDU (buyer a gagné)`);
        } else {
            console.log(`  ✅ RÉSULTAT: VENDOR A GAGNÉ (buyer a perdu)`);
        }
        
    } catch (error: any) {
        console.log(`  ❌ ERREUR lors de submitCommitment: ${error.message}`);
        if (error.data) {
            console.log(`     Error data: ${error.data}`);
        }
        throw error;
    }
    
    console.log("");
    console.log("=".repeat(80));
    console.log("✅ TEST TERMINÉ");
    console.log("=".repeat(80));
    console.log("\n📝 Résumé:");
    console.log(`  - Fichier testé: test_65bytes.bin (${fileContent.length} bytes)`);
    console.log(`  - Porte cible: ${TARGET_GATE}`);
    console.log(`  - Porte atteinte: ${gateNum}`);
    console.log(`  - DisputeSOXAccount: ${disputeAddress}`);
    console.log(`  - État final: ${stateName(state)}`);
    console.log(`  - Rounds de challenge: ${roundCount}`);
    console.log(`  - buyerResponses[${gateNum}]: ${buyerResponseAtGate}`);
    console.log(`  - currAcc (vendor): ${currAccBytes32}`);
    console.log(`  - Dernier perdant: ${await dispute.lastLosingPartyWasVendor() ? "Vendor" : "Buyer"}`);
    console.log("");
}

main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error(error);
        process.exit(1);
    });

