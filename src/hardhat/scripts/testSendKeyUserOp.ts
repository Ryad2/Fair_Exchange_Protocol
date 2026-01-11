import hre from "hardhat";
import { ethers } from "ethers";
import {
    Wallet,
    AbiCoder,
    keccak256,
    getBytes,
    zeroPadValue,
    toBeHex,
    parseEther,
    concat,
    toUtf8Bytes,
} from "ethers";

function packUint(high128: bigint, low128: bigint): string {
    const packed = (high128 << 128n) | low128;
    return zeroPadValue(toBeHex(packed), 32);
}

function getUserOpHash(userOp: any, entryPoint: string, chainId: number): string {
    const abiCoder = AbiCoder.defaultAbiCoder();

    const accountGasLimits = packUint(
        BigInt(userOp.verificationGasLimit),
        BigInt(userOp.callGasLimit)
    );
    const gasFees = packUint(
        BigInt(userOp.maxPriorityFeePerGas),
        BigInt(userOp.maxFeePerGas)
    );

    const PACKED_USEROP_TYPEHASH = keccak256(
        toUtf8Bytes(
            "PackedUserOperation(address sender,uint256 nonce,bytes initCode,bytes callData,bytes32 accountGasLimits,uint256 preVerificationGas,bytes32 gasFees,bytes paymasterAndData)"
        )
    );

    const EIP712_DOMAIN_TYPEHASH = keccak256(
        toUtf8Bytes(
            "EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"
        )
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
                entryPoint,
            ]
        )
    );

    const initCode = userOp.initCode || "0x";
    const callData = userOp.callData || "0x";
    const paymasterAndData = userOp.paymasterAndData || "0x";

    const hashInitCode = keccak256(initCode);
    const hashCallData = keccak256(callData);
    const hashPaymasterAndData = keccak256(paymasterAndData);

    const encoded = abiCoder.encode(
        [
            "bytes32",
            "address",
            "uint256",
            "bytes32",
            "bytes32",
            "bytes32",
            "uint256",
            "bytes32",
            "bytes32",
        ],
        [
            PACKED_USEROP_TYPEHASH,
            userOp.sender,
            BigInt(userOp.nonce),
            hashInitCode,
            hashCallData,
            accountGasLimits,
            BigInt(userOp.preVerificationGas),
            gasFees,
            hashPaymasterAndData,
        ]
    );

    return keccak256(concat(["0x1901", domainSeparator, keccak256(encoded)]));
}

function normalizeSignature(signature: string): string {
    let normalized = signature.startsWith("0x") ? signature : `0x${signature}`;
    if (normalized.length !== 132) {
        throw new Error(
            `Invalid signature length: ${normalized.length}, expected 132 (65 bytes)`
        );
    }

    const r = normalized.slice(2, 66);
    const s = normalized.slice(66, 130);
    const vHex = normalized.slice(130, 132);
    const v = parseInt(vHex, 16);

    if (v === 27 || v === 28) {
        return normalized;
    }

    const normalizedV = v < 27 ? v + 27 : v % 2 === 0 ? 28 : 27;
    const normalizedVHex = normalizedV.toString(16).padStart(2, "0");
    return `0x${r}${s}${normalizedVHex}`;
}

