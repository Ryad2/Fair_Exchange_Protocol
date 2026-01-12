import hre from "hardhat";
import { ethers, Contract } from "ethers";

async function main() {
    const provider = hre.ethers.provider;
    const address = process.env.CONTRACT_ADDRESS || "0x9A676e781A523b5d0C0e43731313A708CB607508";
    
    console.log("=".repeat(80));
    console.log("🔍 VÉRIFICATION DU CONTRAT OptimisticSOXAccount");
    console.log("=".repeat(80));
    console.log("");
    console.log("Adresse:", address);
    console.log("");
    
    const code = await provider.getCode(address);
    if (!code || code === "0x") {
        console.log("❌ Contrat NON DÉPLOYÉ à cette adresse");
        process.exit(1);
    }
    
    console.log("✅ Contrat DÉPLOYÉ!");
    console.log("   Taille du code:", code.length, "bytes");
    console.log("");
    
    // Essayer de lire les propriétés du contrat
    try {
        const accountAbi = [
            "function nonce() view returns (uint256)",
            "function vendorSigner() view returns (address)",
            "function vendor() view returns (address)",
            "function buyer() view returns (address)",
            "function sponsor() view returns (address)",
            "function entryPoint() view returns (address)",
            "function sessionKeys(address) view returns (bool)",
        ];
        const contract = new Contract(address, accountAbi, provider);
        
        const nonce = await contract.nonce();
        const vendorSigner = await contract.vendorSigner();
        const vendor = await contract.vendor();
        const buyer = await contract.buyer();
        const sponsor = await contract.sponsor();
        const entryPoint = await contract.entryPoint();
        
        console.log("📋 Propriétés du contrat:");
        console.log("   Nonce:", nonce.toString());
        console.log("   VendorSigner:", vendorSigner);
        console.log("   Vendor:", vendor);
        console.log("   Buyer:", buyer);
        console.log("   Sponsor:", sponsor);
        console.log("   EntryPoint:", entryPoint);
        console.log("");
        console.log("✅ C'est bien un OptimisticSOXAccount!");
        console.log("");
        
        // Vérifier si le bundler peut voir ce contrat
        console.log("📋 Vérification avec le bundler...");
        try {
            const axios = require("axios");
            const bundlerResponse = await axios.post("http://localhost:3002/rpc", {
                jsonrpc: "2.0",
                id: 1,
                method: "debug_bundler_clearState",
                params: []
            });
            console.log("   ✅ Cache du bundler vidé");
            
            // Le bundler ne supporte probablement pas eth_getCode directement
            // mais on peut au moins vérifier qu'il répond
            console.log("   💡 Le bundler devrait maintenant voir le contrat après le vidage du cache");
        } catch (error: any) {
            console.warn("   ⚠️  Impossible de communiquer avec le bundler:", error.message);
        }
        
    } catch (error: any) {
        console.log("⚠️  Erreur lors de la lecture des propriétés:", error.message);
        console.log("   Le contrat existe mais n'est peut-être pas un OptimisticSOXAccount");
        console.log("   ou certaines fonctions ne sont pas disponibles");
    }
    
    console.log("");
    console.log("=".repeat(80));
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});













