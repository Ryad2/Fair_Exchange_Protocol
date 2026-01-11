import hre from "hardhat";
import { ethers } from "ethers";
import DisputeSOXAccountArtifact from "../../app/lib/blockchain/contracts/DisputeSOXAccount.json";

/**
 * Script pour vérifier l'état d'un contrat de dispute
 * Usage: DISPUTE_ADDR=0x... npx hardhat run scripts/checkDispute.ts --network localhost
 */
async function main() {
    const disputeAddr = process.env.DISPUTE_ADDR;
    if (!disputeAddr) {
        console.error("❌ Veuillez fournir DISPUTE_ADDR");
        console.error("Usage: DISPUTE_ADDR=0x... npx hardhat run scripts/checkDispute.ts --network localhost");
        process.exit(1);
    }

    const provider = ethers.provider;
    const contract = new ethers.Contract(disputeAddr, DisputeSOXAccountArtifact.abi, provider);

    console.log("=".repeat(80));
    console.log("🔍 ÉTAT DU CONTRAT DE DISPUTE");
    console.log("=".repeat(80));
    console.log("");
    console.log("Adresse du contrat de dispute:", disputeAddr);
    console.log("");

    // Vérifier si c'est un DisputeSOXAccount (avec EntryPoint)
    try {
        const entryPoint = await contract.entryPoint();
        if (entryPoint && entryPoint !== ethers.ZeroAddress) {
            console.log("✅ Type: DisputeSOXAccount (ERC-4337 compatible)");
            console.log("  EntryPoint:", entryPoint);
            console.log("");
        }
    } catch (e) {
        console.log("⚠️  Type: DisputeSOX (legacy, sans EntryPoint)");
        console.log("");
    }

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

    console.log("📊 État actuel:");
    console.log("  État:", stateName, `(${state})`);
    console.log("");

    // Participants
    const buyer = await contract.buyer();
    const vendor = await contract.vendor();
    const buyerDisputeSponsor = await contract.buyerDisputeSponsor();
    const vendorDisputeSponsor = await contract.vendorDisputeSponsor();
    const optimisticContract = await contract.optimisticContract();

    console.log("👥 Participants:");
    console.log("  Buyer:", buyer);
    console.log("  Vendor:", vendor);
    console.log("  Buyer dispute sponsor:", buyerDisputeSponsor);
    console.log("  Vendor dispute sponsor:", vendorDisputeSponsor);
    console.log("  Contrat optimiste:", optimisticContract);
    console.log("");

    // Informations du contrat
    const numBlocks = await contract.numBlocks();
    const numGates = await contract.numGates();
    const commitment = await contract.commitment();
    const circuitVersion = await contract.circuitVersion();
    const chall = await contract.chall();
    const a = await contract.a();
    const b = await contract.b();
    const agreedPrice = await contract.agreedPrice();
    const nextTimeoutTime = await contract.nextTimeoutTime();
    const timeoutIncrement = await contract.timeoutIncrement();

    console.log("📋 Informations du contrat:");
    console.log("  NumBlocks:", numBlocks.toString());
    console.log("  NumGates:", numGates.toString());
    console.log("  Commitment:", commitment);
    console.log("  Circuit version:", circuitVersion.toString());
    console.log("  Challenge index (chall):", chall.toString());
    console.log("  a:", a.toString());
    console.log("  b:", b.toString());
    console.log("  AgreedPrice:", agreedPrice.toString(), "wei");
    console.log("  Next timeout:", new Date(Number(nextTimeoutTime) * 1000).toLocaleString());
    console.log("  Timeout increment:", timeoutIncrement.toString(), "secondes");
    console.log("");

    // Balance
    const balance = await provider.getBalance(disputeAddr);
    console.log("💵 Balance:");
    console.log("  Balance du contrat:", balance.toString(), "wei");
    console.log("");

    // Vérifier le timeout
    const timeoutHasPassed = await contract.timeoutHasPassed();
    console.log("⏰ Timeout:");
    console.log("  Timeout passé:", timeoutHasPassed ? "OUI ✅" : "NON ❌");
    console.log("");

    // Informations selon l'état
    if (state === 0n) { // ChallengeBuyer
        console.log("📝 État: ChallengeBuyer");
        console.log("  → Le buyer doit répondre au challenge avec respondChallenge()");
        console.log("  → Challenge index:", chall.toString());
    } else if (state === 1n) { // WaitVendorOpinion
        const latestResponse = await contract.buyerResponses(chall);
        console.log("📝 État: WaitVendorOpinion");
        console.log("  → Le vendor doit donner son opinion avec giveOpinion()");
        console.log("  → Réponse du buyer:", latestResponse);
    } else if (state === 2n) { // WaitVendorData
        console.log("📝 État: WaitVendorData");
        console.log("  → Le vendor doit soumettre des données avec submitCommitment()");
    } else if (state === 3n) { // WaitVendorDataLeft
        console.log("📝 État: WaitVendorDataLeft");
        console.log("  → Le vendor doit soumettre des données de gauche");
    } else if (state === 4n) { // WaitVendorDataRight
        console.log("📝 État: WaitVendorDataRight");
        console.log("  → Le vendor doit soumettre des données de droite");
    } else if (state === 5n) { // Complete
        console.log("📝 État: Complete");
        console.log("  → La dispute est complète, le vendor a gagné");
    } else if (state === 6n) { // Cancel
        console.log("📝 État: Cancel");
        console.log("  → La dispute peut être annulée avec cancelDispute()");
    } else if (state === 7n) { // End
        console.log("📝 État: End");
        console.log("  → La dispute est terminée");
    }

    console.log("");
    console.log("=".repeat(80));
    console.log("✅ Vérification terminée");
    console.log("=".repeat(80));
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