async function main() {
    const contractAddr = process.env.CONTRACT || process.argv[2];
    if (!contractAddr) {
        console.error("❌ Usage: npx tsx scripts/testSendKeyUserOp.ts <contract_address>");
        console.error("   Or set CONTRACT environment variable");
        process.exit(1);
    }

    const vendorPrivateKey = process.env.VENDOR_KEY || "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";
    const ENTRY_POINT = process.env.ENTRY_POINT || "0x5FbDB2315678afecb367f032d93F642f64180aa3";
    const BUNDLER_URL = process.env.BUNDLER_URL || "http://localhost:4337/rpc";

    const provider = hre.ethers.provider;
    const chainId = Number((await provider.getNetwork()).chainId);
    const vendorWallet = new Wallet(vendorPrivateKey, provider);
    const vendorAddress = await vendorWallet.getAddress();

    console.log("=".repeat(80));
    console.log("🔍 Test diagnostic: sendKey via UserOperation");
    console.log("=".repeat(80));
    console.log("");
    console.log("Contract address:", contractAddr);
    console.log("Vendor address:", vendorAddress);
    console.log("EntryPoint:", ENTRY_POINT);
    console.log("Bundler URL:", BUNDLER_URL);
    console.log("ChainId:", chainId);
    console.log("");

    // Essayer de détecter le type de contrat
    const accountAbi = [
        "function nonce() view returns (uint256)",
        "function vendorSigner() view returns (address)",
        "function vendor() view returns (address)",
        "function buyer() view returns (address)",
        "function currState() view returns (uint8)",
        "function entryPoint() view returns (address)",
        "function sendKey(bytes) external",
        "function execute(address,uint256,bytes) external",
        "function validateUserOp((address,uint256,bytes,bytes,bytes32,uint256,bytes32,bytes,bytes),bytes32,uint256) external payable returns (uint256)",
    ];

    const contract = new ethers.Contract(contractAddr, accountAbi, provider);

    console.log("📋 Vérification du type de contrat:");
    let isOptimisticSOXAccount = false;
    let entryPointAddr: string | null = null;
    try {
        entryPointAddr = await contract.entryPoint();
        isOptimisticSOXAccount = entryPointAddr && entryPointAddr !== ethers.ZeroAddress;
        console.log("   Type: OptimisticSOXAccount ✅");
        console.log("   EntryPoint:", entryPointAddr);
    } catch (error: any) {
        console.log("   Type: OptimisticSOX (legacy)");
        console.log("   Note: Ce contrat ne supporte pas les UserOperations");
    }
    console.log("");

    console.log("📋 État du contrat:");
    let nonce: bigint;
    let vendorSigner: string;
    let vendor: string;
    let buyer: string;
    let currState: number;
    
    try {
        if (isOptimisticSOXAccount) {
            nonce = await contract.nonce();
        } else {
            // Pour OptimisticSOX legacy, pas de nonce
            console.log("   ⚠️  Contrat legacy, nonce non disponible");
            nonce = 0n;
        }
        
        vendorSigner = await contract.vendorSigner().catch(() => "");
        vendor = await contract.vendor();
        buyer = await contract.buyer();
        currState = Number(await contract.currState());

        const stateNames = ["WaitPayment", "WaitKey", "WaitSB", "WaitSV", "InDispute", "End"];
        const stateName = stateNames[currState] || `Unknown(${currState})`;

        console.log("   nonce:", nonce.toString());
        if (vendorSigner) {
            console.log("   vendorSigner:", vendorSigner);
            console.log("   vendorAddress == vendorSigner?", vendorAddress.toLowerCase() === vendorSigner.toLowerCase());
        }
        console.log("   vendor:", vendor);
        console.log("   buyer:", buyer);
        console.log("   currState:", stateName, `(${currState})`);
        console.log("   vendorAddress == vendor?", vendorAddress.toLowerCase() === vendor.toLowerCase());
        console.log("");

        if (currState !== 1) {
            console.error(`❌ Le contrat n'est pas dans l'état WaitKey (1), il est dans ${stateName} (${currState})`);
            process.exit(1);
        }

        if (!isOptimisticSOXAccount) {
            console.error("❌ Ce contrat est un OptimisticSOX legacy et ne supporte pas les UserOperations!");
            console.error("   Vous devez utiliser un OptimisticSOXAccount pour envoyer la clé via UserOperation.");
            process.exit(1);
        }

        if (vendorAddress.toLowerCase() !== vendorSigner?.toLowerCase() && vendorAddress.toLowerCase() !== vendor.toLowerCase()) {
            console.error("❌ Le wallet n'est ni le vendorSigner ni le vendor!");
            process.exit(1);
        }
    } catch (error: any) {
        console.error("❌ Erreur lors de la lecture de l'état:", error.message);
        if (error.data) {
            console.error("   Error data:", error.data);
        }
        process.exit(1);
    }

    if (!isOptimisticSOXAccount) {
        console.error("❌ Impossible de continuer: le contrat n'est pas un OptimisticSOXAccount");
        process.exit(1);
    }

    const key = "0x" + "00".repeat(16);
    const iface = new ethers.Interface(accountAbi);

    console.log("📋 Construction de la UserOperation:");
    const sendKeyData = iface.encodeFunctionData("sendKey", [key]);
    console.log("   sendKey calldata:", sendKeyData);
    console.log("");

    const executeData = iface.encodeFunctionData("execute", [
        contractAddr,
        0,
        sendKeyData,
    ]);
    console.log("   execute calldata:", executeData);
    console.log("");

    // Utiliser le nonce déjà récupéré plus haut
    const callGasLimit = 800000n;
    const verificationGasLimit = 800000n;
    const preVerificationGas = 200000n;
    const maxFeePerGas = parseEther("0.00000002");
    const maxPriorityFeePerGas = parseEther("0.000000001");

    const userOpForHash = {
        sender: contractAddr.toLowerCase(),
        nonce: nonce!.toString(),
        initCode: "0x",
        callData: executeData,
        verificationGasLimit: verificationGasLimit.toString(),
        callGasLimit: callGasLimit.toString(),
        preVerificationGas: preVerificationGas.toString(),
        maxPriorityFeePerGas: maxPriorityFeePerGas.toString(),
        maxFeePerGas: maxFeePerGas.toString(),
        paymasterAndData: "0x",
        signature: "0x",
    };

    console.log("📋 UserOperation:");
    console.log(JSON.stringify(userOpForHash, null, 2));
    console.log("");

    const userOpHash = getUserOpHash(userOpForHash, ENTRY_POINT, chainId);
    console.log("📋 Hash de la UserOperation:");
    console.log("   userOpHash:", userOpHash);
    console.log("");

    const messageHash = keccak256(
        concat([
            toUtf8Bytes("\x19Ethereum Signed Message:\n32"),
            getBytes(userOpHash),
        ])
    );
    console.log("📋 Message hash (pour signature):");
    console.log("   messageHash:", messageHash);
    console.log("");

    const signature = await vendorWallet.signMessage(getBytes(userOpHash));
    const normalizedSig = normalizeSignature(signature);
    console.log("📋 Signature:");
    console.log("   original:", signature);
    console.log("   normalized:", normalizedSig);
    console.log("");

    const accountGasLimits = packUint(verificationGasLimit, callGasLimit);
    const gasFees = packUint(maxPriorityFeePerGas, maxFeePerGas);

    console.log("📋 Test de validation locale:");
    try {
        const packedUserOp = [
            userOpForHash.sender,
            userOpForHash.nonce,
            userOpForHash.initCode,
            userOpForHash.callData,
            accountGasLimits,
            userOpForHash.preVerificationGas,
            gasFees,
            userOpForHash.paymasterAndData,
            normalizedSig,
        ];
        
        const validationResult = await contract.validateUserOp.staticCall(
            packedUserOp,
            userOpHash,
            0,
            { value: 0 }
        );
        console.log("   ✅ Validation réussie:", validationResult.toString());
    } catch (error: any) {
        console.error("   ❌ Validation échouée:", error.message);
        if (error.data) {
            console.error("   Error data:", error.data);
        }
        if (error.reason) {
            console.error("   Reason:", error.reason);
        }
        console.error("   Full error:", error);
    }
    console.log("");

    console.log("📋 Envoi au bundler (format v0.6):");
    const userOpForBundlerFormatted = {
        sender: userOpForHash.sender,
        nonce: toBeHex(BigInt(userOpForHash.nonce)),
        initCode: userOpForHash.initCode,
        callData: userOpForHash.callData,
        callGasLimit: toBeHex(callGasLimit),
        verificationGasLimit: toBeHex(verificationGasLimit),
        preVerificationGas: toBeHex(preVerificationGas),
        maxFeePerGas: toBeHex(maxFeePerGas),
        maxPriorityFeePerGas: toBeHex(maxPriorityFeePerGas),
        paymasterAndData: userOpForHash.paymasterAndData,
        signature: normalizedSig,
    };

    const bundlerRequest = {
        jsonrpc: "2.0",
        id: 1,
        method: "eth_sendUserOperation",
        params: [userOpForBundlerFormatted, ENTRY_POINT],
    };

    console.log("Request:", JSON.stringify(bundlerRequest, null, 2));
    console.log("");

    try {
        const response = await fetch(BUNDLER_URL, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(bundlerRequest),
        });

        const text = await response.text();
        console.log("Response status:", response.status);
        console.log("Response:", text);
        console.log("");

        if (!response.ok) {
            console.error("❌ HTTP error:", response.status);
            process.exit(1);
        }

        const payload = JSON.parse(text);
        if (payload.error) {
            console.error("❌ Bundler error:", JSON.stringify(payload.error, null, 2));
            
            if (payload.error.data) {
                console.log("");
                console.log("📋 Détails de l'erreur:");
                try {
                    const errorData = typeof payload.error.data === 'string' 
                        ? JSON.parse(payload.error.data) 
                        : payload.error.data;
                    console.log(JSON.stringify(errorData, null, 2));
                } catch {
                    console.log(payload.error.data);
                }
            }
            process.exit(1);
        }

        console.log("✅ UserOperation acceptée!");
        console.log("Hash:", payload.result);
    } catch (error: any) {
        console.error("❌ Erreur lors de l'envoi:", error.message);
        if (error.stack) {
            console.error("Stack:", error.stack);
        }
        process.exit(1);
    }
}

main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error(error);
        process.exit(1);
    });

