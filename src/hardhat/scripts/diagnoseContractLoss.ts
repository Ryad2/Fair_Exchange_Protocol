import { ethers } from "hardhat";
import { Contract } from "ethers";

const DISPUTE_ADDRESS = process.env.DISPUTE_ADDRESS || "0xB76E7B83349568dbdA2D6D2D5463eA8a91016b73";

const State: Record<number, string> = {
    0: "ChallengeBuyer",
    1: "WaitVendorOpinion",
    2: "WaitVendorData",
    3: "WaitVendorDataLeft",
    4: "WaitVendorDataRight",
    5: "Complete",
    6: "Cancel",
    7: "End"
};

async function main() {
    console.log("🔍 DIAGNOSTIC DU CONTRAT DE DISPUTE");
    console.log(`📋 Adresse: ${DISPUTE_ADDRESS}\n`);

    const dispute = await ethers.getContractAt("DisputeSOXAccount", DISPUTE_ADDRESS);

    // État actuel
    const currState = Number(await dispute.currState());
    console.log(`📊 État actuel: ${currState} (${State[currState] || "Unknown"})\n`);

    // Informations sur les parties
    const buyer = await dispute.buyer();
    const vendor = await dispute.vendor();
    const buyerDisputeSponsor = await dispute.buyerDisputeSponsor();
    const vendorDisputeSponsor = await dispute.vendorDisputeSponsor();
    
    console.log(`👤 Buyer: ${buyer}`);
    console.log(`👤 Vendor: ${vendor}`);
    console.log(`👤 Buyer Dispute Sponsor: ${buyerDisputeSponsor}`);
    console.log(`👤 Vendor Dispute Sponsor: ${vendorDisputeSponsor}\n`);

    // Informations sur Step 9
    const step9Count = await dispute.step9Count();
    const lastLosingPartyWasVendor = await dispute.lastLosingPartyWasVendor();
    console.log(`📊 Step 9 Count: ${step9Count}`);
    console.log(`📊 Dernier perdant etait vendor: ${lastLosingPartyWasVendor}\n`);

    // Si le contrat est dans l'état Cancel ou Complete
    if (currState === 6) {
        console.log("❌ ETAT: Cancel (Vendor a perdu)");
        console.log("\n📋 ANALYSE:");
        console.log("   Le contrat est dans l'etat Cancel, ce qui signifie que");
        console.log("   verifyCommitmentLeft() a retourne false lors de la derniere soumission.\n");
    } else if (currState === 5) {
        console.log("✅ ETAT: Complete (Vendor a gagne)");
        console.log("\n📋 ANALYSE:");
        console.log("   Le contrat est dans l'etat Complete, ce qui signifie que");
        console.log("   verifyCommitmentLeft() a retourne true lors de la derniere soumission.\n");
    } else {
        console.log(`⚠️  ETAT: ${State[currState] || "Unknown"}`);
        console.log("   Le contrat n'est pas encore dans un etat final (Cancel/Complete).\n");
    }

    // Informations sur le challenge
    const chall = await dispute.chall();
    const a = await dispute.a();
    const b = await dispute.b();
    console.log(`📊 Challenge actuel: ${chall}`);
    console.log(`📊 a: ${a}, b: ${b}\n`);

    // Si on est dans WaitVendorDataLeft, vérifier buyerResponses
    if (currState === 3) {
        console.log("📋 Le contrat est dans l'etat WaitVendorDataLeft (3)");
        console.log(`   Challenge actuel: ${chall}`);
        console.log(`   Pour soumettre des preuves pour gate ${chall}, il faut:`);
        console.log(`   - Que verifyCommitmentLeft() retourne true`);
        console.log(`   - Si true -> Complete (vendor gagne)`);
        console.log(`   - Si false -> Cancel (vendor perd)\n`);
    }

    console.log("💡 RESUME:");
    if (currState === 6) {
        console.log("   ❌ Le vendor a perdu (etat Cancel)");
        console.log("   📋 Cela signifie que verifyCommitmentLeft() a retourne false");
        console.log("   🔍 Causes possibles:");
        console.log("      1. Les preuves ne passent pas (AccumulatorVerifier.verify echoue)");
        console.log("      2. L'evaluation de la gate echoue (evaluateGateFromSons)");
        console.log("      3. Les donnees sont incorrectes (opening value, gate bytes, values, etc.)");
    } else if (currState === 5) {
        console.log("   ✅ Le vendor a gagne (etat Complete)");
        console.log("   📋 Cela signifie que verifyCommitmentLeft() a retourne true");
    }
}

main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error(error);
        process.exit(1);
    });