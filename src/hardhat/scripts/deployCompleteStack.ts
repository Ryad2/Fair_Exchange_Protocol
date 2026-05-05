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

interface DeploymentAddresses {
    accumulatorVerifier: string;
    sha256Evaluator: string;
    simpleOperationsEvaluator: string;
    aes128CtrEvaluator: string;
    circuitEvaluator: string;
    commitmentOpener: string;
    hardcodedSha256CircuitLib: string;
    disputeDeployer: string;
    disputeDeployerNormal: string;
    disputeDeployerSelfSponsored: string;
    disputeDeployerHardcodedSHA256: string;
    optimisticSOXCloneNormal: string;
    optimisticSOXCloneNoSDeposit: string;
    optimisticSOXCloneSponsorIsBuyer: string;
    optimisticSOXCloneSponsorIsVendor: string;
    soxFactory: string;
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
        hardcodedSha256CircuitLib: "",
        disputeDeployer: "",
        disputeDeployerNormal: "",
        disputeDeployerSelfSponsored: "",
        disputeDeployerHardcodedSHA256: "",
        optimisticSOXCloneNormal: "",
        optimisticSOXCloneNoSDeposit: "",
        optimisticSOXCloneSponsorIsBuyer: "",
        optimisticSOXCloneSponsorIsVendor: "",
        soxFactory: "",
        entryPoint: "",
    };

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

    const HardcodedSha256CircuitLibFactory = await ethers.getContractFactory(
        "HardcodedSha256CircuitLib",
        {
            libraries: {
                AccumulatorVerifier: addresses.accumulatorVerifier,
                SHA256Evaluator: addresses.sha256Evaluator,
            },
        }
    );
    const hardcodedSha256CircuitLib = await HardcodedSha256CircuitLibFactory.deploy();
    await hardcodedSha256CircuitLib.waitForDeployment();
    addresses.hardcodedSha256CircuitLib = await hardcodedSha256CircuitLib.getAddress();
    console.log(
        "  ✅ HardcodedSha256CircuitLib:",
        addresses.hardcodedSha256CircuitLib
    );

    console.log("");

    console.log("📦 STEP 2: Deploying dispute deployers...");
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

    const DisputeDeployerNormalFactory = await ethers.getContractFactory("DisputeDeployerNormal", {
        libraries: {
            AccumulatorVerifier: addresses.accumulatorVerifier,
            CommitmentOpener: addresses.commitmentOpener,
            SHA256Evaluator: addresses.sha256Evaluator,
        },
    });
    const disputeDeployerNormal = await DisputeDeployerNormalFactory.connect(sponsor).deploy();
    await disputeDeployerNormal.waitForDeployment();
    addresses.disputeDeployerNormal = await disputeDeployerNormal.getAddress();
    console.log("  ✅ DisputeDeployerNormal:", addresses.disputeDeployerNormal);

    const DisputeDeployerSelfSponsoredFactory = await ethers.getContractFactory("DisputeDeployerSelfSponsored", {
        libraries: {
            AccumulatorVerifier: addresses.accumulatorVerifier,
            CommitmentOpener: addresses.commitmentOpener,
            SHA256Evaluator: addresses.sha256Evaluator,
        },
    });
    const disputeDeployerSelfSponsored = await DisputeDeployerSelfSponsoredFactory.connect(sponsor).deploy();
    await disputeDeployerSelfSponsored.waitForDeployment();
    addresses.disputeDeployerSelfSponsored = await disputeDeployerSelfSponsored.getAddress();
    console.log("  ✅ DisputeDeployerSelfSponsored:", addresses.disputeDeployerSelfSponsored);

    const DisputeDeployerHardcodedSHA256Factory = await ethers.getContractFactory("DisputeDeployerHardcodedSHA256", {
        libraries: {
            AccumulatorVerifier: addresses.accumulatorVerifier,
            CommitmentOpener: addresses.commitmentOpener,
            HardcodedSha256CircuitLib: addresses.hardcodedSha256CircuitLib,
        },
    });
    const disputeDeployerHardcodedSHA256 = await DisputeDeployerHardcodedSHA256Factory.connect(sponsor).deploy();
    await disputeDeployerHardcodedSHA256.waitForDeployment();
    addresses.disputeDeployerHardcodedSHA256 = await disputeDeployerHardcodedSHA256.getAddress();
    console.log("  ✅ DisputeDeployerHardcodedSHA256:", addresses.disputeDeployerHardcodedSHA256);
    console.log("");

    console.log("🏭 STEP 2B: Deploying clone implementations and SOXFactory...");
    console.log("-".repeat(80));

    const cloneLibraries = {
        DisputeDeployerNormal: addresses.disputeDeployerNormal,
        DisputeDeployerSelfSponsored: addresses.disputeDeployerSelfSponsored,
    };

    const OptimisticSOXCloneNormalFactory = await ethers.getContractFactory("OptimisticSOXCloneNormal", {
        libraries: cloneLibraries,
    });
    const optimisticSOXCloneNormal = await OptimisticSOXCloneNormalFactory.connect(sponsor).deploy();
    await optimisticSOXCloneNormal.waitForDeployment();
    addresses.optimisticSOXCloneNormal = await optimisticSOXCloneNormal.getAddress();
    console.log("  ✅ OptimisticSOXCloneNormal:", addresses.optimisticSOXCloneNormal);

    const OptimisticSOXCloneNoSDepositFactory = await ethers.getContractFactory("OptimisticSOXCloneNoSDeposit", {
        libraries: cloneLibraries,
    });
    const optimisticSOXCloneNoSDeposit = await OptimisticSOXCloneNoSDepositFactory.connect(sponsor).deploy();
    await optimisticSOXCloneNoSDeposit.waitForDeployment();
    addresses.optimisticSOXCloneNoSDeposit = await optimisticSOXCloneNoSDeposit.getAddress();
    console.log("  ✅ OptimisticSOXCloneNoSDeposit:", addresses.optimisticSOXCloneNoSDeposit);

    const OptimisticSOXCloneSponsorIsBuyerFactory = await ethers.getContractFactory("OptimisticSOXCloneSponsorIsBuyer", {
        libraries: cloneLibraries,
    });
    const optimisticSOXCloneSponsorIsBuyer = await OptimisticSOXCloneSponsorIsBuyerFactory.connect(sponsor).deploy();
    await optimisticSOXCloneSponsorIsBuyer.waitForDeployment();
    addresses.optimisticSOXCloneSponsorIsBuyer = await optimisticSOXCloneSponsorIsBuyer.getAddress();
    console.log("  ✅ OptimisticSOXCloneSponsorIsBuyer:", addresses.optimisticSOXCloneSponsorIsBuyer);

    const OptimisticSOXCloneSponsorIsVendorFactory = await ethers.getContractFactory("OptimisticSOXCloneSponsorIsVendor", {
        libraries: cloneLibraries,
    });
    const optimisticSOXCloneSponsorIsVendor = await OptimisticSOXCloneSponsorIsVendorFactory.connect(sponsor).deploy();
    await optimisticSOXCloneSponsorIsVendor.waitForDeployment();
    addresses.optimisticSOXCloneSponsorIsVendor = await optimisticSOXCloneSponsorIsVendor.getAddress();
    console.log("  ✅ OptimisticSOXCloneSponsorIsVendor:", addresses.optimisticSOXCloneSponsorIsVendor);

    const SOXFactoryFactory = await ethers.getContractFactory("SOXFactory");
    const soxFactory = await SOXFactoryFactory.connect(sponsor).deploy(
        addresses.optimisticSOXCloneNormal,
        addresses.optimisticSOXCloneNoSDeposit,
        addresses.optimisticSOXCloneSponsorIsBuyer,
        addresses.optimisticSOXCloneSponsorIsVendor
    );
    await soxFactory.waitForDeployment();
    addresses.soxFactory = await soxFactory.getAddress();
    console.log("  ✅ SOXFactory:", addresses.soxFactory);
    console.log("");

    console.log("🔐 STEP 3: Deploying EntryPoint v0.8 (canonical)...");
    console.log("-".repeat(80));

    const provider = ethers.provider;
    
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
    
    await setCode(provider, CANONICAL_ENTRYPOINT_V8, runtimeCode);
    await setCode(provider, tempAddress, "0x");
    
    addresses.entryPoint = CANONICAL_ENTRYPOINT_V8;
    console.log("  ✅ EntryPoint v0.8 deployed at:", addresses.entryPoint);
    
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
    
    const entryPointContract = new ethers.Contract(
        CANONICAL_ENTRYPOINT_V8,
        ["function initDomainSeparator() external"],
        sponsor
    );
    await (entryPointContract.initDomainSeparator() as Promise<any>);
    console.log("  ✅ Domain separator initialized");
    console.log("");

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

    const libraryNames = [
        "AccumulatorVerifier",
        "SHA256Evaluator",
        "SimpleOperationsEvaluator",
        "AES128CtrEvaluator",
        "CircuitEvaluator",
        "CommitmentOpener",
        "HardcodedSha256CircuitLib",
        "DisputeDeployer",
        "DisputeDeployerNormal",
        "DisputeDeployerSelfSponsored",
        "DisputeDeployerHardcodedSHA256",
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

    const OptimisticSOXAccountArtifact = await hre.artifacts.readArtifact("OptimisticSOXAccount");
    let optimisticBytecode = OptimisticSOXAccountArtifact.bytecode;
    
    const disputeDeployerPlaceholder = "0".repeat(40);
    const disputeDeployerAddress = addresses.disputeDeployer.slice(2).toLowerCase();
    
    optimisticBytecode = optimisticBytecode.replace(
        new RegExp(disputeDeployerPlaceholder, "gi"),
        disputeDeployerAddress
    );
    
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

    const OptimisticSOXAccountNormalArtifact = await hre.artifacts.readArtifact("OptimisticSOXAccountNormal");
    const OptimisticSOXAccountNormalFactory = await ethers.getContractFactory("OptimisticSOXAccountNormal", {
        libraries: {
            DisputeDeployerNormal: addresses.disputeDeployerNormal,
        },
    });
    writeFileSync(
        join(contractsDir, "OptimisticSOXAccountNormal.json"),
        JSON.stringify(
            {
                abi: OptimisticSOXAccountNormalArtifact.abi,
                bytecode: OptimisticSOXAccountNormalFactory.bytecode,
            },
            null,
            2
        )
    );
    console.log("  ✅ OptimisticSOXAccountNormal.json generated with linked bytecode");

    const OptimisticSOXAccountPhase3NoHardcodedArtifact = await hre.artifacts.readArtifact("OptimisticSOXAccountPhase3NoHardcoded");
    const OptimisticSOXAccountPhase3NoHardcodedFactory = await ethers.getContractFactory("OptimisticSOXAccountPhase3NoHardcoded", {
        libraries: {
            DisputeDeployerNormal: addresses.disputeDeployerNormal,
        },
    });
    writeFileSync(
        join(contractsDir, "OptimisticSOXAccountPhase3NoHardcoded.json"),
        JSON.stringify(
            {
                abi: OptimisticSOXAccountPhase3NoHardcodedArtifact.abi,
                bytecode: OptimisticSOXAccountPhase3NoHardcodedFactory.bytecode,
            },
            null,
            2
        )
    );
    console.log("  ✅ OptimisticSOXAccountPhase3NoHardcoded.json generated with linked bytecode");

    for (const contractName of [
        "OptimisticSOXAccountNoSDeposit",
        "OptimisticSOXAccountSponsorIsBuyer",
        "OptimisticSOXAccountSponsorIsVendor",
    ]) {
        const artifact = await hre.artifacts.readArtifact(contractName);
        const factory = await ethers.getContractFactory(contractName, {
            libraries: {
                DisputeDeployerNormal: addresses.disputeDeployerNormal,
                DisputeDeployerSelfSponsored: addresses.disputeDeployerSelfSponsored,
            },
        });
        writeFileSync(
            join(contractsDir, `${contractName}.json`),
            JSON.stringify(
                {
                    abi: artifact.abi,
                    bytecode: factory.bytecode,
                },
                null,
                2
            )
        );
        console.log(`  ✅ ${contractName}.json generated with linked bytecode`);
    }

    for (const contractName of [
        "OptimisticSOXCloneNormal",
        "OptimisticSOXCloneNoSDeposit",
        "OptimisticSOXCloneSponsorIsBuyer",
        "OptimisticSOXCloneSponsorIsVendor",
    ]) {
        const artifact = await hre.artifacts.readArtifact(contractName);
        const factory = await ethers.getContractFactory(contractName, {
            libraries: {
                DisputeDeployerNormal: addresses.disputeDeployerNormal,
                DisputeDeployerSelfSponsored: addresses.disputeDeployerSelfSponsored,
            },
        });
        writeFileSync(
            join(contractsDir, `${contractName}.json`),
            JSON.stringify(
                {
                    abi: artifact.abi,
                    bytecode: factory.bytecode,
                },
                null,
                2
            )
        );
        console.log(`  ✅ ${contractName}.json generated with linked bytecode`);
    }

    const SOXFactoryArtifact = await hre.artifacts.readArtifact("SOXFactory");
    const SOXFactoryJsonFactory = await ethers.getContractFactory("SOXFactory");
    writeFileSync(
        join(contractsDir, "SOXFactory.json"),
        JSON.stringify(
            {
                abi: SOXFactoryArtifact.abi,
                bytecode: SOXFactoryJsonFactory.bytecode,
            },
            null,
            2
        )
    );
    console.log("  ✅ SOXFactory.json generated");

    const OptimisticSOXAccountHardcodedSHA256Artifact = await hre.artifacts.readArtifact("OptimisticSOXAccountHardcodedSHA256");
    const OptimisticSOXAccountHardcodedSHA256Factory = await ethers.getContractFactory("OptimisticSOXAccountHardcodedSHA256", {
        libraries: {
            DisputeDeployerHardcodedSHA256: addresses.disputeDeployerHardcodedSHA256,
            HardcodedSha256CircuitLib: addresses.hardcodedSha256CircuitLib,
        },
    });
    writeFileSync(
        join(contractsDir, "OptimisticSOXAccountHardcodedSHA256.json"),
        JSON.stringify(
            {
                abi: OptimisticSOXAccountHardcodedSHA256Artifact.abi,
                bytecode: OptimisticSOXAccountHardcodedSHA256Factory.bytecode,
            },
            null,
            2
        )
    );
    console.log("  ✅ OptimisticSOXAccountHardcodedSHA256.json generated with linked bytecode");

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

    const DisputeSOXAccountNormalArtifact = await hre.artifacts.readArtifact("DisputeSOXAccountNormal");
    writeFileSync(
        join(contractsDir, "DisputeSOXAccountNormal.json"),
        JSON.stringify(
            {
                abi: DisputeSOXAccountNormalArtifact.abi,
                bytecode: DisputeSOXAccountNormalArtifact.bytecode,
            },
            null,
            2
        )
    );
    console.log("  ✅ DisputeSOXAccountNormal.json generated");

    const DisputeSOXAccountSelfSponsoredArtifact = await hre.artifacts.readArtifact("DisputeSOXAccountSelfSponsored");
    writeFileSync(
        join(contractsDir, "DisputeSOXAccountSelfSponsored.json"),
        JSON.stringify(
            {
                abi: DisputeSOXAccountSelfSponsoredArtifact.abi,
                bytecode: DisputeSOXAccountSelfSponsoredArtifact.bytecode,
            },
            null,
            2
        )
    );
    console.log("  ✅ DisputeSOXAccountSelfSponsored.json generated");

    const DisputeSOXAccountHardcodedSHA256Artifact = await hre.artifacts.readArtifact("DisputeSOXAccountHardcodedSHA256");
    writeFileSync(
        join(contractsDir, "DisputeSOXAccountHardcodedSHA256.json"),
        JSON.stringify(
            {
                abi: DisputeSOXAccountHardcodedSHA256Artifact.abi,
                bytecode: DisputeSOXAccountHardcodedSHA256Artifact.bytecode,
            },
            null,
            2
        )
    );
    console.log("  ✅ DisputeSOXAccountHardcodedSHA256.json generated");

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
DISPUTE_DEPLOYER_NORMAL=${addresses.disputeDeployerNormal}
DISPUTE_DEPLOYER_SELF_SPONSORED=${addresses.disputeDeployerSelfSponsored}
DISPUTE_DEPLOYER_HARDCODED_SHA256=${addresses.disputeDeployerHardcodedSHA256}
SOX_FACTORY=${addresses.soxFactory}
`;

    writeFileSync(envPath, envContent);
    console.log("  ✅ .env.local file created:", envPath);
    console.log("");

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
            HardcodedSha256CircuitLib: addresses.hardcodedSha256CircuitLib,
            DisputeDeployer: addresses.disputeDeployer,
            DisputeDeployerNormal: addresses.disputeDeployerNormal,
            DisputeDeployerSelfSponsored: addresses.disputeDeployerSelfSponsored,
            DisputeDeployerHardcodedSHA256: addresses.disputeDeployerHardcodedSHA256,
            OptimisticSOXCloneNormal: addresses.optimisticSOXCloneNormal,
            OptimisticSOXCloneNoSDeposit: addresses.optimisticSOXCloneNoSDeposit,
            OptimisticSOXCloneSponsorIsBuyer: addresses.optimisticSOXCloneSponsorIsBuyer,
            OptimisticSOXCloneSponsorIsVendor: addresses.optimisticSOXCloneSponsorIsVendor,
            SOXFactory: addresses.soxFactory,
        },
        entryPoint: addresses.entryPoint,
        timestamp: new Date().toISOString(),
    };

    const jsonContent = JSON.stringify(deployedContractsData, null, 2);
    
    writeFileSync(deployedContractsPath, jsonContent);
    console.log("  ✅ deployed-contracts.json updated:", deployedContractsPath);
    
    writeFileSync(deployedContractsSrcPath, jsonContent);
    console.log("  ✅ src/deployed-contracts.json updated:", deployedContractsSrcPath);
    console.log("     DisputeDeployer:", addresses.disputeDeployer);
    console.log("     DisputeDeployerNormal:", addresses.disputeDeployerNormal);
    console.log("     DisputeDeployerSelfSponsored:", addresses.disputeDeployerSelfSponsored);
    console.log("     DisputeDeployerHardcodedSHA256:", addresses.disputeDeployerHardcodedSHA256);
    console.log("     SOXFactory:", addresses.soxFactory);
    console.log("     HardcodedSha256CircuitLib:", addresses.hardcodedSha256CircuitLib);
    console.log("");

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
    console.log("    HardcodedSha256CircuitLib:", addresses.hardcodedSha256CircuitLib);
    console.log("");
    console.log("  Main contracts:");
    console.log("    DisputeDeployer         :", addresses.disputeDeployer);
    console.log("    DisputeDeployerNormal   :", addresses.disputeDeployerNormal);
    console.log("    DisputeDeployerSelfSponsored:", addresses.disputeDeployerSelfSponsored);
    console.log("    DisputeDeployerHardcodedSHA256:", addresses.disputeDeployerHardcodedSHA256);
    console.log("    SOXFactory              :", addresses.soxFactory);
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
