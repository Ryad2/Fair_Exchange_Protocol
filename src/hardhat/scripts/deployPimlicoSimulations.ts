import { ethers } from "hardhat";
import fs from "fs";
import path from "path";

function updateBundlerConfig(configPath: string, address: string) {
    let bundlerConfig: any = {};
    try {
        const configContent = fs.readFileSync(configPath, "utf-8");
        bundlerConfig = JSON.parse(configContent);
    } catch (error: any) {
        console.warn("⚠️  Impossible de lire la configuration du bundler:", error.message);
        console.warn("   Le fichier sera créé.");
    }

    bundlerConfig["pimlico-simulation-contract"] = address;

    try {
        fs.writeFileSync(
            configPath,
            JSON.stringify(bundlerConfig, null, 4) + "\n",
            "utf-8"
        );
        console.log("✅ Config bundler mise à jour:", configPath);
        console.log(`   "pimlico-simulation-contract": "${address}"`);
    } catch (error: any) {
        console.error("❌ Erreur lors de l'écriture de config.local.json:", error.message);
    }
}

async function main() {
    const [deployer] = await ethers.getSigners();
    console.log("Deploying PimlicoSimulations with:", await deployer.getAddress());
    
    // Lire le bytecode depuis le JSON compilé d'Alto
    const altoContractsPath = path.join(__dirname, "../../../bundler-alto/src/esm/contracts");
    const pimlicoSimulationsJsonPath = path.join(
        altoContractsPath,
        "PimlicoSimulations.sol/PimlicoSimulations.json"
    );
    
    let bytecode: string;
    let abi: any[];
    
    try {
        // Essayer de lire depuis le build d'Alto
        const json = JSON.parse(fs.readFileSync(pimlicoSimulationsJsonPath, "utf-8"));
        bytecode = json.bytecode.object;
        abi = json.abi;
        console.log("✅ Found compiled contract from Alto");
    } catch (e) {
        console.log("⚠️  Could not find Alto build, trying alternative path...");
        // Essayer un autre chemin
        const altPath = path.join(__dirname, "../../../bundler-alto/src/contracts/PimlicoSimulations.sol/PimlicoSimulations.json");
        try {
            const json = JSON.parse(fs.readFileSync(altPath, "utf-8"));
            bytecode = json.bytecode.object;
            abi = json.abi;
            console.log("✅ Found compiled contract from Alto (alternative path)");
        } catch (e2) {
            throw new Error("Please build Alto contracts first: cd bundler-alto && pnpm run build:all");
        }
    }
    
    // Déployer le contrat
    const factory = new ethers.ContractFactory(abi, bytecode, deployer);
    const contract = await factory.deploy();
    await contract.waitForDeployment();

    const address = await contract.getAddress();
    console.log("✅ PimlicoSimulations deployed at:", address);

    const bundlerConfigPath = path.join(
        __dirname,
        "../../../bundler-alto/scripts/config.local.json"
    );
    updateBundlerConfig(bundlerConfigPath, address);
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});












