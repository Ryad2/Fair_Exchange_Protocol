import hre from "hardhat";
import { ethers } from "hardhat";

/**
 * Script pour corriger le vendorSigner ou ajouter une session key
 * Usage: CONTRACT=0x... VENDOR_KEY=0x... npx hardhat run scripts/fixAccountForVendor.ts --network localhost
 */
async function main() {
    const contractAddress = process.env.CONTRACT || "0x610178da211fef7d417bc0e6fed39f05609ad788";
    const vendorPrivateKey = process.env.VENDOR_KEY || "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d";
    
    const { ethers } = hre;
    const [sponsor] = await ethers.getSigners();
    
    console.log("=".repeat(80));
    console.log("🔧 Correction du contrat pour le vendor");
    console.log("=".repeat(80));
    console.log("");
    console.log("Contract address:", contractAddress);
    console.log("Sponsor:", await sponsor.getAddress());
    console.log("");
    
    // Créer le wallet du vendor
    const vendorWallet = new ethers.Wallet(vendorPrivateKey, ethers.provider);
    const vendorAddress = await vendorWallet.getAddress();
    console.log("Vendor address:", vendorAddress);
    console.log("");
    
    // Charger le contrat
    const accountAbi = [
        "function vendorSigner() view returns (address)",
        "function vendor() view returns (address)",
        "function sessionKeys(address) view returns (bool)",
        "function addSessionKey(address) external"
    ];
    
    const contract = new ethers.Contract(contractAddress, accountAbi, sponsor);
    
    // verify l'état actuel
    const vendorSigner = await contract.vendorSigner();
    const vendor = await contract.vendor();
    const isSessionKey = await contract.sessionKeys(vendorAddress);
    
    console.log("📋 État actuel:");
    console.log("   vendor:", vendor);
    console.log("   vendorSigner:", vendorSigner);
    console.log("   vendorAddress:", vendorAddress);
    console.log("   Est session key?", isSessionKey);
    console.log("");
    
    if (vendorAddress.toLowerCase() === vendorSigner.toLowerCase()) {
        console.log("✅ Le vendorSigner matches déjà au vendor!");
        return;
    }
    
    if (isSessionKey) {
        console.log("✅ Le vendor est déjà une session key autorisée!");
        return;
    }
    
    // Ajouter comme session key
    console.log("🔧 Ajout du vendor comme session key...");
    try {
        const tx = await contract.connect(sponsor).addSessionKey(vendorAddress);
        console.log("   Transaction sente:", tx.hash);
        await tx.wait();
        console.log("✅ Session key addede avec success!");
        
        // verify
        const newIsSessionKey = await contract.sessionKeys(vendorAddress);
        if (newIsSessionKey) {
            console.log("✅ VERIFICATION: Le vendor est maintenant une session key autorisée!");
        }
    } catch (error: any) {
        console.error("❌ error:", error.message);
        throw error;
    }
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});













