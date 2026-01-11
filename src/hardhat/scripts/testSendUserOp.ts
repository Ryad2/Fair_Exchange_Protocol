import hre from "hardhat";
import { ethers, Wallet, Contract } from "ethers";
import fs from "fs";
import path from "path";
import { AbiCoder, keccak256, toUtf8Bytes, concat, toBeHex, zeroPadValue, getBytes } from "ethers";
import axios from "axios";

function getEntryPointFromBundlerConfig(): string {
    const envEntryPoint = process.env.ENTRY_POINT || process.env.NEXT_PUBLIC_ENTRY_POINT;
    if (envEntryPoint) return envEntryPoint;

    const configPath = path.resolve(
        process.cwd(),
        "..",
        "bundler-alto",
        "scripts",
        "config.local.json"
    );
    try {
        const raw = fs.readFileSync(configPath, "utf8");
        const config = JSON.parse(raw);
        const entrypoints = config.entrypoints;
        if (Array.isArray(entrypoints)) return entrypoints[0];
        if (typeof entrypoints === "string") return entrypoints;
    } catch {}

    throw new Error(
        "EntryPoint introuvable. Définissez ENTRY_POINT ou NEXT_PUBLIC_ENTRY_POINT."
    );
}

const ENTRY_POINT = getEntryPointFromBundlerConfig();
const BUNDLER_URL = "http://localhost:3002/rpc";
const PAYMASTER_SIG_MAGIC = "0x22e325a297439656";

// Packer deux uint128 en un bytes32
function packUint(high128: bigint, low128: bigint): string {
    const packed = (high128 << 128n) | low128;
    return zeroPadValue(toBeHex(packed), 32);
}

function bytesEqual(left: Uint8Array, right: Uint8Array): boolean {
    if (left.length !== right.length) return false;
    for (let i = 0; i < left.length; i++) {
        if (left[i] !== right[i]) return false;
    }
    return true;
}

function getPaymasterDataHash(paymasterAndData: string): string {
    const data = getBytes(paymasterAndData || "0x");
    const suffix = getBytes(PAYMASTER_SIG_MAGIC);
    if (data.length < suffix.length + 2) {
        return keccak256(data);
    }
    const suffixStart = data.length - suffix.length;
    if (!bytesEqual(data.slice(suffixStart), suffix)) {
        return keccak256(data);
    }
    const sigLenOffset = data.length - suffix.length - 2;
    const sigLen = (data[sigLenOffset] << 8) | data[sigLenOffset + 1];
    const signedLen = data.length - sigLen - (suffix.length + 2);
    if (signedLen < 0) {
        return keccak256(data);
    }
    return keccak256(concat([data.slice(0, signedLen), suffix]));
}

