import hre from "hardhat";
import { ethers } from "hardhat";
import { Wallet, AbiCoder, keccak256, zeroPadValue, toBeHex, parseEther } from "ethers";

/**
 * Script pour comparer le hash calculé localement avec celui calculé par l'EntryPoint réel
 */
function packUint(high128: bigint, low128: bigint): string {
    const packed = (high128 << 128n) | low128;
    return zeroPadValue(toBeHex(packed), 32);
}

function getUserOpHash(userOp: any, entryPoint: string, chainId: number): string {
    const abiCoder = AbiCoder.defaultAbiCoder();
    
    const accountGasLimits = packUint(BigInt(userOp.verificationGasLimit), BigInt(userOp.callGasLimit));
    const gasFees = packUint(BigInt(userOp.maxPriorityFeePerGas), BigInt(userOp.maxFeePerGas));
    
    const initCode = userOp.initCode || "0x";
    const callData = userOp.callData || "0x";
    const paymasterAndData = userOp.paymasterAndData || "0x";
    
    const hashInitCode = keccak256(initCode);
    const hashCallData = keccak256(callData);
    const hashPaymasterAndData = keccak256(paymasterAndData);
    
    const encoded = abiCoder.encode(
        ["address", "uint256", "bytes32", "bytes32", "bytes32", "uint256", "bytes32", "bytes32"],
        [
            userOp.sender,
            BigInt(userOp.nonce),
            hashInitCode,
            hashCallData,
            accountGasLimits,
            BigInt(userOp.preVerificationGas),
            gasFees,
            hashPaymasterAndData
        ]
    );
    
    const userOpHashValue = keccak256(encoded);
    const hash = keccak256(
        abiCoder.encode(
            ["bytes32", "address", "uint256"],
            [userOpHashValue, entryPoint, chainId]
        )
    );
    
    return hash;
}

async function main() {
    const contractAddr = process.env.CONTRACT || "0x322813fd9a801c5507c9de605d63cea4f2ce6c44";
    const ENTRY_POINT = process.env.ENTRY_POINT || "0x5FbDB2315678afecb367f032d93F642f64180aa3";
    
    const provider = hre.ethers.provider;
    const chainId = (await provider.getNetwork()).chainId;
    
    console.log("=".repeat(80));
    console.log("🔍 Comparaison du hash calculé localement vs EntryPoint réel");
    console.log("=".repeat(80));
    console.log("");
    console.log("Contract address:", contractAddr);
    console.log("EntryPoint:", ENTRY_POINT);
    console.log("ChainId:", chainId.toString());
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
        maxPriorityFeePerGas: parseEther("0.000000001").toString(),
        maxFeePerGas: parseEther("0.00000002").toString(),
        paymasterAndData: "0x"
    };
    
    console.log("📋 UserOperation:");
    console.log("   sender:", userOp.sender);
    console.log("   nonce:", userOp.nonce);
    console.log("   callData:", callData.substring(0, 50) + "...");
    console.log("");
    
    // Calculer le hash localement
    const localHash = getUserOpHash(userOp, ENTRY_POINT, Number(chainId));
    console.log("📋 Hash calculé localement:");
    console.log("   hash:", localHash);
    console.log("");
    
    // Obtenir le hash depuis l'EntryPoint réel
    const entryPointAbi = [
        "function getUserOpHash((address,uint256,bytes,bytes,bytes32,uint256,bytes32,bytes,bytes)) view returns (bytes32)"
    ];
    const entryPointContract = new ethers.Contract(ENTRY_POINT, entryPointAbi, provider);
    
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
        console.log("   Hash local:", localHash);
        console.log("   Hash EntryPoint:", entryPointHash);
        console.log("   Correspond?", localHash.toLowerCase() === entryPointHash.toLowerCase());
        console.log("");
        
        if (localHash.toLowerCase() !== entryPointHash.toLowerCase()) {
            console.error("❌ Les hashs ne correspondent pas!");
            console.error("   Cela indique un problème dans le calcul du hash.");
            process.exit(1);
        } else {
            console.log("✅ Les hashs correspondent!");
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













