import hre from "hardhat";
import { ethers } from "hardhat";
import { writeFileSync } from "fs";
import { join } from "path";

/**
 * Script pour redéployer DisputeDeployer avec le nouveau bytecode de DisputeSOXAccount.
 * 
 * IMPORTANT: Après avoir corrigé DisputeSOXAccount, il faut redéployer DisputeDeployer
 * car il contient le bytecode de DisputeSOXAccount via "new DisputeSOXAccount(...)".
 * 
 * Ce script:
 * 1. Compile les contrats (pour s'assurer que DisputeSOXAccount est à jour)
 * 2. Déploie les libraries nécessaires
 * 3. Déploie DisputeDeployer (qui contient le nouveau bytecode de DisputeSOXAccount)
 * 4. Génère/met à jour les fichiers JSON pour l'application
 */

async function main() {
    const { ethers } = hre;
    const [sponsor] = await ethers.getSigners();
    
    console.log("🔄 Redéploiement de DisputeDeployer avec le nouveau bytecode...");
    console.log("=".repeat(80));
    
    // ÉTAPE 1: Compilation
    console.log("\n📦 ÉTAPE 1: Compilation des contrats...");
    await hre.run("compile");
    console.log("  ✅ Compilation terminée\n");
    
    // ÉTAPE 2: Déploiement des libraries nécessaires
    console.log("📦 ÉTAPE 2: Déploiement des libraries...");
    
    const AccumulatorVerifierFactory = await ethers.getContractFactory("AccumulatorVerifier");
    const accumulatorVerifier = await AccumulatorVerifierFactory.deploy();
    await accumulatorVerifier.waitForDeployment();
    const accumulatorVerifierAddr = await accumulatorVerifier.getAddress();
    console.log("  ✅ AccumulatorVerifier:", accumulatorVerifierAddr);
    
    const CommitmentOpenerFactory = await ethers.getContractFactory("CommitmentOpener");
    const commitmentOpener = await CommitmentOpenerFactory.deploy();
    await commitmentOpener.waitForDeployment();
    const commitmentOpenerAddr = await commitmentOpener.getAddress();
    console.log("  ✅ CommitmentOpener:", commitmentOpenerAddr);
    
    const DisputeSOXHelpersFactory = await ethers.getContractFactory("DisputeSOXHelpers");
    const disputeHelpers = await DisputeSOXHelpersFactory.deploy();
    await disputeHelpers.waitForDeployment();
    const disputeHelpersAddr = await disputeHelpers.getAddress();
    console.log("  ✅ DisputeSOXHelpers:", disputeHelpersAddr);
    
    // ÉTAPE 3: Déploiement de DisputeDeployer (CRITIQUE)
    console.log("\n🚀 ÉTAPE 3: Déploiement de DisputeDeployer avec le nouveau bytecode...");
    const DisputeDeployerFactory = await ethers.getContractFactory("DisputeDeployer", {
        libraries: {
            AccumulatorVerifier: accumulatorVerifierAddr,
            CommitmentOpener: commitmentOpenerAddr,
            DisputeSOXHelpers: disputeHelpersAddr,
        },
    });
    const disputeDeployer = await DisputeDeployerFactory.connect(sponsor).deploy();
    await disputeDeployer.waitForDeployment();
    const disputeDeployerAddr = await disputeDeployer.getAddress();
    console.log("  ✅ DisputeDeployer déployé à:", disputeDeployerAddr);
    console.log("  ⚠️  IMPORTANT: Ce DisputeDeployer contient le NOUVEAU bytecode de DisputeSOXAccount");
    
    // ÉTAPE 4: Génération/mise à jour des fichiers JSON
    console.log("\n📄 ÉTAPE 4: Génération des fichiers JSON pour l'application...");
    const contractsDir = join(__dirname, "../../app/lib/blockchain/contracts/");
    
    // Générer DisputeDeployer.json
    const DisputeDeployerArtifact = await hre.artifacts.readArtifact("DisputeDeployer");
    const disputeDeployerData = {
        abi: DisputeDeployerArtifact.abi,
        bytecode: DisputeDeployerArtifact.bytecode,
    };
    writeFileSync(
        join(contractsDir, "DisputeDeployer.json"),
        JSON.stringify(disputeDeployerData, null, 2)
    );
    console.log("  ✅ DisputeDeployer.json généré");
    
    // Générer OptimisticSOXAccount.json avec le nouveau DisputeDeployer linké
    const OptimisticSOXAccountFactory = await ethers.getContractFactory("OptimisticSOXAccount", {
        libraries: {
            DisputeDeployer: disputeDeployerAddr,
        },
    });
    const OptimisticSOXAccountArtifact = await hre.artifacts.readArtifact("OptimisticSOXAccount");
    const optimisticData = {
        abi: OptimisticSOXAccountArtifact.abi,
        bytecode: OptimisticSOXAccountFactory.bytecode, // Bytecode linké avec le nouveau DisputeDeployer
    };
    writeFileSync(
        join(contractsDir, "OptimisticSOXAccount.json"),
        JSON.stringify(optimisticData, null, 2)
    );
    console.log("  ✅ OptimisticSOXAccount.json généré avec le nouveau DisputeDeployer");
    
    console.log("\n" + "=".repeat(80));
    console.log("✅ REDÉPLOIEMENT TERMINÉ!");
    console.log("=".repeat(80));
    console.log("\n📋 Résumé:");
    console.log(`  - DisputeDeployer: ${disputeDeployerAddr}`);
    console.log(`  - Fichiers JSON mis à jour dans: ${contractsDir}`);
    console.log("\n⚠️  IMPORTANT:");
    console.log("  1. Les nouveaux contrats créés via ce DisputeDeployer utiliseront le NOUVEAU bytecode");
    console.log("  2. Les contrats déjà déployés ne peuvent PAS être mis à jour (immutables)");
    console.log("  3. Il faut créer un NOUVEAU OptimisticSOXAccount pour tester avec la correction");
    console.log("");
}

main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error(error);
        process.exit(1);
    });
