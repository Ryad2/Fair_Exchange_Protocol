import hre from "hardhat";
import { ethers } from "ethers";
import { Wallet, AbiCoder, keccak256, getBytes, zeroPadValue, toBeHex, parseEther, Signature } from "ethers";
import { getUserOperationHash } from "viem/account-abstraction";
import type { UserOperation } from "viem/account-abstraction";

/**
 * Test pour vérifier si le problème vient de la double application du préfixe ERC-191
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
    console.log("🧪 Test de correction de signature");
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
    
    console.log("📋 Hash de la UserOperation:", userOpHash);
    console.log("");
    
    // TEST 1: Signer avec signMessage() (ajoute préfixe ERC-191)
    console.log("🧪 TEST 1: Signature avec signMessage() (préfixe ERC-191 ajouté)");
    console.log("-".repeat(80));
    const hashBytes = getBytes(userOpHash);
    let signature1 = await vendorWallet.signMessage(hashBytes);
    
    const vHex1 = signature1.slice(130, 132);
    const v1 = parseInt(vHex1, 16);
    if (v1 !== 27 && v1 !== 28) {
        signature1 = signature1.slice(0, 130) + (v1 === 0 || v1 === 1 ? (v1 + 27).toString(16) : v1.toString(16));
    }
    
    console.log("   Signature:", signature1);
    
    // Vérifier avec le contrat
    const accountAbi2 = [
        "function validateUserOp((address,uint256,bytes,bytes,bytes32,uint256,bytes32,bytes,bytes),bytes32,uint256) external payable returns (uint256)"
    ];
    const accountContract = new ethers.Contract(contractAddr, accountAbi2, provider);
    
    const accountGasLimits = packUint(800000n, 800000n);
    const gasFees = packUint(parseEther("0.000000001"), parseEther("0.00000002"));
    
    const packedUserOp = [
        contractAddr.toLowerCase(),
        toBeHex(nonce),
        "0x",
        callData,
        accountGasLimits,
        toBeHex(2_000_000n),
        gasFees,
        "0x",
        signature1
    ];
    
    // TEST 2: Signer directement le hash SANS préfixe ERC-191
    console.log("");
    console.log("🧪 TEST 2: Signature directe du hash SANS préfixe ERC-191");
    console.log("-".repeat(80));
    
    // Signer directement avec la clé privée (sans préfixe ERC-191)
    const hashBytes2 = getBytes(userOpHash);
    const signature2 = await vendorWallet.signingKey.sign(hashBytes2);
    const sig2 = Signature.from(signature2);
    const signature2Hex = sig2.serialized;
    
    console.log("   Signature (sans préfixe):", signature2Hex);
    
    // Tester avec le bundler
    const userOp2 = {
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
        signature: signature2Hex
    };
    
    try {
        const response = await fetch(BUNDLER_URL, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                jsonrpc: "2.0",
                id: 1,
                method: "eth_sendUserOperation",
                params: [userOp2, ENTRY_POINT],
            }),
        });
        
        const data = await response.json();
        if (data.error) {
            console.log("   ❌ Erreur:", JSON.stringify(data.error, null, 2));
        } else {
            console.log("   ✅ SUCCÈS! Hash:", data.result);
            console.log("");
            console.log("🎉 La signature SANS préfixe ERC-191 fonctionne!");
            console.log("   Le contrat ajoute le préfixe avec toEthSignedMessageHash(),");
            console.log("   donc nous ne devons PAS l'ajouter lors de la signature.");
            process.exit(0);
        }
    } catch (error: any) {
        console.log("   ❌ Erreur:", error.message);
    }
    
    console.log("");
    console.log("❌ Aucune des méthodes n'a fonctionné.");
    console.log("   Le problème pourrait être ailleurs.");
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});












