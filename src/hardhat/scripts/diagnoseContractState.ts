import hre from "hardhat";
import { ethers } from "hardhat";

/**
 * Script de diagnostic pour vérifier l'état d'un contrat
 * Usage: CONTRACT_ADDR=0x... npx hardhat run scripts/diagnoseContractState.ts --network localhost
 */
async function main() {
    const contractAddr = process.env.CONTRACT_ADDR;
    if (!contractAddr) {
        console.error("❌ Veuillez fournir CONTRACT_ADDR");
        console.error("Usage: CONTRACT_ADDR=0x... npx hardhat run scripts/diagnoseContractState.ts --network localhost");
        process.exit(1);
    }

    const provider = ethers.provider;

    console.log("=".repeat(80));
    console.log("🔍 DIAGNOSTIC DE L'ÉTAT DU CONTRAT");
    console.log("=".repeat(80));
    console.log("");
    console.log("Adresse du contrat:", contractAddr);
    console.log("");

    // Détecter le type de contrat
    let contract: ethers.Contract;
    try {
        const OptimisticSOXAccountArtifact = await hre.artifacts.readArtifact("OptimisticSOXAccount");
        contract = new ethers.Contract(contractAddr, OptimisticSOXAccountArtifact.abi, provider);
        const entryPointAddr = await contract.entryPoint().catch(() => null);
        if (entryPointAddr && entryPointAddr !== ethers.ZeroAddress) {
            console.log("📊 Type de contrat: OptimisticSOXAccount ✅");
        } else {
            const OptimisticSOXArtifact = await hre.artifacts.readArtifact("OptimisticSOX");
            contract = new ethers.Contract(contractAddr, OptimisticSOXArtifact.abi, provider);
            console.log("📊 Type de contrat: OptimisticSOX");
        }
    } catch {
        const OptimisticSOXArtifact = await hre.artifacts.readArtifact("OptimisticSOX");
        contract = new ethers.Contract(contractAddr, OptimisticSOXArtifact.abi, provider);
        console.log("📊 Type de contrat: OptimisticSOX");
    }

    // État actuel
    const state = await contract.currState();
    const stateNames = ["WaitPayment", "WaitKey", "WaitSB", "WaitSV", "InDispute", "End"];
    const stateName = stateNames[Number(state)] || `Unknown (${state})`;
    
    console.log("");
    console.log("📊 État actuel:");
    console.log("  État:", stateName, `(${state})`);
    console.log("");

    // Informations détaillées selon l'état
    const buyer = await contract.buyer();
    const vendor = await contract.vendor();
    const buyerDeposit = await contract.buyerDeposit();
    const key = await contract.key();
    const buyerDisputeSponsor = await contract.buyerDisputeSponsor();
    const vendorDisputeSponsor = await contract.vendorDisputeSponsor();
    const disputeContract = await contract.disputeContract();

    console.log("👥 Participants:");
    console.log("  Buyer:", buyer);
    console.log("  Vendor:", vendor);
    console.log("");

    console.log("💰 Dépôts:");
    console.log("  Buyer deposit:", buyerDeposit.toString(), "wei");
    console.log("");

    console.log("🔑 Clé:");
    console.log("  Clé envoyée:", key !== "0x" && key.length > 2 ? "OUI ✅" : "NON ❌");
    if (key !== "0x" && key.length > 2) {
        console.log("  Clé (hex):", ethers.hexlify(key).slice(0, 20) + "...");
    }
    console.log("");

    console.log("👥 Sponsors de dispute:");
    console.log("  Buyer dispute sponsor:", buyerDisputeSponsor !== ethers.ZeroAddress ? buyerDisputeSponsor : "Non défini");
    console.log("  Vendor dispute sponsor:", vendorDisputeSponsor !== ethers.ZeroAddress ? vendorDisputeSponsor : "Non défini");
    console.log("");

    if (disputeContract !== ethers.ZeroAddress) {
        console.log("📄 Contrat de dispute:", disputeContract);
    } else {
        console.log("📄 Contrat de dispute: Non déployé");
    }
    console.log("");

    // Diagnostic selon l'état
    console.log("🔍 Diagnostic:");
    switch (Number(state)) {
        case 0: // WaitPayment
            console.log("  ⚠️  Le contrat attend que le buyer envoie le paiement.");
            console.log("  💡 Action requise: Le buyer doit appeler sendPayment()");
            break;
        case 1: // WaitKey
            console.log("  ⚠️  Le contrat attend que le vendor envoie la clé.");
            console.log("  💡 Action requise: Le vendor doit appeler sendKey()");
            break;
        case 2: // WaitSB
            console.log("  ✅ Le contrat est dans l'état correct pour sendBuyerDisputeSponsorFee()");
            if (buyerDisputeSponsor !== ethers.ZeroAddress) {
                console.log("  ⚠️  Mais un sponsor buyer est déjà défini:", buyerDisputeSponsor);
            } else {
                console.log("  💡 Vous pouvez maintenant appeler sendBuyerDisputeSponsorFee()");
            }
            break;
        case 3: // WaitSV
            console.log("  ⚠️  Le contrat attend que le sponsor vendor envoie ses frais.");
            console.log("  💡 Action requise: Un sponsor vendor doit appeler sendVendorDisputeSponsorFee()");
            break;
        case 4: // InDispute
            console.log("  ✅ Le contrat est en dispute.");
            console.log("  📄 Contrat de dispute:", disputeContract);
            break;
        case 5: // End
            console.log("  ✅ Le contrat est terminé.");
            break;
        default:
            console.log("  ⚠️  État inconnu:", state);
    }

    console.log("");
    console.log("=".repeat(80));
    console.log("✅ Diagnostic terminé");
    console.log("=".repeat(80));
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});









