import hre from "hardhat";
import { ethers, Contract } from "ethers";

async function main() {
    console.log("=".repeat(80));
    console.log("🔍 RECHERCHE DES CONTRATS OptimisticSOXAccount DÉPLOYÉS");
    console.log("=".repeat(80));
    console.log("");

    const provider = hre.ethers.provider;
    const [deployer] = await ethers.getSigners();
    
    console.log("Compte déployeur:", await deployer.getAddress());
    console.log("");

    // Adresses connues à vérifier (peut être étendu)
    const addressesToCheck: string[] = [
        // Ajoute ici les adresses que tu veux vérifier
        "0xB377a2EeD7566Ac9fCb0BA673604F9BF875e2Bab", // L'adresse que tu as mentionnée
    ];

    // Vérifier les adresses spécifiées
    console.log("📋 Vérification des adresses spécifiées:");
    for (const addr of addressesToCheck) {
        const code = await provider.getCode(addr);
        if (code && code !== "0x") {
            console.log(`   ✅ ${addr}: DÉPLOYÉ (${code.length} bytes)`);
            
            // Essayer de lire les propriétés du contrat
            try {
                const accountAbi = [
                    "function nonce() view returns (uint256)",
                    "function vendorSigner() view returns (address)",
                    "function vendor() view returns (address)",
                    "function buyer() view returns (address)",
                    "function sponsor() view returns (address)",
                ];
                const contract = new Contract(addr, accountAbi, provider);
                const nonce = await contract.nonce();
                const vendorSigner = await contract.vendorSigner();
                const vendor = await contract.vendor();
                const buyer = await contract.buyer();
                const sponsor = await contract.sponsor();
                
                console.log(`      Nonce: ${nonce}`);
                console.log(`      VendorSigner: ${vendorSigner}`);
                console.log(`      Vendor: ${vendor}`);
                console.log(`      Buyer: ${buyer}`);
                console.log(`      Sponsor: ${sponsor}`);
            } catch (e: any) {
                console.log(`      ⚠️  Impossible de lire les propriétés: ${e.message}`);
            }
        } else {
            console.log(`   ❌ ${addr}: NON DÉPLOYÉ`);
        }
    }
    console.log("");

    // Note: Il n'y a pas de moyen facile de lister tous les contrats déployés sur Hardhat
    // car Hardhat ne garde pas de registre centralisé
    console.log("💡 Pour trouver les contrats déployés:");
    console.log("   1. Vérifie les logs de déploiement dans la console");
    console.log("   2. Vérifie la base de données SQLite (si utilisée)");
    console.log("   3. Vérifie les transactions récentes sur Hardhat node");
    console.log("   4. Utilise l'interface web pour voir les contrats déployés");
    console.log("");

    // Vérifier les transactions récentes du déployeur
    console.log("📋 Transactions récentes du déployeur:");
    try {
        const blockNumber = await provider.getBlockNumber();
        console.log(`   Bloc actuel: ${blockNumber}`);
        console.log(`   Vérification des blocs ${Math.max(0, blockNumber - 10)} à ${blockNumber}...`);
        
        let foundContracts = 0;
        for (let i = Math.max(0, blockNumber - 10); i <= blockNumber; i++) {
            const block = await provider.getBlock(i, true);
            if (block && block.transactions) {
                for (const txHash of block.transactions) {
                    if (typeof txHash === "string") {
                        const tx = await provider.getTransaction(txHash);
                        if (tx && tx.to === null && tx.from.toLowerCase() === (await deployer.getAddress()).toLowerCase()) {
                            // Transaction de déploiement
                            const receipt = await provider.getTransactionReceipt(txHash);
                            if (receipt && receipt.contractAddress) {
                                const contractCode = await provider.getCode(receipt.contractAddress);
                                if (contractCode && contractCode !== "0x") {
                                    console.log(`   ✅ Contrat trouvé: ${receipt.contractAddress} (bloc ${i})`);
                                    foundContracts++;
                                    
                                    // Vérifier si c'est un OptimisticSOXAccount
                                    try {
                                        const accountAbi = ["function vendorSigner() view returns (address)"];
                                        const contract = new Contract(receipt.contractAddress, accountAbi, provider);
                                        await contract.vendorSigner();
                                        console.log(`      → C'est un OptimisticSOXAccount!`);
                                    } catch (e) {
                                        // Pas un OptimisticSOXAccount
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
        
        if (foundContracts === 0) {
            console.log("   Aucun contrat trouvé dans les 10 derniers blocs");
            console.log("   💡 Essaie d'augmenter la plage de blocs ou vérifie les logs de déploiement");
        }
    } catch (error: any) {
        console.error("   ❌ Erreur lors de la vérification:", error.message);
    }
    console.log("");

    console.log("=".repeat(80));
    console.log("✅ Recherche terminée");
    console.log("=".repeat(80));
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});













