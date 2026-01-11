import hre from "hardhat";
import { ethers } from "hardhat";
import EntryPointArtifact from "@account-abstraction/contracts/artifacts/EntryPoint.json";

/**
 * Script pour redéployer OptimisticSOXAccount avec la nouvelle version corrigée
 * qui exige DISPUTE_FEES + disputeTip + agreedPrice pour sendVendorDisputeSponsorFee
 * 
 * IMPORTANT: On déploie OptimisticSOXAccount (pas OptimisticSOX) car :
 * - Le bundler communique avec OptimisticSOXAccount via l'EntryPoint
 * - OptimisticSOXAccount supporte ERC-4337 (UserOperations)
 * - OptimisticSOX (base) n'a pas de support ERC-4337
 */
async function main() {
    const [sponsor, buyer, vendor] = await hre.ethers.getSigners();

    console.log("=".repeat(80));
    console.log("🚀 Redéploiement de OptimisticSOXAccount avec la nouvelle version corrigée");
    console.log("=".repeat(80));
    console.log("");
    console.log("Signers:");
    console.log("  Sponsor:", await sponsor.getAddress());
    console.log("  Buyer  :", await buyer.getAddress());
    console.log("  Vendor :", await vendor.getAddress());
    console.log("");

    const GWEI_MULT = 1_000_000_000n;

    // --- Déploiement des Libraries ---
    console.log("📚 Déploiement des libraries...");
    
    const AccumulatorVerifierFactory = await ethers.getContractFactory("AccumulatorVerifier");
    const accumulatorVerifier = await AccumulatorVerifierFactory.deploy();
    await accumulatorVerifier.waitForDeployment();
    console.log("  ✅ AccumulatorVerifier:", await accumulatorVerifier.getAddress());

    const SHA256EvaluatorFactory = await ethers.getContractFactory("SHA256Evaluator");
    const sha256Evaluator = await SHA256EvaluatorFactory.deploy();
    await sha256Evaluator.waitForDeployment();
    console.log("  ✅ SHA256Evaluator:", await sha256Evaluator.getAddress());

    const SimpleOperationsEvaluatorFactory = await ethers.getContractFactory("SimpleOperationsEvaluator");
    const simpleOperationsEvaluator = await SimpleOperationsEvaluatorFactory.deploy();
    await simpleOperationsEvaluator.waitForDeployment();
    console.log("  ✅ SimpleOperationsEvaluator:", await simpleOperationsEvaluator.getAddress());

    const AES128CtrEvaluatorFactory = await ethers.getContractFactory("AES128CtrEvaluator");
    const aes128CtrEvaluator = await AES128CtrEvaluatorFactory.deploy();
    await aes128CtrEvaluator.waitForDeployment();
    console.log("  ✅ AES128CtrEvaluator:", await aes128CtrEvaluator.getAddress());

    const CircuitEvaluatorFactory = await ethers.getContractFactory("CircuitEvaluator", {
        libraries: {
            SHA256Evaluator: await sha256Evaluator.getAddress(),
            SimpleOperationsEvaluator: await simpleOperationsEvaluator.getAddress(),
            AES128CtrEvaluator: await aes128CtrEvaluator.getAddress(),
        },
    });
    const circuitEvaluator = await CircuitEvaluatorFactory.deploy();
    await circuitEvaluator.waitForDeployment();
    console.log("  ✅ CircuitEvaluator:", await circuitEvaluator.getAddress());

    const CommitmentOpenerFactory = await ethers.getContractFactory("CommitmentOpener");
    const commitmentOpener = await CommitmentOpenerFactory.deploy();
    await commitmentOpener.waitForDeployment();
    console.log("  ✅ CommitmentOpener:", await commitmentOpener.getAddress());

    const DisputeSOXHelpersFactory = await ethers.getContractFactory("DisputeSOXHelpers");
    const disputeHelpers = await DisputeSOXHelpersFactory.deploy();
    await disputeHelpers.waitForDeployment();
    console.log("  ✅ DisputeSOXHelpers:", await disputeHelpers.getAddress());

    const DisputeDeployerFactory = await ethers.getContractFactory("DisputeDeployer", {
        libraries: {
            AccumulatorVerifier: await accumulatorVerifier.getAddress(),
            CommitmentOpener: await commitmentOpener.getAddress(),
            DisputeSOXHelpers: await disputeHelpers.getAddress(),
        },
    });
    const disputeDeployer = await DisputeDeployerFactory.connect(sponsor).deploy();
    await disputeDeployer.waitForDeployment();
    console.log("  ✅ DisputeDeployer:", await disputeDeployer.getAddress());
    console.log("");

    // --- Déploiement de l'EntryPoint (nécessaire pour OptimisticSOXAccount) ---
    console.log("📦 Déploiement de l'EntryPoint...");
    let entryPoint;
    const entryPointAddress = "0x5FF137D4b0FDCD49DcA30c7CF57E578a026d2789"; // Adresse standard ERC-4337
    
    // Vérifier si l'EntryPoint existe déjà
    const existingCode = await hre.ethers.provider.getCode(entryPointAddress);
    if (existingCode !== "0x") {
        console.log("  ✅ EntryPoint existe déjà à:", entryPointAddress);
        entryPoint = new hre.ethers.Contract(entryPointAddress, EntryPointArtifact.abi, hre.ethers.provider);
    } else {
        // Déployer l'EntryPoint si nécessaire
        const EntryPointFactory = new hre.ethers.ContractFactory(
            EntryPointArtifact.abi,
            EntryPointArtifact.bytecode,
            sponsor
        );
        entryPoint = await EntryPointFactory.deploy();
        await entryPoint.waitForDeployment();
        const deployedAddress = await entryPoint.getAddress();
        console.log("  ✅ EntryPoint déployé à:", deployedAddress);
    }
    console.log("");

    // --- Déploiement de OptimisticSOXAccount ---
    console.log("📦 Déploiement de OptimisticSOXAccount...");
    console.log("  ⚠️  IMPORTANT: On déploie OptimisticSOXAccount (pas OptimisticSOX) car :");
    console.log("     - Le bundler communique avec OptimisticSOXAccount via l'EntryPoint");
    console.log("     - OptimisticSOXAccount supporte ERC-4337 (UserOperations)");
    console.log("     - OptimisticSOX (base) n'a pas de support ERC-4337");
    console.log("");
    
    const sponsorAmount = ethers.parseEther("1"); // 1 ETH pour le sponsor
    const agreedPrice = 1n; // 1 wei (pour le test)
    const completionTip = 1n; // 1 wei
    const disputeTip = 1n; // 1 wei
    const timeoutIncrement = 3600n; // 1 hour
    const numBlocks = 1024;
    const numGates = 4 * numBlocks + 1;
    const commitment = ethers.ZeroHash; // Commitment vide pour le test

    console.log("  Paramètres:");
    console.log("    EntryPoint:", await entryPoint.getAddress());
    console.log("    Sponsor amount:", sponsorAmount.toString(), "wei");
    console.log("    Agreed price:", agreedPrice.toString(), "wei");
    console.log("    Completion tip:", completionTip.toString(), "wei");
    console.log("    Dispute tip:", disputeTip.toString(), "wei");
    console.log("    Timeout increment:", timeoutIncrement.toString(), "seconds");
    console.log("    Num blocks:", numBlocks);
    console.log("    Num gates:", numGates);
    console.log("    Vendor signer:", await vendor.getAddress());
    console.log("");

    const OptimisticSOXAccountFactory = await ethers.getContractFactory("OptimisticSOXAccount", {
        libraries: {
            DisputeDeployer: await disputeDeployer.getAddress(),
        },
    });

    const contract = await OptimisticSOXAccountFactory.connect(sponsor).deploy(
        await entryPoint.getAddress(),  // _entryPoint
        await vendor.getAddress(),      // _vendor
        await buyer.getAddress(),       // _buyer
        agreedPrice,
        completionTip,
        disputeTip,
        timeoutIncrement,
        commitment,
        numBlocks,
        numGates,
        await vendor.getAddress(),      // _vendorSigner (utilise vendor par défaut)
        {
            value: sponsorAmount,
        }
    );
    await contract.waitForDeployment();
    const contractAddress = await contract.getAddress();

    console.log("  ✅ OptimisticSOXAccount déployé à:", contractAddress);
    console.log("");

    // --- Vérification ---
    console.log("🔍 Vérification du contrat déployé...");
    const deployedState = await contract.currState();
    const deployedBuyer = await contract.buyer();
    const deployedVendor = await contract.vendor();
    const deployedSponsor = await contract.sponsor();
    const deployedAgreedPrice = await contract.agreedPrice();
    const deployedDisputeTip = await contract.disputeTip();
    const deployedEntryPoint = await contract.entryPoint();
    const deployedVendorSigner = await contract.vendorSigner();

    console.log("  État initial:", deployedState.toString(), "(WaitPayment = 0)");
    console.log("  Buyer:", deployedBuyer);
    console.log("  Vendor:", deployedVendor);
    console.log("  Sponsor:", deployedSponsor);
    console.log("  EntryPoint:", deployedEntryPoint);
    console.log("  Vendor signer:", deployedVendorSigner);
    console.log("  Agreed price:", deployedAgreedPrice.toString(), "wei");
    console.log("  Dispute tip:", deployedDisputeTip.toString(), "wei");
    console.log("");

    // --- Test de la nouvelle version ---
    console.log("🧪 Test de la nouvelle version...");
    console.log("  La nouvelle version exige DISPUTE_FEES + disputeTip + agreedPrice");
    console.log("  Montant requis:", (10n + deployedDisputeTip + deployedAgreedPrice).toString(), "wei");
    console.log("  (DISPUTE_FEES: 10 + disputeTip:", deployedDisputeTip.toString(), "+ agreedPrice:", deployedAgreedPrice.toString(), ")");
    console.log("");

    console.log("=".repeat(80));
    console.log("✅ Redéploiement terminé avec succès!");
    console.log("=".repeat(80));
    console.log("");
    console.log("📋 Informations importantes:");
    console.log("  Adresse du contrat:", contractAddress);
    console.log("  EntryPoint:", deployedEntryPoint);
    console.log("  DisputeDeployer:", await disputeDeployer.getAddress());
    console.log("");
    console.log("🔗 Communication avec le bundler:");
    console.log("  - Le bundler communique avec OptimisticSOXAccount via l'EntryPoint");
    console.log("  - Les UserOperations sont envoyées au bundler qui les traite via l'EntryPoint");
    console.log("  - Le vendor peut envoyer sendKey() via UserOperation (fees sponsorisées)");
    console.log("");
    console.log("💡 Pour tester sendVendorDisputeSponsorFee:");
    console.log("  1. Le buyer doit d'abord envoyer le paiement (sendPayment)");
    console.log("  2. Le vendor peut envoyer la clé via UserOperation (sendKey via bundler)");
    console.log("  3. Le buyer dispute sponsor doit envoyer ses frais (sendBuyerDisputeSponsorFee)");
    console.log("  4. Le vendor dispute sponsor peut alors envoyer ses frais avec:");
    console.log("     Montant requis:", (10n + deployedDisputeTip + deployedAgreedPrice).toString(), "wei");
    console.log("");
}

main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error(error);
        process.exit(1);
    });
