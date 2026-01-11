import hre from "hardhat";
import { ethers } from "ethers";
import { Wallet, AbiCoder, keccak256, getBytes, zeroPadValue, toBeHex, parseEther } from "ethers";

/**
 * Script complet pour tester le flux UserOperation et identifier où ça échoue
 */
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
    console.log("🧪 Test complet du flux UserOperation");
    console.log("=".repeat(80));
    console.log("");
    console.log("Contract address:", contractAddr);
    console.log("Vendor address:", vendorAddress);
    console.log("EntryPoint:", ENTRY_POINT);
    console.log("ChainId:", chainId);
    console.log("");
    
    const accountAbi = [
        "function nonce() view returns (uint256)",
        "function vendorSigner() view returns (address)",
        "function sessionKeys(address) view returns (bool)",
        "function sendKey(bytes) external",
        "function validateUserOp((address,uint256,bytes,bytes,bytes32,uint256,bytes32,bytes,bytes),bytes32,uint256) external payable returns (uint256)"
    ];
    
    const contract = new ethers.Contract(contractAddr, accountAbi, provider);
    
    // Vérifier l'état
    const nonce = await contract.nonce();
    const vendorSigner = await contract.vendorSigner();
    const isSessionKey = await contract.sessionKeys(vendorAddress);
    
    console.log("📋 État du contrat:");
    console.log("   nonce:", nonce.toString());
    console.log("   vendorSigner:", vendorSigner);
    console.log("   Est session key?", isSessionKey);
    console.log("");
    
    if (!isSessionKey && vendorAddress.toLowerCase() !== vendorSigner.toLowerCase()) {
        console.error("❌ Le wallet n'est ni le vendorSigner ni une session key!");
        process.exit(1);
    }
    
    // Créer une UserOperation de test
    const key = "0x" + "00".repeat(16);
    const iface = new ethers.Interface(accountAbi);
    const callData = iface.encodeFunctionData("sendKey", [key]);
    
    const callGasLimit = 800000n;
    const verificationGasLimit = 800000n;
    const preVerificationGas = 2_000_000n;
    const maxFeePerGas = parseEther("0.00000002");
    const maxPriorityFeePerGas = parseEther("0.000000001");
    
    const userOpForHash = {
        sender: contractAddr,
        nonce: nonce.toString(),
        initCode: "0x",
        callData: callData,
        verificationGasLimit: verificationGasLimit.toString(),
        callGasLimit: callGasLimit.toString(),
        preVerificationGas: preVerificationGas.toString(),
        maxPriorityFeePerGas: maxPriorityFeePerGas.toString(),
        maxFeePerGas: maxFeePerGas.toString(),
        paymasterAndData: "0x"
    };
    
    console.log("📋 UserOperation:");
    console.log("   sender:", userOpForHash.sender);
    console.log("   nonce:", userOpForHash.nonce);
    console.log("   callData:", callData.substring(0, 50) + "...");
    console.log("");
    
    // Calculer le hash avec notre implémentation (comme le frontend)
    const accountGasLimits = packUint(verificationGasLimit, callGasLimit);
    const gasFees = packUint(maxPriorityFeePerGas, maxFeePerGas);
    const hashInitCode = keccak256(userOpForHash.initCode);
    const hashCallData = keccak256(userOpForHash.callData);
    const hashPaymasterAndData = keccak256(userOpForHash.paymasterAndData);
    
    const abiCoder = AbiCoder.defaultAbiCoder();
    const encoded = abiCoder.encode(
        ["address", "uint256", "bytes32", "bytes32", "bytes32", "uint256", "bytes32", "bytes32"],
        [
            userOpForHash.sender,
            BigInt(userOpForHash.nonce),
            hashInitCode,
            hashCallData,
            accountGasLimits,
            BigInt(userOpForHash.preVerificationGas),
            gasFees,
            hashPaymasterAndData
        ]
    );
    
    const userOpHashValue = keccak256(encoded);
    const localHash = keccak256(
        abiCoder.encode(
            ["bytes32", "address", "uint256"],
            [userOpHashValue, ENTRY_POINT, chainId]
        )
    );
    
    console.log("📋 Hash calculé localement:");
    console.log("   hash:", localHash);
    console.log("");
    
    // Obtenir le hash depuis l'EntryPoint réel
    const entryPointAbi = [
        "function getUserOpHash((address,uint256,bytes,bytes,bytes32,uint256,bytes32,bytes,bytes)) view returns (bytes32)"
    ];
    const entryPointContract = new ethers.Contract(ENTRY_POINT, entryPointAbi, provider);
    
    const packedUserOpTuple = [
        userOpForHash.sender,
        userOpForHash.nonce,
        userOpForHash.initCode,
        userOpForHash.callData,
        accountGasLimits,
        userOpForHash.preVerificationGas,
        gasFees,
        userOpForHash.paymasterAndData,
        "0x" // signature placeholder
    ];
    
    const entryPointHash = await entryPointContract.getUserOpHash(packedUserOpTuple);
    console.log("📋 Hash calculé par EntryPoint réel:");
    console.log("   hash:", entryPointHash);
    console.log("");
    
    console.log("🔍 Comparaison des hashs:");
    console.log("   Hash local:", localHash);
    console.log("   Hash EntryPoint:", entryPointHash);
    console.log("   Correspond?", localHash.toLowerCase() === entryPointHash.toLowerCase());
    console.log("");
    
    if (localHash.toLowerCase() !== entryPointHash.toLowerCase()) {
        console.error("❌ Les hashs ne correspondent pas!");
        process.exit(1);
    }
    
    // Signer le hash
    const hashBytes = getBytes(localHash);
    const signature = await vendorWallet.signMessage(hashBytes);
    
    console.log("📝 Signature:");
    console.log("   signature:", signature);
    console.log("");
    
    // Vérifier la signature
    const recovered = ethers.verifyMessage(hashBytes, signature);
    console.log("🔍 Vérification de la signature:");
    console.log("   Adresse récupérée:", recovered);
    console.log("   Wallet address:", vendorAddress);
    console.log("   Correspond?", recovered.toLowerCase() === vendorAddress.toLowerCase());
    console.log("");
    
    if (recovered.toLowerCase() !== vendorAddress.toLowerCase()) {
        console.error("❌ La signature ne récupère pas la bonne adresse!");
        process.exit(1);
    }
    
    // Tester validateUserOp directement
    console.log("🧪 Test de validateUserOp directement...");
    const packedUserOpWithSig = [
        userOpForHash.sender,
        userOpForHash.nonce,
        userOpForHash.initCode,
        userOpForHash.callData,
        accountGasLimits,
        userOpForHash.preVerificationGas,
        gasFees,
        userOpForHash.paymasterAndData,
        signature
    ];
    
    try {
        // Créer un wallet avec EntryPoint pour appeler validateUserOp
        const [entryPointSigner] = await hre.ethers.getSigners();
        const contractWithEntryPoint = contract.connect(entryPointSigner);
        
        // Simuler l'appel depuis EntryPoint
        // Note: On ne peut pas vraiment appeler validateUserOp depuis l'extérieur car il a onlyEntryPoint
        // Mais on peut vérifier que le hash et la signature sont corrects
        
        console.log("✅ Tous les tests de base ont réussi!");
        console.log("");
        console.log("💡 Le problème pourrait être:");
        console.log("   1. Le bundler calcule le hash différemment");
        console.log("   2. Un problème dans execute() qui cause un revert silencieux");
        console.log("   3. Un problème avec le callData ou les restrictions dans execute()");
        console.log("");
        console.log("Vérifiez les logs du bundler pour voir exactement où ça échoue.");
        
    } catch (error: any) {
        console.error("❌ Erreur lors du test:");
        console.error("   Message:", error.message);
        console.error("   Data:", error.data);
        process.exit(1);
    }
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});












