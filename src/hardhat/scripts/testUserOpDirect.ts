import hre from "hardhat";
import { ethers } from "hardhat";
import { Wallet, AbiCoder, keccak256, toUtf8Bytes, concat, toBeHex, getBytes, zeroPadValue, parseEther, verifyMessage } from "ethers";

/**
 * Script pour tester l'envoi d'une UserOperation directement au contrat
 * Cela permet de vérifier si le problème vient du hash ou de la signature
 */
async function main() {
    const contractAddr = process.env.CONTRACT || "0x9a9f2ccfde556a7e9ff0848998aa4a0cfd8863ae";
    const vendorPrivateKey = process.env.VENDOR_KEY || "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d";
    const entryPointSim = process.env.ENTRY_POINT_SIM || "0x2279B7A0a67DB372996a5FaB50D91eAA73d2eBe6";
    const ENTRY_POINT = "0x5FbDB2315678afecb367f032d93F642f64180aa3";
    
    const provider = hre.ethers.provider;
    const vendorWallet = new Wallet(vendorPrivateKey, provider);
    const vendorAddress = await vendorWallet.getAddress();
    
    console.log("=".repeat(80));
    console.log("🧪 Test direct d'envoi de UserOperation au contrat");
    console.log("=".repeat(80));
    console.log("");
    console.log("Contract address:", contractAddr);
    console.log("Vendor address:", vendorAddress);
    console.log("EntryPointSim:", entryPointSim);
    console.log("EntryPoint:", ENTRY_POINT);
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
    
    if (!isSessionKey && vendorAddress.toLowerCase() !== vendorSigner.toLowerCase()) {
        console.error("❌ Le wallet n'est ni le vendorSigner ni une session key!");
        console.error("   Ajoutez-le comme session key avec:");
        console.error(`   npx hardhat run scripts/fixAccountForVendor.ts --network localhost`);
        process.exit(1);
    }
    
    // Créer une UserOperation de test
    const key = "0x" + "00".repeat(16); // Clé de test (16 bytes)
    const iface = new ethers.Interface(accountAbi);
    const callData = iface.encodeFunctionData("sendKey", [key]);
    
    console.log("📋 Création de la UserOperation...");
    console.log("   callData:", callData);
    console.log("");
    
    // Packer les gas limits selon ERC-4337 PackedUserOperation
    const callGasLimit = 800000n;
    const verificationGasLimit = 800000n;
    const preVerificationGas = 2_000_000n;
    const maxFeePerGas = parseEther("0.00000002");
    const maxPriorityFeePerGas = parseEther("0.000000001");
    
    const accountGasLimits = packUint(verificationGasLimit, callGasLimit);
    const gasFees = packUint(maxPriorityFeePerGas, maxFeePerGas);
    
    // Créer la UserOperation pour le hash
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
    
    // Calculer le hash de la UserOperation
    // IMPORTANT: EntryPointSimulations utilise address(this) dans getUserOpHash, pas l'EntryPoint réel !
    const chainId = (await provider.getNetwork()).chainId;
    const userOpHash = getUserOpHash(userOpForHash, entryPointSim, Number(chainId)); // Utiliser entryPointSim au lieu de ENTRY_POINT
    
    console.log("📋 Hash de la UserOperation:");
    console.log("   userOpHash:", userOpHash);
    console.log("");
    
    // Signer le hash avec le wallet du vendor
    console.log("📝 Signature du hash...");
    const hashBytes = getBytes(userOpHash);
    let signature = await vendorWallet.signMessage(hashBytes);
    
    // Normaliser la signature (v doit être 27 ou 28)
    signature = normalizeSignature(signature);
    
    console.log("   Signature:", signature);
    console.log("");
    
    // Vérifier que la signature récupère la bonne adresse
    const recovered = verifyMessage(hashBytes, signature);
    console.log("🔍 Vérification de la signature:");
    console.log("   Adresse récupérée:", recovered);
    console.log("   Wallet address:", vendorAddress);
    console.log("   Correspond?", recovered.toLowerCase() === vendorAddress.toLowerCase());
    console.log("");
    
    if (recovered.toLowerCase() !== vendorAddress.toLowerCase()) {
        console.error("❌ La signature ne récupère pas la bonne adresse!");
        process.exit(1);
    }
    
    // Créer la PackedUserOperation finale
    const packedUserOp = {
        sender: contractAddr,
        nonce: nonce,
        initCode: "0x",
        callData: callData,
        accountGasLimits: accountGasLimits,
        preVerificationGas: preVerificationGas,
        gasFees: gasFees,
        paymasterAndData: "0x",
        signature: signature
    };
    
    console.log("📤 Tentative d'appel de validateUserOp depuis EntryPointSimulations...");
    console.log("   ⚠️  Note: On va utiliser EntryPointSimulations pour appeler validateUserOp");
    console.log("");
    
    // Obtenir EntryPointSimulations
    const entryPointSimAbi = [
        "function getUserOpHash((address,uint256,bytes,bytes,bytes32,uint256,bytes32,bytes,bytes)) view returns (bytes32)",
        "function simulateHandleOpSingle((address,uint256,bytes,bytes,bytes32,uint256,bytes32,bytes,bytes),address,bytes) returns ((uint256,uint256,uint256,uint256,uint256,uint256,bool,bytes))"
    ];
    const entryPointSimContract = new ethers.Contract(entryPointSim, entryPointSimAbi, provider);
    
    // Vérifier que le hash correspond
    try {
        // Convertir en tuple pour l'appel Solidity
        const packedUserOpTuple = [
            packedUserOp.sender,
            packedUserOp.nonce,
            packedUserOp.initCode,
            packedUserOp.callData,
            packedUserOp.accountGasLimits,
            packedUserOp.preVerificationGas,
            packedUserOp.gasFees,
            packedUserOp.paymasterAndData,
            packedUserOp.signature
        ];
        
        const hashFromSim = await entryPointSimContract.getUserOpHash(packedUserOpTuple);
        console.log("🔍 Vérification du hash:");
        console.log("   Hash calculé localement:", userOpHash);
        console.log("   Hash depuis EntryPointSimulations:", hashFromSim);
        console.log("   Correspond?", userOpHash.toLowerCase() === hashFromSim.toLowerCase());
        console.log("");
        
        if (userOpHash.toLowerCase() !== hashFromSim.toLowerCase()) {
            console.error("❌ Les hashs ne correspondent pas!");
            console.error("   Cela indique un problème dans le calcul du hash.");
            process.exit(1);
        }
    } catch (error: any) {
        console.error("❌ Erreur lors de la vérification du hash:", error.message);
        console.error("   Stack:", error.stack);
        process.exit(1);
    }
    
    // Essayer d'appeler simulateHandleOpSingle
    console.log("🧪 Appel de simulateHandleOpSingle...");
    try {
        // Utiliser un signer pour EntryPointSimulations (le premier compte Hardhat)
        const [signer] = await hre.ethers.getSigners();
        const entryPointSimWithSigner = entryPointSimContract.connect(signer);
        
        // Convertir en tuple pour l'appel Solidity
        const packedUserOpTuple = [
            packedUserOp.sender,
            packedUserOp.nonce,
            packedUserOp.initCode,
            packedUserOp.callData,
            packedUserOp.accountGasLimits,
            packedUserOp.preVerificationGas,
            packedUserOp.gasFees,
            packedUserOp.paymasterAndData,
            packedUserOp.signature
        ];
        
        const result = await entryPointSimWithSigner.simulateHandleOpSingle(
            packedUserOpTuple,
            ethers.ZeroAddress, // target
            "0x" // targetCallData
        );
        
        console.log("✅ simulateHandleOpSingle a réussi!");
        console.log("   Result:", result);
        console.log("");
        console.log("🎉 La UserOperation est valide!");
        
    } catch (error: any) {
        console.error("❌ Erreur lors de simulateHandleOpSingle:");
        console.error("   Message:", error.message);
        console.error("   Data:", error.data);
        console.error("");
        console.error("💡 Cela indique un problème dans validateUserOp ou execute");
        process.exit(1);
    }
}

