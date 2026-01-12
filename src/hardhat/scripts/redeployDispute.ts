import hre from "hardhat";
import { ethers } from "hardhat";
import { readFileSync } from "fs";
import { join } from "path";

/**
 * Script pour redéployer un contrat DisputeSOXAccount via DisputeDeployer.
 * 
 * IMPORTANT: Le contrat DisputeSOXAccount a été corrigé (getAesKey()).
 * Pour qu'un nouveau contrat utilise cette correction, il faut:
 * 1. S'assurer que DisputeDeployer a été redéployé avec le nouveau bytecode
 * 2. Créer un nouveau contrat Dispute via DisputeDeployer.deployDispute()
 * 
 * Ce script affiche les informations nécessaires pour créer un nouveau contrat.
 */
async function main() {
    const { ethers } = hre;
    const [sponsor] = await ethers.getSigners();
    
    console.log("🔄 Script de redéploiement du contrat DisputeSOXAccount");
    console.log("=".repeat(80));
    console.log("");
    console.log("Sponsor:", await sponsor.getAddress());
    console.log("");
    
    // Charger l'adresse de DisputeDeployer depuis deployed-contracts.json
    const contractsJsonPath = join(__dirname, "../../deployed-contracts.json");
    let deployedContracts: any;
    try {
        const jsonContent = readFileSync(contractsJsonPath, "utf-8");
        deployedContracts = JSON.parse(jsonContent);
    } catch (error) {
        console.error("❌ Erreur lors de la lecture de deployed-contracts.json:", error);
        process.exit(1);
    }
    
    const disputeDeployerAddr = deployedContracts?.addresses?.DisputeDeployer;
    if (!disputeDeployerAddr) {
        console.error("❌ DisputeDeployer non trouvé dans deployed-contracts.json");
        console.error("   Exécutez d'abord: npx hardhat run scripts/redeployDisputeDeployer.ts --network localhost");
        process.exit(1);
    }
    
    console.log("📋 DisputeDeployer trouvé à:", disputeDeployerAddr);
    console.log("");
    console.log("✅ IMPORTANT:");
    console.log("   Le contrat DisputeSOXAccount a été corrigé (getAesKey()).");
    console.log("   Pour qu'un nouveau contrat utilise cette correction:");
    console.log("");
    console.log("   1. Vérifiez que DisputeDeployer a été redéployé avec le nouveau bytecode:");
    console.log("      npx hardhat run scripts/redeployDisputeDeployer.ts --network localhost");
    console.log("");
    console.log("   2. Créez un nouveau contrat Dispute via l'interface de l'application");
    console.log("      (qui appelle triggerDispute() dans optimistic.ts)");
    console.log("");
    console.log("   Le nouveau contrat utilisera automatiquement la correction getAesKey().");
    console.log("");
    console.log("⚠️  Note: Les contrats Dispute existants ne peuvent pas être mis à jour.");
    console.log("   Il faut créer un nouveau contrat pour utiliser la correction.");
}

main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error(error);
        process.exit(1);
    });
