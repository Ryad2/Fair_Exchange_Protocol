import hre from "hardhat";
import { ethers } from "ethers";
import { Wallet, AbiCoder, keccak256, getBytes, zeroPadValue, toBeHex, parseEther } from "ethers";
import { getUserOperationHash } from "viem/account-abstraction";
import type { UserOperation } from "viem/account-abstraction";

/**
 * Test pour envoyer la UserOperation au bundler avec différents formats
 */
const BUNDLER_URL = process.env.BUNDLER_URL || "http://localhost:3002/rpc";

function packUint(high128: bigint, low128: bigint): string {
    const packed = (high128 << 128n) | low128;
    return zeroPadValue(toBeHex(packed), 32);
}

async function sendToBundler(userOp: any, entryPoint: string, testName: string): Promise<{ success: boolean; hash?: string; error?: string }> {
    try {
        const response = await fetch(BUNDLER_URL, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                jsonrpc: "2.0",
                id: 1,
                method: "eth_sendUserOperation",
                params: [userOp, entryPoint],
            }),
        });

        const data = await response.json();
        
        if (data.error) {
            return { success: false, error: JSON.stringify(data.error) };
        }
        
        return { success: true, hash: data.result };
    } catch (error: any) {
        return { success: false, error: error.message };
    }
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
    console.log("🧪 Test de différents formats pour le bundler");
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
    
    const userOpHash = getUserOperationHash({
        chainId,
        entryPointAddress: ENTRY_POINT as `0x${string}`,
        entryPointVersion: "0.7",
        userOperation: viemUserOp
    });
    
    const hashBytes = getBytes(userOpHash);
    let signature = await vendorWallet.signMessage(hashBytes);
    
    const vHex = signature.slice(130, 132);
    const v = parseInt(vHex, 16);
    if (v !== 27 && v !== 28) {
        signature = signature.slice(0, 130) + (v === 0 || v === 1 ? (v + 27).toString(16) : v.toString(16));
    }
    
    // TEST 1: Format avec valeurs en hex (comme actuellement)
    console.log("🧪 TEST 1: Format avec valeurs en hex");
    console.log("-".repeat(80));
    const userOp1 = {
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
        signature: signature
    };
    
    const result1 = await sendToBundler(userOp1, ENTRY_POINT, "Test 1");
    console.log("   Résultat:", result1.success ? "✅ Accepté!" : "❌ Rejeté");
    if (result1.success) {
        console.log("   Hash:", result1.hash);
        process.exit(0);
    } else {
        console.log("   Erreur:", result1.error);
    }
    console.log("");
    
    // TEST 2: Format avec valeurs en nombres (comme viem)
    console.log("🧪 TEST 2: Format avec valeurs en nombres");
    console.log("-".repeat(80));
    const userOp2 = {
        sender: contractAddr.toLowerCase(),
        nonce: nonce.toString(),
        initCode: "0x",
        callData: callData,
        callGasLimit: "800000",
        verificationGasLimit: "800000",
        preVerificationGas: "2000000",
        maxFeePerGas: parseEther("0.00000002").toString(),
        maxPriorityFeePerGas: parseEther("0.000000001").toString(),
        paymasterAndData: "0x",
        signature: signature
    };
    
    const result2 = await sendToBundler(userOp2, ENTRY_POINT, "Test 2");
    console.log("   Résultat:", result2.success ? "✅ Accepté!" : "❌ Rejeté");
    if (result2.success) {
        console.log("   Hash:", result2.hash);
        process.exit(0);
    } else {
        console.log("   Erreur:", result2.error);
    }
    console.log("");
    
    // TEST 3: Format avec valeurs en BigInt (comme viem UserOperation)
    console.log("🧪 TEST 3: Format avec valeurs en BigInt (sérialisé en JSON)");
    console.log("-".repeat(80));
    const userOp3 = {
        sender: contractAddr.toLowerCase(),
        nonce: `0x${nonce.toString(16)}`,
        initCode: "0x",
        callData: callData,
        callGasLimit: `0x${(800000n).toString(16)}`,
        verificationGasLimit: `0x${(800000n).toString(16)}`,
        preVerificationGas: `0x${(2_000_000n).toString(16)}`,
        maxFeePerGas: `0x${parseEther("0.00000002").toString(16)}`,
        maxPriorityFeePerGas: `0x${parseEther("0.000000001").toString(16)}`,
        paymasterAndData: "0x",
        signature: signature
    };
    
    const result3 = await sendToBundler(userOp3, ENTRY_POINT, "Test 3");
    console.log("   Résultat:", result3.success ? "✅ Accepté!" : "❌ Rejeté");
    if (result3.success) {
        console.log("   Hash:", result3.hash);
        process.exit(0);
    } else {
        console.log("   Erreur:", result3.error);
    }
    console.log("");
    
    console.log("❌ Aucun format n'a fonctionné.");
    console.log("   Le problème doit être ailleurs (signature, hash, ou contrat).");
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});