// Fonctions utilitaires (parseEther est déjà importé depuis ethers)

function packUint(high128: bigint, low128: bigint): string {
    const packed = (high128 << 128n) | low128;
    return zeroPadValue(toBeHex(packed), 32);
}

function getUserOpHash(userOp: any, entryPoint: string, chainId: number): string {
    const abiCoder = AbiCoder.defaultAbiCoder();
    
    // Packer la UserOperation selon UserOperationLib.encode()
    const accountGasLimits = packUint(BigInt(userOp.verificationGasLimit), BigInt(userOp.callGasLimit));
    const gasFees = packUint(BigInt(userOp.maxPriorityFeePerGas), BigInt(userOp.maxFeePerGas));
    
    // Encoder selon UserOperationLib.encode() - ordre exact:
    // sender, nonce, hashInitCode, hashCallData, accountGasLimits, preVerificationGas, gasFees, hashPaymasterAndData
    const initCode = userOp.initCode || "0x";
    const callData = userOp.callData || "0x";
    const paymasterAndData = userOp.paymasterAndData || "0x";
    
    // calldataKeccak est juste keccak256 sur les bytes (calldataKeccak copie les bytes en mémoire puis fait keccak256)
    const hashInitCode = keccak256(initCode);
    const hashCallData = keccak256(callData);
    const hashPaymasterAndData = keccak256(paymasterAndData);
    
    // Encoder selon l'ordre exact de UserOperationLib.encode()
    // abi.encode(sender, nonce, hashInitCode, hashCallData, accountGasLimits, preVerificationGas, gasFees, hashPaymasterAndData)
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
    
    // userOp.hash() = keccak256(encode(userOp))
    const userOpHashValue = keccak256(encoded);
    
    // EntryPoint v7: getUserOpHash = keccak256(abi.encode(userOp.hash(), address(this), block.chainid))
    const hash = keccak256(
        abiCoder.encode(
            ["bytes32", "address", "uint256"],
            [userOpHashValue, entryPoint, chainId]
        )
    );
    
    return hash;
}

function getPaymasterDataHash(paymasterAndData: string): string {
    const data = getBytes(paymasterAndData || "0x");
    if (data.length === 0 || (data.length === 1 && data[0] === 0)) {
        return keccak256("0x");
    }
    return keccak256(data);
}

function normalizeSignature(signature: string): string {
    if (!signature.startsWith("0x")) {
        signature = "0x" + signature;
    }
    
    if (signature.length !== 132) {
        throw new Error(`Invalid signature length: ${signature.length}`);
    }
    
    const vHex = signature.slice(130, 132);
    const v = parseInt(vHex, 16);
    
    if (v === 27 || v === 28) {
        return signature;
    }
    
    // Normaliser v à 27 ou 28
    const normalizedV = v < 27 ? 27 : 28;
    const normalizedVHex = normalizedV.toString(16).padStart(2, "0");
    
    return "0x" + signature.slice(2, 130) + normalizedVHex;
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});

