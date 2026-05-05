import { writeFileSync } from "fs";
import { ethers } from "hardhat";
import hre from "hardhat";

async function main() {
    // Utiliser les signers Hardhat au lieu de PROVIDER pour bénéficier de la config allowUnlimitedContractSize
    const [deployer] = await ethers.getSigners();

    let addresses = new Map();
    for (const lName of [
        "SHA256Evaluator",
        "SimpleOperationsEvaluator",
        "AES128CtrEvaluator",
        "AccumulatorVerifier",
        "CommitmentOpener",
        "DisputeSOXHelpers",
    ]) {
        let factory = await ethers.getContractFactory(lName);
        let lib = await factory.deploy();
        await lib.waitForDeployment();
        addresses.set(lName, await lib.getAddress());
    }

    const HardcodedSha256CircuitLibFactory = await ethers.getContractFactory(
        "HardcodedSha256CircuitLib",
        {
            libraries: {
                AccumulatorVerifier: await addresses.get("AccumulatorVerifier"),
                SHA256Evaluator: await addresses.get("SHA256Evaluator"),
            },
        }
    );
    const hardcodedSha256CircuitLib = await HardcodedSha256CircuitLibFactory.deploy();
    await hardcodedSha256CircuitLib.waitForDeployment();
    addresses.set("HardcodedSha256CircuitLib", await hardcodedSha256CircuitLib.getAddress());

    // circuit evaluator depends on some of the others
    const CircuitEvaluatorFactory = await ethers.getContractFactory(
        "CircuitEvaluator",
        {
            libraries: {
                SHA256Evaluator: await addresses.get("SHA256Evaluator"),
                SimpleOperationsEvaluator: await addresses.get(
                    "SimpleOperationsEvaluator"
                ),
                AES128CtrEvaluator: await addresses.get("AES128CtrEvaluator"),
            },
        }
    );
    const circuitEvaluator = await CircuitEvaluatorFactory.deploy();
    await circuitEvaluator.waitForDeployment();
    addresses.set("CircuitEvaluator", await circuitEvaluator.getAddress());

    // dispute deployers depend on the proof/evaluator libraries embedded in the dispute account
    const DisputeDeployerFactory = await ethers.getContractFactory(
        "DisputeDeployer",
        {
            libraries: {
                AccumulatorVerifier: await addresses.get("AccumulatorVerifier"),
                CommitmentOpener: await addresses.get("CommitmentOpener"),
                SHA256Evaluator: await addresses.get("SHA256Evaluator"),
            },
        }
    );
    let disputeDeployer = await DisputeDeployerFactory.deploy();
    await disputeDeployer.waitForDeployment();
    addresses.set("DisputeDeployer", await disputeDeployer.getAddress());

    const DisputeDeployerNormalFactory = await ethers.getContractFactory(
        "DisputeDeployerNormal",
        {
            libraries: {
                AccumulatorVerifier: await addresses.get("AccumulatorVerifier"),
                CommitmentOpener: await addresses.get("CommitmentOpener"),
                SHA256Evaluator: await addresses.get("SHA256Evaluator"),
            },
        }
    );
    let disputeDeployerNormal = await DisputeDeployerNormalFactory.deploy();
    await disputeDeployerNormal.waitForDeployment();
    addresses.set("DisputeDeployerNormal", await disputeDeployerNormal.getAddress());

    const DisputeDeployerSelfSponsoredFactory = await ethers.getContractFactory(
        "DisputeDeployerSelfSponsored",
        {
            libraries: {
                AccumulatorVerifier: await addresses.get("AccumulatorVerifier"),
                CommitmentOpener: await addresses.get("CommitmentOpener"),
                SHA256Evaluator: await addresses.get("SHA256Evaluator"),
            },
        }
    );
    let disputeDeployerSelfSponsored = await DisputeDeployerSelfSponsoredFactory.deploy();
    await disputeDeployerSelfSponsored.waitForDeployment();
    addresses.set(
        "DisputeDeployerSelfSponsored",
        await disputeDeployerSelfSponsored.getAddress()
    );

    const DisputeDeployerHardcodedSHA256Factory = await ethers.getContractFactory(
        "DisputeDeployerHardcodedSHA256",
        {
            libraries: {
                AccumulatorVerifier: await addresses.get("AccumulatorVerifier"),
                CommitmentOpener: await addresses.get("CommitmentOpener"),
                HardcodedSha256CircuitLib: await addresses.get("HardcodedSha256CircuitLib"),
            },
        }
    );
    let disputeDeployerHardcodedSHA256 = await DisputeDeployerHardcodedSHA256Factory.deploy();
    await disputeDeployerHardcodedSHA256.waitForDeployment();
    addresses.set(
        "DisputeDeployerHardcodedSHA256",
        await disputeDeployerHardcodedSHA256.getAddress()
    );

    let optimisticData = null;
    let disputeData = null;
    try {
        const optimisticFac = await ethers.getContractFactory("OptimisticSOX", {
            libraries: {
                DisputeDeployer: addresses.get("DisputeDeployer"),
            },
        });

        const optimisticArtifact = await hre.artifacts.readArtifact("OptimisticSOX");
        optimisticData = {
            abi: optimisticArtifact.abi,
            bytecode: optimisticFac.bytecode,
        };
    } catch {}

    try {
        const disputeFac = await ethers.getContractFactory("DisputeSOX", {
            libraries: {
                AccumulatorVerifier: addresses.get("AccumulatorVerifier"),
                CommitmentOpener: addresses.get("CommitmentOpener"),
                DisputeSOXHelpers: addresses.get("DisputeSOXHelpers"),
            },
        });

        const disputeArtifact = await hre.artifacts.readArtifact("DisputeSOX");
        disputeData = {
            abi: disputeArtifact.abi,
            bytecode: disputeFac.bytecode,
        };
    } catch {}

    // link libraries to OptimisticSOXAccount
    // IMPORTANT: On génère le bytecode linké avec des adresses de placeholder
    // qui seront remplacées dynamiquement lors du déploiement dans l'application web
    const optimisticAccountFac = await ethers.getContractFactory("OptimisticSOXAccount", {
        libraries: {
            DisputeDeployer: addresses.get("DisputeDeployer"),
        },
    });

    const optimisticAccountArtifact = await hre.artifacts.readArtifact(
        "OptimisticSOXAccount"
    );

    // Utiliser le bytecode linké (les adresses seront remplacées dynamiquement dans l'app web)
    const optimisticAccountData = {
        abi: optimisticAccountArtifact.abi,
        bytecode: optimisticAccountFac.bytecode, // Bytecode linké avec les adresses actuelles
    };

    const optimisticAccountNormalFac = await ethers.getContractFactory("OptimisticSOXAccountNormal", {
        libraries: {
            DisputeDeployerNormal: addresses.get("DisputeDeployerNormal"),
        },
    });
    const optimisticAccountNormalArtifact = await hre.artifacts.readArtifact(
        "OptimisticSOXAccountNormal"
    );
    const optimisticAccountNormalData = {
        abi: optimisticAccountNormalArtifact.abi,
        bytecode: optimisticAccountNormalFac.bytecode,
    };

    const optimisticAccountPhase3NoHardcodedFac = await ethers.getContractFactory(
        "OptimisticSOXAccountPhase3NoHardcoded",
        {
            libraries: {
                DisputeDeployerNormal: addresses.get("DisputeDeployerNormal"),
            },
        }
    );
    const optimisticAccountPhase3NoHardcodedArtifact = await hre.artifacts.readArtifact(
        "OptimisticSOXAccountPhase3NoHardcoded"
    );
    const optimisticAccountPhase3NoHardcodedData = {
        abi: optimisticAccountPhase3NoHardcodedArtifact.abi,
        bytecode: optimisticAccountPhase3NoHardcodedFac.bytecode,
    };

    const phase3DirectContractNames = [
        "OptimisticSOXAccountNoSDeposit",
        "OptimisticSOXAccountSponsorIsBuyer",
        "OptimisticSOXAccountSponsorIsVendor",
    ];
    const phase3DirectContractData = new Map<string, { abi: any; bytecode: string }>();
    for (const contractName of phase3DirectContractNames) {
        const artifact = await hre.artifacts.readArtifact(contractName);
        const factory = await ethers.getContractFactory(contractName, {
            libraries: {
                DisputeDeployerNormal: addresses.get("DisputeDeployerNormal"),
                DisputeDeployerSelfSponsored: addresses.get("DisputeDeployerSelfSponsored"),
            },
        });
        phase3DirectContractData.set(contractName, {
            abi: artifact.abi,
            bytecode: factory.bytecode,
        });
    }

    const cloneContractNames = [
        "OptimisticSOXCloneNormal",
        "OptimisticSOXCloneNoSDeposit",
        "OptimisticSOXCloneSponsorIsBuyer",
        "OptimisticSOXCloneSponsorIsVendor",
    ];
    const cloneContractData = new Map<string, { abi: any; bytecode: string }>();
    for (const contractName of cloneContractNames) {
        const artifact = await hre.artifacts.readArtifact(contractName);
        const factory = await ethers.getContractFactory(contractName, {
            libraries: {
                DisputeDeployerNormal: addresses.get("DisputeDeployerNormal"),
                DisputeDeployerSelfSponsored: addresses.get("DisputeDeployerSelfSponsored"),
            },
        });
        cloneContractData.set(contractName, {
            abi: artifact.abi,
            bytecode: factory.bytecode,
        });
    }

    const soxFactoryArtifact = await hre.artifacts.readArtifact("SOXFactory");
    const soxFactoryFac = await ethers.getContractFactory("SOXFactory");
    const soxFactoryData = {
        abi: soxFactoryArtifact.abi,
        bytecode: soxFactoryFac.bytecode,
    };

    const optimisticAccountHardcodedSHA256Fac = await ethers.getContractFactory(
        "OptimisticSOXAccountHardcodedSHA256",
        {
            libraries: {
                DisputeDeployerHardcodedSHA256: addresses.get("DisputeDeployerHardcodedSHA256"),
                HardcodedSha256CircuitLib: addresses.get("HardcodedSha256CircuitLib"),
            },
        }
    );
    const optimisticAccountHardcodedSHA256Artifact = await hre.artifacts.readArtifact(
        "OptimisticSOXAccountHardcodedSHA256"
    );
    const optimisticAccountHardcodedSHA256Data = {
        abi: optimisticAccountHardcodedSHA256Artifact.abi,
        bytecode: optimisticAccountHardcodedSHA256Fac.bytecode,
    };

    const disputeAccountNormalArtifact = await hre.artifacts.readArtifact(
        "DisputeSOXAccountNormal"
    );
    const disputeAccountNormalData = {
        abi: disputeAccountNormalArtifact.abi,
        bytecode: disputeAccountNormalArtifact.bytecode,
    };

    const disputeAccountSelfSponsoredArtifact = await hre.artifacts.readArtifact(
        "DisputeSOXAccountSelfSponsored"
    );
    const disputeAccountSelfSponsoredData = {
        abi: disputeAccountSelfSponsoredArtifact.abi,
        bytecode: disputeAccountSelfSponsoredArtifact.bytecode,
    };

    const disputeAccountHardcodedSHA256Artifact = await hre.artifacts.readArtifact(
        "DisputeSOXAccountHardcodedSHA256"
    );
    const disputeAccountHardcodedSHA256Fac = await ethers.getContractFactory(
        "DisputeSOXAccountHardcodedSHA256",
        {
            libraries: {
                AccumulatorVerifier: addresses.get("AccumulatorVerifier"),
                CommitmentOpener: addresses.get("CommitmentOpener"),
                HardcodedSha256CircuitLib: addresses.get("HardcodedSha256CircuitLib"),
                SHA256Evaluator: addresses.get("SHA256Evaluator"),
            },
        }
    );
    const disputeAccountHardcodedSHA256Data = {
        abi: disputeAccountHardcodedSHA256Artifact.abi,
        bytecode: disputeAccountHardcodedSHA256Fac.bytecode,
    };

    const contractsDir = "../app/lib/blockchain/contracts/";
    
    // Écrire les contrats principaux
    if (optimisticData) {
        writeFileSync(
            contractsDir + "OptimisticSOX.json",
            JSON.stringify(optimisticData)
        );
    }
    if (disputeData) {
        writeFileSync(
            contractsDir + "DisputeSOX.json",
            JSON.stringify(disputeData)
        );
    }
    writeFileSync(
        contractsDir + "OptimisticSOXAccount.json",
        JSON.stringify(optimisticAccountData)
    );
    writeFileSync(
        contractsDir + "OptimisticSOXAccountNormal.json",
        JSON.stringify(optimisticAccountNormalData)
    );
    writeFileSync(
        contractsDir + "OptimisticSOXAccountPhase3NoHardcoded.json",
        JSON.stringify(optimisticAccountPhase3NoHardcodedData)
    );
    for (const [contractName, data] of phase3DirectContractData.entries()) {
        writeFileSync(
            contractsDir + contractName + ".json",
            JSON.stringify(data)
        );
    }
    for (const [contractName, data] of cloneContractData.entries()) {
        writeFileSync(
            contractsDir + contractName + ".json",
            JSON.stringify(data)
        );
    }
    writeFileSync(
        contractsDir + "SOXFactory.json",
        JSON.stringify(soxFactoryData)
    );
    writeFileSync(
        contractsDir + "OptimisticSOXAccountHardcodedSHA256.json",
        JSON.stringify(optimisticAccountHardcodedSHA256Data)
    );
    writeFileSync(
        contractsDir + "DisputeSOXAccountNormal.json",
        JSON.stringify(disputeAccountNormalData)
    );
    writeFileSync(
        contractsDir + "DisputeSOXAccountSelfSponsored.json",
        JSON.stringify(disputeAccountSelfSponsoredData)
    );
    writeFileSync(
        contractsDir + "DisputeSOXAccountHardcodedSHA256.json",
        JSON.stringify(disputeAccountHardcodedSHA256Data)
    );

    // Écrire les libraries nécessaires pour deploy-libraries.ts
    for (const lName of [
        "SHA256Evaluator",
        "SimpleOperationsEvaluator",
        "AES128CtrEvaluator",
        "AccumulatorVerifier",
        "CommitmentOpener",
        "CircuitEvaluator",
        "DisputeSOXHelpers",
        "HardcodedSha256CircuitLib",
        "DisputeDeployer",
        "DisputeDeployerNormal",
        "DisputeDeployerSelfSponsored",
        "DisputeDeployerHardcodedSHA256",
    ]) {
        const artifact = await hre.artifacts.readArtifact(lName);
        let factory;
        
        if (lName === "CircuitEvaluator") {
            factory = await ethers.getContractFactory("CircuitEvaluator", {
                libraries: {
                    SHA256Evaluator: addresses.get("SHA256Evaluator"),
                    SimpleOperationsEvaluator: addresses.get("SimpleOperationsEvaluator"),
                    AES128CtrEvaluator: addresses.get("AES128CtrEvaluator"),
                },
            });
        } else if (lName === "DisputeDeployer") {
            factory = await ethers.getContractFactory("DisputeDeployer", {
                libraries: {
                    AccumulatorVerifier: addresses.get("AccumulatorVerifier"),
                    CommitmentOpener: addresses.get("CommitmentOpener"),
                    SHA256Evaluator: addresses.get("SHA256Evaluator"),
                },
            });
        } else if (lName === "DisputeDeployerNormal") {
            factory = await ethers.getContractFactory("DisputeDeployerNormal", {
                libraries: {
                    AccumulatorVerifier: addresses.get("AccumulatorVerifier"),
                    CommitmentOpener: addresses.get("CommitmentOpener"),
                    SHA256Evaluator: addresses.get("SHA256Evaluator"),
                },
            });
        } else if (lName === "DisputeDeployerSelfSponsored") {
            factory = await ethers.getContractFactory("DisputeDeployerSelfSponsored", {
                libraries: {
                    AccumulatorVerifier: addresses.get("AccumulatorVerifier"),
                    CommitmentOpener: addresses.get("CommitmentOpener"),
                    SHA256Evaluator: addresses.get("SHA256Evaluator"),
                },
            });
        } else if (lName === "DisputeDeployerHardcodedSHA256") {
            factory = await ethers.getContractFactory("DisputeDeployerHardcodedSHA256", {
                libraries: {
                    AccumulatorVerifier: addresses.get("AccumulatorVerifier"),
                    CommitmentOpener: addresses.get("CommitmentOpener"),
                    HardcodedSha256CircuitLib: addresses.get("HardcodedSha256CircuitLib"),
                },
            });
        } else if (lName === "HardcodedSha256CircuitLib") {
            factory = await ethers.getContractFactory("HardcodedSha256CircuitLib", {
                libraries: {
                    AccumulatorVerifier: addresses.get("AccumulatorVerifier"),
                    SHA256Evaluator: addresses.get("SHA256Evaluator"),
                },
            });
        } else if (lName === "DisputeSOXHelpers") {
            factory = await ethers.getContractFactory("DisputeSOXHelpers");
        } else {
            factory = await ethers.getContractFactory(lName);
        }
        
        const libraryData = {
            abi: artifact.abi,
            bytecode: factory.bytecode,
        };
        
        writeFileSync(
            contractsDir + lName + ".json",
            JSON.stringify(libraryData)
        );
    }

    console.log("✅ Tous les fichiers JSON ont été générés!");
    console.log("  Contrats: OptimisticSOX, DisputeSOX, OptimisticSOXAccount, OptimisticSOXAccountNormal, OptimisticSOXAccountPhase3NoHardcoded, OptimisticSOXAccountNoSDeposit, OptimisticSOXAccountSponsorIsBuyer, OptimisticSOXAccountSponsorIsVendor, OptimisticSOXAccountHardcodedSHA256, OptimisticSOXClone*, SOXFactory, DisputeSOXAccountNormal, DisputeSOXAccountSelfSponsored, DisputeSOXAccountHardcodedSHA256");
    console.log("  Libraries: SHA256Evaluator, SimpleOperationsEvaluator, AES128CtrEvaluator, AccumulatorVerifier, CommitmentOpener, CircuitEvaluator, DisputeSOXHelpers, HardcodedSha256CircuitLib, DisputeDeployer, DisputeDeployerNormal, DisputeDeployerSelfSponsored, DisputeDeployerHardcodedSHA256");
}

main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error(error);
        process.exit(1);
    });
