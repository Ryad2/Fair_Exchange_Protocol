import { ethers } from "hardhat";
import fs from "fs";
import path from "path";

/**
 * Script simple pour déployer EntryPoint v0.7 en utilisant le script localDeployer du bundler
 * OU utiliser l'adresse déterministe standard
 */
async function main() {
    const [deployer] = await ethers.getSigners();
    const provider = ethers.provider;

    console.log("=".repeat(80));
    console.log("🚀 DÉPLOIEMENT/UTILISATION ENTRYPOINT V0.7");
    console.log("=".repeat(80));
    console.log("");
    console.log("Deployer:", await deployer.getAddress());
    console.log("");

    // Adresse déterministe standard pour EntryPoint v0.7
    const ENTRY_POINT_V07_DETERMINISTIC = "0x0000000071727De22E5E9d8BAf0edAc6f37da032";
    
    console.log("📋 Vérification de l'EntryPoint v0.7 déterministe...");
    console.log("   Adresse:", ENTRY_POINT_V07_DETERMINISTIC);
    
    const existingCode = await provider.getCode(ENTRY_POINT_V07_DETERMINISTIC);
    
    if (existingCode && existingCode !== "0x" && existingCode.length > 100) {
        console.log("   ✅ EntryPoint v0.7 déjà déployé à cette adresse!");
        console.log("   Code length:", existingCode.length, "bytes");
        
        // Vérifier que c'est bien un EntryPoint v0.7
        try {
            const entryPointAbi = ["function depositTo(address) payable", "function balanceOf(address) view returns (uint256)"];
            const entryPoint = new ethers.Contract(ENTRY_POINT_V07_DETERMINISTIC, entryPointAbi, provider);
            const testBalance = await entryPoint.balanceOf(ethers.ZeroAddress);
            console.log("   ✅ Vérification: EntryPoint répond correctement");
        } catch (error: any) {
            console.error("   ❌ L'adresse n'est pas un EntryPoint valide:", error.message);
            process.exit(1);
        }
        
        console.log("");
        console.log("💡 Utilisez cette adresse:", ENTRY_POINT_V07_DETERMINISTIC);
        
        // Mettre à jour la configuration
        updateConfig(ENTRY_POINT_V07_DETERMINISTIC);
        return;
    }

    console.log("   ⚠️  EntryPoint v0.7 non trouvé à l'adresse déterministe");
    console.log("");
    console.log("💡 Solution: Utilisez le script du bundler pour déployer EntryPoint v0.7:");
    console.log("   cd bundler-alto && pnpm install && pnpm build");
    console.log("   cd scripts/localDeployer && pnpm tsx index.ts");
    console.log("");
    console.log("   OU utilisez directement l'adresse standard qui devrait être déployée");
    console.log("   sur la plupart des réseaux de test: 0x0000000071727De22E5E9d8BAf0edAc6f37da032");
    console.log("");
    
    // Mettre à jour quand même avec l'adresse déterministe (le bundler peut la déployer)
    updateConfig(ENTRY_POINT_V07_DETERMINISTIC);
    console.log("⚠️  La configuration a été mise à jour, mais l'EntryPoint doit être déployé!");
}

function updateConfig(entryPointAddress: string) {
    // Mettre à jour la configuration du bundler
    const bundlerConfigPath = path.join(
        __dirname,
        "../../../bundler-alto/scripts/config.local.json"
    );
    let bundlerConfig: any = {};

    try {
        const configContent = fs.readFileSync(bundlerConfigPath, "utf-8");
        bundlerConfig = JSON.parse(configContent);
    } catch (error: any) {
        console.warn("⚠️  Impossible de lire la configuration du bundler:", error.message);
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
    } catch (error: any) {
        console.error("❌ Erreur lors de l'écriture de config.local.json:", error.message);
    }

    // Mettre à jour .env.local
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
    } catch (error: any) {
        console.error("❌ Erreur lors de la mise à jour de .env.local:", error.message);
    }
}

main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error(error);
        process.exitCode = 1;
    });





