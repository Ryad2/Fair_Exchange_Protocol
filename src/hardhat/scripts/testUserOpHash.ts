import hre from "hardhat";
import { ethers, Wallet, Contract } from "ethers";
import { AbiCoder, keccak256, toUtf8Bytes, concat, toBeHex, zeroPadValue, getBytes } from "ethers";
import fs from "fs";
import path from "path";

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

async function main() {
    const contractAddress = process.env.CONTRACT_ADDRESS;
    const vendorAddress = process.env.VENDOR_ADDRESS;
    
    if (!contractAddress || !vendorAddress) {
        console.error("❌ Erreur: Utilisez CONTRACT_ADDRESS=0x... VENDOR_ADDRESS=0x... npx hardhat run scripts/testUserOpHash.ts --network localhost");
        process.exit(1);
    }

    console.log(`🔍 Test du calcul du userOpHash pour le contrat: ${contractAddress}`);
    console.log(`   Vendor address: ${vendorAddress}`);

    try {
        const provider = hre.ethers.provider;
        const network = await provider.getNetwork();
        const chainId = Number(network.chainId);
        
        console.log("\n📋 Configuration:");
        console.log("   Chain ID:", chainId);
        console.log("   EntryPoint:", ENTRY_POINT);
        
        // Charger le contrat
        const accountAbi = [
            "function nonce() view returns (uint256)",
            "function vendorSigner() view returns (address)",
            "function sessionKeys(address) view returns (bool)",
            "function sendKey(bytes) external",
            "function execute(address,uint256,bytes) external"
        ];
        const contract = new Contract(contractAddress, accountAbi, provider);
        
        // Obtenir le nonce
        const nonce = await contract.nonce();
        console.log("\n📊 Nonce actuel:", nonce.toString());
        
        // Créer une UserOperation de test
        const callData = contract.interface.encodeFunctionData("sendKey", ["0x1234"]);
        const executeData = contract.interface.encodeFunctionData("execute", [
            contractAddress,
            0,
            callData
        ]);
        
        const userOp = {
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
        
        console.log("\n📋 UserOperation de test:");
        console.log("   sender:", userOp.sender);
        console.log("   nonce:", userOp.nonce);
        console.log("   initCode:", userOp.initCode);
        console.log("   callData:", userOp.callData.substring(0, 50) + "...");
        console.log("   callGasLimit:", userOp.callGasLimit);
        console.log("   verificationGasLimit:", userOp.verificationGasLimit);
        console.log("   preVerificationGas:", userOp.preVerificationGas);
        console.log("   maxFeePerGas:", userOp.maxFeePerGas);
        console.log("   maxPriorityFeePerGas:", userOp.maxPriorityFeePerGas);
        console.log("   paymasterAndData:", userOp.paymasterAndData);
        
        // Calculer le hash
        const userOpHash = getUserOpHash(userOp, ENTRY_POINT, chainId);
        console.log("\n✅ userOpHash calculé:", userOpHash);
        
        // Vérifier le vendorSigner
        const vendorSigner = await contract.vendorSigner();
        console.log("\n👤 VendorSigner du contrat:", vendorSigner);
        
        // Vérifier si c'est une session key
        const isSessionKey = await contract.sessionKeys(vendorAddress);
        console.log("🔑 Vendor address est une session key?", isSessionKey);
        
        console.log("\n✅ Test terminé!");
        console.log("   Utilisez ce userOpHash pour signer la UserOperation");
        console.log("   Assurez-vous que le wallet qui signe correspond au vendorSigner ou à une session key autorisée");
        
    } catch (error: any) {
        console.error("❌ Erreur lors du test:", error.message || error.toString());
        process.exit(1);
    }
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});












