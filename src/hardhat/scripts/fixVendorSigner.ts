import hre from "hardhat";
import { ethers } from "hardhat";

/**
 * Script pour diagnostiquer et corriger le problème de vendorSigner
 * Usage: npx hardhat run scripts/fixVendorSigner.ts --network localhost <contractAddress> <vendorPrivateKey>
 */
async function main() {
    const args = process.argv.slice(2);
    if (args.length < 2) {
        console.error("Usage: npx hardhat run scripts/fixVendorSigner.ts --network localhost <contractAddress> <vendorPrivateKey>");
        process.exit(1);
    }
    
    const contractAddress = args[0];
    const vendorPrivateKey = args[1];
    
    const { ethers } = hre;
    const [sponsor] = await ethers.getSigners();
    
    console.log("=".repeat(80));
    console.log("🔍 Diagnostic du vendorSigner");
    console.log("=".repeat(80));
    console.log("");
    console.log("Contract address:", contractAddress);
    console.log("Sponsor:", await sponsor.getAddress());
    console.log("");
    
    // Charger le contrat
    const accountAbi = [
        "function vendorSigner() view returns (address)",
        "function vendor() view returns (address)",
        "function sessionKeys(address) view returns (bool)",
        "function setVendorSigner(address) external",
        "function addSessionKey(address) external"
    ];
    
    const contract = new ethers.Contract(contractAddress, accountAbi, sponsor);
    
    // Obtenir les informations actuelles
    const vendorSigner = await contract.vendorSigner();
    const vendor = await contract.vendor();
    
    console.log("📋 État actuel du contrat:");
    console.log("   vendor:", vendor);
    console.log("   vendorSigner:", vendorSigner);
    console.log("");
    
    // Créer le wallet du vendor à partir de la clé privée
    const vendorWallet = new ethers.Wallet(vendorPrivateKey, ethers.provider);
    const vendorAddress = await vendorWallet.getAddress();
    
    console.log("📋 Informations du vendor:");
    console.log("   Vendor address (depuis private key):", vendorAddress);
    console.log("   Correspond au vendor du contrat?", vendorAddress.toLowerCase() === vendor.toLowerCase());
    console.log("   Correspond au vendorSigner?", vendorAddress.toLowerCase() === vendorSigner.toLowerCase());
    console.log("");
    
    // Vérifier si c'est une session key
    const isSessionKey = await contract.sessionKeys(vendorAddress);
    console.log("📋 Session key:");
    console.log("   Est une session key autorisée?", isSessionKey);
    console.log("");
    
    // Diagnostic
    if (vendorAddress.toLowerCase() === vendorSigner.toLowerCase()) {
        console.log("✅ Le vendorSigner correspond déjà au vendor!");
        console.log("   Le problème pourrait être ailleurs (signature, hash, etc.)");
    } else if (isSessionKey) {
        console.log("✅ Le vendor est une session key autorisée!");
        console.log("   Le problème pourrait être ailleurs (signature, hash, etc.)");
    } else {
        console.log("❌ PROBLÈME DÉTECTÉ:");
        console.log("   Le vendorSigner ne correspond pas au vendor et ce n'est pas une session key!");
        console.log("");
        console.log("💡 Solutions possibles:");
        console.log("   1. Mettre à jour le vendorSigner pour qu'il corresponde au vendor");
        console.log("   2. Ajouter le vendor comme session key");
        console.log("");
        
        // Proposer de corriger
        console.log("🔧 Correction automatique:");
        console.log("   Option 1: Mettre à jour vendorSigner...");
        
        try {
            // Pour mettre à jour vendorSigner, il faut que le vendor actuel appelle setVendorSigner
            // Mais on peut essayer avec le sponsor si le vendor n'est pas disponible
            console.log("   ⚠️  Pour mettre à jour vendorSigner, le vendor doit appeler setVendorSigner()");
            console.log("   Ou utilisez une session key à la place.");
            console.log("");
            
            console.log("   Option 2: Ajouter comme session key (recommandé)...");
            const addSessionKeyTx = await contract.connect(sponsor).addSessionKey(vendorAddress);
            console.log("   Transaction envoyée:", addSessionKeyTx.hash);
            const receipt = await addSessionKeyTx.wait();
            console.log("   ✅ Session key ajoutée avec succès!");
            console.log("   Block:", receipt?.blockNumber);
            console.log("");
            console.log("📋 Nouvel état:");
            const newIsSessionKey = await contract.sessionKeys(vendorAddress);
            console.log("   Est une session key autorisée?", newIsSessionKey);
        } catch (error: any) {
            console.error("   ❌ Erreur lors de l'ajout de la session key:", error.message);
            if (error.message?.includes("Only sponsor")) {
                console.error("   ⚠️  Seul le sponsor peut ajouter des session keys");
            }
        }
    }
    
    console.log("");
    console.log("=".repeat(80));
    console.log("✅ Diagnostic terminé");
    console.log("=".repeat(80));
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});













