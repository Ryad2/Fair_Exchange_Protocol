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
    initSync,
} from "../../app/lib/crypto_lib/crypto_lib";
import EntryPointArtifact from "@account-abstraction/contracts/artifacts/EntryPoint.json";

const CANONICAL_ENTRYPOINT_V8 = "0x4337084D9E255Ff0702461CF8895CE9E3b5Ff108";
const DISPUTE_FEES = 10n; // From OptimisticSOXAccount.sol
const SPONSOR_FEES = 5n; // From OptimisticSOXAccount.sol

async function main() {
    const [sponsor, buyer, vendor, sbSponsor, svSponsor] = await hre.ethers.getSigners();
    const provider = ethers.provider;

    console.log("=".repeat(80));
    console.log("🧪 TEST DISPUTE AVEC FICHIER test_65bytes.bin");
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
    
    // Lire le fichier (à la racine du projet)
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
    
    console.log(`  ✅ Precontract calculé:`);
    console.log(`     numBlocks: ${numBlocks}`);
    console.log(`     numGates: ${numGates}`);
    console.log(`     commitment: ${commitmentHex.slice(0, 20)}...`);
    console.log(`     opening_value: ${openingValueHex.slice(0, 20)}...`);
    console.log("");

    // ============================================
    // ÉTAPE 1: Déployer EntryPoint (pour test local)
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
    // ÉTAPE 4: Déployer OptimisticSOXAccount
    // ============================================
    console.log("🚀 ÉTAPE 4: Déploiement de OptimisticSOXAccount...");
    const OptimisticSOXAccountFactory = await ethers.getContractFactory("OptimisticSOXAccount", {
        libraries: {
            DisputeDeployer: await disputeDeployer.getAddress(),
        },
    });

    const sponsorAmount = parseEther("1");
    const agreedPrice = parseEther("0.001");
    const completionTip = parseEther("0.0001");
    const disputeTip = parseEther("0.0001");
    const timeoutIncrement = 3600n; // 1 hour
    
    // Utiliser les valeurs calculées depuis le precontract
    // bytes_to_hex retourne déjà une string avec "0x"
    const commitmentBytes32 = commitmentHex; // bytes_to_hex retourne déjà "0x..."
    
    console.log(`  📊 Paramètres du contrat:`);
    console.log(`     numBlocks: ${numBlocks}`);
    console.log(`     numGates: ${numGates}`);
    console.log(`     commitment: ${commitmentBytes32.slice(0, 20)}...`);

    const optimisticAccount = await OptimisticSOXAccountFactory.connect(sponsor).deploy(
        entryPointAddress, // Utiliser l'EntryPoint déployé pour le test
        await vendor.getAddress(),
        await buyer.getAddress(),
        agreedPrice,
        completionTip,
        disputeTip,
        timeoutIncrement,
        commitmentBytes32,
        numBlocks,
        numGates,
        await vendor.getAddress(), // vendorSigner
        { value: sponsorAmount }
    );
    await optimisticAccount.waitForDeployment();
    const optimisticAddress = await optimisticAccount.getAddress();
    console.log("  ✅ OptimisticSOXAccount déployé à:", optimisticAddress);
    console.log("");

    // ============================================
    // ÉTAPE 5: Buyer envoie le paiement
    // ============================================
    console.log("💰 ÉTAPE 5: Buyer envoie le paiement...");
    const paymentAmount = agreedPrice + completionTip;
    const tx1 = await optimisticAccount.connect(buyer).sendPayment({ value: paymentAmount });
    await tx1.wait();
    console.log("  ✅ Paiement envoyé:", tx1.hash);
    let currentState = await optimisticAccount.currState();
    console.log("  📊 État après paiement:", currentState.toString(), "(1 = WaitKey)");
    console.log("");

    // ============================================
    // ÉTAPE 6: Vendor envoie la clé
    // ============================================
    console.log("🔑 ÉTAPE 6: Vendor envoie la clé...");
    // Convertir la clé Uint8Array en bytes pour ethers (sendKey attend bytes)
    const keyHex = bytes_to_hex(key); // Retourne "0x..."
    const keyBytes = ethers.getBytes(keyHex);
    const tx2 = await optimisticAccount.connect(vendor).sendKey(keyBytes);
    await tx2.wait();
    console.log("  ✅ Clé envoyée:", tx2.hash);
    console.log("  🔑 Clé (hex):", keyHex);
    currentState = await optimisticAccount.currState();
    console.log("  📊 État après clé:", currentState.toString(), "(2 = WaitSB)");
    console.log("");

    // ============================================
    // ÉTAPE 7: Buyer dispute sponsor paie
    // ============================================
    console.log("👤 ÉTAPE 7: Buyer dispute sponsor paie...");
    const sbAmount = DISPUTE_FEES + disputeTip;
    const tx3 = await optimisticAccount.connect(sbSponsor).sendBuyerDisputeSponsorFee({
        value: sbAmount,
    });
    await tx3.wait();
    console.log("  ✅ Buyer dispute sponsor a payé:", tx3.hash);
    currentState = await optimisticAccount.currState();
    console.log("  📊 État après frais buyer sponsor:", currentState.toString(), "(3 = WaitSV)");
    console.log("");

    // ============================================
    // ÉTAPE 8: Vendor dispute sponsor paie (déclenche la dispute)
    // ============================================
    console.log("🧪 ÉTAPE 8: Vendor dispute sponsor paie (déclenche la dispute)...");
    const svAmount = DISPUTE_FEES + disputeTip + agreedPrice;
    const tx4 = await optimisticAccount.connect(svSponsor).sendVendorDisputeSponsorFee({
        value: svAmount,
    });
    await tx4.wait();
    console.log("  ✅ Vendor dispute sponsor a payé:", tx4.hash);
    currentState = await optimisticAccount.currState();
    console.log("  📊 État après frais vendor sponsor:", currentState.toString(), "(4 = InDispute)");
    
    const disputeAddress = await optimisticAccount.disputeContract();
    console.log("  ✅ DisputeSOXAccount déployé à:", disputeAddress);
    console.log("");

    // ============================================
    // ÉTAPE 9: Vérification du contrat de dispute
    // ============================================
    console.log("🔍 ÉTAPE 9: Vérification du contrat de dispute...");
    const dispute = await ethers.getContractAt("DisputeSOXAccount", disputeAddress);
    
    const disputeState = await dispute.currState();
    const disputeStateNames = [
        "ChallengeBuyer",
        "WaitVendorOpinion",
        "WaitVendorData",
        "WaitVendorDataLeft",
        "WaitVendorDataRight",
        "Complete",
        "Cancel",
        "End"
    ];
    console.log("  📊 État de la dispute:", disputeStateNames[Number(disputeState)], `(${disputeState})`);
    console.log("  📊 numBlocks:", (await dispute.numBlocks()).toString());
    console.log("  📊 numGates:", (await dispute.numGates()).toString());
    console.log("  📊 challenge (chall):", (await dispute.chall()).toString());
    console.log("");

    console.log("=".repeat(80));
    console.log("✅ TEST TERMINÉ - Dispute déclenchée avec succès!");
    console.log("=".repeat(80));
    console.log("\n📝 Résumé:");
    console.log(`  - Fichier testé: test_65bytes.bin (${fileContent.length} bytes)`);
    console.log(`  - OptimisticSOXAccount: ${optimisticAddress}`);
    console.log(`  - DisputeSOXAccount: ${disputeAddress}`);
    console.log(`  - État de la dispute: ${disputeStateNames[Number(disputeState)]}`);
    console.log(`  - Clé utilisée: ${bytes_to_hex(key)}`);
    console.log(`  - Commitment: ${commitmentBytes32.slice(0, 20)}...`);
    console.log(`  - Opening value: ${openingValueHex.slice(0, 20)}...`);
    console.log(`  - numBlocks: ${numBlocks}`);
    console.log(`  - numGates: ${numGates}`);
    console.log("\n✅ Le contrat est prêt pour tester la dispute complète!");
    console.log("   Utilisez le frontend ou un script avec les fonctions de preuve WASM");
    console.log("   pour tester submitCommitment, submitCommitmentLeft, ou submitCommitmentRight.");
    console.log("");
}

main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error(error);
        process.exit(1);
    });

