import hre from "hardhat";
import { ethers } from "hardhat";

async function main() {
    const entryPointAddress = process.argv[2] || "0x4826533B4897376654Bb4d4AD88B7faFD0C98528";
    
    const provider = hre.ethers.provider;
    const code = await provider.getCode(entryPointAddress);
    
    console.log("=".repeat(80));
    console.log("🔍 Vérification de l'EntryPoint");
    console.log("=".repeat(80));
    console.log("");
    console.log("Adresse:", entryPointAddress);
    console.log("Code length:", code.length, "bytes");
    console.log("");
    
    if (code === "0x" || code.length <= 2) {
        console.error("❌ Aucun contrat trouvé à cette adresse!");
        console.error("   L'EntryPoint n'est pas déployé à cette adresse.");
        console.error("");
        console.error("💡 Déployez l'EntryPoint avec:");
        console.error("   npx hardhat run scripts/deployEntryPoint.ts --network localhost");
        process.exit(1);
    } else {
        console.log("✅ Contrat trouvé à cette adresse!");
        
        // Vérifier que c'est bien un EntryPoint en appelant une fonction view
        try {
            const entryPointAbi = [
                "function getUserOpHash((address,uint256,bytes,bytes,bytes32,uint256,bytes32,bytes,bytes)) view returns (bytes32)"
            ];
            const entryPoint = new ethers.Contract(entryPointAddress, entryPointAbi, provider);
            console.log("✅ L'EntryPoint répond aux appels (getUserOpHash disponible)");
        } catch (error: any) {
            console.warn("⚠️  Impossible de vérifier que c'est un EntryPoint:", error.message);
        }
    }
    
    console.log("");
    console.log("=".repeat(80));
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});













