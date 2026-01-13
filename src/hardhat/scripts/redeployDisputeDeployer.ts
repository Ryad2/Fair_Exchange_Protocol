import hre from "hardhat";
import { ethers } from "hardhat";
import { writeFileSync, readFileSync, existsSync } from "fs";
import { join } from "path";

/**
 * Script to redeploy DisputeDeployer with the new DisputeSOXAccount bytecode.
 * 
 * IMPORTANT: After fixing DisputeSOXAccount, DisputeDeployer must be redeployed
 * because it contains the DisputeSOXAccount bytecode via "new DisputeSOXAccount(...)".
 * 
 * This script:
 * 1. Compiles contracts (to ensure DisputeSOXAccount is up to date)
 * 2. Deploys necessary libraries
 * 3. Deploys DisputeDeployer (which contains the new DisputeSOXAccount bytecode)
 * 4. Generates/updates JSON files for the application
 */

async function main() {
    const { ethers } = hre;
    const [sponsor] = await ethers.getSigners();
    
    console.log("🔄 Redeploying DisputeDeployer with new bytecode...");
    console.log("=".repeat(80));
    
    // STEP 1: Compilation
    console.log("\n📦 STEP 1: Compiling contracts...");
    await hre.run("compile");
    console.log("  ✅ Compilation completed\n");
    
    // STEP 2: Deploy necessary libraries
    console.log("📦 STEP 2: Deploying libraries...");
    
    const AccumulatorVerifierFactory = await ethers.getContractFactory("AccumulatorVerifier");
    const accumulatorVerifier = await AccumulatorVerifierFactory.deploy();
    await accumulatorVerifier.waitForDeployment();
    const accumulatorVerifierAddr = await accumulatorVerifier.getAddress();
    console.log("  ✅ AccumulatorVerifier:", accumulatorVerifierAddr);
    
    const SHA256EvaluatorFactory = await ethers.getContractFactory("SHA256Evaluator");
    const sha256Evaluator = await SHA256EvaluatorFactory.deploy();
    await sha256Evaluator.waitForDeployment();
    const sha256EvaluatorAddr = await sha256Evaluator.getAddress();
    console.log("  ✅ SHA256Evaluator:", sha256EvaluatorAddr);
    
    const CommitmentOpenerFactory = await ethers.getContractFactory("CommitmentOpener");
    const commitmentOpener = await CommitmentOpenerFactory.deploy();
    await commitmentOpener.waitForDeployment();
    const commitmentOpenerAddr = await commitmentOpener.getAddress();
    console.log("  ✅ CommitmentOpener:", commitmentOpenerAddr);
    
    // STEP 3: Deploy DisputeDeployer (CRITICAL)
    console.log("\n🚀 STEP 3: Deploying DisputeDeployer with new bytecode...");
    const DisputeDeployerFactory = await ethers.getContractFactory("DisputeDeployer", {
        libraries: {
            AccumulatorVerifier: accumulatorVerifierAddr,
            CommitmentOpener: commitmentOpenerAddr,
            SHA256Evaluator: sha256EvaluatorAddr,
        },
    });
    const disputeDeployer = await DisputeDeployerFactory.connect(sponsor).deploy();
    await disputeDeployer.waitForDeployment();
    const disputeDeployerAddr = await disputeDeployer.getAddress();
    console.log("  ✅ DisputeDeployer deployed at:", disputeDeployerAddr);
    console.log("  ⚠️  IMPORTANT: This DisputeDeployer contains the NEW DisputeSOXAccount bytecode");
    
    // STEP 4: Generate/update JSON files
    console.log("\n📄 STEP 4: Generating JSON files for the application...");
    const contractsDir = join(__dirname, "../../app/lib/blockchain/contracts/");
    
    // Generate DisputeDeployer.json
    const DisputeDeployerArtifact = await hre.artifacts.readArtifact("DisputeDeployer");
    const disputeDeployerData = {
        abi: DisputeDeployerArtifact.abi,
        bytecode: DisputeDeployerArtifact.bytecode,
    };
    writeFileSync(
        join(contractsDir, "DisputeDeployer.json"),
        JSON.stringify(disputeDeployerData, null, 2)
    );
    console.log("  ✅ DisputeDeployer.json generated");
    
    // Generate OptimisticSOXAccount.json with new DisputeDeployer linked
    const OptimisticSOXAccountFactory = await ethers.getContractFactory("OptimisticSOXAccount", {
        libraries: {
            DisputeDeployer: disputeDeployerAddr,
        },
    });
    const OptimisticSOXAccountArtifact = await hre.artifacts.readArtifact("OptimisticSOXAccount");
    const optimisticData = {
        abi: OptimisticSOXAccountArtifact.abi,
        bytecode: OptimisticSOXAccountFactory.bytecode, // Linked bytecode with new DisputeDeployer
    };
    writeFileSync(
        join(contractsDir, "OptimisticSOXAccount.json"),
        JSON.stringify(optimisticData, null, 2)
    );
    console.log("  ✅ OptimisticSOXAccount.json generated with new DisputeDeployer");
    
    // STEP 5: Update deployed-contracts.json
    console.log("\n📝 STEP 5: Updating deployed-contracts.json...");
    const deployedContractsPath = join(__dirname, "../../../deployed-contracts.json");
    
    let deployedContracts: any = {};
    if (existsSync(deployedContractsPath)) {
        deployedContracts = JSON.parse(readFileSync(deployedContractsPath, "utf-8"));
    }
    
    const network = await hre.ethers.provider.getNetwork();
    if (!deployedContracts.addresses) {
        deployedContracts.addresses = {};
    }
    
    // Update only DisputeDeployer (other libraries remain unchanged)
    deployedContracts.addresses.DisputeDeployer = disputeDeployerAddr;
    deployedContracts.network = hre.network.name;
    deployedContracts.chainId = Number(network.chainId);
    deployedContracts.deployer = await sponsor.getAddress();
    deployedContracts.timestamp = new Date().toISOString();
    
    writeFileSync(
        deployedContractsPath,
        JSON.stringify(deployedContracts, null, 2)
    );
    console.log("  ✅ deployed-contracts.json updated:", deployedContractsPath);
    console.log("     DisputeDeployer:", disputeDeployerAddr);
    
    console.log("\n" + "=".repeat(80));
    console.log("✅ REDEPLOYMENT COMPLETED!");
    console.log("=".repeat(80));
    console.log("\n📋 Summary:");
    console.log(`  - DisputeDeployer: ${disputeDeployerAddr}`);
    console.log(`  - JSON files updated in: ${contractsDir}`);
    console.log(`  - deployed-contracts.json updated: ${deployedContractsPath}`);
    console.log("\n⚠️  IMPORTANT:");
    console.log("  1. New contracts created via this DisputeDeployer will use the NEW bytecode");
    console.log("  2. Already deployed contracts CANNOT be updated (immutable)");
    console.log("  3. You must create a NEW OptimisticSOXAccount to test with the fix");
    console.log("  4. Restart the application to use the new DisputeDeployer");
    console.log("");
}

main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error(error);
        process.exit(1);
    });
