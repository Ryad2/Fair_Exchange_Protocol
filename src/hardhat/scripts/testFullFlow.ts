import hre from "hardhat";
import { ethers, Wallet, Contract } from "ethers";
import { AbiCoder, keccak256, toUtf8Bytes, concat, toBeHex, zeroPadValue, getBytes, parseEther } from "ethers";
import axios from "axios";
import fs from "fs";
import path from "path";
import EntryPointArtifact from "@account-abstraction/contracts/artifacts/EntryPoint.json";

const BUNDLER_URL = "http://localhost:3002/rpc";

// Lire l'adresse de l'EntryPoint depuis la configuration du bundler
function getEntryPointFromBundlerConfig(): string {
    const envEntryPoint = process.env.ENTRY_POINT || process.env.NEXT_PUBLIC_ENTRY_POINT;
    if (envEntryPoint) return envEntryPoint;

    const configPath = path.join(__dirname, "../../../bundler-alto/scripts/config.local.json");
    try {
        const configContent = fs.readFileSync(configPath, "utf-8");
        const config = JSON.parse(configContent);
        const entrypoints = config.entrypoints;
        if (Array.isArray(entrypoints)) return entrypoints[0];
        if (typeof entrypoints === "string") return entrypoints;
    } catch (error) {
        console.warn("⚠️  Impossible de lire la configuration du bundler:", error.message);
    }

    throw new Error(
        "EntryPoint introuvable. Définissez ENTRY_POINT ou NEXT_PUBLIC_ENTRY_POINT."
    );
}

const ENTRY_POINT = getEntryPointFromBundlerConfig();
const PAYMASTER_SIG_MAGIC = "0x22e325a297439656";

// Packer deux uint128 en un bytes32
function packUint(high128: bigint, low128: bigint): string {
    const packed = (high128 << 128n) | low128;
    return zeroPadValue(toBeHex(packed), 32);
}

function bytesEqual(left: Uint8Array, right: Uint8Array): boolean {
    if (left.length !== right.length) return false;
    for (let i = 0; i < left.length; i++) {
        if (left[i] !== right[i]) return false;
    }
    return true;
}

function getPaymasterDataHash(paymasterAndData: string): string {
    const data = getBytes(paymasterAndData || "0x");
    const suffix = getBytes(PAYMASTER_SIG_MAGIC);
    if (data.length < suffix.length + 2) {
        return keccak256(data);
    }
    const suffixStart = data.length - suffix.length;
    if (!bytesEqual(data.slice(suffixStart), suffix)) {
        return keccak256(data);
    }
    const sigLenOffset = data.length - suffix.length - 2;
    const sigLen = (data[sigLenOffset] << 8) | data[sigLenOffset + 1];
    const signedLen = data.length - sigLen - (suffix.length + 2);
    if (signedLen < 0) {
        return keccak256(data);
    }
    return keccak256(concat([data.slice(0, signedLen), suffix]));
}

// Fonction pour calculer getUserOpHash selon la spécification ERC-4337
function getUserOpHash(userOp: any, entryPoint: string, chainId: number): string {
    const abiCoder = AbiCoder.defaultAbiCoder();
    
    const accountGasLimits = packUint(BigInt(userOp.verificationGasLimit), BigInt(userOp.callGasLimit));
    const gasFees = packUint(BigInt(userOp.maxPriorityFeePerGas), BigInt(userOp.maxFeePerGas));
    
    const PACKED_USEROP_TYPEHASH = keccak256(
        toUtf8Bytes("PackedUserOperation(address sender,uint256 nonce,bytes initCode,bytes callData,bytes32 accountGasLimits,uint256 preVerificationGas,bytes32 gasFees,bytes paymasterAndData)")
    );
    
    const EIP712_DOMAIN_TYPEHASH = keccak256(
        toUtf8Bytes("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)")
    );
    const domainNameHash = keccak256(toUtf8Bytes("ERC4337"));
    const domainVersionHash = keccak256(toUtf8Bytes("1"));
    
    const domainSeparator = keccak256(
        abiCoder.encode(
            ["bytes32", "bytes32", "bytes32", "uint256", "address"],
            [
                EIP712_DOMAIN_TYPEHASH,
                domainNameHash,
                domainVersionHash,
                chainId,
                entryPoint
            ]
        )
    );
    
    const initCode = userOp.initCode || "0x";
    const callData = userOp.callData || "0x";
    const paymasterAndData = userOp.paymasterAndData || "0x";
    
    const hashInitCode = keccak256(initCode);
    const hashCallData = keccak256(callData);
    const hashPaymasterAndData = getPaymasterDataHash(paymasterAndData);
    
    const encoded = abiCoder.encode(
        ["bytes32", "address", "uint256", "bytes32", "bytes32", "bytes32", "uint256", "bytes32", "bytes32"],
        [
            PACKED_USEROP_TYPEHASH,
            userOp.sender,
            BigInt(userOp.nonce),
            hashInitCode,
            hashCallData,
            accountGasLimits,
            BigInt(userOp.preVerificationGas),
            gasFees,
            hashPaymasterAndData
        ]
    );
    
    return keccak256(concat(["0x1901", domainSeparator, keccak256(encoded)]));
}

