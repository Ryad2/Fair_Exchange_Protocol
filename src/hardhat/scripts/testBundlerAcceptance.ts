import hre from "hardhat";
import { ethers } from "ethers";
import { Wallet, AbiCoder, keccak256, getBytes, zeroPadValue, toBeHex, parseEther } from "ethers";
import { getUserOperationHash } from "viem/account-abstraction";
import type { UserOperation } from "viem/account-abstraction";

/**
 * Script pour tester différentes variations de UserOperation jusqu'à ce que le bundler l'accepte
 */
const BUNDLER_URL = process.env.BUNDLER_URL || "http://localhost:3002/rpc";

function packUint(high128: bigint, low128: bigint): string {
    const packed = (high128 << 128n) | low128;
    return zeroPadValue(toBeHex(packed), 32);
}

async function sendToBundler(userOp: any, entryPoint: string, testName: string): Promise<{ success: boolean; hash?: string; error?: string }> {
    try {
        const cleanedUserOp: any = {
            sender: String(userOp.sender).toLowerCase(),
            nonce: String(userOp.nonce),
            initCode: String(userOp.initCode || "0x"),
            callData: String(userOp.callData),
            callGasLimit: String(userOp.callGasLimit),
            verificationGasLimit: String(userOp.verificationGasLimit),
            preVerificationGas: String(userOp.preVerificationGas),
            maxFeePerGas: String(userOp.maxFeePerGas),
            maxPriorityFeePerGas: String(userOp.maxPriorityFeePerGas),
            paymasterAndData: String(userOp.paymasterAndData || "0x"),
            signature: String(userOp.signature)
        };

        const response = await fetch(BUNDLER_URL, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                jsonrpc: "2.0",
                id: 1,
                method: "eth_sendUserOperation",
                params: [cleanedUserOp, entryPoint],
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
    console.log("🧪 Test d'acceptation par le bundler - Essai de différentes variations");
    console.log("=".repeat(80));
    console.log("");
    console.log("Contract address:", contractAddr);
    console.log("Vendor address:", vendorAddress);
    console.log("EntryPoint:", ENTRY_POINT);
    console.log("ChainId:", chainId);
    console.log("Bundler URL:", BUNDLER_URL);
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
    
    console.log("📋 Paramètres de base:");
    console.log("   nonce:", nonce.toString());
    console.log("   callData:", callData.substring(0, 50) + "...");
    console.log("");
    
    // Test 1: Hash avec viem (comme le frontend)
    console.log("🧪 TEST 1: Hash avec viem (comme le frontend)");
    console.log("-".repeat(80));
    
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
    
    console.log("   Hash viem:", viemHash);
    
    const hashBytes = getBytes(viemHash);
    let signature = await vendorWallet.signMessage(hashBytes);
    
    // Normaliser signature si nécessaire
    const vHex = signature.slice(130, 132);
    const v = parseInt(vHex, 16);
    if (v !== 27 && v !== 28) {
        signature = signature.slice(0, 130) + (v === 0 || v === 1 ? (v + 27).toString(16) : v.toString(16));
    }
    
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
    
    const result1 = await sendToBundler(userOp1, ENTRY_POINT, "Test 1: Hash viem");
    console.log("   Résultat:", result1.success ? "✅ Accepté!" : "❌ Rejeté");
    if (!result1.success) {
        console.log("   Erreur:", result1.error);
    } else {
        console.log("   Hash:", result1.hash);
        console.log("");
        console.log("✅ SUCCÈS! La UserOperation a été acceptée!");
        console.log("   Configuration qui fonctionne:");
        console.log("   - Hash calculé avec viem");
        console.log("   - Signature normalisée");
        process.exit(0);
    }
    console.log("");
    
    // Test 2: Hash avec EntryPoint réel (comme notre implémentation manuelle)
    console.log("🧪 TEST 2: Hash avec EntryPoint réel (implémentation manuelle)");
    console.log("-".repeat(80));
    
    const accountGasLimits = packUint(800000n, 800000n);
    const gasFees = packUint(parseEther("0.000000001"), parseEther("0.00000002"));
    const hashInitCode = keccak256("0x");
    const hashCallData = keccak256(callData);
    const hashPaymasterAndData = keccak256("0x");
    
    const abiCoder = AbiCoder.defaultAbiCoder();
    const encoded = abiCoder.encode(
        ["address", "uint256", "bytes32", "bytes32", "bytes32", "uint256", "bytes32", "bytes32"],
        [
            contractAddr,
            nonce,
            hashInitCode,
            hashCallData,
            accountGasLimits,
            2_000_000n,
            gasFees,
            hashPaymasterAndData
        ]
    );
    
    const userOpHashValue = keccak256(encoded);
    const manualHash = keccak256(
        abiCoder.encode(
            ["bytes32", "address", "uint256"],
            [userOpHashValue, ENTRY_POINT, chainId]
        )
    );
    
    console.log("   Hash manuel:", manualHash);
    
    const hashBytes2 = getBytes(manualHash);
    let signature2 = await vendorWallet.signMessage(hashBytes2);
    
    const vHex2 = signature2.slice(130, 132);
    const v2 = parseInt(vHex2, 16);
    if (v2 !== 27 && v2 !== 28) {
        signature2 = signature2.slice(0, 130) + (v2 === 0 || v2 === 1 ? (v2 + 27).toString(16) : v2.toString(16));
    }
    
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
        signature: signature2
    };
    
    const result2 = await sendToBundler(userOp2, ENTRY_POINT, "Test 2: Hash manuel");
    console.log("   Résultat:", result2.success ? "✅ Accepté!" : "❌ Rejeté");
    if (!result2.success) {
        console.log("   Erreur:", result2.error);
    } else {
        console.log("   Hash:", result2.hash);
        console.log("");
        console.log("✅ SUCCÈS! La UserOperation a été acceptée!");
        console.log("   Configuration qui fonctionne:");
        console.log("   - Hash calculé manuellement");
        console.log("   - Signature normalisée");
        process.exit(0);
    }
    console.log("");
    
    // Test 3: Vérifier le hash calculé par le bundler
    console.log("🧪 TEST 3: Vérification du hash avec le bundler");
    console.log("-".repeat(80));
    
    try {
        const estimateResponse = await fetch(BUNDLER_URL, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                jsonrpc: "2.0",
                id: 2,
                method: "eth_estimateUserOperationGas",
                params: [userOp1, ENTRY_POINT],
            }),
        });
        
        const estimateData = await estimateResponse.json();
        console.log("   Réponse estimation:", JSON.stringify(estimateData, null, 2));
    } catch (error: any) {
        console.log("   Erreur estimation:", error.message);
    }
    console.log("");
    
    console.log("❌ Aucune des configurations n'a fonctionné.");
    console.log("");
    console.log("💡 Prochaines étapes:");
    console.log("   1. Vérifiez les logs du bundler pour voir l'erreur exacte");
    console.log("   2. Vérifiez que le contrat existe et est correctement configuré");
    console.log("   3. Vérifiez que le wallet est autorisé (vendorSigner ou session key)");
    console.log("   4. Comparez les hashs calculés avec ceux du bundler");
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});













