import hre from "hardhat";
import { ethers } from "hardhat";
import { parseEther } from "ethers";
import EntryPointArtifact from "@account-abstraction/contracts/artifacts/EntryPoint.json";

/**
 * Test complet de tous les flux OptimisticSOXAccount
 * 
 * Ce script teste :
 * 1. Déploiement d'OptimisticSOXAccount
 * 2. Flux optimiste complet : sendPayment -> sendKey -> sendBuyerDisputeSponsorFee -> sendVendorDisputeSponsorFee
 * 3. Vérification du déploiement du contrat de dispute (DisputeSOXAccount)
 * 4. Vérification des états à chaque étape
 * 5. Vérification des montants et balances
 */
async function main() {
    const [sponsor, buyer, vendor, sbSponsor, svSponsor] = await hre.ethers.getSigners();
    const provider = ethers.provider;

    console.log("=".repeat(80));
    console.log("🧪 TEST COMPLET - Tous les flux OptimisticSOXAccount");
    console.log("=".repeat(80));
    console.log("");
    console.log("👥 Signers:");
    console.log("  Sponsor      :", await sponsor.getAddress());
    console.log("  Buyer        :", await buyer.getAddress());
    console.log("  Vendor       :", await vendor.getAddress());
    console.log("  SB Sponsor   :", await sbSponsor.getAddress());
    console.log("  SV Sponsor   :", await svSponsor.getAddress());
    console.log("");

    // ========================================================================
    // ÉTAPE 0: Déploiement des libraries et contrats
    // ========================================================================
    console.log("📚 ÉTAPE 0: Déploiement des libraries et contrats");
    console.log("-".repeat(80));

    // Déploiement des libraries
    console.log("\n📦 Déploiement des libraries...");
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

    // Déploiement de DisputeDeployer
    console.log("\n📦 Déploiement de DisputeDeployer...");
    const DisputeDeployerFactory = await ethers.getContractFactory("DisputeDeployer", {
        libraries: {
            AccumulatorVerifier: await accumulatorVerifier.getAddress(),
            CommitmentOpener: await commitmentOpener.getAddress(),
            DisputeSOXHelpers: await disputeHelpers.getAddress(),
        },
    });
    const disputeDeployer = await DisputeDeployerFactory.deploy();
    await disputeDeployer.waitForDeployment();
    console.log("  ✅ DisputeDeployer:", await disputeDeployer.getAddress());

    // Déploiement de l'EntryPoint
    console.log("\n📦 Déploiement de l'EntryPoint...");
    const EntryPointFactory = new ethers.ContractFactory(
        EntryPointArtifact.abi,
        EntryPointArtifact.bytecode,
        sponsor
    );
    const entryPoint = await EntryPointFactory.deploy();
    await entryPoint.waitForDeployment();
    const entryPointAddress = await entryPoint.getAddress();
    console.log("  ✅ EntryPoint déployé à:", entryPointAddress);

    // Déploiement de OptimisticSOXAccount
    console.log("\n📦 Déploiement de OptimisticSOXAccount...");
    const OptimisticSOXAccountFactory = await ethers.getContractFactory(
        "OptimisticSOXAccount",
        {
            libraries: {
                DisputeDeployer: await disputeDeployer.getAddress(),
            },
        }
    );

    const sponsorAmount = parseEther("1");
    const agreedPrice = parseEther("0.000000000000000001"); // 1 wei
    const completionTip = parseEther("0.000000000000000001"); // 1 wei
    const disputeTip = parseEther("0.000000000000000001"); // 1 wei
    const timeoutIncrement = 3600n; // 1 hour
    const numBlocks = 1024;
    const numGates = 4 * numBlocks + 1;
    const commitment = new Uint8Array(32);

    console.log("  Paramètres:");
    console.log("    EntryPoint:", entryPointAddress);
    console.log("    Sponsor amount:", sponsorAmount.toString(), "wei");
    console.log("    Agreed price:", agreedPrice.toString(), "wei");
    console.log("    Completion tip:", completionTip.toString(), "wei");
    console.log("    Dispute tip:", disputeTip.toString(), "wei");
    console.log("    Timeout increment:", timeoutIncrement.toString(), "seconds");
    console.log("    Num blocks:", numBlocks);
    console.log("    Num gates:", numGates);

    const optimisticAccount = await OptimisticSOXAccountFactory.connect(sponsor).deploy(
        entryPointAddress,
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
        {
            value: sponsorAmount,
        }
    );
    await optimisticAccount.waitForDeployment();
    const contractAddress = await optimisticAccount.getAddress();
    console.log("  ✅ OptimisticSOXAccount déployé à:", contractAddress);

    // Vérification du type de contrat
    const OptimisticSOXAccountArtifact = await hre.artifacts.readArtifact("OptimisticSOXAccount");
    const contract = new ethers.Contract(contractAddress, OptimisticSOXAccountArtifact.abi, provider);
    const entryPointFromContract = await contract.entryPoint();
    const isOptimisticSOXAccount = entryPointFromContract !== ethers.ZeroAddress;
    console.log("  🔍 Vérification:");
    console.log("    EntryPoint dans le contrat:", entryPointFromContract);
    console.log("    Type de contrat:", isOptimisticSOXAccount ? "OptimisticSOXAccount ✅" : "OptimisticSOX ❌");
    
    if (!isOptimisticSOXAccount) {
        throw new Error("❌ Le contrat déployé n'est pas un OptimisticSOXAccount!");
    }

    // État initial
    const stateNames = ["WaitPayment", "WaitKey", "WaitSB", "WaitSV", "InDispute", "End"];
    let currentState = await contract.currState();
    console.log("    État initial:", stateNames[Number(currentState)], `(${currentState})`);
    console.log("");

    // ========================================================================
    // ÉTAPE 1: Buyer envoie le paiement
    // ========================================================================
    console.log("💰 ÉTAPE 1: Buyer envoie le paiement");
    console.log("-".repeat(80));
    
    const paymentAmount = agreedPrice + completionTip;
    console.log("  Montant requis:", paymentAmount.toString(), "wei (agreedPrice + completionTip)");
    console.log("  Balance buyer avant:", (await provider.getBalance(await buyer.getAddress())).toString(), "wei");
    
    const tx1 = await contract.connect(buyer).sendPayment({ value: paymentAmount });
    console.log("  📝 Transaction envoyée:", tx1.hash);
    const receipt1 = await tx1.wait();
    console.log("  ✅ Transaction confirmée dans le bloc:", receipt1?.blockNumber);
    
    currentState = await contract.currState();
    console.log("  📊 État après paiement:", stateNames[Number(currentState)], `(${currentState})`);
    
    if (currentState !== 1n) {
        throw new Error(`❌ État incorrect après paiement. Attendu: 1 (WaitKey), Reçu: ${currentState}`);
    }
    
    const buyerDeposit = await contract.buyerDeposit();
    console.log("  💵 Buyer deposit:", buyerDeposit.toString(), "wei");
    console.log("");

    // ========================================================================
    // ÉTAPE 2: Vendor envoie la clé
    // ========================================================================
    console.log("🔑 ÉTAPE 2: Vendor envoie la clé");
    console.log("-".repeat(80));
    
    const keyData = ethers.toUtf8Bytes("test-secret-key-12345");
    console.log("  Clé à envoyer:", ethers.hexlify(keyData));
    
    const tx2 = await contract.connect(vendor).sendKey(keyData);
    console.log("  📝 Transaction envoyée:", tx2.hash);
    const receipt2 = await tx2.wait();
    console.log("  ✅ Transaction confirmée dans le bloc:", receipt2?.blockNumber);
    
    currentState = await contract.currState();
    console.log("  📊 État après clé:", stateNames[Number(currentState)], `(${currentState})`);
    
    if (currentState !== 2n) {
        throw new Error(`❌ État incorrect après clé. Attendu: 2 (WaitSB), Reçu: ${currentState}`);
    }
    
    const key = await contract.key();
    console.log("  🔑 Clé stockée:", ethers.hexlify(key));
    
    if (ethers.hexlify(key) !== ethers.hexlify(keyData)) {
        throw new Error("❌ La clé stockée ne correspond pas à la clé envoyée!");
    }
    console.log("");

    // ========================================================================
    // ÉTAPE 3: Buyer dispute sponsor envoie ses frais
    // ========================================================================
    console.log("💳 ÉTAPE 3: Buyer dispute sponsor envoie ses frais");
    console.log("-".repeat(80));
    
    const DISPUTE_FEES = 10n;
    const sbRequiredAmount = DISPUTE_FEES + disputeTip;
    console.log("  Montant requis:", sbRequiredAmount.toString(), "wei (DISPUTE_FEES + disputeTip)");
    console.log("  Balance SB sponsor avant:", (await provider.getBalance(await sbSponsor.getAddress())).toString(), "wei");
    
    const tx3 = await contract.connect(sbSponsor).sendBuyerDisputeSponsorFee({ value: sbRequiredAmount });
    console.log("  📝 Transaction envoyée:", tx3.hash);
    const receipt3 = await tx3.wait();
    console.log("  ✅ Transaction confirmée dans le bloc:", receipt3?.blockNumber);
    
    currentState = await contract.currState();
    console.log("  📊 État après frais buyer sponsor:", stateNames[Number(currentState)], `(${currentState})`);
    
    if (currentState !== 3n) {
        throw new Error(`❌ État incorrect après frais buyer sponsor. Attendu: 3 (WaitSV), Reçu: ${currentState}`);
    }
    
    const buyerDisputeSponsor = await contract.buyerDisputeSponsor();
    const sbDeposit = await contract.sbDeposit();
    console.log("  👤 Buyer dispute sponsor:", buyerDisputeSponsor);
    console.log("  💵 SB deposit:", sbDeposit.toString(), "wei");
    
    if (buyerDisputeSponsor.toLowerCase() !== (await sbSponsor.getAddress()).toLowerCase()) {
        throw new Error("❌ Le buyer dispute sponsor n'est pas correctement défini!");
    }
    console.log("");

    // ========================================================================
    // ÉTAPE 4: Vendor dispute sponsor envoie ses frais
    // ========================================================================
    console.log("💳 ÉTAPE 4: Vendor dispute sponsor envoie ses frais");
    console.log("-".repeat(80));
    
    const svRequiredAmount = DISPUTE_FEES + disputeTip + agreedPrice;
    console.log("  Montant requis:", svRequiredAmount.toString(), "wei");
    console.log("  (DISPUTE_FEES:", DISPUTE_FEES, "+ disputeTip:", disputeTip.toString(), "+ agreedPrice:", agreedPrice.toString(), ")");
    
    const contractBalanceBefore = await provider.getBalance(contractAddress);
    const svSponsorBalanceBefore = await provider.getBalance(await svSponsor.getAddress());
    const totalBalanceAfter = contractBalanceBefore + svRequiredAmount;
    
    console.log("  📊 Vérifications avant envoi:");
    console.log("    Balance actuelle du contrat:", contractBalanceBefore.toString(), "wei");
    console.log("    Balance du sponsor vendor:", svSponsorBalanceBefore.toString(), "wei");
    console.log("    Balance totale après envoi:", totalBalanceAfter.toString(), "wei");
    console.log("    AgreedPrice requis:", agreedPrice.toString(), "wei");
    console.log("    ✅ Balance totale >= AgreedPrice:", totalBalanceAfter >= agreedPrice ? "OUI" : "NON");
    
    // Simulation
    console.log("\n  🧪 Simulation...");
    try {
        await contract.connect(svSponsor).sendVendorDisputeSponsorFee.staticCall({ value: svRequiredAmount });
        console.log("  ✅ Simulation réussie");
    } catch (e: any) {
        const errorMsg = e?.reason || e?.message || e?.toString() || "Unknown error";
        console.error("  ❌ Simulation échouée:", errorMsg);
        throw e;
    }

    // Envoi réel
    console.log("\n  🚀 Envoi réel...");
    const tx4 = await contract.connect(svSponsor).sendVendorDisputeSponsorFee({ value: svRequiredAmount });
    console.log("  📝 Transaction envoyée:", tx4.hash);
    const receipt4 = await tx4.wait();
    console.log("  ✅ Transaction confirmée dans le bloc:", receipt4?.blockNumber);
    
    currentState = await contract.currState();
    console.log("  📊 État après frais vendor sponsor:", stateNames[Number(currentState)], `(${currentState})`);
    
    if (currentState !== 4n) {
        throw new Error(`❌ État incorrect après frais vendor sponsor. Attendu: 4 (InDispute), Reçu: ${currentState}`);
    }
    
    const vendorDisputeSponsor = await contract.vendorDisputeSponsor();
    const svDeposit = await contract.svDeposit();
    const disputeContractAddress = await contract.disputeContract();
    
    console.log("  👤 Vendor dispute sponsor:", vendorDisputeSponsor);
    console.log("  💵 SV deposit:", svDeposit.toString(), "wei");
    console.log("  📄 Contrat de dispute déployé:", disputeContractAddress);
    
    if (vendorDisputeSponsor.toLowerCase() !== (await svSponsor.getAddress()).toLowerCase()) {
        throw new Error("❌ Le vendor dispute sponsor n'est pas correctement défini!");
    }
    
    if (disputeContractAddress === ethers.ZeroAddress) {
        throw new Error("❌ Le contrat de dispute n'a pas été déployé!");
    }
    console.log("");

    // ========================================================================
    // ÉTAPE 5: Vérification du contrat de dispute
    // ========================================================================
    console.log("🔍 ÉTAPE 5: Vérification du contrat de dispute");
    console.log("-".repeat(80));
    
    try {
        const DisputeSOXAccountArtifact = await hre.artifacts.readArtifact("DisputeSOXAccount");
        const disputeContract = new ethers.Contract(
            disputeContractAddress,
            DisputeSOXAccountArtifact.abi,
            provider
        );
        
        const disputeEntryPoint = await disputeContract.entryPoint();
        const disputeBuyer = await disputeContract.buyer();
        const disputeVendor = await disputeContract.vendor();
        const disputeBuyerSponsor = await disputeContract.buyerDisputeSponsor();
        const disputeVendorSponsor = await disputeContract.vendorDisputeSponsor();
        const disputeState = await disputeContract.currState();
        
        console.log("  EntryPoint du contrat de dispute:", disputeEntryPoint);
        console.log("  Type de contrat:", disputeEntryPoint !== ethers.ZeroAddress ? "DisputeSOXAccount ✅" : "DisputeSOX ❌");
        console.log("  Buyer:", disputeBuyer);
        console.log("  Vendor:", disputeVendor);
        console.log("  Buyer dispute sponsor:", disputeBuyerSponsor);
        console.log("  Vendor dispute sponsor:", disputeVendorSponsor);
        console.log("  État du contrat de dispute:", disputeState.toString());
        
        if (disputeEntryPoint === ethers.ZeroAddress) {
            throw new Error("❌ Le contrat de dispute n'a pas d'EntryPoint (devrait être DisputeSOXAccount)!");
        }
        
        if (disputeBuyer.toLowerCase() !== (await buyer.getAddress()).toLowerCase()) {
            throw new Error("❌ Le buyer dans le contrat de dispute ne correspond pas!");
        }
        
        if (disputeVendor.toLowerCase() !== (await vendor.getAddress()).toLowerCase()) {
            throw new Error("❌ Le vendor dans le contrat de dispute ne correspond pas!");
        }
        
        console.log("  ✅ Toutes les vérifications du contrat de dispute sont passées!");
    } catch (e: any) {
        console.error("  ⚠️  Erreur lors de la vérification du contrat de dispute:", e.message);
        throw e;
    }
    console.log("");

    // ========================================================================
    // RÉSUMÉ FINAL
    // ========================================================================
    console.log("=".repeat(80));
    console.log("✅ TEST COMPLET RÉUSSI!");
    console.log("=".repeat(80));
    console.log("");
    console.log("📋 Résumé:");
    console.log("  Contrat OptimisticSOXAccount:", contractAddress);
    console.log("  EntryPoint:", entryPointAddress);
    console.log("  Contrat de dispute:", disputeContractAddress);
    console.log("  Type de dispute:", "DisputeSOXAccount ✅");
    console.log("");
    console.log("📊 États parcourus:");
    console.log("  État initial: WaitPayment (0)");
    console.log("  Après paiement: WaitKey (1)");
    console.log("  Après clé: WaitSB (2)");
    console.log("  Après frais buyer sponsor: WaitSV (3)");
    console.log("  Après frais vendor sponsor: InDispute (4)");
    console.log("");
    console.log("💰 Montants:");
    console.log("  Sponsor deposit:", sponsorAmount.toString(), "wei");
    console.log("  Buyer payment:", paymentAmount.toString(), "wei");
    console.log("  SB sponsor fee:", sbRequiredAmount.toString(), "wei");
    console.log("  SV sponsor fee:", svRequiredAmount.toString(), "wei");
    console.log("");
}

main().catch((error) => {
    console.error("");
    console.error("=".repeat(80));
    console.error("❌ TEST ÉCHOUÉ!");
    console.error("=".repeat(80));
    console.error(error);
    process.exitCode = 1;
});









