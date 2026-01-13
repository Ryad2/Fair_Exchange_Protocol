import hre from "hardhat";
import { ethers } from "hardhat";
import { parseEther } from "ethers";
import { writeFileSync, existsSync, mkdirSync, readFileSync } from "fs";
import { join } from "path";

const CANONICAL_ENTRYPOINT_V8 = "0x4337084D9E255Ff0702461CF8895CE9E3b5Ff108";

async function setCode(
    provider: typeof ethers.provider,
    address: string,
    code: string
) {
    try {
        await provider.send("hardhat_setCode", [address, code]);
        return;
    } catch {
        await provider.send("anvil_setCode", [address, code]);
    }
}

async function setStorage(
    provider: typeof ethers.provider,
    address: string,
    slot: string,
    value: string
) {
    try {
        await provider.send("hardhat_setStorageAt", [address, slot, value]);
        return;
    } catch {
        await provider.send("anvil_setStorageAt", [address, slot, value]);
    }
}

/**
 * Script de déploiement complet et synchronisé
 * 
 * Ce script déploie dans l'ordre :
 * 1. Toutes les libraries nécessaires
 * 2. DisputeDeployer
 * 3. EntryPoint (pour ERC-4337)
 * 4. Génère les JSON avec les bonnes adresses
 * 5. Met à jour la config du bundler
 * 6. Crée un fichier .env.local avec les adresses
 */

interface DeploymentAddresses {
    accumulatorVerifier: string;
    sha256Evaluator: string;
    simpleOperationsEvaluator: string;
    aes128CtrEvaluator: string;
    circuitEvaluator: string;
    commitmentOpener: string;
    disputeDeployer: string;
    entryPoint: string;
}

