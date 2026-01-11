import hre from "hardhat";
import { ethers } from "hardhat";
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
    Contract,
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
    // Utiliser EntryPoint v0.7 (adresse déterministe standard)
    const ENTRY_POINT = process.env.ENTRY_POINT || 
        process.env.NEXT_PUBLIC_ENTRY_POINT || 
        "0x0000000071727De22E5E9d8BAf0edAc6f37da032"; // EntryPoint v0.7 déterministe (PackedUserOperation)
    const BUNDLER_URL = process.env.BUNDLER_URL || "http://localhost:4337/rpc";
    const deployNew = process.env.DEPLOY_NEW === "true" || !contractAddr;

    const provider = hre.ethers.provider;
    const chainId = Number((await provider.getNetwork()).chainId);
    const [sponsor, buyer, vendor] = await hre.ethers.getSigners();
    
    console.log("=".repeat(80));
    console.log("🧪 Test: sendKey via UserOperation (sponsorisé)");
    console.log("=".repeat(80));
    console.log("");
    console.log("Sponsor:", await sponsor.getAddress());
    console.log("Buyer:", await buyer.getAddress());
    console.log("Vendor:", await vendor.getAddress());
    console.log("EntryPoint configuré:", ENTRY_POINT);
    console.log("Bundler URL:", BUNDLER_URL);
    console.log("ChainId:", chainId);
    console.log("");
    
    // Vérifier si l'EntryPoint existe vraiment
    console.log("🔍 Vérification de l'EntryPoint...");
    const entryPointCode = await provider.getCode(ENTRY_POINT);
    if (!entryPointCode || entryPointCode === "0x" || entryPointCode.length < 100) {
        console.error("❌ L'EntryPoint n'existe pas ou n'est pas valide à", ENTRY_POINT);
        console.error("   Code length:", entryPointCode?.length || 0);
        console.error("");
        console.error("💡 Solution: Déployez un vrai EntryPoint avec:");
        console.error("   cd src/hardhat && npx hardhat run scripts/deployEntryPoint.ts --network localhost");
        console.error("   Puis mettez à jour bundler-alto/scripts/config.local.json avec la nouvelle adresse");
        process.exit(1);
    }
    console.log("✅ EntryPoint trouvé (code length:", entryPointCode.length, "bytes)");
    
    // Tester si l'EntryPoint répond
    try {
        const entryPointAbi = ["function depositTo(address) payable", "function balanceOf(address) view returns (uint256)"];
        const entryPointContract = new ethers.Contract(ENTRY_POINT, entryPointAbi, provider);
        const testBalance = await entryPointContract.balanceOf(ethers.ZeroAddress);
        console.log("✅ EntryPoint répond (test balance:", testBalance.toString(), ")");
    } catch (error: any) {
        console.error("❌ L'EntryPoint ne répond pas correctement:", error.message);
        console.error("   L'adresse", ENTRY_POINT, "n'est probablement pas un vrai EntryPoint");
        process.exit(1);
    }
    console.log("");

    let optimisticAccount: Contract;
    let contractAddress: string;

    if (deployNew || !contractAddr) {
        console.log("📦 Déploiement d'un nouveau OptimisticSOXAccount...");
        
        // Déployer les libraries nécessaires
        const AccumulatorVerifierFactory = await hre.ethers.getContractFactory("AccumulatorVerifier");
        const accumulatorVerifier = await AccumulatorVerifierFactory.deploy();
        await accumulatorVerifier.waitForDeployment();
        const accumulatorVerifierAddr = await accumulatorVerifier.getAddress();

        const CommitmentOpenerFactory = await hre.ethers.getContractFactory("CommitmentOpener");
        const commitmentOpener = await CommitmentOpenerFactory.deploy();
        await commitmentOpener.waitForDeployment();
        const commitmentOpenerAddr = await commitmentOpener.getAddress();

        const SHA256EvaluatorFactory = await hre.ethers.getContractFactory("SHA256Evaluator");
        const sha256Evaluator = await SHA256EvaluatorFactory.deploy();
        await sha256Evaluator.waitForDeployment();
        const sha256EvaluatorAddr = await sha256Evaluator.getAddress();

        const DisputeDeployerFactory = await hre.ethers.getContractFactory("DisputeDeployer", {
            libraries: {
                AccumulatorVerifier: accumulatorVerifierAddr,
                CommitmentOpener: commitmentOpenerAddr,
                SHA256Evaluator: sha256EvaluatorAddr,
            },
        });
        const disputeDeployer = await DisputeDeployerFactory.deploy();
        await disputeDeployer.waitForDeployment();
        const disputeDeployerAddr = await disputeDeployer.getAddress();

        // Déployer OptimisticSOXAccount
        const OptimisticSOXAccountFactory = await hre.ethers.getContractFactory("OptimisticSOXAccount", {
            libraries: {
                DisputeDeployer: disputeDeployerAddr,
            },
        });

        const agreedPrice = parseEther("1.0");
        const completionTip = parseEther("0.1");
        const disputeTip = parseEther("0.1");
        const timeoutIncrement = 3600;
        const commitment = "0x" + "00".repeat(32);
        const numBlocks = 10;
        const numGates = 100;

        optimisticAccount = await OptimisticSOXAccountFactory.connect(sponsor).deploy(
            ENTRY_POINT,
            await vendor.getAddress(),
            await buyer.getAddress(),
            agreedPrice,
            completionTip,
            disputeTip,
            timeoutIncrement,
            commitment,
            numBlocks,
            numGates,
            await vendor.getAddress(), // vendorSigner
            { value: parseEther("1") } // sponsor deposit
        );
        await optimisticAccount.waitForDeployment();
        contractAddress = await optimisticAccount.getAddress();

        console.log("✅ OptimisticSOXAccount déployé à:", contractAddress);
        console.log("");

        // Simuler le payment du buyer pour mettre le contrat en état WaitKey
        console.log("💰 Simulation du paiement du buyer...");
        const paymentAmount = agreedPrice + completionTip;
        await optimisticAccount.connect(buyer).sendPayment({ value: paymentAmount });
        console.log("✅ Paiement envoyé, état du contrat:", await optimisticAccount.currState());
        console.log("");

        // Vérifier l'EntryPoint du contrat
        const contractEntryPoint = await optimisticAccount.entryPoint();
        console.log("🔍 EntryPoint du contrat:", contractEntryPoint);
        console.log("🔍 EntryPoint attendu:", ENTRY_POINT);
        if (contractEntryPoint.toLowerCase() !== ENTRY_POINT.toLowerCase()) {
            console.error("❌ L'EntryPoint du contrat ne correspond pas à celui attendu!");
            console.error("   Le contrat doit être déployé avec l'EntryPoint:", ENTRY_POINT);
            process.exit(1);
        }
        console.log("");

        // Vérifier si l'EntryPoint existe et a le bon bytecode
        const entryPointCode = await provider.getCode(ENTRY_POINT);
        if (!entryPointCode || entryPointCode === "0x") {
            console.error("❌ L'EntryPoint n'existe pas à l'adresse", ENTRY_POINT);
            console.error("   Vous devez d'abord déployer l'EntryPoint avec:");
            console.error("   npx hardhat run scripts/deployCompleteStack.ts --network localhost");
            process.exit(1);
        }
        console.log("✅ EntryPoint trouvé à", ENTRY_POINT);
        console.log("");

        // Dépôt dans EntryPoint pour sponsoriser les UserOperations
        console.log("💳 Dépôt dans EntryPoint pour sponsoriser les UserOperations...");
        const depositAmount = parseEther("0.5");
        
        // Essayer de déposer directement sur l'EntryPoint (plus fiable)
        try {
            const entryPointAbi = ["function depositTo(address) payable"];
            const entryPointContract = new ethers.Contract(ENTRY_POINT, entryPointAbi, sponsor);
            const tx = await entryPointContract.depositTo(contractAddress, { value: depositAmount });
            await tx.wait();
            console.log("✅ Transaction de dépôt confirmée:", tx.hash);
        } catch (directError: any) {
            console.error("❌ Dépôt direct échoué:", directError.message);
            if (directError.data) {
                console.error("   Error data:", directError.data);
            }
            // Essayer via la fonction du contrat
            try {
                console.log("   Tentative via depositToEntryPoint du contrat...");
                await optimisticAccount.connect(sponsor).depositToEntryPoint({ value: depositAmount });
                console.log("✅ Dépôt via contrat réussi");
            } catch (contractError: any) {
                console.error("❌ Dépôt via contrat échoué:", contractError.message);
                console.error("   ⚠️  Le dépôt est peut-être déjà effectué ou l'EntryPoint n'est pas compatible");
            }
        }
        
        // Essayer de lire le dépôt, mais ignorer l'erreur si ça échoue
        let deposit = 0n;
        try {
            deposit = await optimisticAccount.getDeposit();
            console.log("✅ Balance EntryPoint du contrat:", ethers.formatEther(deposit), "ETH");
        } catch (error: any) {
            console.log("⚠️  Impossible de lire le dépôt (c'est peut-être normal si l'EntryPoint n'est pas déployé)");
            console.log("   Le bundler peut quand même fonctionner avec un dépôt externe");
        }
        console.log("");
    } else {
        contractAddress = contractAddr;
        // Utiliser directement Contract avec l'ABI au lieu de attach pour éviter les problèmes de linking
        optimisticAccount = new ethers.Contract(contractAddress, [
            "function entryPoint() view returns (address)",
            "function nonce() view returns (uint256)",
            "function vendorSigner() view returns (address)",
            "function vendor() view returns (address)",
            "function buyer() view returns (address)",
            "function currState() view returns (uint8)",
            "function sendPayment() payable",
        ], provider);
        console.log("📋 Utilisation du contrat existant:", contractAddress);
        console.log("");
    }

    const accountAbi = [
        "function nonce() view returns (uint256)",
        "function vendorSigner() view returns (address)",
        "function vendor() view returns (address)",
        "function buyer() view returns (address)",
        "function currState() view returns (uint8)",
        "function entryPoint() view returns (address)",
        "function getDeposit() view returns (uint256)",
        "function sendKey(bytes) external",
        "function execute(address,uint256,bytes) external",
        "function validateUserOp((address,uint256,bytes,bytes,bytes32,uint256,bytes32,bytes,bytes),bytes32,uint256) external payable returns (uint256)",
    ];

    const contract = new ethers.Contract(contractAddress, accountAbi, provider);

    console.log("📋 État du contrat:");
    const nonce = await contract.nonce();
    const vendorSigner = await contract.vendorSigner();
    const vendorAddr = await contract.vendor();
    const buyerAddr = await contract.buyer();
    const currState = Number(await contract.currState());

    const stateNames = ["WaitPayment", "WaitKey", "WaitSB", "WaitSV", "InDispute", "End"];
    const stateName = stateNames[currState] || `Unknown(${currState})`;

    console.log("   nonce:", nonce.toString());
    console.log("   vendorSigner:", vendorSigner);
    console.log("   vendor:", vendorAddr);
    console.log("   buyer:", buyerAddr);
    console.log("   currState:", stateName, `(${currState})`);
    
    // Essayer de lire le dépôt si possible
    try {
        const deposit = await contract.getDeposit();
        console.log("   EntryPoint deposit:", ethers.formatEther(deposit), "ETH");
    } catch {
        console.log("   EntryPoint deposit: (non disponible)");
    }
    console.log("");

    if (currState !== 1) {
        console.error(`❌ Le contrat n'est pas dans l'état WaitKey (1), il est dans ${stateName} (${currState})`);
        console.error("   💡 Relancez avec DEPLOY_NEW=true pour créer un nouveau contrat");
        process.exit(1);
    }

    // Déterminer quel wallet utiliser pour signer (vendor ou vendorSigner)
    let vendorWallet: Wallet;
    if (vendorSigner.toLowerCase() === (await vendor.getAddress()).toLowerCase()) {
        vendorWallet = vendor as Wallet;
        console.log("🔑 Utilisation du wallet vendor pour signer");
    } else {
        // Utiliser la clé privée correspondant au vendorSigner
        // Hardhat Account #2 (0x70997970C51812dc3A010C7d01b50e0d17dc79C8) = 0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d
        // Hardhat Account #3 (0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC) = 0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a
        const vendorSignerKey = process.env.VENDOR_SIGNER_PRIVATE_KEY || 
            (vendorSigner.toLowerCase() === "0x3c44cdddb6a900fa2b585dd299e03d12fa4293bc" 
                ? "0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a"
                : "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d");
        vendorWallet = new Wallet(vendorSignerKey, provider);
        console.log("🔑 Utilisation d'un wallet séparé pour vendorSigner");
    }
    
    const vendorAddress = await vendorWallet.getAddress();
    console.log("   Vendor wallet address:", vendorAddress);
    console.log("   Expected vendorSigner:", vendorSigner);
    console.log("   Match?", vendorAddress.toLowerCase() === vendorSigner.toLowerCase());
    
    if (vendorAddress.toLowerCase() !== vendorSigner.toLowerCase()) {
        console.error("❌ Le wallet utilisé ne correspond pas au vendorSigner!");
        console.error("   Définissez VENDOR_SIGNER_PRIVATE_KEY avec la clé privée correspondant à", vendorSigner);
        process.exit(1);
    }
    console.log("");

    const key = "0x" + "00".repeat(16);
    const iface = new ethers.Interface(accountAbi);

    console.log("📋 Construction de la UserOperation:");
    const sendKeyData = iface.encodeFunctionData("sendKey", [key]);
    console.log("   sendKey calldata:", sendKeyData);
    console.log("");

    const executeData = iface.encodeFunctionData("execute", [
        contractAddress,
        0,
        sendKeyData,
    ]);
    console.log("   execute calldata:", executeData);
    console.log("");

    const callGasLimit = 800000n;
    const verificationGasLimit = 800000n;
    const preVerificationGas = 200000n;
    const maxFeePerGas = parseEther("0.00000002");
    const maxPriorityFeePerGas = parseEther("0.000000001");

    const userOpForHash = {
        sender: contractAddress.toLowerCase(),
        nonce: nonce.toString(),
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

    console.log("📋 UserOperation (pour hash):");
    console.log("   sender:", userOpForHash.sender);
    console.log("   nonce:", userOpForHash.nonce);
    console.log("   callData length:", userOpForHash.callData.length, "chars");
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

    console.log("📋 Test de validation locale (simulation):");
    try {
        const packedUserOp = [
            userOpForHash.sender,
            userOpForHash.nonce,
            userOpForHash.initCode,
            userOpForHash.callData,
            packUint(verificationGasLimit, callGasLimit),
            userOpForHash.preVerificationGas,
            packUint(maxPriorityFeePerGas, maxFeePerGas),
            userOpForHash.paymasterAndData,
            normalizedSig,
        ];
        
        // Test avec simulateHandleOp si disponible, sinon test direct
        const entryPointContract = new ethers.Contract(
            ENTRY_POINT,
            ["function simulateHandleOp(tuple,address,bytes) returns (tuple)"],
            provider
        );
        
        try {
            const simulationResult = await entryPointContract.simulateHandleOp.staticCall(
                packedUserOp,
                contractAddress,
                "0x"
            );
            console.log("   ✅ Simulation réussie:", simulationResult);
        } catch (simError: any) {
            console.log("   ⚠️  simulateHandleOp non disponible, test direct...");
            
            // Test direct de validateUserOp
            const validationResult = await contract.validateUserOp.staticCall(
                packedUserOp,
                userOpHash,
                0,
                { value: 0 }
            );
            console.log("   ✅ Validation réussie:", validationResult.toString());
            
            // Test de l'exécution
            console.log("   📝 Test d'exécution simulée...");
            try {
                const executeResult = await contract.execute.staticCall(
                    contractAddress,
                    0,
                    sendKeyData,
                    { from: ENTRY_POINT } // Simuler depuis EntryPoint
                );
                console.log("   ✅ Exécution simulée réussie");
            } catch (execError: any) {
                console.error("   ❌ Exécution simulée échouée:", execError.message);
                if (execError.reason) {
                    console.error("   Reason:", execError.reason);
                }
                if (execError.data) {
                    console.error("   Data:", execError.data);
                }
            }
        }
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

    console.log("📋 Format de la UserOperation pour le bundler:");
    console.log("   Format: v0.6 (non-packed) avec initCode et paymasterAndData");
    console.log("   Le bundler détectera automatiquement la version et convertira si nécessaire");
    console.log("");

    // Format v0.6 pour le bundler (le bundler convertira en PackedUserOperation si l'EntryPoint est v0.7)
    const userOpForBundler = {
        sender: userOpForHash.sender.toLowerCase(), // Lowercase pour cohérence
        nonce: toBeHex(BigInt(userOpForHash.nonce)),
        initCode: userOpForHash.initCode || "0x",
        callData: userOpForHash.callData,
        callGasLimit: toBeHex(callGasLimit),
        verificationGasLimit: toBeHex(verificationGasLimit),
        preVerificationGas: toBeHex(preVerificationGas),
        maxFeePerGas: toBeHex(maxFeePerGas),
        maxPriorityFeePerGas: toBeHex(maxPriorityFeePerGas),
        paymasterAndData: userOpForHash.paymasterAndData || "0x",
        signature: normalizedSig,
    };
    
    console.log("📋 UserOperation (format v0.6 pour bundler):");
    console.log("   sender:", userOpForBundler.sender);
    console.log("   nonce:", userOpForBundler.nonce);
    console.log("   initCode:", userOpForBundler.initCode === "0x" ? "(empty)" : userOpForBundler.initCode);
    console.log("   callData length:", (userOpForBundler.callData.length - 2) / 2, "bytes");
    console.log("   callGasLimit:", userOpForBundler.callGasLimit);
    console.log("   verificationGasLimit:", userOpForBundler.verificationGasLimit);
    console.log("   maxFeePerGas:", userOpForBundler.maxFeePerGas);
    console.log("   signature length:", (userOpForBundler.signature.length - 2) / 2, "bytes");
    console.log("");

    const bundlerRequest = {
        jsonrpc: "2.0",
        id: 1,
        method: "eth_sendUserOperation",
        params: [userOpForBundler, ENTRY_POINT],
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
            console.error("❌ Bundler error:");
            console.error(JSON.stringify(payload.error, null, 2));
            
            if (payload.error.data) {
                console.log("");
                console.log("📋 Détails de l'erreur:");
                try {
                    const errorData = typeof payload.error.data === 'string' 
                        ? JSON.parse(payload.error.data) 
                        : payload.error.data;
                    console.log(JSON.stringify(errorData, null, 2));
                    
                    // Si c'est une erreur de simulation, essayer d'obtenir plus de détails
                    if (errorData.message && errorData.message.includes("simulation")) {
                        console.log("");
                        console.log("💡 Pour obtenir plus de détails sur l'erreur de simulation:");
                        console.log("   1. Vérifiez que l'EntryPoint est correctement déployé");
                        console.log("   2. Vérifiez que le contrat a un dépôt suffisant dans l'EntryPoint");
                        console.log("   3. Vérifiez les logs du bundler pour plus d'informations");
                    }
                } catch {
                    console.log("Error data (raw):", payload.error.data);
                }
            }
            
            // Essayer d'obtenir plus d'informations via debug_bundler_dumpMempool
            console.log("");
            console.log("🔍 Tentative d'obtenir plus d'informations...");
            try {
                const debugResponse = await fetch(BUNDLER_URL, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                        jsonrpc: "2.0",
                        id: 2,
                        method: "debug_bundler_dumpMempool",
                        params: [ENTRY_POINT],
                    }),
                });
                const debugPayload = await debugResponse.json();
                if (debugPayload.result) {
                    console.log("📋 Mempool state:", JSON.stringify(debugPayload.result, null, 2));
                }
            } catch (debugError) {
                console.log("⚠️  Impossible d'obtenir les informations de debug");
            }
            
            process.exit(1);
        }

        console.log("✅ UserOperation acceptée par le bundler!");
        console.log("Hash:", payload.result);
        console.log("");
        console.log("💡 Vérifiez l'état du contrat pour confirmer que sendKey a été exécuté");
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

