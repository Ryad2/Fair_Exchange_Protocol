import hre from "hardhat";
import { ethers } from "hardhat";
import { Wallet } from "ethers";

async function main() {
    // Hardhat passe les arguments différemment, utiliser les variables d'environnement ou les arguments après le script
    const args = process.argv.slice(process.argv.indexOf(__filename) + 1);
    const contractAddr = args[0] || process.env.CONTRACT_ADDRESS;
    const vendorPrivateKey = args[1] || process.env.VENDOR_PRIVATE_KEY;
    
    if (!contractAddr || !vendorPrivateKey) {
        console.error("Usage:");
        console.error("  CONTRACT_ADDRESS=<addr> VENDOR_PRIVATE_KEY=<key> npx hardhat run scripts/diagnoseAccount.ts --network localhost");
        console.error("  ou");
        console.error("  npx hardhat run scripts/diagnoseAccount.ts --network localhost <contractAddress> <vendorPrivateKey>");
        console.error("");
        console.error("Exemple:");
        console.error("  npx hardhat run scripts/diagnoseAccount.ts --network localhost 0x610178da211fef7d417bc0e6fed39f05609ad788 0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d");
        process.exit(1);
    }
    
    const provider = hre.ethers.provider;
    const vendorWallet = new Wallet(vendorPrivateKey, provider);
    const vendorAddress = await vendorWallet.getAddress();
    
    console.log("=".repeat(80));
    console.log("🔍 Diagnostic complet du contrat OptimisticSOXAccount");
    console.log("=".repeat(80));
    console.log("");
    console.log("Contract address:", contractAddr);
    console.log("Vendor wallet address:", vendorAddress);
    console.log("");
    
    // Charger le contrat avec toutes les fonctions nécessaires
    const accountAbi = [
        "function vendor() view returns (address)",
        "function buyer() view returns (address)",
        "function sponsor() view returns (address)",
        "function vendorSigner() view returns (address)",
        "function entryPointSim() view returns (address)",
        "function nonce() view returns (uint256)",
        "function sessionKeys(address) view returns (bool)",
        "function getAccountInfo() view returns (address, address, uint256, address, address, address)",
        "function getDeposit() view returns (uint256)"
    ];
    
    const contract = new ethers.Contract(contractAddr, accountAbi, provider);
    
    try {
        // Vérifier si le contrat existe
        const code = await provider.getCode(contractAddr);
        if (!code || code === "0x") {
            console.error("❌ Le contrat n'existe pas à cette adresse!");
            process.exit(1);
        }
        console.log("✅ Contrat trouvé (code:", code.length, "bytes)");
        console.log("");
        
        // Récupérer toutes les informations
        let vendor, buyer, sponsor, vendorSigner, entryPointSim, nonce, deposit;
        let getAccountInfoResult: any = null;
        
        try {
            getAccountInfoResult = await contract.getAccountInfo();
            vendorSigner = getAccountInfoResult[0];
            entryPointSim = getAccountInfoResult[1];
            nonce = getAccountInfoResult[2];
            vendor = getAccountInfoResult[3];
            buyer = getAccountInfoResult[4];
            sponsor = getAccountInfoResult[5];
        } catch (e) {
            // Si getAccountInfo n'existe pas, récupérer individuellement
            vendor = await contract.vendor();
            buyer = await contract.buyer();
            sponsor = await contract.sponsor();
            vendorSigner = await contract.vendorSigner();
            try {
                entryPointSim = await contract.entryPointSim();
            } catch (e2) {
                entryPointSim = "0x0000000000000000000000000000000000000000";
            }
            nonce = await contract.nonce();
        }
        
        deposit = await contract.getDeposit();
        const isSessionKey = await contract.sessionKeys(vendorAddress);
        
        console.log("📋 État du contrat:");
        console.log("   vendor:", vendor);
        console.log("   buyer:", buyer);
        console.log("   sponsor:", sponsor);
        console.log("   vendorSigner:", vendorSigner);
        console.log("   entryPointSim:", entryPointSim === "0x0000000000000000000000000000000000000000" ? "Non configuré" : entryPointSim);
        console.log("   nonce:", nonce.toString());
        console.log("   EntryPoint deposit:", ethers.formatEther(deposit), "ETH");
        console.log("");
        
        console.log("🔍 Vérifications:");
        const vendorMatch = vendorAddress.toLowerCase() === vendor.toLowerCase();
        const vendorSignerMatch = vendorAddress.toLowerCase() === vendorSigner.toLowerCase();
        const entryPointSimConfigured = entryPointSim && entryPointSim !== "0x0000000000000000000000000000000000000000";
        
        console.log("   ✅ Vendor correspond?", vendorMatch);
        console.log("   ✅ VendorSigner correspond?", vendorSignerMatch);
        console.log("   ✅ Wallet est une session key?", isSessionKey);
        console.log("   ✅ EntryPointSim configuré?", entryPointSimConfigured);
        console.log("");
        
        // Vérifier ENTRY_POINT_SIM depuis l'environnement
        const ENTRY_POINT_SIM = process.env.NEXT_PUBLIC_ENTRY_POINT_SIM;
        console.log("📋 Configuration environnement:");
        console.log("   NEXT_PUBLIC_ENTRY_POINT_SIM:", ENTRY_POINT_SIM || "Non défini");
        console.log("");
        
        // Diagnostic
        let hasIssues = false;
        
        if (!vendorMatch) {
            console.error("❌ PROBLÈME: Le wallet ne correspond pas au vendor du contrat!");
            hasIssues = true;
        }
        
        if (!vendorSignerMatch && !isSessionKey) {
            console.error("❌ PROBLÈME: Le wallet ne correspond ni au vendorSigner ni à une session key autorisée!");
            hasIssues = true;
        }
        
        if (ENTRY_POINT_SIM && !entryPointSimConfigured) {
            console.error("❌ PROBLÈME: EntryPointSim n'est pas configuré dans le contrat!");
            console.error("   NEXT_PUBLIC_ENTRY_POINT_SIM est défini mais le contrat ne l'a pas configuré.");
            console.error("");
            console.error("💡 Solution: Configurez EntryPointSim avec:");
            console.error(`   npx hardhat run scripts/setEntryPointSim.ts --network localhost ${contractAddr} <sponsorPrivateKey>`);
            hasIssues = true;
        }
        
        if (parseInt(deposit.toString()) === 0) {
            console.warn("⚠️ ATTENTION: Le dépôt EntryPoint est à 0!");
            console.warn("   Le contrat pourrait ne pas avoir assez de fonds pour payer le gas.");
        }
        
        if (!hasIssues) {
            console.log("✅ Toutes les vérifications sont OK!");
            console.log("");
            console.log("💡 Si vous rencontrez toujours des erreurs:");
            console.log("   1. Vérifiez que le nonce est correct (attendu:", nonce.toString(), ")");
            console.log("   2. Vérifiez que la signature est valide");
            console.log("   3. Vérifiez les logs du bundler pour plus de détails");
        } else {
            console.log("");
            console.log("💡 Solutions:");
            if (!vendorSignerMatch && !isSessionKey) {
                console.log("   1. Mettez à jour le vendorSigner:");
                console.log(`      npx hardhat run scripts/fixVendorSigner.ts --network localhost ${contractAddr} ${vendorPrivateKey}`);
            }
            if (ENTRY_POINT_SIM && !entryPointSimConfigured) {
                console.log("   2. Configurez EntryPointSim:");
                console.log(`      npx hardhat run scripts/setEntryPointSim.ts --network localhost ${contractAddr} <sponsorPrivateKey>`);
            }
        }
    } catch (error: any) {
        console.error("❌ Erreur lors de la lecture du contrat:", error.message);
        console.error("   Vérifiez que le contrat existe et que l'adresse est correcte");
        process.exit(1);
    }
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});

