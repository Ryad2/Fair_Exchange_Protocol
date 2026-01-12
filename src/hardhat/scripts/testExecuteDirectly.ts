import hre from "hardhat";
import { ethers } from "ethers";
import { Wallet, AbiCoder, keccak256, getBytes, zeroPadValue, toBeHex, parseEther } from "ethers";
import { getUserOperationHash } from "viem/account-abstraction";
import type { UserOperation } from "viem/account-abstraction";

/**
 * Test pour vérifier si execute() peut être appelé directement
 */
async function main() {
    const contractAddr = process.env.CONTRACT || "0x9d4454b023096f34b160d6b654540c56a1f81688";
    const vendorPrivateKey = process.env.VENDOR_KEY || "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d";
    const ENTRY_POINT = process.env.ENTRY_POINT || "0x4826533B4897376654Bb4d4AD88B7faFD0C98528";
    
    const provider = hre.ethers.provider;
    const vendorWallet = new Wallet(vendorPrivateKey, provider);
    const vendorAddress = await vendorWallet.getAddress();
    
    console.log("=".repeat(80));
    console.log("🧪 Test d'appel direct à execute()");
    console.log("=".repeat(80));
    console.log("");
    
    const accountAbi = [
        "function execute(address,uint256,bytes) external",
        "function sendKey(bytes) external",
        "function nonce() view returns (uint256)"
    ];
    
    const contract = new ethers.Contract(contractAddr, accountAbi, vendorWallet);
    
    const key = "0x" + "00".repeat(16);
    const iface = new ethers.Interface(accountAbi);
    const callData = iface.encodeFunctionData("sendKey", [key]);
    
    console.log("📋 Test d'appel direct à execute():");
    console.log("   target:", contractAddr);
    console.log("   value: 0");
    console.log("   callData:", callData);
    console.log("   Sélecteur:", callData.substring(0, 10));
    console.log("");
    
    // Vérifier le sélecteur attendu
    const sendKeySelector = iface.getFunction("sendKey").selector;
    console.log("📋 Sélecteur attendu pour sendKey(bytes):", sendKeySelector);
    console.log("   Sélecteur dans callData:", callData.substring(0, 10));
    console.log("   Correspond?", callData.substring(0, 10).toLowerCase() === sendKeySelector.toLowerCase());
    console.log("");
    
    // Essayer d'appeler execute() directement (devrait échouer car onlyEntryPointOrVendor)
    try {
        console.log("🧪 Tentative d'appel direct à execute() depuis vendorSigner...");
        const tx = await contract.execute(contractAddr, 0, callData);
        await tx.wait();
        console.log("   ✅ Succès! execute() a fonctionné");
    } catch (error: any) {
        console.log("   ❌ Erreur:", error.message);
        if (error.data) {
            console.log("   Data:", error.data);
        }
    }
    
    // Essayer d'appeler sendKey() directement
    try {
        console.log("");
        console.log("🧪 Tentative d'appel direct à sendKey()...");
        const tx = await contract.sendKey(key);
        await tx.wait();
        console.log("   ✅ Succès! sendKey() a fonctionné");
    } catch (error: any) {
        console.log("   ❌ Erreur:", error.message);
        if (error.data) {
            console.log("   Data:", error.data);
        }
    }
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});













