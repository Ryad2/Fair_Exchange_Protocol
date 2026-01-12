import hre from "hardhat";
import { ethers, parseEther } from "hardhat";
import fs from "fs";
import path from "path";

const CANONICAL_ENTRYPOINT_V8 = "0x4337084D9E255Ff0702461CF8895CE9E3b5Ff108";
const DISPUTE_FEES = 10n; // From OptimisticSOXAccount.sol
const SPONSOR_FEES = 5n; // From OptimisticSOXAccount.sol

async function main() {
    const [sponsor, buyer, vendor, sbSponsor, svSponsor] = await hre.ethers.getSigners();

    console.log("=".repeat(80));
    console.log("🧪 TEST DE DÉPLOIEMENT ET DISPUTE");
    console.log("=".repeat(80));
    console.log("\n📋 Comptes:");
    console.log("  Sponsor:", await sponsor.getAddress());
    console.log("  Buyer:", await buyer.getAddress());
    console.log("  Vendor:", await vendor.getAddress());
    console.log("  Buyer Dispute Sponsor:", await sbSponsor.getAddress());
    console.log("  Vendor Dispute Sponsor:", await svSponsor.getAddress());
    console.log("");

    // ============================================
    // ÉTAPE 1: Vérifier/créer EntryPoint v0.8
    // ============================================
    console.log("🔐 ÉTAPE 1: Vérification EntryPoint v0.8...");
    const entryPointCode = await ethers.provider.getCode(CANONICAL_ENTRYPOINT_V8);
    if (!entryPointCode || entryPointCode === "0x") {
        console.log("  ⚠️  EntryPoint v0.8 pas déployé, déploiement...");
        console.log("  ⚠️  Exécute d'abord: npx hardhat run scripts/deployEntryPointV8.ts --network localhost");
        console.log("  ⚠️  Ou lance ce script après deployEntryPointV8.ts");
        process.exit(1);
    }
    console.log("  ✅ EntryPoint v0.8 trouvé à:", CANONICAL_ENTRYPOINT_V8);
    console.log("");

    // ============================================
    // ÉTAPE 2: Déployer les libraries
    // ============================================
    console.log("📚 ÉTAPE 2: Déploiement des libraries...");
    const AccumulatorVerifierFactory = await ethers.getContractFactory("AccumulatorVerifier");
    const accumulatorVerifier = await AccumulatorVerifierFactory.deploy();
    await accumulatorVerifier.waitForDeployment();
    console.log("  ✅ AccumulatorVerifier:", await accumulatorVerifier.getAddress());

    const SHA256EvaluatorFactory = await ethers.getContractFactory("SHA256Evaluator");
    const sha256Evaluator = await SHA256EvaluatorFactory.deploy();
    await sha256Evaluator.waitForDeployment();
    console.log("  ✅ SHA256Evaluator:", await sha256Evaluator.getAddress());

    const CommitmentOpenerFactory = await ethers.getContractFactory("CommitmentOpener");
    const commitmentOpener = await CommitmentOpenerFactory.deploy();
    await commitmentOpener.waitForDeployment();
    console.log("  ✅ CommitmentOpener:", await commitmentOpener.getAddress());

    const DisputeSOXHelpersFactory = await ethers.getContractFactory("DisputeSOXHelpers");
    const disputeHelpers = await DisputeSOXHelpersFactory.deploy();
    await disputeHelpers.waitForDeployment();
    console.log("  ✅ DisputeSOXHelpers:", await disputeHelpers.getAddress());
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
    const numBlocks = 1024;
    const numGates = 4 * numBlocks + 1;
    const commitment = ethers.ZeroHash;

    const optimisticAccount = await OptimisticSOXAccountFactory.connect(sponsor).deploy(
        CANONICAL_ENTRYPOINT_V8, // EntryPoint v0.8
        await vendor.getAddress(),
        await buyer.getAddress(),
        agreedPrice,
        completionTip,
        disputeTip,
        timeoutIncrement,
        commitment,
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
    // ÉTAPE 5: Flow optimistic (buyer paie, vendor envoie clé)
    // ============================================
    console.log("💰 ÉTAPE 5: Flow optimistic...");
    
    // Buyer paie
    console.log("  📤 Buyer envoie le paiement...");
    await optimisticAccount.connect(buyer).sendPayment({
        value: agreedPrice + completionTip,
    });
    console.log("  ✅ Paiement envoyé");

    // Vendor envoie la clé
    console.log("  🔑 Vendor envoie la clé...");
    const key = ethers.toUtf8Bytes("test-key-12345");
    await optimisticAccount.connect(vendor).sendKey(key);
    console.log("  ✅ Clé envoyée");
    console.log("");

    // ============================================
    // ÉTAPE 6: Buyer dispute sponsor paie
    // ============================================
    console.log("👤 ÉTAPE 6: Buyer dispute sponsor paie...");
    const sbAmount = DISPUTE_FEES + disputeTip;
    await optimisticAccount.connect(sbSponsor).sendBuyerDisputeSponsorFee({
        value: sbAmount,
    });
    console.log("  ✅ Buyer dispute sponsor a payé");
    console.log("  ✅ buyerDisputeSponsor:", await optimisticAccount.buyerDisputeSponsor());
    console.log("");

    // ============================================
    // ÉTAPE 7: TEST - Vendor dispute sponsor paie (LE TEST PRINCIPAL)
    // ============================================
    console.log("🧪 ÉTAPE 7: TEST - Vendor dispute sponsor paie...");
    console.log("  ⚠️  C'est ici que la correction vendorDisputeSponsor est testée!");
    const svAmount = DISPUTE_FEES + disputeTip + agreedPrice;
    console.log("  Montant à envoyer:", svAmount.toString(), "wei");
    
    try {
        const tx = await optimisticAccount.connect(svSponsor).sendVendorDisputeSponsorFee({
            value: svAmount,
        });
        console.log("  📤 Transaction envoyée, attente de confirmation...");
        const receipt = await tx.wait();
        console.log("  ✅ Transaction confirmée!");
        console.log("  ✅ Hash:", receipt?.hash);

        // Vérifier que le contrat de dispute a été déployé
        const disputeAddress = await optimisticAccount.disputeContract();
        console.log("  ✅ Dispute contract déployé à:", disputeAddress);
        
        // Vérifier que vendorDisputeSponsor est correctement défini
        const vendorDisputeSponsor = await optimisticAccount.vendorDisputeSponsor();
        console.log("  ✅ vendorDisputeSponsor:", vendorDisputeSponsor);
        
        if (vendorDisputeSponsor.toLowerCase() !== (await svSponsor.getAddress()).toLowerCase()) {
            throw new Error(`vendorDisputeSponsor mismatch! Expected ${await svSponsor.getAddress()}, got ${vendorDisputeSponsor}`);
        }
        console.log("  ✅ vendorDisputeSponsor correspond au sponsor vendor");

        // Vérifier l'état du contrat optimistic
        const state = await optimisticAccount.currState();
        console.log("  ✅ État OptimisticSOXAccount:", state.toString(), "(5 = InDispute)");

        // Vérifier que le contrat de dispute est accessible
        const DisputeSOXAccountFactory = await ethers.getContractFactory("DisputeSOXAccount");
        const disputeContract = DisputeSOXAccountFactory.attach(disputeAddress);
        const disputeState = await disputeContract.currState();
        console.log("  ✅ État DisputeSOXAccount:", disputeState.toString(), "(0 = ChallengeBuyer)");

        console.log("");
        console.log("=".repeat(80));
        console.log("✅ SUCCESS! La dispute a été déployée correctement!");
        console.log("=".repeat(80));
        console.log("\n📊 Résumé:");
        console.log("  OptimisticSOXAccount:", optimisticAddress);
        console.log("  DisputeSOXAccount:", disputeAddress);
        console.log("  EntryPoint:", CANONICAL_ENTRYPOINT_V8);
        console.log("  buyerDisputeSponsor:", await optimisticAccount.buyerDisputeSponsor());
        console.log("  vendorDisputeSponsor:", await optimisticAccount.vendorDisputeSponsor());
        console.log("");

    } catch (error: any) {
        console.log("");
        console.log("=".repeat(80));
        console.log("❌ ERREUR lors du déploiement de la dispute!");
        console.log("=".repeat(80));
        console.log("\nErreur:", error.message);
        if (error.reason) {
            console.log("Raison:", error.reason);
        }
        if (error.data) {
            console.log("Data:", error.data);
        }
        console.log("\n💡 Vérifications:");
        console.log("  - EntryPoint v0.8 est déployé à", CANONICAL_ENTRYPOINT_V8);
        console.log("  - Le code de DisputeSOXAccount a été compilé avec la correction vendorDisputeSponsor");
        console.log("  - DisputeDeployer a été redéployé avec le nouveau bytecode");
        console.log("");
        process.exit(1);
    }
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});



