import hre from "hardhat";
import { ethers } from "hardhat";

/**
 * Script pour tester le nouveau contrat déployé
 * Contrat: 0xFD471836031dc5108809D173A067e8486B9047A3
 */
async function main() {
    const contractAddress = "0xFD471836031dc5108809D173A067e8486B9047A3";
    
    const [sponsor, buyer, vendor, sbSponsor, svSponsor] = await hre.ethers.getSigners();
    
    console.log("=".repeat(80));
    console.log("🧪 Test du nouveau contrat OptimisticSOX");
    console.log("=".repeat(80));
    console.log("");
    console.log("Contrat:", contractAddress);
    console.log("Signers:");
    console.log("  Sponsor:", await sponsor.getAddress());
    console.log("  Buyer:", await buyer.getAddress());
    console.log("  Vendor:", await vendor.getAddress());
    console.log("  SB Sponsor:", await sbSponsor.getAddress());
    console.log("  SV Sponsor:", await svSponsor.getAddress());
    console.log("");
    
    // Charger le contrat
    const OptimisticSOXArtifact = await hre.artifacts.readArtifact("OptimisticSOX");
    const contract = new hre.ethers.Contract(contractAddress, OptimisticSOXArtifact.abi, hre.ethers.provider);
    
    // Vérifier l'état initial
    const initialState = await contract.currState();
    const stateNames = ["WaitPayment", "WaitKey", "WaitSB", "WaitSV", "InDispute", "End"];
    console.log("📊 État initial:", stateNames[Number(initialState)], `(${initialState})`);
    
    const agreedPrice = await contract.agreedPrice();
    const completionTip = await contract.completionTip();
    const disputeTip = await contract.disputeTip();
    const DISPUTE_FEES = 10n;
    
    console.log("💰 Montants:");
    console.log("  Agreed price:", agreedPrice.toString(), "wei");
    console.log("  Completion tip:", completionTip.toString(), "wei");
    console.log("  Dispute tip:", disputeTip.toString(), "wei");
    console.log("  DISPUTE_FEES:", DISPUTE_FEES.toString(), "wei");
    console.log("");
    
    // Étape 1: Buyer envoie le paiement
    console.log("📝 Étape 1: Buyer envoie le paiement...");
    try {
        const paymentAmount = agreedPrice + completionTip;
        const tx1 = await contract.connect(buyer).sendPayment({
            value: paymentAmount,
        });
        await tx1.wait();
        console.log("  ✅ Paiement envoyé:", tx1.hash);
        const state1 = await contract.currState();
        console.log("  État après paiement:", stateNames[Number(state1)], `(${state1})`);
    } catch (e: any) {
        console.log("  ❌ Erreur:", e?.message);
        return;
    }
    console.log("");
    
    // Étape 2: Vendor envoie la clé
    console.log("📝 Étape 2: Vendor envoie la clé...");
    try {
        const key = ethers.toUtf8Bytes("test-key-123");
        const tx2 = await contract.connect(vendor).sendKey(key);
        await tx2.wait();
        console.log("  ✅ Clé envoyée:", tx2.hash);
        const state2 = await contract.currState();
        console.log("  État après clé:", stateNames[Number(state2)], `(${state2})`);
    } catch (e: any) {
        console.log("  ❌ Erreur:", e?.message);
        return;
    }
    console.log("");
    
    // Étape 3: Buyer dispute sponsor envoie ses frais
    console.log("📝 Étape 3: Buyer dispute sponsor envoie ses frais...");
    try {
        const sbAmount = DISPUTE_FEES + disputeTip;
        const tx3 = await contract.connect(sbSponsor).sendBuyerDisputeSponsorFee({
            value: sbAmount,
        });
        await tx3.wait();
        console.log("  ✅ Frais buyer sponsor envoyés:", tx3.hash);
        const state3 = await contract.currState();
        console.log("  État après frais buyer sponsor:", stateNames[Number(state3)], `(${state3})`);
    } catch (e: any) {
        console.log("  ❌ Erreur:", e?.message);
        return;
    }
    console.log("");
    
    // Étape 4: Vendor dispute sponsor envoie ses frais (NOUVELLE VERSION)
    console.log("📝 Étape 4: Vendor dispute sponsor envoie ses frais (NOUVELLE VERSION)...");
    console.log("  Montant requis:", (DISPUTE_FEES + disputeTip + agreedPrice).toString(), "wei");
    console.log("  (DISPUTE_FEES:", DISPUTE_FEES.toString(), "+ disputeTip:", disputeTip.toString(), "+ agreedPrice:", agreedPrice.toString(), ")");
    
    try {
        const svAmount = DISPUTE_FEES + disputeTip + agreedPrice;
        
        // Simuler d'abord
        console.log("  🧪 Simulation...");
        await contract.connect(svSponsor).sendVendorDisputeSponsorFee.staticCall({
            value: svAmount,
        });
        console.log("  ✅ Simulation réussie");
        
        // Envoyer réellement
        console.log("  🚀 Envoi réel...");
        const tx4 = await contract.connect(svSponsor).sendVendorDisputeSponsorFee({
            value: svAmount,
        });
        await tx4.wait();
        console.log("  ✅ Frais vendor sponsor envoyés:", tx4.hash);
        
        const state4 = await contract.currState();
        const disputeContract = await contract.disputeContract();
        console.log("  État après frais vendor sponsor:", stateNames[Number(state4)], `(${state4})`);
        console.log("  Contrat de dispute déployé:", disputeContract);
        
        if (disputeContract !== ethers.ZeroAddress) {
            console.log("");
            console.log("  🎉 SUCCÈS! Le contrat de dispute a été déployé avec succès!");
        }
    } catch (e: any) {
        console.log("  ❌ Erreur:", e?.message);
        console.log("  Reason:", e?.reason);
        console.log("  Data:", e?.data);
        return;
    }
    console.log("");
    
    console.log("=".repeat(80));
    console.log("✅ Test terminé avec succès!");
    console.log("=".repeat(80));
}

main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error(error);
        process.exit(1);
    });









