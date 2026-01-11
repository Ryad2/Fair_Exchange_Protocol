import hre from "hardhat";
import { ethers } from "hardhat";
import fs from "fs";
import path from "path";
import EntryPointArtifact from "@account-abstraction/contracts/artifacts/EntryPoint.json";

function parseEntrypoints(entrypoints: unknown): string[] {
    if (!entrypoints) return [];
    if (Array.isArray(entrypoints)) {
        return entrypoints.map(String).map((value) => value.trim()).filter(Boolean);
    }
    if (typeof entrypoints === "string") {
        return entrypoints
            .split(",")
            .map((value) => value.trim())
            .filter(Boolean);
    }
    return [];
}

function formatEntrypoints(entrypoints: string[]): string {
    return entrypoints.join(",");
}

async function main() {
    const [deployer] = await ethers.getSigners();
    const provider = hre.ethers.provider;

    console.log("=".repeat(80));
    console.log("🚀 Déploiement de l'EntryPoint pour le bundler Alto");
    console.log("=".repeat(80));
    console.log("");
    console.log("Deployer:", await deployer.getAddress());

    // Lire la configuration actuelle du bundler
    const bundlerConfigPath = path.join(__dirname, "../../../bundler-alto/scripts/config.local.json");
    let bundlerConfig: any = {};
    
    try {
        const configContent = fs.readFileSync(bundlerConfigPath, "utf-8");
        bundlerConfig = JSON.parse(configContent);
        console.log("📋 Configuration actuelle du bundler:");
        console.log("   EntryPoint configuré:", bundlerConfig.entrypoints || "non défini");
        console.log("");
    } catch (error) {
        console.warn("⚠️  Impossible de lire la configuration du bundler:", error);
        console.warn("   Le fichier sera créé avec la nouvelle adresse");
    }

    // Vérifier si l'EntryPoint existe déjà à l'adresse configurée
    const existingEntrypoints = parseEntrypoints(bundlerConfig.entrypoints);
    const configuredEntryPoint = existingEntrypoints[0];
    let entryPointAddress: string;

    if (configuredEntryPoint) {
        console.log("📋 Vérification de l'EntryPoint configuré:", configuredEntryPoint);
        const existingCode = await provider.getCode(configuredEntryPoint);
        
        if (existingCode && existingCode !== "0x") {
            console.log("   ✅ EntryPoint déjà déployé à cette adresse!");
            console.log("   Code:", existingCode.length, "bytes");
            entryPointAddress = configuredEntryPoint;
        } else {
            console.log("   ⚠️  Aucun code trouvé à cette adresse");
            console.log("   Déploiement d'un nouvel EntryPoint...");
            
            const factory = new ethers.ContractFactory(
                EntryPointArtifact.abi,
                EntryPointArtifact.bytecode,
                deployer
            );
            const entryPoint = await factory.deploy();
            await entryPoint.waitForDeployment();
            entryPointAddress = await entryPoint.getAddress();
            console.log("   ✅ EntryPoint déployé à:", entryPointAddress);
        }
    } else {
        console.log("📋 Aucun EntryPoint configuré, déploiement d'un nouvel EntryPoint...");
        const factory = new ethers.ContractFactory(
            EntryPointArtifact.abi,
            EntryPointArtifact.bytecode,
            deployer
        );
        const entryPoint = await factory.deploy();
        await entryPoint.waitForDeployment();
        entryPointAddress = await entryPoint.getAddress();
        console.log("   ✅ EntryPoint déployé à:", entryPointAddress);
    }

    // Mettre à jour la configuration du bundler (préserver les autres EntryPoints)
    const mergedEntrypoints = [
        entryPointAddress,
        ...existingEntrypoints.filter(
            (value) => value.toLowerCase() !== entryPointAddress.toLowerCase()
        ),
    ];
    bundlerConfig.entrypoints = formatEntrypoints(mergedEntrypoints);
    
    try {
        fs.writeFileSync(
            bundlerConfigPath,
            JSON.stringify(bundlerConfig, null, 4) + "\n",
            "utf-8"
        );
        console.log("");
        console.log("✅ Configuration du bundler mise à jour!");
        console.log("   Fichier:", bundlerConfigPath);
        console.log("   EntryPoint:", entryPointAddress);
    } catch (error) {
        console.error("❌ Erreur lors de la mise à jour de la configuration:", error);
        console.log("");
        console.log("📋 Mise à jour manuelle requise:");
        console.log("   Modifie bundler-alto/scripts/config.local.json:");
        console.log(`   "entrypoints": "${entryPointAddress}"`);
    }

    // Mettre à jour le fichier .env.local pour Next.js
    const envLocalPath = path.join(__dirname, "../../../.env.local");
    try {
        let envContent = "";
        if (fs.existsSync(envLocalPath)) {
            envContent = fs.readFileSync(envLocalPath, "utf-8");
        }
        
        // Remplacer ou ajouter NEXT_PUBLIC_ENTRY_POINT
        if (envContent.includes("NEXT_PUBLIC_ENTRY_POINT=")) {
            envContent = envContent.replace(
                /NEXT_PUBLIC_ENTRY_POINT=.*/g,
                `NEXT_PUBLIC_ENTRY_POINT=${entryPointAddress}`
            );
        } else {
            if (envContent && !envContent.endsWith("\n")) {
                envContent += "\n";
            }
            envContent += `NEXT_PUBLIC_ENTRY_POINT=${entryPointAddress}\n`;
        }
        
        fs.writeFileSync(envLocalPath, envContent, "utf-8");
        console.log("✅ Fichier .env.local mis à jour!");
        console.log("   EntryPoint:", entryPointAddress);
        console.log("");
        console.log("📋 Prochaines étapes:");
        console.log("   1. Redémarre Next.js (si il tourne) pour charger la nouvelle variable");
        console.log("   2. Redémarre le bundler (si il tourne): Ctrl+C puis ./run-local.sh");
    } catch (error) {
        console.warn("⚠️  Impossible de mettre à jour .env.local:", error);
        console.log("");
        console.log("📋 Définis manuellement la variable d'environnement:");
        console.log(`   export NEXT_PUBLIC_ENTRY_POINT=${entryPointAddress}`);
        console.log("   Ou crée/modifie .env.local avec:");
        console.log(`   NEXT_PUBLIC_ENTRY_POINT=${entryPointAddress}`);
    }

    console.log("");
    console.log("=".repeat(80));
    console.log("✅ Déploiement terminé!");
    console.log("=".repeat(80));
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
