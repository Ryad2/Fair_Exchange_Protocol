import hre from "hardhat";
import { ethers } from "hardhat";
import { getUserOperationHash } from "viem/account-abstraction";
import type { UserOperation } from "viem/account-abstraction";

/**
 * Script pour tester le calcul du hash avec viem et comparer avec l'EntryPoint réel
 */
async function main() {
    const contractAddr = process.env.CONTRACT || "0x9d4454b023096f34b160d6b654540c56a1f81688";
    const ENTRY_POINT = process.env.ENTRY_POINT || "0x4826533B4897376654Bb4d4AD88B7faFD0C98528";
    
    const provider = hre.ethers.provider;
    const chainId = Number((await provider.getNetwork()).chainId);
    
    console.log("=".repeat(80));
    console.log("🔍 Test du calcul du hash avec viem vs EntryPoint réel");
    console.log("=".repeat(80));
    console.log("");
    console.log("Contract address:", contractAddr);
    console.log("EntryPoint:", ENTRY_POINT);
    console.log("ChainId:", chainId);
    console.log("");
    
    const accountAbi = [
        "function nonce() view returns (uint256)",
        "function sendKey(bytes) external"
    ];
    
    const contract = new ethers.Contract(contractAddr, accountAbi, provider);
    const nonce = await contract.nonce();
    
    const iface = new ethers.Interface(accountAbi);
    const key = "0x" + "00".repeat(16);
    const callData = iface.encodeFunctionData("sendKey", [key]);
    
    const userOp = {
        sender: contractAddr,
        nonce: nonce.toString(),
        initCode: "0x",
        callData: callData,
        verificationGasLimit: "800000",
        callGasLimit: "800000",
        preVerificationGas: "2000000",
        maxPriorityFeePerGas: ethers.parseEther("0.000000001").toString(),
        maxFeePerGas: ethers.parseEther("0.00000002").toString(),
        paymasterAndData: "0x"
    };
    
    console.log("📋 UserOperation:");
    console.log("   sender:", userOp.sender);
    console.log("   nonce:", userOp.nonce);
    console.log("   callData:", callData.substring(0, 50) + "...");
    console.log("");
    
    // Calculer le hash avec viem
    const viemUserOp: UserOperation = {
        sender: userOp.sender as `0x${string}`,
        nonce: BigInt(userOp.nonce),
        callData: userOp.callData as `0x${string}`,
        initCode: userOp.initCode as `0x${string}`,
        callGasLimit: BigInt(userOp.callGasLimit),
        verificationGasLimit: BigInt(userOp.verificationGasLimit),
        preVerificationGas: BigInt(userOp.preVerificationGas),
        maxFeePerGas: BigInt(userOp.maxFeePerGas),
        maxPriorityFeePerGas: BigInt(userOp.maxPriorityFeePerGas),
        paymaster: undefined,
        paymasterData: undefined,
        paymasterVerificationGasLimit: undefined,
        paymasterPostOpGasLimit: undefined,
        factory: undefined,
        factoryData: undefined
    };
    
    const viemHash = getUserOperationHash({
        chainId,
        entryPointAddress: ENTRY_POINT as `0x${string}`,
        entryPointVersion: "0.7",
        userOperation: viemUserOp
    });
    
    console.log("📋 Hash calculé avec viem:");
    console.log("   hash:", viemHash);
    console.log("");
    
    // Obtenir le hash depuis l'EntryPoint réel
    const entryPointAbi = [
        "function getUserOpHash((address,uint256,bytes,bytes,bytes32,uint256,bytes32,bytes,bytes)) view returns (bytes32)"
    ];
    const entryPointContract = new ethers.Contract(ENTRY_POINT, entryPointAbi, provider);
    
    // Packer les gas limits et fees
    function packUint(high128: bigint, low128: bigint): string {
        const packed = (high128 << 128n) | low128;
        return ethers.zeroPadValue(ethers.toBeHex(packed), 32);
    }
    
    const accountGasLimits = packUint(BigInt(userOp.verificationGasLimit), BigInt(userOp.callGasLimit));
    const gasFees = packUint(BigInt(userOp.maxPriorityFeePerGas), BigInt(userOp.maxFeePerGas));
    
    const packedUserOpTuple = [
        userOp.sender,
        userOp.nonce,
        userOp.initCode,
        userOp.callData,
        accountGasLimits,
        userOp.preVerificationGas,
        gasFees,
        userOp.paymasterAndData,
        "0x" // signature placeholder
    ];
    
    try {
        const entryPointHash = await entryPointContract.getUserOpHash(packedUserOpTuple);
        console.log("📋 Hash calculé par EntryPoint réel:");
        console.log("   hash:", entryPointHash);
        console.log("");
        
        console.log("🔍 Comparaison:");
        console.log("   Hash viem:", viemHash);
        console.log("   Hash EntryPoint:", entryPointHash);
        console.log("   Correspond?", viemHash.toLowerCase() === entryPointHash.toLowerCase());
        console.log("");
        
        if (viemHash.toLowerCase() !== entryPointHash.toLowerCase()) {
            console.error("❌ Les hashs ne correspondent pas!");
            console.error("   Cela indique un problème dans le calcul du hash avec viem.");
            process.exit(1);
        } else {
            console.log("✅ Les hashs correspondent parfaitement!");
        }
    } catch (error: any) {
        console.error("❌ Erreur lors de l'appel à EntryPoint.getUserOpHash():");
        console.error("   Message:", error.message);
        console.error("   Data:", error.data);
        process.exit(1);
    }
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});