// Fonction pour calculer getUserOpHash selon la spécification ERC-4337
function getUserOpHash(userOp: any, entryPoint: string, chainId: number): string {
    const abiCoder = AbiCoder.defaultAbiCoder();
    
    // Packer la UserOperation
    const accountGasLimits = packUint(BigInt(userOp.verificationGasLimit), BigInt(userOp.callGasLimit));
    const gasFees = packUint(BigInt(userOp.maxPriorityFeePerGas), BigInt(userOp.maxFeePerGas));
    
    // Typehash pour PackedUserOperation
    const PACKED_USEROP_TYPEHASH = keccak256(
        toUtf8Bytes("PackedUserOperation(address sender,uint256 nonce,bytes initCode,bytes callData,bytes32 accountGasLimits,uint256 preVerificationGas,bytes32 gasFees,bytes paymasterAndData)")
    );
    
    // Domain separator pour EIP-712
    const EIP712_DOMAIN_TYPEHASH = keccak256(
        toUtf8Bytes("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)")
    );
    const domainNameHash = keccak256(toUtf8Bytes("ERC4337"));
    const domainVersionHash = keccak256(toUtf8Bytes("1"));
    
    const domainSeparator = keccak256(
        abiCoder.encode(
            ["bytes32", "bytes32", "bytes32", "uint256", "address"],
            [
                EIP712_DOMAIN_TYPEHASH,
                domainNameHash,
                domainVersionHash,
                chainId,
                entryPoint
            ]
        )
    );
    
    // Encoder la PackedUserOperation pour le hash
    const initCode = userOp.initCode || "0x";
    const callData = userOp.callData || "0x";
    const paymasterAndData = userOp.paymasterAndData || "0x";
    
    const hashInitCode = keccak256(initCode);
    const hashCallData = keccak256(callData);
    const hashPaymasterAndData = getPaymasterDataHash(paymasterAndData);
    
    // Encoder selon PACKED_USEROP_TYPEHASH
    const encoded = abiCoder.encode(
        ["bytes32", "address", "uint256", "bytes32", "bytes32", "bytes32", "uint256", "bytes32", "bytes32"],
        [
            PACKED_USEROP_TYPEHASH,
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
    
    // Hash final: keccak256("\x19\x01" || domainSeparator || hash(encoded))
    return keccak256(concat(["0x1901", domainSeparator, keccak256(encoded)]));
}

// Normaliser une signature ECDSA pour s'assurer que v est 27 ou 28
function normalizeSignature(signature: string): string {
    if (!signature.startsWith("0x")) {
        signature = "0x" + signature;
    }
    
    if (signature.length !== 132) {
        throw new Error(`Invalid signature length: ${signature.length}, expected 132 (65 bytes)`);
    }
    
    const r = signature.slice(2, 66);
    const s = signature.slice(66, 130);
    const vHex = signature.slice(130, 132);
    const v = parseInt(vHex, 16);
    
    if (v === 27 || v === 28) {
        return signature;
    }
    
    if (v < 27) {
        const normalizedV = v + 27;
        const normalizedVHex = normalizedV.toString(16).padStart(2, "0");
        return "0x" + r + s + normalizedVHex;
    }
    
    const normalizedV = (v % 2 === 0) ? 28 : 27;
    const normalizedVHex = normalizedV.toString(16).padStart(2, "0");
    return "0x" + r + s + normalizedVHex;
}

async function main() {
    const contractAddress = process.env.CONTRACT_ADDRESS;
    const vendorPrivateKey = process.env.VENDOR_PRIVATE_KEY;
    const keyToSend = process.env.KEY_TO_SEND || "0x1234";
    
    if (!contractAddress || !vendorPrivateKey) {
        console.error("❌ Erreur: Utilisez:");
        console.error("   CONTRACT_ADDRESS=0x... VENDOR_PRIVATE_KEY=0x... npx hardhat run scripts/testSendUserOp.ts --network localhost");
        console.error("   Optionnel: KEY_TO_SEND=0x... (défaut: 0x1234)");
        process.exit(1);
    }

    console.log("=".repeat(80));
    console.log("🧪 TEST D'ENVOI DE USEROPERATION");
    console.log("=".repeat(80));
    console.log(`   Contrat: ${contractAddress}`);
    console.log(`   EntryPoint: ${ENTRY_POINT}`);
    console.log(`   Bundler: ${BUNDLER_URL}`);
    console.log(`   Clé à envoyer: ${keyToSend}`);
    console.log("");

    try {
        const provider = hre.ethers.provider;
        const network = await provider.getNetwork();
        const chainId = Number(network.chainId);
        
        console.log("📋 ÉTAPE 1: Configuration");
        console.log("   Chain ID:", chainId);
        console.log("");

        // Créer le wallet du vendor
        const vendorWallet = new Wallet(vendorPrivateKey, provider);
        const vendorAddress = await vendorWallet.getAddress();
        console.log("📋 ÉTAPE 2: Wallet du vendor");
        console.log("   Adresse:", vendorAddress);
        console.log("   Balance:", ethers.formatEther(await provider.getBalance(vendorAddress)), "ETH");
        console.log("");

        // Charger le contrat
        const accountAbi = [
            "function nonce() view returns (uint256)",
            "function vendorSigner() view returns (address)",
            "function vendor() view returns (address)",
            "function sessionKeys(address) view returns (bool)",
            "function sendKey(bytes) external",
            "function execute(address,uint256,bytes) external"
        ];
        const contract = new Contract(contractAddress, accountAbi, provider);
        
        console.log("📋 ÉTAPE 3: Vérification du contrat");
        const contractVendor = await contract.vendor();
        const vendorSigner = await contract.vendorSigner();
        const nonce = await contract.nonce();
        const isSessionKey = await contract.sessionKeys(vendorAddress);
        
        console.log("   Vendor du contrat:", contractVendor);
        console.log("   VendorSigner du contrat:", vendorSigner);
        console.log("   Nonce actuel:", nonce.toString());
        console.log("   Wallet est une session key?", isSessionKey);
        console.log("   Wallet correspond au vendorSigner?", vendorAddress.toLowerCase() === vendorSigner.toLowerCase());
        console.log("");

        // Vérifier que le wallet peut signer
        if (!isSessionKey && vendorAddress.toLowerCase() !== vendorSigner.toLowerCase()) {
            console.error("❌ ERREUR: Le wallet ne correspond pas au vendorSigner et n'est pas une session key!");
            console.error("   Solutions:");
            console.error("   1. Utiliser une session key autorisée");
            console.error("   2. Mettre à jour le vendorSigner avec setVendorSigner()");
            process.exit(1);
        }
        console.log("✅ Le wallet peut signer des UserOperations");
        console.log("");

        // Préparer les données pour sendKey
        console.log("📋 ÉTAPE 4: Préparation des données");
        const sendKeyData = contract.interface.encodeFunctionData("sendKey", [keyToSend]);
        const executeData = contract.interface.encodeFunctionData("execute", [
            contractAddress,
            0,
            sendKeyData
        ]);
        console.log("   sendKey data:", sendKeyData.substring(0, 50) + "...");
        console.log("   execute data:", executeData.substring(0, 50) + "...");
        console.log("");

        // Créer la UserOperation
        console.log("📋 ÉTAPE 5: Création de la UserOperation");
        const userOpForHash: any = {
            sender: contractAddress,
            nonce: nonce.toString(),
            initCode: "0x",
            callData: executeData,
            callGasLimit: "100000",
            verificationGasLimit: "100000",
            preVerificationGas: "100000",
            maxFeePerGas: "1000000000",
            maxPriorityFeePerGas: "1000000000",
            paymasterAndData: "0x",
            signature: "0x"
        };
        
        console.log("   sender:", userOpForHash.sender);
        console.log("   nonce:", userOpForHash.nonce);
        console.log("   initCode:", userOpForHash.initCode);
        console.log("   callData:", userOpForHash.callData.substring(0, 50) + "...");
        console.log("   callGasLimit:", userOpForHash.callGasLimit);
        console.log("   verificationGasLimit:", userOpForHash.verificationGasLimit);
        console.log("   preVerificationGas:", userOpForHash.preVerificationGas);
        console.log("   maxFeePerGas:", userOpForHash.maxFeePerGas);
        console.log("   maxPriorityFeePerGas:", userOpForHash.maxPriorityFeePerGas);
        console.log("   paymasterAndData:", userOpForHash.paymasterAndData);
        console.log("");

        // Calculer le hash
        console.log("📋 ÉTAPE 6: Calcul du userOpHash");
        const userOpHash = getUserOpHash(userOpForHash, ENTRY_POINT, chainId);
        console.log("   userOpHash:", userOpHash);
        console.log("");

        // Signer
        console.log("📋 ÉTAPE 7: Signature");
        const hashBytes = getBytes(userOpHash);
        let signature = await vendorWallet.signMessage(hashBytes);
        console.log("   Signature brute:", signature);
        
        // Vérifier la valeur v
        const vHex = signature.slice(130, 132);
        const v = parseInt(vHex, 16);
        console.log("   Signature v value:", v, `(0x${vHex})`);
        
        // Normaliser si nécessaire
        if (v !== 27 && v !== 28) {
            console.log("   ⚠️ Normalisation de la signature...");
            signature = normalizeSignature(signature);
            const newV = parseInt(signature.slice(130, 132), 16);
            console.log("   Signature normalisée, nouveau v:", newV);
        }
        console.log("   Signature finale:", signature);
        console.log("");

        // Vérifier la signature
        console.log("📋 ÉTAPE 8: Vérification de la signature");
        const { verifyMessage } = await import("ethers");
        const recovered = verifyMessage(hashBytes, signature);
        console.log("   Adresse récupérée:", recovered);
        console.log("   Wallet address:", vendorAddress);
        console.log("   Correspond?", recovered.toLowerCase() === vendorAddress.toLowerCase());
        
        if (recovered.toLowerCase() !== vendorAddress.toLowerCase()) {
            console.error("❌ ERREUR: La signature ne récupère pas la bonne adresse!");
            process.exit(1);
        }
        console.log("✅ Signature valide");
        console.log("");

        // Créer la UserOperation finale pour le bundler
        console.log("📋 ÉTAPE 9: Préparation pour le bundler");
        const userOpForBundler: any = {
            sender: contractAddress.toLowerCase(),
            nonce: toBeHex(nonce),
            initCode: "0x",
            callData: executeData,
            callGasLimit: toBeHex(BigInt(userOpForHash.callGasLimit)),
            verificationGasLimit: toBeHex(BigInt(userOpForHash.verificationGasLimit)),
            preVerificationGas: toBeHex(BigInt(userOpForHash.preVerificationGas)),
            maxFeePerGas: toBeHex(BigInt(userOpForHash.maxFeePerGas)),
            maxPriorityFeePerGas: toBeHex(BigInt(userOpForHash.maxPriorityFeePerGas)),
            paymasterAndData: "0x",
            signature: signature
        };
        
        console.log("   UserOperation pour le bundler:");
        console.log(JSON.stringify(userOpForBundler, null, 2));
        console.log("");

        // Envoyer au bundler
        console.log("📋 ÉTAPE 10: Envoi au bundler");
        console.log("   URL:", BUNDLER_URL);
        
        try {
            const response = await axios.post(BUNDLER_URL, {
                jsonrpc: "2.0",
                id: 1,
                method: "eth_sendUserOperation",
                params: [userOpForBundler, ENTRY_POINT]
            });
            
            console.log("   Réponse du bundler:");
            console.log(JSON.stringify(response.data, null, 2));
            
            if (response.data.error) {
                console.error("❌ ERREUR du bundler:", JSON.stringify(response.data.error, null, 2));
                process.exit(1);
            }
            
            if (response.data.result) {
                console.log("✅ UserOperation envoyée avec succès!");
                console.log("   Hash:", response.data.result);
            }
        } catch (error: any) {
            console.error("❌ Erreur lors de l'envoi au bundler:");
            if (error.response) {
                console.error("   Status:", error.response.status);
                console.error("   Data:", JSON.stringify(error.response.data, null, 2));
            } else {
                console.error("   Erreur:", error.message);
            }
            process.exit(1);
        }
        
        console.log("");
        console.log("=".repeat(80));
        console.log("✅ TEST TERMINÉ AVEC SUCCÈS");
        console.log("=".repeat(80));
        
    } catch (error: any) {
        console.error("");
        console.error("=".repeat(80));
        console.error("❌ ERREUR LORS DU TEST");
        console.error("=".repeat(80));
        console.error("   Message:", error.message || error.toString());
        if (error.stack) {
            console.error("   Stack:", error.stack);
        }
        process.exit(1);
    }
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});











