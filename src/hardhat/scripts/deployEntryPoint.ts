import { ethers } from "hardhat";
import fs from "fs";
import path from "path";
import EntryPointArtifact from "@account-abstraction/contracts/artifacts/EntryPoint.json";

async function main() {
    const [deployer] = await ethers.getSigners();

    console.log("Deploying EntryPoint with:", await deployer.getAddress());

    const factory = new ethers.ContractFactory(
        EntryPointArtifact.abi,
        EntryPointArtifact.bytecode,
        deployer
    );

    const entryPoint = await factory.deploy();
    await entryPoint.waitForDeployment();

    const entryPointAddress = await entryPoint.getAddress();
    console.log("EntryPoint deployed at:", entryPointAddress);

    const bundlerConfigPath = path.join(__dirname, "../../../bundler-alto/scripts/config.local.json");
    let bundlerConfig: any = {};

    try {
        const configContent = fs.readFileSync(bundlerConfigPath, "utf-8");
        bundlerConfig = JSON.parse(configContent);
    } catch (error) {
        console.warn("⚠️  Impossible de lire la configuration du bundler:", error.message);
        console.warn("   Le fichier sera créé.");
    }

    bundlerConfig.entrypoints = entryPointAddress;

    try {
        fs.writeFileSync(
            bundlerConfigPath,
            JSON.stringify(bundlerConfig, null, 4) + "\n",
            "utf-8"
        );
        console.log("✅ Config bundler mise à jour:", bundlerConfigPath);
        console.log(`   "entrypoints": "${entryPointAddress}"`);
    } catch (error) {
        console.error("❌ Erreur lors de l'écriture de config.local.json:", error.message);
    }

    const envPath = path.join(__dirname, "../../../.env.local");
    try {
        let envContent = "";
        if (fs.existsSync(envPath)) {
            envContent = fs.readFileSync(envPath, "utf-8");
        }

        const line = `NEXT_PUBLIC_ENTRY_POINT=${entryPointAddress}`;
        if (envContent.includes("NEXT_PUBLIC_ENTRY_POINT=")) {
            envContent = envContent.replace(/^NEXT_PUBLIC_ENTRY_POINT=.*$/m, line);
        } else {
            envContent = envContent.trimEnd();
            envContent = envContent.length ? `${envContent}\n${line}\n` : `${line}\n`;
        }

        fs.writeFileSync(envPath, envContent, "utf-8");
        console.log("✅ .env.local mise à jour:", envPath);
    } catch (error) {
        console.error("❌ Erreur lors de la mise à jour de .env.local:", error.message);
    }
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
