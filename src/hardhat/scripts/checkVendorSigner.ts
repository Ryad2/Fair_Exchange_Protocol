import hre from "hardhat";
import { ethers } from "hardhat";

/**
 * Script pour vérifier et corriger le vendorSigner d'un OptimisticSOXAccount
 * Usage: npx hardhat run scripts/checkVendorSigner.ts --network localhost
 */
async function main() {
    const [deployer, buyer, vendor, sponsor] = await ethers.getSigners();
    
    // ⚠️ MODIFIEZ CES VALEURS avec l'adresse de votre contrat
    const CONTRACT_ADDRESS = process.env.CONTRACT_ADDRESS || "0x0000000000000000000000000000000000000000";
    
    if (CONTRACT_ADDRESS === "0x0000000000000000000000000000000000000000") {
        console.error("❌ Veuillez définir CONTRACT_ADDRESS avec l'adresse de votre contrat");
        console.error("   Exemple: CONTRACT_ADDRESS=0x123... npx hardhat run scripts/checkVendorSigner.ts --network localhost");
        process.exit(1);
    }
    
    console.log("🔍 Vérification du vendorSigner...");
    console.log("   Contrat:", CONTRACT_ADDRESS);
    console.log("   Vendor address:", await vendor.getAddress());
    
    // Charger le contrat
    const accountAbi = [
        "function vendorSigner() view returns (address)",
        "function vendor() view returns (address)",
        "function setVendorSigner(address) external"
    ];
    
    const contract = new ethers.Contract(CONTRACT_ADDRESS, accountAbi, ethers.provider);
    
    // Vérifier le vendorSigner actuel
    const currentVendorSigner = await contract.vendorSigner();
    const contractVendor = await contract.vendor();
    const vendorAddress = await vendor.getAddress();
    
    console.log("\n📋 État actuel:");
    console.log("   Contrat vendor:", contractVendor);
    console.log("   Contrat vendorSigner:", currentVendorSigner);
    console.log("   Wallet vendor:", vendorAddress);
    
    // Vérifier si le vendor correspond
    if (contractVendor.toLowerCase() !== vendorAddress.toLowerCase()) {
        console.error("\n❌ ERREUR: Le wallet vendor ne correspond pas au vendor du contrat!");
        console.error("   Utilisez le bon wallet ou redéployez le contrat avec le bon vendor.");
        process.exit(1);
    }
    
    // Vérifier si le vendorSigner correspond
    if (currentVendorSigner.toLowerCase() !== vendorAddress.toLowerCase()) {
        console.warn("\n⚠️  Le vendorSigner ne correspond pas au wallet vendor!");
        console.warn("   Mise à jour en cours...");
        
        try {
            const tx = await contract.connect(vendor).setVendorSigner(vendorAddress);
            console.log("   Transaction envoyée:", tx.hash);
            await tx.wait();
            console.log("   ✅ Transaction confirmée!");
            
            // Vérifier que la mise à jour a réussi
            const updatedVendorSigner = await contract.vendorSigner();
            if (updatedVendorSigner.toLowerCase() === vendorAddress.toLowerCase()) {
                console.log("\n✅ vendorSigner mis à jour avec succès!");
                console.log("   Nouveau vendorSigner:", updatedVendorSigner);
            } else {
                console.error("\n❌ La mise à jour a échoué!");
                console.error("   Attendu:", vendorAddress);
                console.error("   Reçu:", updatedVendorSigner);
                process.exit(1);
            }
        } catch (error: any) {
            console.error("\n❌ Erreur lors de la mise à jour:", error.message);
            process.exit(1);
        }
    } else {
        console.log("\n✅ Le vendorSigner correspond déjà au wallet vendor!");
    }
    
    console.log("\n✅ Tout est correct! Tu peux maintenant envoyer la clé.");
}

main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error(error);
        process.exit(1);
    });













