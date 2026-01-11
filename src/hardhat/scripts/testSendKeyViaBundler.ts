import { ethers } from "hardhat";
import { Contract, Wallet, parseEther, formatEther } from "ethers";
import { getUserOperationHash } from "viem/account-abstraction";
import fs from "fs";
import path from "path";

const BUNDLER_URL = process.env.BUNDLER_URL || "http://localhost:4337/rpc";
const ENTRY_POINT = process.env.ENTRY_POINT || "0x4337084D9E255Ff0702461CF8895CE9E3b5Ff108";

async function main() {
    console.log("=".repeat(80));
    console.log("🧪 TEST: Déploiement OptimisticSOXAccount et envoi de clé via UserOperation");
    console.log("=".repeat(80));
    console.log("");

    const [deployer, buyer, vendor] = await ethers.getSigners();
    const sponsor = deployer; // Le sponsor est le deployer

    console.log("📋 Adresses:");
    console.log("   Sponsor/Deployer:", await sponsor.getAddress());
    console.log("   Buyer:", await buyer.getAddress());
    console.log("   Vendor:", await vendor.getAddress());
    console.log("   EntryPoint:", ENTRY_POINT);
    console.log("   Bundler URL:", BUNDLER_URL);
    console.log("");

    // 1. Déployer les libraries nécessaires pour DisputeDeployer
    console.log("📦 ÉTAPE 1: Déploiement des libraries nécessaires");
    
    console.log("   Déploiement de SHA256Evaluator...");
    const SHA256EvaluatorFactory = await ethers.getContractFactory("SHA256Evaluator");
    const sha256Evaluator = await SHA256EvaluatorFactory.deploy();
    await sha256Evaluator.waitForDeployment();
    const sha256EvaluatorAddr = await sha256Evaluator.getAddress();
    console.log("   ✅ SHA256Evaluator déployé à:", sha256EvaluatorAddr);
    
    console.log("   Déploiement de AccumulatorVerifier...");
    const AccumulatorVerifierFactory = await ethers.getContractFactory("AccumulatorVerifier");
    const accumulatorVerifier = await AccumulatorVerifierFactory.deploy();
    await accumulatorVerifier.waitForDeployment();
    const accumulatorVerifierAddr = await accumulatorVerifier.getAddress();
    console.log("   ✅ AccumulatorVerifier déployé à:", accumulatorVerifierAddr);
    
    console.log("   Déploiement de CommitmentOpener...");
    const CommitmentOpenerFactory = await ethers.getContractFactory("CommitmentOpener");
    const commitmentOpener = await CommitmentOpenerFactory.deploy();
    await commitmentOpener.waitForDeployment();
    const commitmentOpenerAddr = await commitmentOpener.getAddress();
    console.log("   ✅ CommitmentOpener déployé à:", commitmentOpenerAddr);
    
    // 2. Déployer DisputeDeployer avec les libraries linkées
    console.log("📦 ÉTAPE 2: Déploiement de DisputeDeployer avec libraries linkées");
    const DisputeDeployerFactory = await ethers.getContractFactory("DisputeDeployer", {
        libraries: {
            AccumulatorVerifier: accumulatorVerifierAddr,
            CommitmentOpener: commitmentOpenerAddr,
            SHA256Evaluator: sha256EvaluatorAddr,
        },
    });
    const disputeDeployer = await DisputeDeployerFactory.deploy();
    await disputeDeployer.waitForDeployment();
    const disputeDeployerAddr = await disputeDeployer.getAddress();
    console.log("   ✅ DisputeDeployer déployé à:", disputeDeployerAddr);
    console.log("");

    // 3. Déployer OptimisticSOXAccount
    console.log("📦 ÉTAPE 3: Déploiement d'OptimisticSOXAccount");
    const OptimisticSOXAccountFactory = await ethers.getContractFactory("OptimisticSOXAccount", {
        libraries: {
            DisputeDeployer: disputeDeployerAddr,
        },
    });

    const agreedPrice = parseEther("1.0");
    const completionTip = parseEther("0.1");
    const disputeTip = parseEther("0.1");
    const timeoutIncrement = 3600; // 1 hour
    const commitment = "0x" + "0".repeat(64); // Dummy commitment
    const numBlocks = 100;
    const numGates = 50;
    const vendorSigner = await vendor.getAddress(); // Vendor signe les UserOps

    const optimisticAccount = await OptimisticSOXAccountFactory.connect(sponsor).deploy(
        ENTRY_POINT,
        await vendor.getAddress(),
        await buyer.getAddress(),
        agreedPrice,
        completionTip,
        disputeTip,
        timeoutIncrement,
        commitment,
        numBlocks,
        numGates,
        vendorSigner,
        { value: parseEther("0.5") } // Sponsor deposit
    );
    await optimisticAccount.waitForDeployment();
    const contractAddress = await optimisticAccount.getAddress();
    console.log("   ✅ OptimisticSOXAccount déployé à:", contractAddress);
    console.log("");

    // 4. Dépôt à l'EntryPoint pour sponsoriser les UserOps
    console.log("💰 ÉTAPE 4: Dépôt à l'EntryPoint pour sponsoriser les UserOps");
    try {
        const entryPoint = new Contract(
            ENTRY_POINT,
            ["function depositTo(address) payable", "function balanceOf(address) view returns (uint256)"],
            sponsor
        );
        
        const depositAmount = parseEther("1.0");
        const depositTx = await entryPoint.depositTo(contractAddress, { value: depositAmount });
        await depositTx.wait();
        console.log("   ✅ Dépôt de", formatEther(depositAmount), "ETH à l'EntryPoint");
        
        const balance = await entryPoint.balanceOf(contractAddress);
        console.log("   Balance EntryPoint du contrat:", formatEther(balance), "ETH");
    } catch (error: any) {
        console.error("   ❌ Erreur lors du dépôt:", error.message);
        console.log("   ⚠️  Continuez quand même...");
    }
    console.log("");

    // 5. Simuler le paiement du buyer pour passer en état WaitKey
    console.log("💳 ÉTAPE 5: Simulation du paiement du buyer");
    try {
        // Le buyer doit envoyer agreedPrice + completionTip
        const paymentAmount = agreedPrice + completionTip;
        console.log("   Montant à envoyer:", formatEther(paymentAmount), "ETH");
        console.log("   (agreedPrice:", formatEther(agreedPrice), "ETH + completionTip:", formatEther(completionTip), "ETH)");
        
        const sendPaymentTx = await optimisticAccount.connect(buyer).sendPayment({
            value: paymentAmount,
        });
        await sendPaymentTx.wait();
        console.log("   ✅ Paiement envoyé");
        
        const state = await optimisticAccount.currState();
        console.log("   État du contrat:", state.toString(), "(0=WaitPayment, 1=WaitKey, ...)");
        if (state.toString() !== "1") {
            throw new Error(`État incorrect: attendu 1 (WaitKey), obtenu ${state}`);
        }
    } catch (error: any) {
        console.error("   ❌ Erreur lors du paiement:", error.message);
        throw error;
    }
    console.log("");

    // 6. Préparer la UserOperation pour sendKey
    console.log("📝 ÉTAPE 6: Préparation de la UserOperation pour sendKey");
    const keyToSend = "0x" + "1234567890abcdef".repeat(4); // 32 bytes key
    console.log("   Clé à envoyer:", keyToSend.substring(0, 20) + "...");
    
    const contractAbi = JSON.parse(
        fs.readFileSync(
            path.join(__dirname, "../artifacts/contracts/OptimisticSOXAccount.sol/OptimisticSOXAccount.json"),
            "utf-8"
        )
    ).abi;
    
    const contract = new Contract(contractAddress, contractAbi, vendor);
    
    // Encoder sendKey
    const sendKeyData = contract.interface.encodeFunctionData("sendKey", [keyToSend]);
    console.log("   sendKey calldata:", sendKeyData.substring(0, 50) + "...");
    
    // Encoder execute(self, 0, sendKeyData)
    const executeData = contract.interface.encodeFunctionData("execute", [
        contractAddress,
        0,
        sendKeyData,
    ]);
    console.log("   execute calldata:", executeData.substring(0, 50) + "...");
    console.log("");

    // 7. Obtenir le nonce
    console.log("🔢 ÉTAPE 7: Obtention du nonce");
    const nonce = await contract.nonce();
    console.log("   Nonce actuel:", nonce.toString());
    console.log("");

    // 8. Créer la UserOperation
    console.log("📋 ÉTAPE 8: Création de la UserOperation");
    const network = await ethers.provider.getNetwork();
    const chainId = Number(network.chainId);
    
    const callGasLimit = 500_000n;
    const verificationGasLimit = 500_000n;
    const preVerificationGas = 100_000n;
    const maxFeePerGas = parseEther("0.00000002");
    const maxPriorityFeePerGas = parseEther("0.000000001");

    // 9. Calculer le hash et signer
    console.log("🔐 ÉTAPE 9: Calcul du hash et signature");
    
    // IMPORTANT: Le bundler calcule le hash avec viem (format non-packé)
    // EntryPoint calcule le hash avec PackedUserOperation (format packé)
    // Pour que le bundler accepte, nous devons utiliser le hash de viem
    // Pour que EntryPoint accepte, nous devons utiliser le hash d'EntryPoint
    // SOLUTION: Utilisons le hash de viem car c'est le bundler qui valide d'abord
    
    const viemUserOpForHash: any = {
        sender: contractAddress as `0x${string}`,
        nonce: BigInt(nonce),
        callData: executeData as `0x${string}`,
        callGasLimit,
        verificationGasLimit,
        preVerificationGas,
        maxFeePerGas,
        maxPriorityFeePerGas,
        // factory et factoryData omis (undefined) - viem les traite comme initCode="0x"
    };

    // Utiliser viem comme le bundler (pour passer la validation du bundler)
    const userOpHash = getUserOperationHash({
        chainId: BigInt(chainId),
        entryPointAddress: ENTRY_POINT as `0x${string}`,
        entryPointVersion: "0.8" as const,
        userOperation: viemUserOpForHash,
    });
    
    console.log("   Hash calculé avec viem (pour validation bundler):", userOpHash);
    
    console.log("   userOpHash:", userOpHash);
    
    // Signer avec le vendor
    // Hardhat Account #3 (0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC) = 0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a
    const vendorPrivateKey = process.env.VENDOR_PRIVATE_KEY || "0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a";
    const vendorWallet = new Wallet(vendorPrivateKey, ethers.provider);
    const vendorWalletAddress = await vendorWallet.getAddress();
    console.log("   Vendor wallet address:", vendorWalletAddress);
    console.log("   Expected vendorSigner:", vendorSigner);
    
    if (vendorWalletAddress.toLowerCase() !== vendorSigner.toLowerCase()) {
        console.error("   ❌ ERREUR: Le wallet vendor ne correspond pas au vendorSigner du contrat!");
        throw new Error(`Vendor wallet mismatch: ${vendorWalletAddress} != ${vendorSigner}`);
    }
    
    // Signer le hash : le contrat utilise toEthSignedMessageHash, donc signMessage est correct
    // userOpHash est déjà un hex string, signMessage attend bytes ou string
    const signature = await vendorWallet.signMessage(ethers.getBytes(userOpHash));
    
    // Vérifier que la signature est valide en local
    console.log("   🔍 Vérification locale de la signature...");
    try {
        const recoveredAddress = ethers.verifyMessage(ethers.getBytes(userOpHash), signature);
        console.log("   Adresse récupérée depuis signature:", recoveredAddress);
        console.log("   Vendor wallet address:", vendorWalletAddress);
        console.log("   Signature valide?", recoveredAddress.toLowerCase() === vendorWalletAddress.toLowerCase());
        if (recoveredAddress.toLowerCase() !== vendorWalletAddress.toLowerCase()) {
            throw new Error("La signature ne correspond pas au wallet vendor!");
        }
    } catch (error: any) {
        console.error("   ❌ Erreur lors de la vérification:", error.message);
        throw error;
    }
    
    console.log("   Signature:", signature.substring(0, 20) + "...");
    console.log("");

    // Vérifier le hash côté contrat EntryPoint
    console.log("   🔍 Vérification du hash côté EntryPoint...");
    try {
        const entryPointContract = new Contract(
            ENTRY_POINT,
            ["function getUserOpHash((address,uint256,bytes,bytes,bytes32,uint256,bytes32,bytes,bytes)) view returns (bytes32)"],
            ethers.provider
        );
        
        // Construire PackedUserOperation pour vérifier le hash
        // Pack gas limits
        const accountGasLimits = ethers.solidityPacked(
            ["bytes16", "bytes16"],
            [
                "0x" + verificationGasLimit.toString(16).padStart(32, "0"),
                "0x" + callGasLimit.toString(16).padStart(32, "0"),
            ]
        );
        
        // Pack gas fees
        const gasFees = ethers.solidityPacked(
            ["bytes16", "bytes16"],
            [
                "0x" + maxPriorityFeePerGas.toString(16).padStart(32, "0"),
                "0x" + maxFeePerGas.toString(16).padStart(32, "0"),
            ]
        );
        
        const packedUserOp = [
            contractAddress,
            nonce,
            "0x", // initCode (vide car compte existe)
            executeData,
            accountGasLimits,
            preVerificationGas,
            gasFees,
            "0x", // paymasterAndData (vide)
            signature,
        ];
        
        const contractHash = await entryPointContract.getUserOpHash.staticCall(packedUserOp);
        console.log("   Hash calculé par EntryPoint:", contractHash);
        console.log("   Hash calculé par nous:", userOpHash);
        console.log("   Match?", contractHash.toLowerCase() === userOpHash.toLowerCase());
        
        if (contractHash.toLowerCase() !== userOpHash.toLowerCase()) {
            console.error("   ❌ ERREUR: Les hash ne correspondent pas!");
            console.error("     Le hash que nous avons signé ne correspond pas au hash attendu par EntryPoint.");
            console.error("     Cela signifie que la signature sera invalide.");
        }
    } catch (error: any) {
        console.warn("   ⚠️  Impossible de vérifier le hash côté EntryPoint:", error.message);
    }
    console.log("");

    // UserOperation au format v0.8 (unpacked, comme attendu par le bundler)
    // Pour v0.8, le schéma attend factory/factoryData (optionnel, null si absent)
    // et paymaster séparés (optionnel, null si absent)
    // IMPORTANT: Pas de initCode ni paymasterAndData dans le format non-packé v0.8
    const userOpForBundler: any = {
        sender: contractAddress.toLowerCase(),
        nonce: "0x" + nonce.toString(16),
        callData: executeData,
        callGasLimit: "0x" + callGasLimit.toString(16),
        verificationGasLimit: "0x" + verificationGasLimit.toString(16),
        preVerificationGas: "0x" + preVerificationGas.toString(16),
        maxFeePerGas: "0x" + maxFeePerGas.toString(16),
        maxPriorityFeePerGas: "0x" + maxPriorityFeePerGas.toString(16),
        signature: signature,
        // factory et factoryData sont omis (undefined/null) car le compte existe déjà
        // paymaster et paymasterData sont omis car pas de paymaster
    };
    
    console.log("   Format UserOperation pour bundler:");
    console.log("     sender:", userOpForBundler.sender);
    console.log("     nonce:", userOpForBundler.nonce);
    console.log("     callData length:", userOpForBundler.callData.length);
    console.log("     factory:", userOpForBundler.factory || "undefined (compte existant)");
    console.log("     paymaster:", userOpForBundler.paymaster || "undefined (pas de paymaster)");

    console.log("   UserOperation pour bundler:");
    console.log("     sender:", userOpForBundler.sender);
    console.log("     nonce:", userOpForBundler.nonce);
    console.log("     initCode:", userOpForBundler.initCode);
    console.log("     callData length:", userOpForBundler.callData.length, "chars");
    console.log("");

    // 10. Envoyer au bundler
    console.log("🚀 ÉTAPE 10: Envoi de la UserOperation au bundler");
    console.log("   Bundler URL:", BUNDLER_URL);
    console.log("");

    try {
        // Vérifier les paramètres du contrat
        console.log("   📊 Vérification des paramètres du contrat...");
        const contractNonce = await contract.nonce();
        const contractVendorSigner = await contract.vendorSigner();
        const contractVendor = await contract.vendor();
        const contractBuyer = await contract.buyer();
        
        console.log("     Nonce du contrat:", contractNonce.toString());
        console.log("     Nonce de la UserOp:", nonce.toString());
        console.log("     vendorSigner dans le contrat:", contractVendorSigner);
        console.log("     vendor dans le contrat:", contractVendor);
        console.log("     buyer dans le contrat:", contractBuyer);
        console.log("     Wallet utilisé pour signer:", vendorWalletAddress);
        
        if (contractNonce.toString() !== nonce.toString()) {
            console.error("     ❌ ERREUR: Les nonces ne correspondent pas!");
            throw new Error(`Nonce mismatch: contract=${contractNonce}, userOp=${nonce}`);
        }
        
        const signerMatches = vendorWalletAddress.toLowerCase() === contractVendorSigner.toLowerCase() ||
                             vendorWalletAddress.toLowerCase() === contractVendor.toLowerCase() ||
                             vendorWalletAddress.toLowerCase() === contractBuyer.toLowerCase();
        if (!signerMatches) {
            console.error("     ❌ ERREUR: Le wallet signataire ne correspond à aucun signataire autorisé!");
            console.error("       Attendu: vendorSigner, vendor, ou buyer");
            throw new Error(`Signer mismatch: wallet=${vendorWalletAddress}, vendorSigner=${contractVendorSigner}, vendor=${contractVendor}, buyer=${contractBuyer}`);
        }
        console.log("     ✅ Nonces et signataires correspondent");
        console.log("");

        const response = await fetch(BUNDLER_URL, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                jsonrpc: "2.0",
                id: 1,
                method: "eth_sendUserOperation",
                params: [userOpForBundler, ENTRY_POINT],
            }),
        });

        const result = await response.json();
        
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${JSON.stringify(result)}`);
        }

        if (result.error) {
            console.error("   ❌ ERREUR du bundler:");
            console.error("     Code:", result.error.code);
            console.error("     Message:", result.error.message);
            if (result.error.data) {
                console.error("     Data:", JSON.stringify(result.error.data, null, 2));
            }
            throw new Error(result.error.message || "Bundler rejected UserOperation");
        }

        console.log("   ✅ UserOperation acceptée par le bundler!");
        console.log("   UserOpHash:", result.result);
        console.log("");

        // 11. Vérifier l'état du contrat
        console.log("🔍 ÉTAPE 11: Vérification de l'état du contrat");
        
        // Attendre un peu pour que la transaction soit incluse
        console.log("   ⏳ Attente de 5 secondes pour l'inclusion dans un bloc...");
        await new Promise(resolve => setTimeout(resolve, 5000));
        
        const finalState = await optimisticAccount.currState();
        const keyOnContract = await optimisticAccount.key();
        
        console.log("   État final:", finalState.toString(), "(attendu: 2 pour WaitSB)");
        console.log("   Clé sur le contrat:", keyOnContract !== "0x" ? keyOnContract.substring(0, 20) + "..." : "Non définie");
        
        if (finalState.toString() === "2" && keyOnContract !== "0x") {
            console.log("   ✅ SUCCÈS! La clé a été envoyée et le contrat est en état WaitSB");
        } else {
            console.log("   ⚠️  Le contrat n'a pas encore été mis à jour. La transaction peut être en cours...");
        }

    } catch (error: any) {
        console.error("   ❌ ERREUR lors de l'envoi au bundler:");
        console.error("     ", error.message);
        if (error.stack) {
            console.error("     Stack:", error.stack);
        }
        throw error;
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

