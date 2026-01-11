import hre from "hardhat";
import { ethers } from "hardhat";
import { Wallet } from "ethers";

async function main() {
    const contractAddr = process.argv[2];
    const vendorPrivateKey = process.argv[3];
    
    if (!contractAddr || !vendorPrivateKey) {
        console.error("Usage: npx hardhat run scripts/diagnoseVendorSigner.ts --network localhost <contractAddress> <vendorPrivateKey>");
        process.exit(1);
    }
    
    const provider = hre.ethers.provider;
    const wallet = new Wallet(vendorPrivateKey, provider);
    const walletAddress = await wallet.getAddress();
    
    console.log("=".repeat(80));
    console.log("🔍 Diagnostic du vendorSigner");
    console.log("=".repeat(80));
    console.log("");
    console.log("Contract address:", contractAddr);
    console.log("Wallet address (depuis clé privée):", walletAddress);
    console.log("");
    
    // Charger le contrat
    const accountAbi = [
        "function vendor() view returns (address)",
        "function vendorSigner() view returns (address)",
        "function sessionKeys(address) view returns (bool)",
        "function nonce() view returns (uint256)"
    ];
    
    const contract = new ethers.Contract(contractAddr, accountAbi, provider);
    
    try {
        const vendor = await contract.vendor();
        const vendorSigner = await contract.vendorSigner();
        const isSessionKey = await contract.sessionKeys(walletAddress);
        const nonce = await contract.nonce();
        
        console.log("📋 État du contrat:");
        console.log("   vendor:", vendor);
        console.log("   vendorSigner:", vendorSigner);
        console.log("   nonce:", nonce.toString());
        console.log("");
        
        console.log("🔍 Vérifications:");
        console.log("   Wallet correspond au vendor?", walletAddress.toLowerCase() === vendor.toLowerCase());
        console.log("   Wallet correspond au vendorSigner?", walletAddress.toLowerCase() === vendorSigner.toLowerCase());
        console.log("   Wallet est une session key?", isSessionKey);
        console.log("");
        
        if (walletAddress.toLowerCase() === vendorSigner.toLowerCase()) {
            console.log("✅ Le wallet correspond au vendorSigner - tout devrait fonctionner!");
        } else if (isSessionKey) {
            console.log("✅ Le wallet est une session key autorisée - tout devrait fonctionner!");
        } else {
            console.log("❌ PROBLÈME DÉTECTÉ:");
            console.log("   Le wallet ne correspond ni au vendorSigner ni à une session key autorisée!");
            console.log("");
            console.log("💡 Solutions:");
            console.log("   1. Mettre à jour le vendorSigner:");
            console.log(`      Le vendor doit appeler: setVendorSigner(${walletAddress})`);
            console.log("");
            console.log("   2. Ou utiliser le script fixVendorSigner.ts:");
            console.log(`      npx hardhat run scripts/fixVendorSigner.ts --network localhost ${contractAddr} ${vendorPrivateKey}`);
        }
    } catch (error: any) {
        console.error("❌ Erreur lors de la lecture du contrat:", error.message);
        console.error("   Vérifiez que le contrat existe et que l'adresse est correcte");
    }
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});












