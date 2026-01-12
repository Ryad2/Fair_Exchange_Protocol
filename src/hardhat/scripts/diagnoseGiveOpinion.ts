import hre from "hardhat";
import { ethers } from "hardhat";
import DisputeSOXAccountArtifact from "../../app/lib/blockchain/contracts/DisputeSOXAccount.json";

/**
 * Script pour diagnostiquer pourquoi giveOpinion ne fonctionne pas
 * Usage: DISPUTE_ADDR=0x... npx hardhat run scripts/diagnoseGiveOpinion.ts --network localhost
 */
async function main() {
    const disputeAddr = process.env.DISPUTE_ADDR || "0xF8ADc47E258b9a56a8E0A717572dB3F1Cb1b4cc4";
    
    const provider = ethers.provider;
    const contract = new ethers.Contract(disputeAddr, DisputeSOXAccountArtifact.abi, provider);

    console.log("=".repeat(80));
    console.log("🔍 DIAGNOSTIC: giveOpinion ne fonctionne pas");
    console.log("=".repeat(80));
    console.log("");
    console.log("Adresse du contrat:", disputeAddr);
    console.log("");

    // État actuel
    const state = await contract.currState();
    const stateNames = [
        "ChallengeBuyer",
        "WaitVendorOpinion",
        "WaitVendorData",
        "WaitVendorDataLeft",
        "WaitVendorDataRight",
        "Complete",
        "Cancel",
        "End"
    ];
    const stateName = stateNames[Number(state)] || `Unknown (${state})`;
    console.log("📊 État actuel:", stateName, `(${state})`);
    console.log("");

    // Participants
    const buyer = await contract.buyer();
    const vendor = await contract.vendor();
    const buyerDisputeSponsor = await contract.buyerDisputeSponsor();
    const vendorDisputeSponsor = await contract.vendorDisputeSponsor();
    
    console.log("👥 Participants:");
    console.log("  Buyer:", buyer);
    console.log("  Vendor:", vendor);
    console.log("  Buyer Dispute Sponsor:", buyerDisputeSponsor);
    console.log("  Vendor Dispute Sponsor:", vendorDisputeSponsor);
    console.log("");

    // Vérifier si le sponsor a pris la place
    const step9Count = await contract.step9Count();
    const lastLosingPartyWasVendor = await contract.lastLosingPartyWasVendor();
    
    console.log("📈 Step 9 Info:");
    console.log("  Step9Count:", step9Count.toString());
    console.log("  LastLosingPartyWasVendor:", lastLosingPartyWasVendor);
    
    const sponsorTookOverVendor = vendor.toLowerCase() === vendorDisputeSponsor.toLowerCase();
    const sponsorTookOverBuyer = buyer.toLowerCase() === buyerDisputeSponsor.toLowerCase();
    
    if (sponsorTookOverVendor) {
        console.log("  ⚠️  Vendor a été remplacé par le sponsor!");
    }
    if (sponsorTookOverBuyer) {
        console.log("  ⚠️  Buyer a été remplacé par le sponsor!");
    }
    console.log("");

    // Signers (si disponible - besoin d'une fonction getter ou vérifier le code)
    try {
        // Essayer de lire les signers via une fonction si elle existe
        // Sinon, on peut essayer de les déduire
        console.log("🔑 Signers (tentative de lecture):");
        // Note: Il n'y a peut-être pas de getter public pour les signers
        // Dans ce cas, on ne peut pas les vérifier directement
        console.log("  (Pas de getter public pour les signers)");
    } catch (e) {
        console.log("  (Impossible de lire les signers - pas de getter public)");
    }
    console.log("");

    // Challenge info
    const chall = await contract.chall();
    const a = await contract.a();
    const b = await contract.b();
    const latestResponse = await contract.getLatestBuyerResponse();
    
    console.log("🎯 Challenge Info:");
    console.log("  Challenge index (chall):", chall.toString());
    console.log("  a:", a.toString());
    console.log("  b:", b.toString());
    console.log("  Latest buyer response:", latestResponse);
    console.log("");

    // Diagnostic selon l'état
    if (state === 1n) { // WaitVendorOpinion
        console.log("🔍 DIAGNOSTIC pour WaitVendorOpinion:");
        console.log("");
        
        if (sponsorTookOverVendor) {
            console.log("  ⚠️  PROBLÈME POTENTIEL:");
            console.log("  Le sponsor a pris la place du vendor.");
            console.log("  Si vous utilisez des user operations ERC-4337,");
            console.log("  vous devez utiliser la clé privée de vendorDisputeSponsorSigner,");
            console.log("  PAS la clé privée du vendor original.");
            console.log("");
            console.log("  SOLUTION:");
            console.log("  1. Vérifier que vendorSigner a été mis à jour à vendorDisputeSponsorSigner");
            console.log("  2. Utiliser la clé privée de vendorDisputeSponsor pour signer la user operation");
            console.log("  3. OU redéployer le contrat avec la correction des signers dans handleStep9");
            console.log("");
        } else {
            console.log("  ✅ Vendor original actif (pas de sponsor takeover)");
            console.log("  Utiliser la clé privée du vendor original pour signer");
            console.log("");
        }

        console.log("  Pour appeler giveOpinion:");
        console.log("  - L'état doit être WaitVendorOpinion (✓)");
        console.log("  - Le msg.sender doit être 'vendor' OU une user operation avec vendorSigner");
        console.log("  - Si sponsor takeover: vendorSigner doit être vendorDisputeSponsorSigner");
        console.log("");
    }

    // Vérifier le code du contrat pour voir s'il a la correction
    console.log("🔍 Vérification du code du contrat:");
    const code = await provider.getCode(disputeAddr);
    if (code && code !== "0x") {
        console.log("  ✅ Code du contrat trouvé");
        console.log("  Taille:", code.length, "caractères hex");
        // On ne peut pas facilement vérifier si le code contient la correction
        // sans décompiler, mais on peut vérifier si c'est bien un DisputeSOXAccount
        console.log("  (Pour vérifier la correction, il faut redéployer avec le nouveau code)");
    } else {
        console.log("  ❌ Code du contrat introuvable");
    }
    console.log("");

    console.log("=".repeat(80));
    console.log("✅ Diagnostic terminé");
    console.log("=".repeat(80));
}

main().catch(console.error);

