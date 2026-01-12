import hre from "hardhat";
import { ethers } from "ethers";
import { Wallet, AbiCoder, keccak256, getBytes, zeroPadValue, toBeHex, parseEther } from "ethers";
import { getUserOperationHash } from "viem/account-abstraction";
import type { UserOperation } from "viem/account-abstraction";

/**
 * Script pour comparer notre hash avec celui calculé par le bundler
 */
const BUNDLER_URL = process.env.BUNDLER_URL || "http://localhost:3002/rpc";

function packUint(high128: bigint, low128: bigint): string {
    const packed = (high128 << 128n) | low128;
    return zeroPadValue(toBeHex(packed), 32);
}

async function main() {
    const contractAddr = process.env.CONTRACT || "0x9d4454b023096f34b160d6b654540c56a1f81688";
    const vendorPrivateKey = process.env.VENDOR_KEY || "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d";
    const ENTRY_POINT = process.env.ENTRY_POINT || "0x4826533B4897376654Bb4d4AD88B7faFD0C98528";
    
    const provider = hre.ethers.provider;
    const chainId = Number((await provider.getNetwork()).chainId);
    const vendorWallet = new Wallet(vendorPrivateKey, provider);
    const vendorAddress = await vendorWallet.getAddress();
    
    console.log("=".repeat(80));
    console.log("🔍 Comparaison du hash avec le bundler");
    console.log("=".repeat(80));
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
        sender: contractAddr.toLowerCase(),
        nonce: toBeHex(nonce),
        initCode: "0x",
        callData: callData,
        callGasLimit: toBeHex(800000n),
        verificationGasLimit: toBeHex(800000n),
        preVerificationGas: toBeHex(2_000_000n),
        maxFeePerGas: toBeHex(parseEther("0.00000002")),
        maxPriorityFeePerGas: toBeHex(parseEther("0.000000001")),
        paymasterAndData: "0x",
        signature: "0x" + "00".repeat(65) // Placeholder
    };
    
    console.log("📋 UserOperation (sans signature):");
    console.log("   sender:", userOp.sender);
    console.log("   nonce:", userOp.nonce);
    console.log("   callData:", callData.substring(0, 50) + "...");
    console.log("");
    
    // Calculer le hash avec viem
    const viemUserOp: UserOperation = {
        sender: contractAddr as `0x${string}`,
        nonce: BigInt(nonce),
        callData: callData as `0x${string}`,
        factory: undefined,
        factoryData: undefined,
        callGasLimit: 800000n,
        verificationGasLimit: 800000n,
        preVerificationGas: 2_000_000n,
        maxFeePerGas: parseEther("0.00000002"),
        maxPriorityFeePerGas: parseEther("0.000000001"),
        paymaster: undefined,
        paymasterData: undefined,
        paymasterVerificationGasLimit: undefined,
        paymasterPostOpGasLimit: undefined
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
    
    const accountGasLimits = packUint(800000n, 800000n);
    const gasFees = packUint(parseEther("0.000000001"), parseEther("0.00000002"));
    
    const packedUserOpTuple = [
        userOp.sender,
        userOp.nonce,
        userOp.initCode,
        userOp.callData,
        accountGasLimits,
        userOp.preVerificationGas,
        gasFees,
        userOp.paymasterAndData,
        userOp.signature
    ];
    
    const entryPointHash = await entryPointContract.getUserOpHash(packedUserOpTuple);
    console.log("📋 Hash calculé par EntryPoint réel:");
    console.log("   hash:", entryPointHash);
    console.log("");
    
    console.log("🔍 Comparaison:");
    console.log("   Hash viem:", viemHash);
    console.log("   Hash EntryPoint:", entryPointHash);
    console.log("   Correspond?", viemHash.toLowerCase() === entryPointHash.toLowerCase());
    console.log("");
    
    // Essayer d'obtenir le hash depuis le bundler via getUserOperationByHash
    // Mais d'abord, essayons d'estimer pour voir l'erreur exacte
    console.log("🧪 Test avec le bundler (estimation)...");
    try {
        const estimateResponse = await fetch(BUNDLER_URL, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                jsonrpc: "2.0",
                id: 1,
                method: "eth_estimateUserOperationGas",
                params: [userOp, ENTRY_POINT],
            }),
        });
        
        const estimateData = await estimateResponse.json();
        console.log("   Réponse:", JSON.stringify(estimateData, null, 2));
    } catch (error: any) {
        console.log("   Erreur:", error.message);
    }
    console.log("");
    
    // Signer avec le hash viem et tester
    console.log("🧪 Test avec signature basée sur hash viem...");
    const hashBytes = getBytes(viemHash);
    let signature = await vendorWallet.signMessage(hashBytes);
    
    const vHex = signature.slice(130, 132);
    const v = parseInt(vHex, 16);
    if (v !== 27 && v !== 28) {
        signature = signature.slice(0, 130) + (v === 0 || v === 1 ? (v + 27).toString(16) : v.toString(16));
    }
    
    const userOpWithSig = {
        ...userOp,
        signature: signature
    };
    
    try {
        const response = await fetch(BUNDLER_URL, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                jsonrpc: "2.0",
                id: 2,
                method: "eth_sendUserOperation",
                params: [userOpWithSig, ENTRY_POINT],
            }),
        });
        
        const data = await response.json();
        if (data.error) {
            console.log("   ❌ Erreur:", JSON.stringify(data.error, null, 2));
        } else {
            console.log("   ✅ Succès! Hash:", data.result);
        }
    } catch (error: any) {
        console.log("   ❌ Erreur:", error.message);
    }
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});













