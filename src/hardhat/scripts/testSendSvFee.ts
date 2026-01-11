import hre from "hardhat";
import { ethers } from "ethers";

/**
 * Script de test pour diagnostiquer le problème avec sendVendorDisputeSponsorFee
 * Contrat: 0x4826533B4897376654Bb4d4AD88B7faFD0C98528
 */
async function main() {
    const contractAddress = "0x4826533B4897376654Bb4d4AD88B7faFD0C98528";
    
    // Récupérer les signers
    const [deployer, sponsor, buyer, vendor, sbSponsor, svSponsor] = await hre.ethers.getSigners();
    
    console.log("🔍 Diagnostic du contrat:", contractAddress);
    console.log("Deployer:", await deployer.getAddress());
    console.log("SV Sponsor:", await svSponsor.getAddress());
    
    // Charger le contrat en utilisant l'ABI directement
    const OptimisticSOXArtifact = await hre.artifacts.readArtifact("OptimisticSOX");
    const contract = new hre.ethers.Contract(contractAddress, OptimisticSOXArtifact.abi, hre.ethers.provider);
    
    // Vérifier l'état actuel
    const currentState = await contract.currState();
    const stateNames = ["WaitPayment", "WaitKey", "WaitSB", "WaitSV", "InDispute", "End"];
    const currentStateName = stateNames[Number(currentState)] || `Unknown (${currentState})`;
    
    console.log("\n📊 État du contrat:");
    console.log("- État actuel:", currentStateName, `(${currentState})`);
    console.log("- Buyer:", await contract.buyer());
    console.log("- Vendor:", await contract.vendor());
    console.log("- Sponsor:", await contract.sponsor());
    console.log("- Buyer Dispute Sponsor:", await contract.buyerDisputeSponsor());
    console.log("- Vendor Dispute Sponsor:", await contract.vendorDisputeSponsor());
    
    // Récupérer les valeurs importantes
    const DISPUTE_FEES = 10n;
    const disputeTip = await contract.disputeTip();
    const agreedPrice = await contract.agreedPrice();
    const contractBalance = await hre.ethers.provider.getBalance(contractAddress);
    
    console.log("\n💰 Montants:");
    console.log("- DISPUTE_FEES:", DISPUTE_FEES.toString(), "wei");
    console.log("- disputeTip:", disputeTip.toString(), "wei");
    console.log("- agreedPrice:", agreedPrice.toString(), "wei");
    console.log("- Balance actuelle du contrat:", contractBalance.toString(), "wei");
    
    // Calculer les montants requis
    const oldRequiredAmount = DISPUTE_FEES + disputeTip;
    const newRequiredAmount = DISPUTE_FEES + disputeTip + agreedPrice;
    const totalBalanceAfterOld = contractBalance + oldRequiredAmount;
    const totalBalanceAfterNew = contractBalance + newRequiredAmount;
    
    console.log("\n💵 Montants requis:");
    console.log("- Ancien montant (DISPUTE_FEES + disputeTip):", oldRequiredAmount.toString(), "wei");
    console.log("- Nouveau montant (DISPUTE_FEES + disputeTip + agreedPrice):", newRequiredAmount.toString(), "wei");
    console.log("- Balance totale après ancien montant:", totalBalanceAfterOld.toString(), "wei");
    console.log("- Balance totale après nouveau montant:", totalBalanceAfterNew.toString(), "wei");
    console.log("- AgreedPrice requis:", agreedPrice.toString(), "wei");
    
    // Vérifier si c'est un OptimisticSOXAccount
    let isOptimisticSOXAccount = false;
    try {
        const entryPointAddr = await contract.entryPoint();
        isOptimisticSOXAccount = entryPointAddr !== ethers.ZeroAddress;
        if (isOptimisticSOXAccount) {
            console.log("\n✅ C'est un OptimisticSOXAccount");
            console.log("- EntryPoint:", entryPointAddr);
        } else {
            console.log("\n✅ C'est un OptimisticSOX (base)");
        }
    } catch {
        console.log("\n✅ C'est un OptimisticSOX (base)");
    }
    
    // Vérifier le solde du sponsor vendor
    const svSponsorBalance = await hre.ethers.provider.getBalance(await svSponsor.getAddress());
    console.log("\n💳 Solde du sponsor vendor:", svSponsorBalance.toString(), "wei");
    
    if (currentState !== 3n) {
        console.log("\n❌ Le contrat n'est pas dans l'état WaitSV (3). État actuel:", currentStateName);
        return;
    }
    
    // Essayer de simuler avec le nouveau montant
    console.log("\n🧪 Test 1: Simulation avec le nouveau montant (", newRequiredAmount.toString(), "wei)...");
    try {
        await contract.connect(svSponsor).sendVendorDisputeSponsorFee.staticCall({
            value: newRequiredAmount,
        });
        console.log("✅ Simulation réussie avec le nouveau montant");
    } catch (e: any) {
        const errorMsg = e?.reason || e?.message || e?.toString() || "Unknown error";
        console.log("❌ Simulation échouée avec le nouveau montant:", errorMsg);
    }
    
    // Essayer de simuler avec l'ancien montant
    console.log("\n🧪 Test 2: Simulation avec l'ancien montant (", oldRequiredAmount.toString(), "wei)...");
    try {
        await contract.connect(svSponsor).sendVendorDisputeSponsorFee.staticCall({
            value: oldRequiredAmount,
        });
        console.log("✅ Simulation réussie avec l'ancien montant");
    } catch (e: any) {
        const errorMsg = e?.reason || e?.message || e?.toString() || "Unknown error";
        console.log("❌ Simulation échouée avec l'ancien montant:", errorMsg);
    }
    
    // Vérifier si un sponsor vendor est déjà défini
    const existingVendorSponsor = await contract.vendorDisputeSponsor();
    if (existingVendorSponsor !== ethers.ZeroAddress) {
        console.log("\n⚠️ Un sponsor vendor est déjà défini:", existingVendorSponsor);
        console.log("   Cela pourrait expliquer pourquoi l'appel échoue.");
    }
    
    // Vérifier le bytecode pour comprendre quelle version est déployée
    console.log("\n🔍 Analyse du bytecode du contrat...");
    const code = await hre.ethers.provider.getCode(contractAddress);
    console.log("- Taille du bytecode:", code.length, "caractères");
    
    // Essayer de décoder l'erreur en appelant avec trace
    console.log("\n🔍 Tentative de trace de l'erreur...");
    try {
        // Utiliser callStatic avec plus de détails
        const result = await contract.connect(svSponsor).sendVendorDisputeSponsorFee.staticCall({
            value: oldRequiredAmount,
            gasLimit: 5000000,
        });
        console.log("✅ Appel réussi:", result);
    } catch (e: any) {
        console.log("❌ Erreur détaillée:");
        console.log("   Message:", e?.message);
        console.log("   Reason:", e?.reason);
        console.log("   Code:", e?.code);
        console.log("   Data:", e?.data);
        
        // Essayer de décoder avec le sélecteur de fonction
        if (e?.data && typeof e.data === 'string' && e.data !== "0x") {
            console.log("   Données d'erreur (hex):", e.data);
            // Le sélecteur de fonction sendVendorDisputeSponsorFee est 0xbec67887
            // Si les données commencent par ça, c'est un appel direct
            const functionSelector = "0xbec67887";
            if (e.data.startsWith(functionSelector)) {
                console.log("   ⚠️ Les données commencent par le sélecteur de fonction - peut-être un problème de signature");
            }
        }
        
        // Vérifier si le problème vient du déploiement de DisputeSOX
        console.log("\n🔍 Vérification du déploiement de DisputeSOX...");
        console.log("   Le problème pourrait venir du fait que DisputeSOX nécessite msg.value >= agreedPrice");
        console.log("   mais le contrat déployé utilise address(this).balance qui pourrait ne pas être suffisant.");
        console.log("   Balance actuelle:", contractBalance.toString(), "wei");
        console.log("   AgreedPrice requis:", agreedPrice.toString(), "wei");
        console.log("   Balance >= AgreedPrice?", contractBalance >= agreedPrice);
        
        // Vérifier si le contrat déployé utilise l'ancienne version
        // en essayant d'appeler avec seulement DISPUTE_FEES + disputeTip
        console.log("\n🔍 Test: Vérification de la version du contrat déployé...");
        console.log("   Le contrat déployé pourrait utiliser l'ancienne version qui exige seulement");
        console.log("   DISPUTE_FEES + disputeTip, mais le déploiement de DisputeSOX échoue car");
        console.log("   address(this).balance n'est pas suffisant.");
    }
    
    // Essayer d'appeler réellement avec l'ancien montant si la balance est suffisante
    if (totalBalanceAfterOld >= agreedPrice && svSponsorBalance >= oldRequiredAmount) {
        console.log("\n🚀 Tentative d'envoi réel avec l'ancien montant (", oldRequiredAmount.toString(), "wei)...");
        try {
            // Estimer le gas d'abord
            const gasEstimate = await contract.connect(svSponsor).sendVendorDisputeSponsorFee.estimateGas({
                value: oldRequiredAmount,
            });
            console.log("📊 Estimation de gas:", gasEstimate.toString());
            
            const tx = await contract.connect(svSponsor).sendVendorDisputeSponsorFee({
                value: oldRequiredAmount,
                gasLimit: gasEstimate * 2n, // Doubler pour être sûr
            });
            console.log("📝 Transaction envoyée:", tx.hash);
            const receipt = await tx.wait();
            console.log("✅ Transaction confirmée dans le bloc:", receipt?.blockNumber);
            
            // Vérifier l'état après
            const newState = await contract.currState();
            const disputeContract = await contract.disputeContract();
            console.log("\n📊 État après l'envoi:");
            console.log("- Nouvel état:", stateNames[Number(newState)] || `Unknown (${newState})`);
            console.log("- Contrat de dispute:", disputeContract);
        } catch (e: any) {
            const errorMsg = e?.reason || e?.message || e?.toString() || "Unknown error";
            console.log("❌ Échec de l'envoi:", errorMsg);
            
            // Essayer de décoder l'erreur
            if (e?.data) {
                console.log("📋 Données d'erreur:", e.data);
            }
            
            // Si c'est une erreur de gas, essayer avec plus de gas
            if (errorMsg.includes("gas") || errorMsg.includes("out of gas")) {
                console.log("\n💡 Tentative avec plus de gas...");
                try {
                    const tx = await contract.connect(svSponsor).sendVendorDisputeSponsorFee({
                        value: oldRequiredAmount,
                        gasLimit: 10000000,
                    });
                    console.log("📝 Transaction envoyée avec plus de gas:", tx.hash);
                    const receipt = await tx.wait();
                    console.log("✅ Transaction confirmée:", receipt?.blockNumber);
                } catch (e2: any) {
                    console.log("❌ Échec même avec plus de gas:", e2?.message);
                }
            }
        }
    } else {
        console.log("\n⚠️ Conditions non remplies pour l'envoi:");
        console.log("- Balance totale après ancien montant >= agreedPrice:", totalBalanceAfterOld >= agreedPrice);
        console.log("- Solde sponsor vendor >= ancien montant:", svSponsorBalance >= oldRequiredAmount);
    }
}

main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error(error);
        process.exit(1);
    });

