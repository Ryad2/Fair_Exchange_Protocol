import hre from "hardhat";
import { ethers } from "hardhat";
import { Wallet } from "ethers";

/**
 * Script pour tester la simulation d'une UserOperation localement
 */
async function main() {
    const contractAddr = process.env.CONTRACT || "0x610178da211fef7d417bc0e6fed39f05609ad788";
    const vendorPrivateKey = process.env.VENDOR_KEY || "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d";
    const entryPointSim = process.env.ENTRY_POINT_SIM || "0x2279B7A0a67DB372996a5FaB50D91eAA73d2eBe6";
    
    const provider = hre.ethers.provider;
    const vendorWallet = new Wallet(vendorPrivateKey, provider);
    const vendorAddress = await vendorWallet.getAddress();
    
    console.log("=".repeat(80));
    console.log("🧪 Test de simulation UserOperation");
    console.log("=".repeat(80));
    console.log("");
    console.log("Contract address:", contractAddr);
    console.log("Vendor address:", vendorAddress);
    console.log("EntryPointSim:", entryPointSim);
    console.log("");
    
    const accountAbi = [
        "function vendorSigner() view returns (address)",
        "function nonce() view returns (uint256)",
        "function sessionKeys(address) view returns (bool)",
        "function entryPointSim() view returns (address)",
        "function sendKey(bytes) external",
        "function execute(address,uint256,bytes) external"
    ];
    
    const contract = new ethers.Contract(contractAddr, accountAbi, provider);
    
    // Vérifier l'état
    const vendorSigner = await contract.vendorSigner();
    const nonce = await contract.nonce();
    const isSessionKey = await contract.sessionKeys(vendorAddress);
    const contractEntryPointSim = await contract.entryPointSim();
    
    console.log("📋 État du contrat:");
    console.log("   vendorSigner:", vendorSigner);
    console.log("   nonce:", nonce.toString());
    console.log("   Est session key?", isSessionKey);
    console.log("   entryPointSim:", contractEntryPointSim);
    console.log("");
    
    // Créer une UserOperation de test
    const key = "0x" + "00".repeat(16); // Clé de test (16 bytes)
    const iface = new ethers.Interface(accountAbi);
    const callData = iface.encodeFunctionData("sendKey", [key]);
    
    console.log("📋 UserOperation de test:");
    console.log("   callData:", callData.substring(0, 50) + "...");
    console.log("");
    
    // Simuler l'appel depuis EntryPointSim
    console.log("🧪 Simulation depuis EntryPointSim...");
    try {
        // Créer un contrat EntryPointSim mock pour tester
        const entryPointSimContract = new ethers.Contract(
            entryPointSim,
            ["function simulateHandleOpSingle((address,uint256,bytes,bytes,bytes32,uint256,bytes32,bytes,bytes),address,bytes) returns ((uint256,uint256,uint256,uint256,uint256,uint256,bool,bytes))"],
            provider
        );
        
        // PackedUserOperation simplifiée pour le test
        const userOp = {
            sender: contractAddr,
            nonce: nonce.toString(),
            initCode: "0x",
            callData: callData,
            accountGasLimits: ethers.solidityPacked(["uint128", "uint128"], [1000000, 1000000]),
            preVerificationGas: 100000,
            gasFees: ethers.solidityPacked(["uint128", "uint128"], [1000000000, 1000000000]),
            paymasterAndData: "0x",
            signature: "0x" + "00".repeat(65) // Signature placeholder
        };
        
        console.log("   Tentative de simulation...");
        // Note: Cette simulation nécessite que EntryPointSimulations soit déployé et fonctionnel
        // Pour l'instant, on teste juste la préparation
        
        console.log("✅ UserOperation préparée avec succès");
        console.log("   Le problème pourrait venir de la signature ou du hash");
        
    } catch (error: any) {
        console.error("❌ Erreur lors de la simulation:", error.message);
    }
    
    console.log("");
    console.log("💡 Pour déboguer:");
    console.log("   1. Vérifiez que la signature correspond au wallet qui signe");
    console.log("   2. Vérifiez que le userOpHash est calculé correctement");
    console.log("   3. Vérifiez que EntryPointSim peut appeler validateUserOp");
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});













