import hre from "hardhat";
import { ethers } from "hardhat";
import { Wallet } from "ethers";

async function main() {
    const contractAddr = process.argv[2];
    const sponsorPrivateKey = process.argv[3];
    const entryPointSim = process.env.NEXT_PUBLIC_ENTRY_POINT_SIM;
    
    if (!contractAddr || !sponsorPrivateKey) {
        console.error("Usage: NEXT_PUBLIC_ENTRY_POINT_SIM=<address> npx hardhat run scripts/setEntryPointSim.ts --network localhost <contractAddress> <sponsorPrivateKey>");
        process.exit(1);
    }
    
    if (!entryPointSim) {
        console.error("❌ NEXT_PUBLIC_ENTRY_POINT_SIM n'est pas défini dans l'environnement!");
        console.error("   Définissez-le dans .env.local ou exportez-le avant d'exécuter le script.");
        process.exit(1);
    }
    
    const provider = hre.ethers.provider;
    const sponsorWallet = new Wallet(sponsorPrivateKey, provider);
    const sponsorAddress = await sponsorWallet.getAddress();
    
    console.log("=".repeat(80));
    console.log("🔧 Configuration d'EntryPointSim");
    console.log("=".repeat(80));
    console.log("");
    console.log("Contract address:", contractAddr);
    console.log("Sponsor address:", sponsorAddress);
    console.log("EntryPointSim:", entryPointSim);
    console.log("");
    
    const accountAbi = [
        "function sponsor() view returns (address)",
        "function entryPointSim() view returns (address)",
        "function setEntryPointSim(address) external"
    ];
    
    const contract = new ethers.Contract(contractAddr, accountAbi, sponsorWallet);
    
    try {
        // Vérifier que le wallet correspond au sponsor
        const contractSponsor = await contract.sponsor();
        if (contractSponsor.toLowerCase() !== sponsorAddress.toLowerCase()) {
            console.error("❌ Le wallet ne correspond pas au sponsor du contrat!");
            console.error("   Contrat sponsor:", contractSponsor);
            console.error("   Wallet address:", sponsorAddress);
            process.exit(1);
        }
        console.log("✅ Le wallet correspond au sponsor");
        
        // Vérifier l'état actuel
        let currentEntryPointSim: string;
        try {
            currentEntryPointSim = await contract.entryPointSim();
        } catch (e) {
            console.error("❌ Le contrat n'a pas la fonction entryPointSim()");
            console.error("   Le contrat est probablement une ancienne version qui ne supporte pas EntryPointSim.");
            process.exit(1);
        }
        
        console.log("   EntryPointSim actuel:", currentEntryPointSim === "0x0000000000000000000000000000000000000000" ? "Non configuré" : currentEntryPointSim);
        
        if (currentEntryPointSim.toLowerCase() === entryPointSim.toLowerCase()) {
            console.log("✅ EntryPointSim est déjà configuré avec cette valeur!");
            return;
        }
        
        // Configurer EntryPointSim
        console.log("");
        console.log("🔄 Configuration d'EntryPointSim...");
        const tx = await contract.setEntryPointSim(entryPointSim);
        console.log("   Transaction envoyée, hash:", tx.hash);
        console.log("   Attente de la confirmation...");
        await tx.wait();
        console.log("✅ EntryPointSim configuré avec succès!");
        
        // Vérifier
        const updatedEntryPointSim = await contract.entryPointSim();
        if (updatedEntryPointSim.toLowerCase() === entryPointSim.toLowerCase()) {
            console.log("✅ Vérification: EntryPointSim =", updatedEntryPointSim);
        } else {
            console.error("❌ Erreur: EntryPointSim n'a pas été mis à jour correctement!");
            console.error("   Attendu:", entryPointSim);
            console.error("   Reçu:", updatedEntryPointSim);
        }
    } catch (error: any) {
        console.error("❌ Erreur:", error.message);
        if (error.message?.includes("Only sponsor")) {
            console.error("   Le wallet doit être le sponsor du contrat.");
        }
        process.exit(1);
    }
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});












