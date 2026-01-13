import hre from "hardhat";
import { ethers } from "hardhat";
import { parseEther } from "ethers";
import { writeFileSync, existsSync, mkdirSync, readFileSync } from "fs";
import { join } from "path";

const CANONICAL_ENTRYPOINT_V8 = "0x4337084D9E255Ff0702461CF8895CE9E3b5Ff108";

async function setCode(
    provider: typeof ethers.provider,
    address: string,
    code: string
) {
    try {
        await provider.send("hardhat_setCode", [address, code]);
        return;
    } catch {
        await provider.send("anvil_setCode", [address, code]);
    }
}

async function setStorage(
    provider: typeof ethers.provider,
    address: string,
    slot: string,
    value: string
) {
    try {
        await provider.send("hardhat_setStorageAt", [address, slot, value]);
        return;
    } catch {
        await provider.send("anvil_setStorageAt", [address, slot, value]);
    }
}

/**
 * Complete and synchronized deployment script
 * 
 * This script deploys in order:
 * 1. All necessary libraries
 * 2. DisputeDeployer
 * 3. EntryPoint (for ERC-4337)
 * 4. Generates JSON files with correct addresses
 * 5. Updates bundler config
 * 6. Creates .env.local file with addresses
 */

interface DeploymentAddresses {
    accumulatorVerifier: string;
    sha256Evaluator: string;
    simpleOperationsEvaluator: string;
    aes128CtrEvaluator: string;
    circuitEvaluator: string;
    commitmentOpener: string;
    disputeDeployer: string;
    entryPoint: string;
}