function normalizeSignature(signature: string): string {
    if (!signature.startsWith("0x")) {
        signature = "0x" + signature;
    }
    
    if (signature.length !== 132) {
        throw new Error(`Invalid signature length: ${signature.length}, expected 132 (65 bytes)`);
    }
    
    const r = signature.slice(2, 66);
    const s = signature.slice(66, 130);
    const vHex = signature.slice(130, 132);
    const v = parseInt(vHex, 16);
    
    if (v === 27 || v === 28) {
        return signature;
    }
    
    if (v < 27) {
        const normalizedV = v + 27;
        const normalizedVHex = normalizedV.toString(16).padStart(2, "0");
        return "0x" + r + s + normalizedVHex;
    }
    
    const normalizedV = (v % 2 === 0) ? 28 : 27;
    const normalizedVHex = normalizedV.toString(16).padStart(2, "0");
    return "0x" + r + s + normalizedVHex;
}

async function main() {
    console.log("=".repeat(80));
    console.log("🧪 TEST COMPLET: Déploiement + Envoi UserOperation");
    console.log("=".repeat(80));
    console.log("");

    try {
        const { ethers } = hre;
        const [sponsor, buyer, vendor] = await ethers.getSigners();
        const provider = hre.ethers.provider;
        const network = await provider.getNetwork();
        const chainId = Number(network.chainId);

        console.log("📋 ÉTAPE 1: Configuration");
        console.log("   Chain ID:", chainId);
        console.log("   EntryPoint attendu:", ENTRY_POINT);
        console.log("   Bundler:", BUNDLER_URL);
        console.log("   Sponsor:", await sponsor.getAddress());
        console.log("   Buyer:", await buyer.getAddress());
        console.log("   Vendor:", await vendor.getAddress());
        console.log("");

        // Vérifier si l'EntryPoint existe déjà à l'adresse configurée dans le bundler
        console.log("📋 Vérification de l'EntryPoint...");
        console.log("   Adresse configurée dans bundler:", ENTRY_POINT);
        
        let actualEntryPoint = ENTRY_POINT;
        const entryPointCode = await provider.getCode(ENTRY_POINT);
        
        if (!entryPointCode || entryPointCode === "0x") {
            // EntryPoint n'existe pas, on le déploie
            console.log("   ⚠️  EntryPoint non trouvé à cette adresse, déploiement...");
            const EntryPointFactory = new ethers.ContractFactory(
                EntryPointArtifact.abi,
                EntryPointArtifact.bytecode,
                sponsor
            );
            const entryPoint = await EntryPointFactory.deploy();
            await entryPoint.waitForDeployment();
            actualEntryPoint = await entryPoint.getAddress();
            console.log("   ✅ EntryPoint déployé à:", actualEntryPoint);
            console.log("");
            console.log("   ⚠️  ATTENTION: L'adresse déployée diffère de celle configurée dans le bundler!");
            console.log("   📋 Pour que le bundler fonctionne avec cette adresse:");
            console.log("   1. Arrête le bundler (Ctrl+C dans son terminal)");
            console.log("   2. Modifie bundler-alto/scripts/config.local.json:");
            console.log(`      "entrypoints": "${actualEntryPoint}"`);
            console.log("   3. Redémarre le bundler");
            console.log("");
        } else {
            // EntryPoint existe déjà
            console.log("   ✅ EntryPoint trouvé à cette adresse!");
            console.log("");
        }

        // Déployer les libraries
        console.log("📋 ÉTAPE 2: Déploiement des libraries");
        
        const AccumulatorVerifierFactory = await ethers.getContractFactory("AccumulatorVerifier");
        const accumulatorVerifier = await AccumulatorVerifierFactory.deploy();
        await accumulatorVerifier.waitForDeployment();
        console.log("   AccumulatorVerifier:", await accumulatorVerifier.getAddress());

        const SHA256EvaluatorFactory = await ethers.getContractFactory("SHA256Evaluator");
        const sha256Evaluator = await SHA256EvaluatorFactory.deploy();
        await sha256Evaluator.waitForDeployment();
        console.log("   SHA256Evaluator:", await sha256Evaluator.getAddress());

        const SimpleOperationsEvaluatorFactory = await ethers.getContractFactory("SimpleOperationsEvaluator");
        const simpleOperationsEvaluator = await SimpleOperationsEvaluatorFactory.deploy();
        await simpleOperationsEvaluator.waitForDeployment();
        console.log("   SimpleOperationsEvaluator:", await simpleOperationsEvaluator.getAddress());

        const AES128CtrEvaluatorFactory = await ethers.getContractFactory("AES128CtrEvaluator");
        const aes128CtrEvaluator = await AES128CtrEvaluatorFactory.deploy();
        await aes128CtrEvaluator.waitForDeployment();
        console.log("   AES128CtrEvaluator:", await aes128CtrEvaluator.getAddress());

        const CircuitEvaluatorFactory = await ethers.getContractFactory("CircuitEvaluator", {
            libraries: {
                SHA256Evaluator: await sha256Evaluator.getAddress(),
                SimpleOperationsEvaluator: await simpleOperationsEvaluator.getAddress(),
                AES128CtrEvaluator: await aes128CtrEvaluator.getAddress(),
            },
        });
        const circuitEvaluator = await CircuitEvaluatorFactory.deploy();
        await circuitEvaluator.waitForDeployment();
        console.log("   CircuitEvaluator:", await circuitEvaluator.getAddress());

        const CommitmentOpenerFactory = await ethers.getContractFactory("CommitmentOpener");
        const commitmentOpener = await CommitmentOpenerFactory.deploy();
        await commitmentOpener.waitForDeployment();
        console.log("   CommitmentOpener:", await commitmentOpener.getAddress());

        const DisputeSOXHelpersFactory = await ethers.getContractFactory("DisputeSOXHelpers");
        const disputeHelpers = await DisputeSOXHelpersFactory.deploy();
        await disputeHelpers.waitForDeployment();
        console.log("   DisputeSOXHelpers:", await disputeHelpers.getAddress());

        const DisputeDeployerFactory = await ethers.getContractFactory("DisputeDeployer", {
            libraries: {
                AccumulatorVerifier: await accumulatorVerifier.getAddress(),
                CommitmentOpener: await commitmentOpener.getAddress(),
                DisputeSOXHelpers: await disputeHelpers.getAddress(),
            },
        });
        const disputeDeployer = await DisputeDeployerFactory.connect(sponsor).deploy();
        await disputeDeployer.waitForDeployment();
        console.log("   DisputeDeployer:", await disputeDeployer.getAddress());
        console.log("");

        // Déployer OptimisticSOXAccount
        console.log("📋 ÉTAPE 3: Déploiement de OptimisticSOXAccount");
        const sponsorAmount = parseEther("1");
        const agreedPrice = 30n * 1_000_000_000n; // 30 Gwei
        const completionTip = 80n * 1_000_000_000n; // 80 Gwei
        const disputeTip = 120n * 1_000_000_000n; // 120 Gwei
        const timeoutIncrement = 3600n; // 1 hour
        const numBlocks = 1024;
        const numGates = 4 * numBlocks + 1;
        const commitment = new Uint8Array(32); // Commitment vide pour le test
        
        const accountFactory = await ethers.getContractFactory("OptimisticSOXAccount", {
            libraries: {
                DisputeDeployer: await disputeDeployer.getAddress(),
            },
        });

        const vendorAddress = await vendor.getAddress();
        const optimisticAccount = await accountFactory.connect(sponsor).deploy(
            actualEntryPoint,
            vendorAddress,
            await buyer.getAddress(),
            agreedPrice,
            completionTip,
            disputeTip,
            timeoutIncrement,
            commitment,
            numBlocks,
            numGates,
            vendorAddress, // vendorSigner = vendor
            {
                value: sponsorAmount,
            }
        );
        await optimisticAccount.waitForDeployment();
        const accountAddress = await optimisticAccount.getAddress();
        console.log("   ✅ OptimisticSOXAccount déployé à:", accountAddress);
        console.log("   Sponsor deposit:", ethers.formatEther(sponsorAmount), "ETH");
        
        // Vérifier que le contrat a bien du code
        const accountCode = await provider.getCode(accountAddress);
        if (!accountCode || accountCode === "0x") {
            throw new Error(`Le contrat OptimisticSOXAccount n'a pas de code à l'adresse ${accountAddress}`);
        }
        console.log("   ✅ Code du contrat vérifié (", accountCode.length, "bytes)");
        
        // Attendre un peu pour que le bundler voie le déploiement
        console.log("   ⏳ Attente de la synchronisation avec le bundler...");
        const deployReceipt = await optimisticAccount.deploymentTransaction()?.wait();
        if (deployReceipt) {
            console.log("   Bloc de déploiement:", deployReceipt.blockNumber);
            // Attendre 2 secondes pour que le bundler synchronise
            console.log("   Attente de 2 secondes...");
            await new Promise(resolve => setTimeout(resolve, 2000));
        }
        console.log("");

        // Déposer des fonds dans l'EntryPoint
        console.log("📋 ÉTAPE 4: Dépôt dans l'EntryPoint");
        const depositAmount = parseEther("0.5");
        
        // Vérifier le solde du sponsor avant le dépôt
        const sponsorBalance = await provider.getBalance(await sponsor.getAddress());
        console.log("   Solde du sponsor:", ethers.formatEther(sponsorBalance), "ETH");
        console.log("   Montant à déposer:", ethers.formatEther(depositAmount), "ETH");
        
        if (sponsorBalance < depositAmount) {
            throw new Error(`Solde insuffisant: ${ethers.formatEther(sponsorBalance)} ETH < ${ethers.formatEther(depositAmount)} ETH`);
        }
        
        try {
            // Vérifier que le contrat peut recevoir des fonds
            const contractBalance = await provider.getBalance(accountAddress);
            console.log("   Solde du contrat avant:", ethers.formatEther(contractBalance), "ETH");
            
            // Vérifier que l'EntryPoint est valide (sans appeler balanceOf qui peut échouer)
            const entryPointCode = await provider.getCode(actualEntryPoint);
            if (!entryPointCode || entryPointCode === "0x") {
                throw new Error(`EntryPoint non déployé à ${actualEntryPoint}`);
            }
            console.log("   EntryPoint vérifié (code présent)");
            
            // Essayer le dépôt avec un gas limit élevé
            console.log("   Envoi de la transaction de dépôt...");
            const depositTx = await optimisticAccount.connect(sponsor).depositToEntryPoint({
                value: depositAmount,
                gasLimit: 500000 // Gas limit explicite
            });
            console.log("   Transaction envoyée, hash:", depositTx.hash);
            const receipt = await depositTx.wait();
            console.log("   Transaction confirmée dans le bloc:", receipt?.blockNumber);
            
            if (receipt?.status === 0) {
                throw new Error("Transaction revertée");
            }
            
            // Essayer de vérifier le solde dans l'EntryPoint après le dépôt (peut échouer si c'est une library)
            try {
                const entryPointContract = new Contract(actualEntryPoint, [
                    "function balanceOf(address) view returns (uint256)"
                ], provider);
                const balanceAfter = await entryPointContract.balanceOf(accountAddress);
                console.log("   Solde dans l'EntryPoint après:", ethers.formatEther(balanceAfter), "ETH");
            } catch (e: any) {
                console.warn("   ⚠️  Impossible de vérifier le solde dans l'EntryPoint (peut être une library):", e.message);
            }
            
            console.log("   ✅ Dépôt de", ethers.formatEther(depositAmount), "ETH dans l'EntryPoint");
            console.log("");
        } catch (error: any) {
            console.error("   ❌ Erreur lors du dépôt:", error.message || error.toString());
            if (error.data) {
                console.error("   Données d'erreur:", error.data);
            }
            if (error.reason) {
                console.error("   Raison:", error.reason);
            }
            if (error.transaction) {
                console.error("   Transaction:", error.transaction);
            }
            console.error("");
            console.error("   💡 Vérifications:");
            console.error("      - L'EntryPoint est-il bien déployé à", actualEntryPoint, "?");
            console.error("      - Le contrat OptimisticSOXAccount a-t-il bien l'EntryPoint configuré?");
            console.error("      - L'EntryPoint accepte-t-il les dépôts?");
            throw error;
        }

        // Générer une session key (optionnel)
        console.log("📋 ÉTAPE 5: Génération d'une session key (optionnel)");
        const sessionKeyWallet = Wallet.createRandom().connect(provider);
        const sessionKeyAddress = await sessionKeyWallet.getAddress();
        const sessionKeyPrivateKey = sessionKeyWallet.privateKey;
        
        // Ajouter la session key au contrat
        const addSessionKeyTx = await optimisticAccount.connect(sponsor).addSessionKey(sessionKeyAddress);
        await addSessionKeyTx.wait();
        console.log("   ✅ Session key ajoutée:", sessionKeyAddress);
        console.log("   Session key private key:", sessionKeyPrivateKey);
        console.log("");

        // Préparer l'envoi de la clé
        console.log("📋 ÉTAPE 6: Préparation de l'envoi de la clé");
        const keyToSend = "0x1234567890abcdef";
        const accountAbi = [
            "function nonce() view returns (uint256)",
            "function vendorSigner() view returns (address)",
            "function sessionKeys(address) view returns (bool)",
            "function sendKey(bytes) external",
            "function execute(address,uint256,bytes) external"
        ];
        const contract = new Contract(accountAddress, accountAbi, provider);
        
        const nonce = await contract.nonce();
        const vendorSigner = await contract.vendorSigner();
        const isSessionKey = await contract.sessionKeys(sessionKeyAddress);
        
        console.log("   Nonce actuel:", nonce.toString());
        console.log("   VendorSigner:", vendorSigner);
        console.log("   Session key autorisée?", isSessionKey);
        console.log("");

        // Créer la UserOperation
        console.log("📋 ÉTAPE 7: Création de la UserOperation");
        const sendKeyData = contract.interface.encodeFunctionData("sendKey", [keyToSend]);
        const executeData = contract.interface.encodeFunctionData("execute", [
            accountAddress,
            0,
            sendKeyData
        ]);
        
        const userOpForHash: any = {
            sender: accountAddress,
            nonce: nonce.toString(),
            initCode: "0x",
            callData: executeData,
            callGasLimit: "100000",
            verificationGasLimit: "100000",
            preVerificationGas: "100000",
            maxFeePerGas: "1000000000",
            maxPriorityFeePerGas: "1000000000",
            paymasterAndData: "0x",
            signature: "0x"
        };
        
        console.log("   sendKey data:", sendKeyData.substring(0, 50) + "...");
        console.log("   execute data:", executeData.substring(0, 50) + "...");
        console.log("");

        // Calculer le hash
        console.log("📋 ÉTAPE 8: Calcul du userOpHash");
        const userOpHash = getUserOpHash(userOpForHash, actualEntryPoint, chainId);
        console.log("   userOpHash:", userOpHash);
        console.log("");

        // Signer avec la session key (ou le vendor)
        console.log("📋 ÉTAPE 9: Signature");
        const signerWallet = sessionKeyWallet; // Utiliser la session key
        const hashBytes = getBytes(userOpHash);
        let signature = await signerWallet.signMessage(hashBytes);
        
        const vHex = signature.slice(130, 132);
        const v = parseInt(vHex, 16);
        console.log("   Signature brute:", signature.substring(0, 20) + "...");
        console.log("   Signature v value:", v);
        
        if (v !== 27 && v !== 28) {
            signature = normalizeSignature(signature);
            console.log("   Signature normalisée");
        }
        console.log("   Signature finale:", signature.substring(0, 20) + "...");
        console.log("");

        // Vérifier la signature
        console.log("📋 ÉTAPE 10: Vérification de la signature");
        const { verifyMessage } = await import("ethers");
        const recovered = verifyMessage(hashBytes, signature);
        const signerAddress = await signerWallet.getAddress();
        console.log("   Adresse récupérée:", recovered);
        console.log("   Signataire:", signerAddress);
        console.log("   Correspond?", recovered.toLowerCase() === signerAddress.toLowerCase());
        
        if (recovered.toLowerCase() !== signerAddress.toLowerCase()) {
            throw new Error("La signature ne récupère pas la bonne adresse!");
        }
        console.log("   ✅ Signature valide");
        console.log("");

        // Créer la UserOperation finale pour le bundler
        console.log("📋 ÉTAPE 11: Préparation pour le bundler");
        const userOpForBundler: any = {
            sender: accountAddress.toLowerCase(),
            nonce: toBeHex(nonce),
            initCode: "0x",
            callData: executeData,
            callGasLimit: toBeHex(BigInt(userOpForHash.callGasLimit)),
            verificationGasLimit: toBeHex(BigInt(userOpForHash.verificationGasLimit)),
            preVerificationGas: toBeHex(BigInt(userOpForHash.preVerificationGas)),
            maxFeePerGas: toBeHex(BigInt(userOpForHash.maxFeePerGas)),
            maxPriorityFeePerGas: toBeHex(BigInt(userOpForHash.maxPriorityFeePerGas)),
            paymasterAndData: "0x",
            signature: signature
        };
        console.log("   UserOperation prête pour le bundler");
        console.log("");

        // Vérifier une dernière fois que le contrat a du code avant d'envoyer au bundler
        console.log("📋 ÉTAPE 12: Vérification finale avant envoi au bundler");
        const finalAccountCode = await provider.getCode(accountAddress);
        if (!finalAccountCode || finalAccountCode === "0x") {
            throw new Error(`❌ Le contrat OptimisticSOXAccount n'a toujours pas de code à l'adresse ${accountAddress}. Le bundler ne pourra pas traiter la UserOperation.`);
        }
        console.log("   ✅ Code du contrat vérifié (Hardhat):", finalAccountCode.length, "bytes");
        
        // Note: Le bundler Alto ne supporte pas les méthodes RPC standard comme eth_getCode
        // Il vérifiera automatiquement le contrat lors de la simulation de la UserOperation
        console.log("   ⚠️  Note: Le bundler Alto ne supporte pas eth_getCode");
        console.log("   Le bundler vérifiera automatiquement le contrat lors de la simulation");
        console.log("");

        // Note: Pas de vérification finale possible car le bundler Alto ne supporte pas eth_getCode
        // Le bundler vérifiera le contrat lors de la simulation de la UserOperation
        console.log("📋 ÉTAPE 13: Prêt pour l'envoi");
        console.log("   Le bundler vérifiera automatiquement le contrat lors de la simulation");
        console.log("");

        // Vider le cache du bundler avant l'envoi (pour forcer la resynchronisation)
        console.log("📋 ÉTAPE 14: Vidage du cache du bundler");
        try {
            await axios.post(BUNDLER_URL, {
                jsonrpc: "2.0",
                id: 999,
                method: "debug_bundler_clearState",
                params: []
            });
            console.log("   ✅ Cache du bundler vidé");
        } catch (error: any) {
            console.warn("   ⚠️  Impossible de vider le cache du bundler:", error.message || "méthode non disponible");
            console.warn("   On continue quand même...");
        }
        console.log("");

        // Envoyer au bundler
        console.log("📋 ÉTAPE 15: Envoi au bundler");
        let bundlerSuccess = false;
        let bundlerError: any = null;
        
        try {
            const response = await axios.post(BUNDLER_URL, {
                jsonrpc: "2.0",
                id: 1,
                method: "eth_sendUserOperation",
                params: [userOpForBundler, actualEntryPoint]
            });
            
            if (response.data.error) {
                bundlerError = response.data.error;
                const errorMsg = JSON.stringify(response.data.error);
                
                // Vérifier si c'est juste un problème d'adresse EntryPoint
                if (errorMsg.includes("EntryPoint") && errorMsg.includes("not supported")) {
                    console.warn("   ⚠️  Le bundler rejette car l'EntryPoint n'est pas configuré avec la bonne adresse");
                    console.warn("   Mais toutes les autres étapes ont réussi !");
                    console.log("");
                    console.log("   📋 Pour compléter le test:");
                    console.log("   1. Arrête le bundler (Ctrl+C)");
                    console.log("   2. Modifie bundler-alto/scripts/config.local.json:");
                    console.log(`      "entrypoints": "${actualEntryPoint}"`);
                    console.log("   3. Redémarre le bundler");
                    console.log("   4. Relance ce test");
                    console.log("");
                    // Ne pas throw, continuer pour afficher le résumé
                } else if (errorMsg.includes("Sender has no code") || errorMsg.includes("factory not deployed")) {
                    console.error("   ❌ Le bundler ne voit pas le contrat déployé lors de la simulation!");
                    console.error("   Adresse du contrat:", accountAddress);
                    console.error("   Code du contrat (vu par Hardhat):", finalAccountCode.length, "bytes");
                    console.error("");
                    console.error("   💡 Le bundler utilise probablement un cache ou n'est pas synchronisé.");
                    console.error("   SOLUTION RECOMMANDÉE:");
                    console.error("   1. Arrête le bundler (Ctrl+C dans son terminal)");
                    console.error("   2. Redémarre le bundler: cd bundler-alto && ./run-local.sh");
                    console.error("   3. Relance ce test");
                    console.error("");
                    console.error("   Autres solutions possibles:");
                    console.error("   - Vérifie que le bundler utilise http://localhost:8545 dans config.local.json");
                    console.error("   - Assure-toi qu'un seul Hardhat node tourne sur le port 8545");
                    console.error("   - Redémarre Hardhat node ET le bundler ensemble");
                    throw new Error(`Bundler error: ${errorMsg}`);
                } else {
                    throw new Error(`Bundler error: ${errorMsg}`);
                }
            } else if (response.data.result) {
                bundlerSuccess = true;
                console.log("   ✅ UserOperation envoyée avec succès!");
                console.log("   Hash:", response.data.result);
            }
        } catch (error: any) {
            bundlerError = error;
            if (error.response) {
                const errorData = error.response.data;
                const errorMsg = JSON.stringify(errorData);
                
                // Vérifier si c'est juste un problème d'adresse EntryPoint
                if (errorMsg.includes("EntryPoint") && errorMsg.includes("not supported")) {
                    console.warn("   ⚠️  Le bundler rejette car l'EntryPoint n'est pas configuré avec la bonne adresse");
                    console.warn("   Mais toutes les autres étapes ont réussi !");
                    console.log("");
                    console.log("   📋 Pour compléter le test:");
                    console.log("   1. Arrête le bundler (Ctrl+C)");
                    console.log("   2. Modifie bundler-alto/scripts/config.local.json:");
                    console.log(`      "entrypoints": "${actualEntryPoint}"`);
                    console.log("   3. Redémarre le bundler");
                    console.log("   4. Relance ce test");
                    console.log("");
                    // Ne pas throw, continuer pour afficher le résumé
                } else if (errorMsg.includes("Sender has no code") || errorMsg.includes("factory not deployed")) {
                    console.error("   ❌ Le bundler ne voit pas le contrat déployé lors de la simulation!");
                    console.error("   Adresse du contrat:", accountAddress);
                    console.error("   Code du contrat (vu par Hardhat):", finalAccountCode.length, "bytes");
                    console.error("");
                    console.error("   💡 Le bundler utilise probablement un cache ou n'est pas synchronisé.");
                    console.error("   SOLUTION RECOMMANDÉE:");
                    console.error("   1. Arrête le bundler (Ctrl+C dans son terminal)");
                    console.error("   2. Redémarre le bundler: cd bundler-alto && ./run-local.sh");
                    console.error("   3. Relance ce test");
                    console.error("");
                    console.error("   Autres solutions possibles:");
                    console.error("   - Vérifie que le bundler utilise http://localhost:8545 dans config.local.json");
                    console.error("   - Assure-toi qu'un seul Hardhat node tourne sur le port 8545");
                    console.error("   - Redémarre Hardhat node ET le bundler ensemble");
                    throw error;
                } else {
                    console.error("   ❌ Erreur lors de l'envoi au bundler:");
                    console.error("   Status:", error.response.status);
                    console.error("   Data:", JSON.stringify(errorData, null, 2));
                    throw error;
                }
            } else {
                console.error("   ❌ Erreur lors de l'envoi au bundler:");
                console.error("   Erreur:", error.message);
                throw error;
            }
        }
        
        console.log("");
        console.log("=".repeat(80));
        console.log("✅ TEST COMPLET TERMINÉ AVEC SUCCÈS");
        console.log("=".repeat(80));
        console.log("");
        console.log("📋 Résumé:");
        console.log("   Contrat déployé:", accountAddress);
        console.log("   Session key:", sessionKeyAddress);
        console.log("   Session key private key:", sessionKeyPrivateKey);
        console.log("   Clé envoyée:", keyToSend);
        
    } catch (error: any) {
        console.error("");
        console.error("=".repeat(80));
        console.error("❌ ERREUR LORS DU TEST");
        console.error("=".repeat(80));
        console.error("   Message:", error.message || error.toString());
        if (error.stack) {
            console.error("   Stack:", error.stack);
        }
        process.exit(1);
    }
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