async function main() {
    const { ethers } = hre;
    const [sponsor] = await ethers.getSigners();

    console.log("=".repeat(80));
    console.log("🚀 DÉPLOIEMENT COMPLET ET SYNCHRONISÉ DU STACK SOX");
    console.log("=".repeat(80));
    console.log("");
    console.log("📋 Signer:", await sponsor.getAddress());
    console.log("🌐 Network:", hre.network.name);
    console.log("");

    const addresses: DeploymentAddresses = {
        accumulatorVerifier: "",
        sha256Evaluator: "",
        simpleOperationsEvaluator: "",
        aes128CtrEvaluator: "",
        circuitEvaluator: "",
        commitmentOpener: "",
        disputeDeployer: "",
        entryPoint: "",
    };

    // ============================================
    // ÉTAPE 1: Déploiement des libraries
    // ============================================
    console.log("📚 ÉTAPE 1: Déploiement des libraries...");
    console.log("-".repeat(80));

    const AccumulatorVerifierFactory = await ethers.getContractFactory("AccumulatorVerifier");
    const accumulatorVerifier = await AccumulatorVerifierFactory.deploy();
    await accumulatorVerifier.waitForDeployment();
    addresses.accumulatorVerifier = await accumulatorVerifier.getAddress();
    console.log("  ✅ AccumulatorVerifier:", addresses.accumulatorVerifier);

    const SHA256EvaluatorFactory = await ethers.getContractFactory("SHA256Evaluator");
    const sha256Evaluator = await SHA256EvaluatorFactory.deploy();
    await sha256Evaluator.waitForDeployment();
    addresses.sha256Evaluator = await sha256Evaluator.getAddress();
    console.log("  ✅ SHA256Evaluator:", addresses.sha256Evaluator);

    const SimpleOperationsEvaluatorFactory = await ethers.getContractFactory("SimpleOperationsEvaluator");
    const simpleOperationsEvaluator = await SimpleOperationsEvaluatorFactory.deploy();
    await simpleOperationsEvaluator.waitForDeployment();
    addresses.simpleOperationsEvaluator = await simpleOperationsEvaluator.getAddress();
    console.log("  ✅ SimpleOperationsEvaluator:", addresses.simpleOperationsEvaluator);

    const AES128CtrEvaluatorFactory = await ethers.getContractFactory("AES128CtrEvaluator");
    const aes128CtrEvaluator = await AES128CtrEvaluatorFactory.deploy();
    await aes128CtrEvaluator.waitForDeployment();
    addresses.aes128CtrEvaluator = await aes128CtrEvaluator.getAddress();
    console.log("  ✅ AES128CtrEvaluator:", addresses.aes128CtrEvaluator);

    const CircuitEvaluatorFactory = await ethers.getContractFactory("CircuitEvaluator", {
        libraries: {
            SHA256Evaluator: addresses.sha256Evaluator,
            SimpleOperationsEvaluator: addresses.simpleOperationsEvaluator,
            AES128CtrEvaluator: addresses.aes128CtrEvaluator,
        },
    });
    const circuitEvaluator = await CircuitEvaluatorFactory.deploy();
    await circuitEvaluator.waitForDeployment();
    addresses.circuitEvaluator = await circuitEvaluator.getAddress();
    console.log("  ✅ CircuitEvaluator:", addresses.circuitEvaluator);

    const CommitmentOpenerFactory = await ethers.getContractFactory("CommitmentOpener");
    const commitmentOpener = await CommitmentOpenerFactory.deploy();
    await commitmentOpener.waitForDeployment();
    addresses.commitmentOpener = await commitmentOpener.getAddress();
    console.log("  ✅ CommitmentOpener:", addresses.commitmentOpener);

    console.log("");

    // ============================================
    // ÉTAPE 2: Déploiement de DisputeDeployer
    // ============================================
    console.log("📦 ÉTAPE 2: Déploiement de DisputeDeployer...");
    console.log("-".repeat(80));

    const DisputeDeployerFactory = await ethers.getContractFactory("DisputeDeployer", {
        libraries: {
            AccumulatorVerifier: addresses.accumulatorVerifier,
            CommitmentOpener: addresses.commitmentOpener,
            SHA256Evaluator: addresses.sha256Evaluator,
        },
    });
    const disputeDeployer = await DisputeDeployerFactory.connect(sponsor).deploy();
    await disputeDeployer.waitForDeployment();
    addresses.disputeDeployer = await disputeDeployer.getAddress();
    console.log("  ✅ DisputeDeployer:", addresses.disputeDeployer);
    // If DisputeSOXAccount constructor signature changes, recompile and redeploy
    // DisputeDeployer + OptimisticSOXAccount so the linked bytecode stays in sync.
    console.log("");

    // ============================================
    // ÉTAPE 3: Déploiement de l'EntryPoint v0.8 (canonique)
    // ============================================
    console.log("🔐 ÉTAPE 3: Déploiement de l'EntryPoint v0.8 (canonique)...");
    console.log("-".repeat(80));

    const provider = ethers.provider;
    
    // Déployer un EntryPoint temporaire pour obtenir son runtime code
    const entryPointJsonPath = join(
        __dirname,
        "../../../bundler-alto/src/contracts/EntryPointFilterOpsOverride.sol/EntryPointFilterOpsOverride08.json"
    );
    const entryPointJson = JSON.parse(
        readFileSync(entryPointJsonPath, "utf-8")
    );
    
    const tempFactory = new ethers.ContractFactory(
        entryPointJson.abi,
        entryPointJson.bytecode.object,
        sponsor
    );
    const tempEntryPoint = await tempFactory.deploy();
    await tempEntryPoint.waitForDeployment();
    const tempAddress = await tempEntryPoint.getAddress();
    const runtimeCode = await provider.getCode(tempAddress);
    
    if (!runtimeCode || runtimeCode === "0x") {
        throw new Error("Failed to read EntryPoint runtime code");
    }
    
    // Déployer l'EntryPoint à l'adresse canonique
    await setCode(provider, CANONICAL_ENTRYPOINT_V8, runtimeCode);
    await setCode(provider, tempAddress, "0x"); // Nettoyer le contrat temporaire
    
    addresses.entryPoint = CANONICAL_ENTRYPOINT_V8;
    console.log("  ✅ EntryPoint v0.8 déployé à:", addresses.entryPoint);
    
    // Déployer et configurer SenderCreator
    const senderCreatorJsonPath = join(
        __dirname,
        "../../../bundler-alto/src/contracts/SenderCreator.sol/SenderCreator.json"
    );
    const senderCreatorJson = JSON.parse(
        readFileSync(senderCreatorJsonPath, "utf-8")
    );
    const senderCreatorFactory = new ethers.ContractFactory(
        senderCreatorJson.abi,
        senderCreatorJson.bytecode.object,
        sponsor
    );
    const senderCreator = await senderCreatorFactory.deploy();
    await senderCreator.waitForDeployment();
    const senderCreatorAddress = await senderCreator.getAddress();
    console.log("  ✅ SenderCreator déployé à:", senderCreatorAddress);
    
    // Configurer le slot SenderCreator dans l'EntryPoint
    const senderCreatorSlot = ethers.keccak256(
        ethers.toUtf8Bytes("SENDER_CREATOR")
    );
    const senderCreatorValue = ethers.zeroPadValue(senderCreatorAddress, 32);
    await setStorage(
        provider,
        CANONICAL_ENTRYPOINT_V8,
        senderCreatorSlot,
        senderCreatorValue
    );
    console.log("  ✅ SenderCreator slot configuré");
    
    // Initialiser le domain separator
    const entryPointContract = new ethers.Contract(
        CANONICAL_ENTRYPOINT_V8,
        ["function initDomainSeparator() external"],
        sponsor
    );
    await (entryPointContract.initDomainSeparator() as Promise<any>);
    console.log("  ✅ Domain separator initialisé");
    console.log("");

    // ============================================
    // ÉTAPE 4: Génération des JSON avec bytecode linké
    // ============================================
    console.log("📄 ÉTAPE 4: Génération des JSON avec bytecode linké...");
    console.log("-".repeat(80));

    const contractsDir = join(__dirname, "../../app/lib/blockchain/contracts/");
    if (!existsSync(contractsDir)) {
        mkdirSync(contractsDir, { recursive: true });
    }
    const legacyContractsDir = join(contractsDir, "legacy");
    if (!existsSync(legacyContractsDir)) {
        mkdirSync(legacyContractsDir, { recursive: true });
    }

    // Générer JSON pour chaque library
    const libraryNames = [
        "AccumulatorVerifier",
        "SHA256Evaluator",
        "SimpleOperationsEvaluator",
        "AES128CtrEvaluator",
        "CircuitEvaluator",
        "CommitmentOpener",
        "DisputeDeployer",
    ];

    for (const libName of libraryNames) {
        const artifact = await hre.artifacts.readArtifact(libName);
        const data = {
            abi: artifact.abi,
            bytecode: artifact.bytecode,
        };
        writeFileSync(
            join(contractsDir, `${libName}.json`),
            JSON.stringify(data, null, 2)
        );
        console.log(`  ✅ ${libName}.json généré`);
    }

    // Générer JSON pour OptimisticSOXAccount avec bytecode linké
    const OptimisticSOXAccountArtifact = await hre.artifacts.readArtifact("OptimisticSOXAccount");
    let optimisticBytecode = OptimisticSOXAccountArtifact.bytecode;
    
    // Remplacer le placeholder de DisputeDeployer dans le bytecode
    const disputeDeployerPlaceholder = "0".repeat(40); // Placeholder de 40 caractères (20 bytes)
    const disputeDeployerAddress = addresses.disputeDeployer.slice(2).toLowerCase();
    
    // Trouver et remplacer le placeholder (peut nécessiter plusieurs tentatives selon le format)
    optimisticBytecode = optimisticBytecode.replace(
        new RegExp(disputeDeployerPlaceholder, "gi"),
        disputeDeployerAddress
    );
    
    // Si le placeholder n'est pas trouvé, essayer de linker manuellement
    // Note: Hardhat devrait déjà linker, mais on s'assure que c'est correct
    const OptimisticSOXAccountFactory = await ethers.getContractFactory("OptimisticSOXAccount", {
        libraries: {
            DisputeDeployer: addresses.disputeDeployer,
        },
    });
    const linkedBytecode = OptimisticSOXAccountFactory.bytecode;
    
    const optimisticData = {
        abi: OptimisticSOXAccountArtifact.abi,
        bytecode: linkedBytecode,
    };
    writeFileSync(
        join(contractsDir, "OptimisticSOXAccount.json"),
        JSON.stringify(optimisticData, null, 2)
    );
    console.log("  ✅ OptimisticSOXAccount.json généré avec bytecode linké");

    // Générer JSON pour DisputeSOXAccount
    const DisputeSOXAccountArtifact = await hre.artifacts.readArtifact("DisputeSOXAccount");
    const disputeData = {
        abi: DisputeSOXAccountArtifact.abi,
        bytecode: DisputeSOXAccountArtifact.bytecode,
    };
    writeFileSync(
        join(contractsDir, "DisputeSOXAccount.json"),
        JSON.stringify(disputeData, null, 2)
    );
    console.log("  ✅ DisputeSOXAccount.json généré");

    // Générer JSON pour OptimisticSOX (base, sans ERC-4337) - optionnel
    try {
        const OptimisticSOXArtifact = await hre.artifacts.readArtifact("OptimisticSOX");
        const optimisticBaseFactory = await ethers.getContractFactory("OptimisticSOX", {
            libraries: {
                DisputeDeployer: addresses.disputeDeployer,
            },
        });
        const optimisticBaseData = {
            abi: OptimisticSOXArtifact.abi,
            bytecode: optimisticBaseFactory.bytecode,
        };
        writeFileSync(
            join(legacyContractsDir, "OptimisticSOX.json"),
            JSON.stringify(optimisticBaseData, null, 2)
        );
        console.log("  ✅ legacy/OptimisticSOX.json généré avec bytecode linké");
    } catch (error) {
        console.log("  ⚠️  OptimisticSOX n'existe pas (ignoré)");
    }

    // Générer JSON pour DisputeSOX (base) - optionnel
    try {
        const DisputeSOXArtifact = await hre.artifacts.readArtifact("DisputeSOX");
        const disputeBaseData = {
            abi: DisputeSOXArtifact.abi,
            bytecode: DisputeSOXArtifact.bytecode,
        };
        writeFileSync(
            join(legacyContractsDir, "DisputeSOX.json"),
            JSON.stringify(disputeBaseData, null, 2)
        );
        console.log("  ✅ legacy/DisputeSOX.json généré");
    } catch (error) {
        console.log("  ⚠️  DisputeSOX n'existe pas (ignoré)");
    }

    console.log("");

    // ============================================
    // ÉTAPE 5: Mise à jour de la config du bundler
    // ============================================
    console.log("⚙️  ÉTAPE 5: Mise à jour de la config du bundler...");
    console.log("-".repeat(80));

    const bundlerConfigPath = join(__dirname, "../../../bundler-alto/config.localhost.json");
    
    if (existsSync(bundlerConfigPath)) {
        const bundlerConfig = require(bundlerConfigPath);
        bundlerConfig.entrypoints = addresses.entryPoint;
        
        writeFileSync(
            bundlerConfigPath,
            JSON.stringify(bundlerConfig, null, 2)
        );
        console.log("  ✅ Config bundler mise à jour:", bundlerConfigPath);
        console.log("     EntryPoint:", addresses.entryPoint);
    } else {
        console.log("  ⚠️  Fichier de config bundler non trouvé:", bundlerConfigPath);
        console.log("     Vous devrez mettre à jour manuellement la config du bundler");
    }
    console.log("");

    // ============================================
    // ÉTAPE 6: Création du fichier .env.local
    // ============================================
    console.log("🔧 ÉTAPE 6: Création du fichier .env.local...");
    console.log("-".repeat(80));

    const envPath = join(__dirname, "../../../.env.local");
    const envContent = `# Adresses déployées automatiquement par deployCompleteStack.ts
# Généré le: ${new Date().toISOString()}

# EntryPoint pour ERC-4337 (v0.8 canonique)
NEXT_PUBLIC_ENTRY_POINT=${addresses.entryPoint}
NEXT_PUBLIC_ENTRY_POINT_V8=${addresses.entryPoint}

# RPC URL (par défaut: localhost)
NEXT_PUBLIC_RPC_URL=http://localhost:8545

# Libraries déployées (pour référence)
ACCUMULATOR_VERIFIER=${addresses.accumulatorVerifier}
SHA256_EVALUATOR=${addresses.sha256Evaluator}
SIMPLE_OPERATIONS_EVALUATOR=${addresses.simpleOperationsEvaluator}
AES128_CTR_EVALUATOR=${addresses.aes128CtrEvaluator}
CIRCUIT_EVALUATOR=${addresses.circuitEvaluator}
COMMITMENT_OPENER=${addresses.commitmentOpener}
DISPUTE_DEPLOYER=${addresses.disputeDeployer}
`;

    writeFileSync(envPath, envContent);
    console.log("  ✅ Fichier .env.local créé:", envPath);
    console.log("");

    // ============================================
    // ÉTAPE 7: Mise à jour de deployed-contracts.json
    // ============================================
    console.log("📝 ÉTAPE 7: Mise à jour de deployed-contracts.json...");
    console.log("-".repeat(80));

    const deployedContractsPath = join(__dirname, "../../../deployed-contracts.json");
    const deployedContractsSrcPath = join(__dirname, "../../deployed-contracts.json");
    const network = await hre.ethers.provider.getNetwork();
    const deployedContractsData = {
        network: hre.network.name,
        chainId: Number(network.chainId),
        deployer: await sponsor.getAddress(),
        addresses: {
            AccumulatorVerifier: addresses.accumulatorVerifier,
            SHA256Evaluator: addresses.sha256Evaluator,
            SimpleOperationsEvaluator: addresses.simpleOperationsEvaluator,
            AES128CtrEvaluator: addresses.aes128CtrEvaluator,
            CircuitEvaluator: addresses.circuitEvaluator,
            CommitmentOpener: addresses.commitmentOpener,
            DisputeDeployer: addresses.disputeDeployer,
        },
        entryPoint: addresses.entryPoint,
        timestamp: new Date().toISOString(),
    };

    const jsonContent = JSON.stringify(deployedContractsData, null, 2);
    
    // Écrire à la racine (pour compatibilité)
    writeFileSync(deployedContractsPath, jsonContent);
    console.log("  ✅ deployed-contracts.json mis à jour:", deployedContractsPath);
    
    // Écrire aussi dans src/ (pour que Next.js/Turbopack puisse le trouver)
    writeFileSync(deployedContractsSrcPath, jsonContent);
    console.log("  ✅ src/deployed-contracts.json mis à jour:", deployedContractsSrcPath);
    console.log("     DisputeDeployer:", addresses.disputeDeployer);
    console.log("");

    // ============================================
    // RÉSUMÉ
    // ============================================
    console.log("=".repeat(80));
    console.log("✅ DÉPLOIEMENT COMPLET TERMINÉ AVEC SUCCÈS !");
    console.log("=".repeat(80));
    console.log("");
    console.log("📋 Adresses déployées :");
    console.log("");
    console.log("  Libraries :");
    console.log("    AccumulatorVerifier      :", addresses.accumulatorVerifier);
    console.log("    SHA256Evaluator          :", addresses.sha256Evaluator);
    console.log("    SimpleOperationsEvaluator:", addresses.simpleOperationsEvaluator);
    console.log("    AES128CtrEvaluator      :", addresses.aes128CtrEvaluator);
    console.log("    CircuitEvaluator        :", addresses.circuitEvaluator);
    console.log("    CommitmentOpener         :", addresses.commitmentOpener);
    console.log("");
    console.log("  Contrats principaux :");
    console.log("    DisputeDeployer         :", addresses.disputeDeployer);
    console.log("    EntryPoint              :", addresses.entryPoint);
    console.log("");
    console.log("📄 Fichiers générés :");
    console.log("    JSON contracts         : src/app/lib/blockchain/contracts/*.json");
    console.log("    Config bundler         : bundler-alto/config.localhost.json");
    console.log("    Variables d'environnement: .env.local");
    console.log("");
    console.log("🚀 Prochaines étapes :");
    console.log("    1. Vérifier que le fichier .env.local est chargé par Next.js");
    console.log("    2. Redémarrer l'application web (npm run dev)");
    console.log("    3. Démarrer le bundler avec la nouvelle config");
    console.log("    4. Tester le déploiement d'un contrat OptimisticSOXAccount");
    console.log("");
    console.log("=".repeat(80));
}

main().catch((error) => {
    console.error("❌ Erreur lors du déploiement:", error);
    process.exitCode = 1;
});


