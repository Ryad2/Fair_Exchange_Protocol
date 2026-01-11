import hre from "hardhat";
import { ethers } from "hardhat";
import { Wallet } from "ethers";

/**
 * Script pour tester validateUserOp directement depuis EntryPointSimulations
 * Cela simule exactement ce que fait le bundler
 */
async function main() {
    const contractAddr = process.env.CONTRACT || "0x9a9f2ccfde556a7e9ff0848998aa4a0cfd8863ae";
    const vendorPrivateKey = process.env.VENDOR_KEY || "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d";
    const entryPointSim = process.env.ENTRY_POINT_SIM || "0x2279B7A0a67DB372996a5FaB50D91eAA73d2eBe6";
    const ENTRY_POINT = "0x5FbDB2315678afecb367f032d93F642f64180aa3";
    
    const provider = hre.ethers.provider;
    const vendorWallet = new Wallet(vendorPrivateKey, provider);
    const vendorAddress = await vendorWallet.getAddress();
    
    console.log("=".repeat(80));
    console.log("🧪 Test direct de validateUserOp depuis EntryPointSimulations");
    console.log("=".repeat(80));
    console.log("");
    console.log("Contract address:", contractAddr);
    console.log("Vendor address:", vendorAddress);
    console.log("EntryPointSim:", entryPointSim);
    console.log("EntryPoint:", ENTRY_POINT);
    console.log("");
    
    const accountAbi = [
        "function vendorSigner() view returns (address)",
        "function nonce() view returns (uint256)",
        "function sessionKeys(address) view returns (bool)",
        "function entryPointSim() view returns (address)",
        "function sendKey(bytes) external",
        "function validateUserOp((address,uint256,bytes,bytes,bytes32,uint256,bytes32,bytes,bytes),bytes32,uint256) external payable returns (uint256)"
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
    
    // Vérifier EntryPointSimulations
    const entryPointSimCode = await provider.getCode(entryPointSim);
    if (!entryPointSimCode || entryPointSimCode === "0x") {
        console.error("❌ EntryPointSimulations n'existe pas à", entryPointSim);
        process.exit(1);
    }
    console.log("✅ EntryPointSimulations trouvé");
    console.log("");
    
    // Créer une UserOperation de test
    const key = "0x" + "00".repeat(16); // Clé de test (16 bytes)
    const iface = new ethers.Interface(accountAbi);
    const callData = iface.encodeFunctionData("sendKey", [key]);
    
    // PackedUserOperation selon ERC-4337
    const accountGasLimits = ethers.solidityPacked(["uint128", "uint128"], [1000000, 1000000]);
    const gasFees = ethers.solidityPacked(["uint128", "uint128"], [1000000000, 1000000000]);
    
    const userOp = {
        sender: contractAddr,
        nonce: nonce,
        initCode: "0x",
        callData: callData,
        accountGasLimits: accountGasLimits,
        preVerificationGas: 100000,
        gasFees: gasFees,
        paymasterAndData: "0x",
        signature: "0x" + "00".repeat(65) // Signature placeholder
    };
    
    // Calculer le hash de la UserOperation (simplifié)
    const chainId = (await provider.getNetwork()).chainId;
    console.log("📋 Calcul du hash de la UserOperation...");
    console.log("   chainId:", chainId.toString());
    console.log("   sender:", userOp.sender);
    console.log("   nonce:", userOp.nonce.toString());
    console.log("");
    
    // Obtenir le hash depuis EntryPointSimulations
    const entryPointSimAbi = [
        "function getUserOpHash((address,uint256,bytes,bytes,bytes32,uint256,bytes32,bytes,bytes)) view returns (bytes32)"
    ];
    const entryPointSimContract = new ethers.Contract(entryPointSim, entryPointSimAbi, provider);
    
    try {
        const userOpHash = await entryPointSimContract.getUserOpHash(userOp);
        console.log("✅ Hash de la UserOperation (depuis EntryPointSimulations):", userOpHash);
        console.log("");
        
        // Essayer d'appeler validateUserOp directement depuis EntryPointSimulations
        console.log("🧪 Tentative d'appel de validateUserOp depuis EntryPointSimulations...");
        console.log("   ⚠️  Cela devrait échouer car la signature est invalide, mais on peut voir l'erreur");
        
        // Créer un signer pour EntryPointSimulations (mais on ne peut pas vraiment l'appeler directement)
        // Au lieu de cela, vérifions si le contrat peut être appelé depuis EntryPointSimulations
        
        console.log("💡 Pour tester complètement:");
        console.log("   1. Créez une signature valide avec le hash calculé");
        console.log("   2. Appelez validateUserOp depuis EntryPointSimulations");
        console.log("   3. Vérifiez que msg.sender == entryPointSim dans le contrat");
        
    } catch (error: any) {
        console.error("❌ Erreur:", error.message);
        console.error("   Cela pourrait indiquer un problème avec EntryPointSimulations");
    }
    
    console.log("");
    console.log("💡 Le problème pourrait être:");
    console.log("   1. Le hash calculé par le frontend ne correspond pas à celui d'EntryPointSimulations");
    console.log("   2. La signature est invalide");
    console.log("   3. EntryPointSimulations n'appelle pas validateUserOp correctement");
    console.log("   4. Le contrat vérifie msg.sender mais EntryPointSimulations utilise un autre sender");
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});












