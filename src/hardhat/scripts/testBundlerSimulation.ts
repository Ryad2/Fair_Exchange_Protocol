import hre from "hardhat";
import { ethers } from "ethers";
import { Wallet, AbiCoder, keccak256, getBytes, zeroPadValue, toBeHex, parseEther } from "ethers";
import { getUserOperationHash } from "viem/account-abstraction";
import type { UserOperation } from "viem/account-abstraction";

/**
 * Test pour simuler exactement ce que fait le bundler avec PimlicoSimulations
 */
const BUNDLER_URL = process.env.BUNDLER_URL || "http://localhost:3002/rpc";
const PIMLICO_SIM = process.env.PIMLICO_SIM || "0x8A791620dd6260079BF849Dc5567aDC3F2FdC318";

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
    console.log("🧪 Simulation exacte du bundler avec PimlicoSimulations");
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
    
    // Calculer le hash avec viem (comme le bundler)
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
    
    console.log("📋 Hash calculé avec viem:", userOpHash);
    console.log("");
    
    // Signer avec signMessage() (ajoute préfixe ERC-191)
    const hashBytes = getBytes(userOpHash);
    let signature = await vendorWallet.signMessage(hashBytes);
    
    const vHex = signature.slice(130, 132);
    const v = parseInt(vHex, 16);
    if (v !== 27 && v !== 28) {
        signature = signature.slice(0, 130) + (v === 0 || v === 1 ? (v + 27).toString(16) : v.toString(16));
    }
    
    // Créer PackedUserOperation pour PimlicoSimulations
    const accountGasLimits = packUint(800000n, 800000n);
    const gasFees = packUint(parseEther("0.000000001"), parseEther("0.00000002"));
    
    const packedUserOp = [
        contractAddr.toLowerCase(),
        toBeHex(nonce),
        "0x", // initCode
        callData,
        accountGasLimits,
        toBeHex(2_000_000n),
        gasFees,
        "0x", // paymasterAndData
        signature
    ];
    
    console.log("🧪 Test avec PimlicoSimulations.filterOps07()...");
    
    const pimlicoAbi = [
        "function filterOps07((address,uint256,bytes,bytes,bytes32,uint256,bytes32,bytes,bytes)[],address,address) external returns ((uint256,uint256,(bytes32,bytes)[]))"
    ];
    
    const [signer] = await hre.ethers.getSigners();
    const pimlicoContract = new ethers.Contract(PIMLICO_SIM, pimlicoAbi, signer);
    
    try {
        const result = await pimlicoContract.filterOps07.staticCall(
            [packedUserOp],
            signer.address, // beneficiary
            ENTRY_POINT
        );
        
        console.log("   ✅ filterOps07 a réussi!");
        console.log("   Result:", result);
    } catch (error: any) {
        console.log("   ❌ Erreur:", error.message);
        if (error.data) {
            console.log("   Data:", error.data);
        }
        if (error.reason) {
            console.log("   Reason:", error.reason);
        }
        
        // Essayer de décoder l'erreur
        try {
            const revertAbi = [
                "error ExecutionResult(uint256,uint256,uint256,uint256,bool,bytes)"
            ];
            const iface = new ethers.Interface(revertAbi);
            const decoded = iface.parseError(error.data);
            console.log("   Erreur décodée:", decoded);
        } catch (e) {
            // Pas une ExecutionResult
        }
    }
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