async function main() {
    const { ethers } = hre;
    const [sponsor] = await ethers.getSigners();

    console.log("=".repeat(80));
    console.log("🚀 COMPLETE AND SYNCHRONIZED SOX STACK DEPLOYMENT");
    console.log("=".repeat(80));
    console.log("");
    console.log("📋 Signer:", await sponsor.getAddress());
    console.log("🌐 Network:", hre.network.name);
    console.log("");

    const addresses: DeploymentAddresses = {
        accumulatorVerifier: "",
        sha256Evaluator: "",
        simpleOperationsEvaluator: "",
        aes128CtrEvaluator: "",
        circuitEvaluator: "",
        commitmentOpener: "",
        disputeDeployer: "",
        entryPoint: "",
    };

    // ============================================
    // STEP 1: Deploy libraries
    // ============================================
    console.log("📚 STEP 1: Deploying libraries...");
    console.log("-".repeat(80));

    const AccumulatorVerifierFactory = await ethers.getContractFactory("AccumulatorVerifier");
    const accumulatorVerifier = await AccumulatorVerifierFactory.deploy();
    await accumulatorVerifier.waitForDeployment();
    addresses.accumulatorVerifier = await accumulatorVerifier.getAddress();
    console.log("  ✅ AccumulatorVerifier:", addresses.accumulatorVerifier);

    const SHA256EvaluatorFactory = await ethers.getContractFactory("SHA256Evaluator");
    const sha256Evaluator = await SHA256EvaluatorFactory.deploy();
    await sha256Evaluator.waitForDeployment();
    addresses.sha256Evaluator = await sha256Evaluator.getAddress();
    console.log("  ✅ SHA256Evaluator:", addresses.sha256Evaluator);

    const SimpleOperationsEvaluatorFactory = await ethers.getContractFactory("SimpleOperationsEvaluator");
    const simpleOperationsEvaluator = await SimpleOperationsEvaluatorFactory.deploy();
    await simpleOperationsEvaluator.waitForDeployment();
    addresses.simpleOperationsEvaluator = await simpleOperationsEvaluator.getAddress();
    console.log("  ✅ SimpleOperationsEvaluator:", addresses.simpleOperationsEvaluator);

    const AES128CtrEvaluatorFactory = await ethers.getContractFactory("AES128CtrEvaluator");
    const aes128CtrEvaluator = await AES128CtrEvaluatorFactory.deploy();
    await aes128CtrEvaluator.waitForDeployment();
    addresses.aes128CtrEvaluator = await aes128CtrEvaluator.getAddress();
    console.log("  ✅ AES128CtrEvaluator:", addresses.aes128CtrEvaluator);

    const CircuitEvaluatorFactory = await ethers.getContractFactory("CircuitEvaluator", {
        libraries: {
            SHA256Evaluator: addresses.sha256Evaluator,
            SimpleOperationsEvaluator: addresses.simpleOperationsEvaluator,
            AES128CtrEvaluator: addresses.aes128CtrEvaluator,
        },
    });
    const circuitEvaluator = await CircuitEvaluatorFactory.deploy();
    await circuitEvaluator.waitForDeployment();
    addresses.circuitEvaluator = await circuitEvaluator.getAddress();
    console.log("  ✅ CircuitEvaluator:", addresses.circuitEvaluator);

    const CommitmentOpenerFactory = await ethers.getContractFactory("CommitmentOpener");
    const commitmentOpener = await CommitmentOpenerFactory.deploy();
    await commitmentOpener.waitForDeployment();
    addresses.commitmentOpener = await commitmentOpener.getAddress();
    console.log("  ✅ CommitmentOpener:", addresses.commitmentOpener);

    console.log("");

    // ============================================
    // STEP 2: Deploy DisputeDeployer
    // ============================================
    console.log("📦 STEP 2: Deploying DisputeDeployer...");
    console.log("-".repeat(80));

    const DisputeDeployerFactory = await ethers.getContractFactory("DisputeDeployer", {
        libraries: {
            AccumulatorVerifier: addresses.accumulatorVerifier,
            CommitmentOpener: addresses.commitmentOpener,
            SHA256Evaluator: addresses.sha256Evaluator,
        },
    });
    const disputeDeployer = await DisputeDeployerFactory.connect(sponsor).deploy();
    await disputeDeployer.waitForDeployment();
    addresses.disputeDeployer = await disputeDeployer.getAddress();
    console.log("  ✅ DisputeDeployer:", addresses.disputeDeployer);
    // If DisputeSOXAccount constructor signature changes, recompile and redeploy
    // DisputeDeployer + OptimisticSOXAccount so the linked bytecode stays in sync.
    console.log("");

    // ============================================
    // STEP 3: Deploy EntryPoint v0.8 (canonical)
    // ============================================
    console.log("🔐 STEP 3: Deploying EntryPoint v0.8 (canonical)...");
    console.log("-".repeat(80));

    const provider = ethers.provider;
    
    // Deploy a temporary EntryPoint to get its runtime code
    const entryPointJsonPath = join(
        __dirname,
        "../../../bundler-alto/src/contracts/EntryPointFilterOpsOverride.sol/EntryPointFilterOpsOverride08.json"
    );
    const entryPointJson = JSON.parse(
        readFileSync(entryPointJsonPath, "utf-8")
    );
    
    const tempFactory = new ethers.ContractFactory(
        entryPointJson.abi,
        entryPointJson.bytecode.object,
        sponsor
    );
    const tempEntryPoint = await tempFactory.deploy();
    await tempEntryPoint.waitForDeployment();
    const tempAddress = await tempEntryPoint.getAddress();
    const runtimeCode = await provider.getCode(tempAddress);
    
    if (!runtimeCode || runtimeCode === "0x") {
        throw new Error("Failed to read EntryPoint runtime code");
    }
    
    // Deploy EntryPoint at canonical address
    await setCode(provider, CANONICAL_ENTRYPOINT_V8, runtimeCode);
    await setCode(provider, tempAddress, "0x"); // Clean up temporary contract
    
    addresses.entryPoint = CANONICAL_ENTRYPOINT_V8;
    console.log("  ✅ EntryPoint v0.8 deployed at:", addresses.entryPoint);
    
    // Deploy and configure SenderCreator
    const senderCreatorJsonPath = join(
        __dirname,
        "../../../bundler-alto/src/contracts/SenderCreator.sol/SenderCreator.json"
    );
    const senderCreatorJson = JSON.parse(
        readFileSync(senderCreatorJsonPath, "utf-8")
    );
    const senderCreatorFactory = new ethers.ContractFactory(
        senderCreatorJson.abi,
        senderCreatorJson.bytecode.object,
        sponsor
    );
    const senderCreator = await senderCreatorFactory.deploy();
    await senderCreator.waitForDeployment();
    const senderCreatorAddress = await senderCreator.getAddress();
    console.log("  ✅ SenderCreator deployed at:", senderCreatorAddress);
    
    // Configure SenderCreator slot in EntryPoint
    const senderCreatorSlot = ethers.keccak256(
        ethers.toUtf8Bytes("SENDER_CREATOR")
    );
    const senderCreatorValue = ethers.zeroPadValue(senderCreatorAddress, 32);
    await setStorage(
        provider,
        CANONICAL_ENTRYPOINT_V8,
        senderCreatorSlot,
        senderCreatorValue
    );
    console.log("  ✅ SenderCreator slot configured");
    
    // Initialize domain separator
    const entryPointContract = new ethers.Contract(
        CANONICAL_ENTRYPOINT_V8,
        ["function initDomainSeparator() external"],
        sponsor
    );
    await (entryPointContract.initDomainSeparator() as Promise<any>);
    console.log("  ✅ Domain separator initialized");
    console.log("");

    // ============================================
    // STEP 4: Generate JSON files with linked bytecode
    // ============================================
    console.log("📄 STEP 4: Generating JSON files with linked bytecode...");
    console.log("-".repeat(80));

    const contractsDir = join(__dirname, "../../app/lib/blockchain/contracts/");
    if (!existsSync(contractsDir)) {
        mkdirSync(contractsDir, { recursive: true });
    }
    const legacyContractsDir = join(contractsDir, "legacy");
    if (!existsSync(legacyContractsDir)) {
        mkdirSync(legacyContractsDir, { recursive: true });
    }

    // Generate JSON for each library
    const libraryNames = [
        "AccumulatorVerifier",
        "SHA256Evaluator",
        "SimpleOperationsEvaluator",
        "AES128CtrEvaluator",
        "CircuitEvaluator",
        "CommitmentOpener",
        "DisputeDeployer",
    ];

    for (const libName of libraryNames) {
        const artifact = await hre.artifacts.readArtifact(libName);
        const data = {
            abi: artifact.abi,
            bytecode: artifact.bytecode,
        };
        writeFileSync(
            join(contractsDir, `${libName}.json`),
            JSON.stringify(data, null, 2)
        );
        console.log(`  ✅ ${libName}.json generated`);
    }

    // Generate JSON for OptimisticSOXAccount with linked bytecode
    const OptimisticSOXAccountArtifact = await hre.artifacts.readArtifact("OptimisticSOXAccount");
    let optimisticBytecode = OptimisticSOXAccountArtifact.bytecode;
    
    // Replace DisputeDeployer placeholder in bytecode
    const disputeDeployerPlaceholder = "0".repeat(40); // 40 character placeholder (20 bytes)
    const disputeDeployerAddress = addresses.disputeDeployer.slice(2).toLowerCase();
    
    // Find and replace placeholder (may require multiple attempts depending on format)
    optimisticBytecode = optimisticBytecode.replace(
        new RegExp(disputeDeployerPlaceholder, "gi"),
        disputeDeployerAddress
    );
    
    // If placeholder not found, try manual linking
    // Note: Hardhat should already link, but we ensure it's correct
    const OptimisticSOXAccountFactory = await ethers.getContractFactory("OptimisticSOXAccount", {
        libraries: {
            DisputeDeployer: addresses.disputeDeployer,
        },
    });
    const linkedBytecode = OptimisticSOXAccountFactory.bytecode;
    
    const optimisticData = {
        abi: OptimisticSOXAccountArtifact.abi,
        bytecode: linkedBytecode,
    };
    writeFileSync(
        join(contractsDir, "OptimisticSOXAccount.json"),
        JSON.stringify(optimisticData, null, 2)
    );
    console.log("  ✅ OptimisticSOXAccount.json generated with linked bytecode");

    // Generate JSON for DisputeSOXAccount
    const DisputeSOXAccountArtifact = await hre.artifacts.readArtifact("DisputeSOXAccount");
    const disputeData = {
        abi: DisputeSOXAccountArtifact.abi,
        bytecode: DisputeSOXAccountArtifact.bytecode,
    };
    writeFileSync(
        join(contractsDir, "DisputeSOXAccount.json"),
        JSON.stringify(disputeData, null, 2)
    );
    console.log("  ✅ DisputeSOXAccount.json generated");

    // Generate JSON for OptimisticSOX (base, without ERC-4337) - optional
    try {
        const OptimisticSOXArtifact = await hre.artifacts.readArtifact("OptimisticSOX");
        const optimisticBaseFactory = await ethers.getContractFactory("OptimisticSOX", {
            libraries: {
                DisputeDeployer: addresses.disputeDeployer,
            },
        });
        const optimisticBaseData = {
            abi: OptimisticSOXArtifact.abi,
            bytecode: optimisticBaseFactory.bytecode,
        };
        writeFileSync(
            join(legacyContractsDir, "OptimisticSOX.json"),
            JSON.stringify(optimisticBaseData, null, 2)
        );
        console.log("  ✅ legacy/OptimisticSOX.json generated with linked bytecode");
    } catch (error) {
        console.log("  ⚠️  OptimisticSOX does not exist (ignored)");
    }

    // Generate JSON for DisputeSOX (base) - optional
    try {
        const DisputeSOXArtifact = await hre.artifacts.readArtifact("DisputeSOX");
        const disputeBaseData = {
            abi: DisputeSOXArtifact.abi,
            bytecode: DisputeSOXArtifact.bytecode,
        };
        writeFileSync(
            join(legacyContractsDir, "DisputeSOX.json"),
            JSON.stringify(disputeBaseData, null, 2)
        );
        console.log("  ✅ legacy/DisputeSOX.json generated");
    } catch (error) {
        console.log("  ⚠️  DisputeSOX does not exist (ignored)");
    }

    console.log("");

    // ============================================
    // STEP 5: Update bundler config
    // ============================================
    console.log("⚙️  STEP 5: Updating bundler config...");
    console.log("-".repeat(80));

    const bundlerConfigPath = join(__dirname, "../../../bundler-alto/config.localhost.json");
    
    if (existsSync(bundlerConfigPath)) {
        const bundlerConfig = require(bundlerConfigPath);
        bundlerConfig.entrypoints = addresses.entryPoint;
        
        writeFileSync(
            bundlerConfigPath,
            JSON.stringify(bundlerConfig, null, 2)
        );
        console.log("  ✅ Bundler config updated:", bundlerConfigPath);
        console.log("     EntryPoint:", addresses.entryPoint);
    } else {
        console.log("  ⚠️  Bundler config file not found:", bundlerConfigPath);
        console.log("     You will need to manually update the bundler config");
    }
    console.log("");

    // ============================================
    // STEP 6: Create .env.local file
    // ============================================
    console.log("🔧 STEP 6: Creating .env.local file...");
    console.log("-".repeat(80));

    const envPath = join(__dirname, "../../../.env.local");
    const envContent = `# Deployed addresses automatically generated by deployCompleteStack.ts
# Generated on: ${new Date().toISOString()}

# EntryPoint for ERC-4337 (v0.8 canonical)
NEXT_PUBLIC_ENTRY_POINT=${addresses.entryPoint}
NEXT_PUBLIC_ENTRY_POINT_V8=${addresses.entryPoint}

# RPC URL (default: localhost)
NEXT_PUBLIC_RPC_URL=http://localhost:8545

# Deployed libraries (for reference)
ACCUMULATOR_VERIFIER=${addresses.accumulatorVerifier}
SHA256_EVALUATOR=${addresses.sha256Evaluator}
SIMPLE_OPERATIONS_EVALUATOR=${addresses.simpleOperationsEvaluator}
AES128_CTR_EVALUATOR=${addresses.aes128CtrEvaluator}
CIRCUIT_EVALUATOR=${addresses.circuitEvaluator}
COMMITMENT_OPENER=${addresses.commitmentOpener}
DISPUTE_DEPLOYER=${addresses.disputeDeployer}
`;

    writeFileSync(envPath, envContent);
    console.log("  ✅ .env.local file created:", envPath);
    console.log("");

    // ============================================
    // STEP 7: Update deployed-contracts.json
    // ============================================
    console.log("📝 STEP 7: Updating deployed-contracts.json...");
    console.log("-".repeat(80));

    const deployedContractsPath = join(__dirname, "../../../deployed-contracts.json");
    const deployedContractsSrcPath = join(__dirname, "../../deployed-contracts.json");
    const network = await hre.ethers.provider.getNetwork();
    const deployedContractsData = {
        network: hre.network.name,
        chainId: Number(network.chainId),
        deployer: await sponsor.getAddress(),
        addresses: {
            AccumulatorVerifier: addresses.accumulatorVerifier,
            SHA256Evaluator: addresses.sha256Evaluator,
            SimpleOperationsEvaluator: addresses.simpleOperationsEvaluator,
            AES128CtrEvaluator: addresses.aes128CtrEvaluator,
            CircuitEvaluator: addresses.circuitEvaluator,
            CommitmentOpener: addresses.commitmentOpener,
            DisputeDeployer: addresses.disputeDeployer,
        },
        entryPoint: addresses.entryPoint,
        timestamp: new Date().toISOString(),
    };

    const jsonContent = JSON.stringify(deployedContractsData, null, 2);
    
    // Write to root (for compatibility)
    writeFileSync(deployedContractsPath, jsonContent);
    console.log("  ✅ deployed-contracts.json updated:", deployedContractsPath);
    
    // Also write to src/ (so Next.js/Turbopack can find it)
    writeFileSync(deployedContractsSrcPath, jsonContent);
    console.log("  ✅ src/deployed-contracts.json updated:", deployedContractsSrcPath);
    console.log("     DisputeDeployer:", addresses.disputeDeployer);
    console.log("");

    // ============================================
    // SUMMARY
    // ============================================
    console.log("=".repeat(80));
    console.log("✅ COMPLETE DEPLOYMENT FINISHED SUCCESSFULLY!");
    console.log("=".repeat(80));
    console.log("");
    console.log("📋 Deployed addresses:");
    console.log("");
    console.log("  Libraries:");
    console.log("    AccumulatorVerifier      :", addresses.accumulatorVerifier);
    console.log("    SHA256Evaluator          :", addresses.sha256Evaluator);
    console.log("    SimpleOperationsEvaluator:", addresses.simpleOperationsEvaluator);
    console.log("    AES128CtrEvaluator      :", addresses.aes128CtrEvaluator);
    console.log("    CircuitEvaluator        :", addresses.circuitEvaluator);
    console.log("    CommitmentOpener         :", addresses.commitmentOpener);
    console.log("");
    console.log("  Main contracts:");
    console.log("    DisputeDeployer         :", addresses.disputeDeployer);
    console.log("    EntryPoint              :", addresses.entryPoint);
    console.log("");
    console.log("📄 Generated files:");
    console.log("    Contract JSON files     : src/app/lib/blockchain/contracts/*.json");
    console.log("    Bundler config          : bundler-alto/config.localhost.json");
    console.log("    Environment variables   : .env.local");
    console.log("");
    console.log("🚀 Next steps:");
    console.log("    1. Verify that .env.local file is loaded by Next.js");
    console.log("    2. Restart the web application (npm run dev)");
    console.log("    3. Start the bundler with the new config");
    console.log("    4. Test deploying an OptimisticSOXAccount contract");
    console.log("");
    console.log("=".repeat(80));
}

main().catch((error) => {
    console.error("❌ Error during deployment:", error);
    process.exitCode = 1;
});
