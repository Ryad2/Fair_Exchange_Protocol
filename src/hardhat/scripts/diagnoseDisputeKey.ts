import hre from "hardhat";
import { ethers } from "hardhat";

/**
 * Script pour diagnostiquer la clé AES dans un contrat Dispute
 */
async function main() {
    const DISPUTE_ADDRESS = process.env.DISPUTE_ADDRESS || (process.argv.length > 2 ? process.argv[process.argv.length - 1] : "");
    
    if (!DISPUTE_ADDRESS) {
        console.error("❌ Veuillez fournir l'adresse du contrat Dispute");
        console.error("   Usage: npx hardhat run scripts/diagnoseDisputeKey.ts --network localhost -- 0xDE504C6d3d9877e9a41392bD6318c7d612C69387");
        console.error("   OU: DISPUTE_ADDRESS=0xDE504C6d3d9877e9a41392bD6318c7d612C69387 npx hardhat run scripts/diagnoseDisputeKey.ts --network localhost");
        process.exit(1);
    }
    
    console.log("🔍 Diagnostic de la clé AES dans le contrat Dispute");
    console.log("=".repeat(80));
    console.log("");
    console.log("Adresse du contrat Dispute:", DISPUTE_ADDRESS);
    console.log("");
    
    const provider = hre.ethers.provider;
    
    // Charger le contrat Dispute (utiliser getContractAt pour éviter les problèmes de linking)
    const disputeContract = await ethers.getContractAt("DisputeSOXAccount", DISPUTE_ADDRESS);
    
    try {
        // Récupérer l'adresse du contrat OptimisticSOXAccount
        const optimisticContractAddr = await disputeContract.optimisticContract();
        console.log("📋 OptimisticSOXAccount:", optimisticContractAddr);
        console.log("");
        
        // Charger le contrat OptimisticSOXAccount
        const optimisticContract = await ethers.getContractAt("OptimisticSOXAccount", optimisticContractAddr);
        
        // Récupérer la clé
        const key = await optimisticContract.key();
        console.log("🔑 Clé récupérée depuis OptimisticSOXAccount:");
        console.log("   Longueur:", key.length, "bytes");
        console.log("   Valeur hex:", ethers.hexlify(key));
        console.log("   Valeur hex (sans 0x):", ethers.hexlify(key).slice(2));
        console.log("");
        
        // Afficher les premiers bytes pour debug
        console.log("🔍 Détails de la clé (premiers bytes):");
        for (let i = 0; i < Math.min(key.length, 10); i++) {
            const char = String.fromCharCode(key[i]);
            const isPrintable = key[i] >= 0x20 && key[i] <= 0x7E;
            console.log(`   Byte ${i}: 0x${key[i].toString(16).padStart(2, "0")} (${isPrintable ? `'${char}'` : 'non-printable'})`);
        }
        console.log("");
        
        // Vérifier le format
        if (key.length === 34) {
            console.log("⚠️  ATTENTION: La clé fait 34 bytes");
            if (key[0] === 0x30 && key[1] === 0x78) {
                console.log("✅ La clé est au format hex string '0x...' (34 bytes)");
                console.log("   La correction getAesKey() devrait convertir cela en 16 bytes");
            } else {
                console.log("⚠️  La clé fait 34 bytes mais ne commence PAS par '0x' (0x30, 0x78)");
                console.log("   Byte 0:", `0x${key[0].toString(16).padStart(2, "0")}`, `(${String.fromCharCode(key[0])})`);
                console.log("   Byte 1:", `0x${key[1].toString(16).padStart(2, "0")}`, `(${String.fromCharCode(key[1])})`);
                console.log("");
                console.log("   La correction getAesKey() ne détectera PAS ce format !");
                console.log("   Elle cherche: length == 34 && bytes[0] == 0x30 && bytes[1] == 0x78");
                console.log("");
                console.log("💡 SOLUTION:");
                console.log("   Si la clé fait 34 bytes mais n'est pas au format '0x...',");
                console.log("   la correction getAesKey() utilisera le fallback (prendre les 16 premiers bytes)");
            }
            console.log("");
        } else if (key.length === 16) {
        } else if (key.length === 16) {
            console.log("✅ La clé fait 16 bytes (format correct)");
            console.log("   La correction getAesKey() devrait fonctionner sans conversion");
        } else {
            console.log("⚠️  ATTENTION: La clé fait", key.length, "bytes (attendu: 16 ou 34)");
            if (key.length > 16) {
                console.log("   La correction getAesKey() devrait prendre les 16 premiers bytes");
            } else {
                console.log("   La clé est trop courte (attendu: 16 bytes)");
            }
        }
        console.log("");
        
        // Vérifier si le contrat Dispute a été créé après le redéploiement de DisputeDeployer
        const blockNumber = await provider.getBlockNumber();
        console.log("📊 Block actuel:", blockNumber);
        console.log("");
        
        // Vérifier l'état du contrat
        const state = await disputeContract.currState();
        const stateNames = ["ChallengeBuyer", "WaitVendorOpinion", "WaitVendorData", "WaitVendorDataLeft", "WaitVendorDataRight", "Complete", "Cancel", "End"];
        console.log("📋 État du contrat Dispute:", stateNames[Number(state)] || `Unknown (${state})`);
        console.log("");
        
        console.log("=".repeat(80));
        console.log("✅ Diagnostic terminé");
        console.log("=".repeat(80));
        
    } catch (error: any) {
        console.error("❌ Erreur lors du diagnostic:", error.message);
        if (error.data) {
            console.error("   Error data:", error.data);
        }
        process.exit(1);
    }
}

main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error(error);
        process.exit(1);
    });

