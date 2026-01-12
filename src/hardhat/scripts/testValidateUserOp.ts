import hre from "hardhat";
import { ethers } from "hardhat";
import { Wallet } from "ethers";

/**
 * Script pour tester validateUserOp directement depuis EntryPointSimulations
 */
async function main() {
    const contractAddr = process.env.CONTRACT || "0x9a9f2ccfde556a7e9ff0848998aa4a0cfd8863ae";
    const vendorPrivateKey = process.env.VENDOR_KEY || "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d";
    const entryPointSim = process.env.ENTRY_POINT_SIM || "0x2279B7A0a67DB372996a5FaB50D91eAA73d2eBe6";
    
    const provider = hre.ethers.provider;
    const vendorWallet = new Wallet(vendorPrivateKey, provider);
    const vendorAddress = await vendorWallet.getAddress();
    
    console.log("=".repeat(80));
    console.log("🧪 Test de validateUserOp depuis EntryPointSimulations");
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
    
    // Vérifier que EntryPointSimulations peut appeler validateUserOp
    console.log("🔍 Vérification de EntryPointSimulations...");
    const entryPointSimCode = await provider.getCode(entryPointSim);
    if (!entryPointSimCode || entryPointSimCode === "0x") {
        console.error("❌ EntryPointSimulations n'existe pas à", entryPointSim);
        process.exit(1);
    }
    console.log("✅ EntryPointSimulations trouvé (code:", entryPointSimCode.length, "bytes)");
    console.log("");
    
    // Créer une UserOperation de test
    const key = "0x" + "00".repeat(16); // Clé de test (16 bytes)
    const iface = new ethers.Interface(accountAbi);
    const callData = iface.encodeFunctionData("sendKey", [key]);
    
    // PackedUserOperation
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
    
    // Calculer le hash de la UserOperation (simplifié pour le test)
    const ENTRY_POINT = "0x5FbDB2315678afecb367f032d93F642f64180aa3";
    const chainId = (await provider.getNetwork()).chainId;
    
    console.log("📋 UserOperation de test:");
    console.log("   sender:", userOp.sender);
    console.log("   nonce:", userOp.nonce.toString());
    console.log("   callData:", callData.substring(0, 50) + "...");
    console.log("");
    
    console.log("💡 Pour tester complètement:");
    console.log("   1. Le bundler utilise EntryPointSimulations pour simuler");
    console.log("   2. EntryPointSimulations appelle validateUserOp sur le contrat");
    console.log("   3. Le contrat vérifie msg.sender == entryPointSim");
    console.log("   4. Si msg.sender est EntryPointSimulations et entryPointSim est EntryPointSimulations, cela devrait fonctionner");
    console.log("");
    console.log("⚠️  Si l'erreur persiste, vérifiez:");
    console.log("   - Que EntryPointSimulations appelle bien validateUserOp");
    console.log("   - Que msg.sender dans validateUserOp est bien EntryPointSimulations");
    console.log("   - Que le hash de la UserOperation est correct");
    console.log("   - Que la signature est valide");
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});













