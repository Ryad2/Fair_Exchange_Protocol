import hre from "hardhat";
import { ethers } from "hardhat";
import OptimisticSOXAccountArtifact from "../../app/lib/blockchain/contracts/OptimisticSOXAccount.json";
import OptimisticSOXArtifact from "../../app/lib/blockchain/contracts/OptimisticSOX.json";

/**
 * Script de diagnostic pour analyser un contrat OptimisticSOX/OptimisticSOXAccount
 * Usage: CONTRACT_ADDR=0x... npx hardhat run scripts/diagnoseContract.ts --network localhost
 */
async function main() {
    const contractAddr = process.env.CONTRACT_ADDR;
    if (!contractAddr) {
        console.error("❌ Veuillez fournir CONTRACT_ADDR");
        console.error("Usage: CONTRACT_ADDR=0x... npx hardhat run scripts/diagnoseContract.ts --network localhost");
        process.exit(1);
    }

    const provider = ethers.provider;
    const [deployer] = await hre.ethers.getSigners();

    console.log("=".repeat(80));
    console.log("🔍 DIAGNOSTIC DU CONTRAT");
    console.log("=".repeat(80));
    console.log("");
    console.log("Adresse du contrat:", contractAddr);
    console.log("");

    // Détecter le type de contrat
    let contract: ethers.Contract;
    let isOptimisticSOXAccount = false;
    let entryPointAddr: string | null = null;

    try {
        contract = new ethers.Contract(contractAddr, OptimisticSOXAccountArtifact.abi, provider);
        try {
            entryPointAddr = await contract.entryPoint();
            isOptimisticSOXAccount = entryPointAddr !== ethers.ZeroAddress;
        } catch {
            // Si entryPoint() n'existe pas, c'est OptimisticSOX
            contract = new ethers.Contract(contractAddr, OptimisticSOXArtifact.abi, provider);
        }
    } catch {
        contract = new ethers.Contract(contractAddr, OptimisticSOXArtifact.abi, provider);
    }

    console.log("📊 Type de contrat:", isOptimisticSOXAccount ? "OptimisticSOXAccount ✅" : "OptimisticSOX");
    if (isOptimisticSOXAccount && entryPointAddr) {
        console.log("  EntryPoint:", entryPointAddr);
    }
    console.log("");

    // Informations de base
    const state = await contract.currState();
    const stateNames = ["WaitPayment", "WaitKey", "WaitSB", "WaitSV", "InDispute", "End"];
    const stateName = stateNames[Number(state)] || `Unknown (${state})`;
    
    console.log("📊 État du contrat:");
    console.log("  État:", stateName, `(${state})`);
    console.log("");

    const agreedPrice = await contract.agreedPrice();
    const disputeTip = await contract.disputeTip();
    const completionTip = await contract.completionTip();
    const DISPUTE_FEES = 10n;

    console.log("💰 Montants:");
    console.log("  AgreedPrice:", agreedPrice.toString(), "wei");
    console.log("  DisputeTip:", disputeTip.toString(), "wei");
    console.log("  CompletionTip:", completionTip.toString(), "wei");
    console.log("  DISPUTE_FEES:", DISPUTE_FEES.toString(), "wei");
    console.log("");

    // Vérifier les sponsors
    const buyerDisputeSponsor = await contract.buyerDisputeSponsor();
    const vendorDisputeSponsor = await contract.vendorDisputeSponsor();
    
    console.log("👥 Sponsors:");
    console.log("  Buyer dispute sponsor:", buyerDisputeSponsor);
    console.log("  Vendor dispute sponsor:", vendorDisputeSponsor);
    console.log("");

    // Vérifier les balances
    const contractBalance = await provider.getBalance(contractAddr);
    console.log("💵 Balances:");
    console.log("  Balance du contrat:", contractBalance.toString(), "wei");
    console.log("");

    // Calculer les montants requis
    const requiredAmount = DISPUTE_FEES + disputeTip + agreedPrice;
    const oldRequiredAmount = DISPUTE_FEES + disputeTip;
    const totalBalanceAfter = contractBalance + requiredAmount;
    const totalBalanceAfterOld = contractBalance + oldRequiredAmount;

    console.log("💳 Montants requis:");
    console.log("  Nouveau montant (recommandé):", requiredAmount.toString(), "wei");
    console.log("    (DISPUTE_FEES:", DISPUTE_FEES, "+ disputeTip:", disputeTip.toString(), "+ agreedPrice:", agreedPrice.toString(), ")");
    console.log("  Ancien montant (compatibilité):", oldRequiredAmount.toString(), "wei");
    console.log("    (DISPUTE_FEES:", DISPUTE_FEES, "+ disputeTip:", disputeTip.toString(), ")");
    console.log("");

    console.log("📊 Balance après envoi:");
    console.log("  Avec nouveau montant:", totalBalanceAfter.toString(), "wei");
    console.log("  Avec ancien montant:", totalBalanceAfterOld.toString(), "wei");
    console.log("  AgreedPrice requis:", agreedPrice.toString(), "wei");
    console.log("  ✅ Balance totale >= AgreedPrice (nouveau):", totalBalanceAfter >= agreedPrice ? "OUI" : "NON");
    console.log("  ✅ Balance totale >= AgreedPrice (ancien):", totalBalanceAfterOld >= agreedPrice ? "OUI" : "NON");
    console.log("");

    // Vérifier le contrat de dispute s'il existe
    try {
        const disputeContract = await contract.disputeContract();
        if (disputeContract !== ethers.ZeroAddress) {
            console.log("📄 Contrat de dispute déjà déployé:", disputeContract);
            console.log("  ⚠️  Le contrat est déjà en dispute, vous ne pouvez plus envoyer les frais.");
        } else {
            console.log("📄 Contrat de dispute: Non déployé");
        }
    } catch {
        console.log("📄 Contrat de dispute: Non déployé");
    }
    console.log("");

    // Vérifier le code du contrat pour voir s'il correspond à la version attendue
    const code = await provider.getCode(contractAddr);
    console.log("📦 Code du contrat:");
    console.log("  Taille du code:", code.length, "caractères");
    console.log("  Code non vide:", code !== "0x" ? "OUI ✅" : "NON ❌");
    console.log("");

    // Si c'est WaitSV et qu'il n'y a pas de sponsor vendor, tester la simulation
    if (state === 3n && vendorDisputeSponsor === ethers.ZeroAddress) {
        console.log("🧪 Test de simulation avec le nouveau montant...");
        const testWallet = deployer;
        try {
            await contract.connect(testWallet).sendVendorDisputeSponsorFee.staticCall({
                value: requiredAmount,
            });
            console.log("  ✅ Simulation réussie avec le nouveau montant");
        } catch (e: any) {
            const errorMsg = e?.reason || e?.message || e?.toString() || "Unknown error";
            console.log("  ❌ Simulation échouée avec le nouveau montant:", errorMsg);
            
            // Essayer avec l'ancien montant si c'est OptimisticSOX
            if (!isOptimisticSOXAccount && totalBalanceAfterOld >= agreedPrice) {
                console.log("");
                console.log("🧪 Test de simulation avec l'ancien montant (compatibilité)...");
                try {
                    await contract.connect(testWallet).sendVendorDisputeSponsorFee.staticCall({
                        value: oldRequiredAmount,
                    });
                    console.log("  ✅ Simulation réussie avec l'ancien montant");
                    console.log("  💡 Le contrat semble être une ancienne version qui attend seulement DISPUTE_FEES + disputeTip");
                } catch (e2: any) {
                    const errorMsg2 = e2?.reason || e2?.message || e2?.toString() || "Unknown error";
                    console.log("  ❌ Simulation échouée aussi avec l'ancien montant:", errorMsg2);
                }
            }
        }
    } else if (state !== 3n) {
        console.log("⚠️  Le contrat n'est pas dans l'état WaitSV, impossible de tester sendVendorDisputeSponsorFee");
    } else {
        console.log("⚠️  Un sponsor vendor est déjà défini, impossible de tester");
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

import OptimisticSOXAccountArtifact from "../../app/lib/blockchain/contracts/OptimisticSOXAccount.json";
import OptimisticSOXArtifact from "../../app/lib/blockchain/contracts/OptimisticSOX.json";

/**
 * Script de diagnostic pour analyser un contrat OptimisticSOX/OptimisticSOXAccount
 * Usage: CONTRACT_ADDR=0x... npx hardhat run scripts/diagnoseContract.ts --network localhost
 */
async function main() {
    const contractAddr = process.env.CONTRACT_ADDR;
    if (!contractAddr) {
        console.error("❌ Veuillez fournir CONTRACT_ADDR");
        console.error("Usage: CONTRACT_ADDR=0x... npx hardhat run scripts/diagnoseContract.ts --network localhost");
        process.exit(1);
    }

    const provider = ethers.provider;
    const [deployer] = await hre.ethers.getSigners();

    console.log("=".repeat(80));
    console.log("🔍 DIAGNOSTIC DU CONTRAT");
    console.log("=".repeat(80));
    console.log("");
    console.log("Adresse du contrat:", contractAddr);
    console.log("");

    // Détecter le type de contrat
    let contract: ethers.Contract;
    let isOptimisticSOXAccount = false;
    let entryPointAddr: string | null = null;

    try {
        contract = new ethers.Contract(contractAddr, OptimisticSOXAccountArtifact.abi, provider);
        try {
            entryPointAddr = await contract.entryPoint();
            isOptimisticSOXAccount = entryPointAddr !== ethers.ZeroAddress;
        } catch {
            // Si entryPoint() n'existe pas, c'est OptimisticSOX
            contract = new ethers.Contract(contractAddr, OptimisticSOXArtifact.abi, provider);
        }
    } catch {
        contract = new ethers.Contract(contractAddr, OptimisticSOXArtifact.abi, provider);
    }

    console.log("📊 Type de contrat:", isOptimisticSOXAccount ? "OptimisticSOXAccount ✅" : "OptimisticSOX");
    if (isOptimisticSOXAccount && entryPointAddr) {
        console.log("  EntryPoint:", entryPointAddr);
    }
    console.log("");

    // Informations de base
    const state = await contract.currState();
    const stateNames = ["WaitPayment", "WaitKey", "WaitSB", "WaitSV", "InDispute", "End"];
    const stateName = stateNames[Number(state)] || `Unknown (${state})`;
    
    console.log("📊 État du contrat:");
    console.log("  État:", stateName, `(${state})`);
    console.log("");

    const agreedPrice = await contract.agreedPrice();
    const disputeTip = await contract.disputeTip();
    const completionTip = await contract.completionTip();
    const DISPUTE_FEES = 10n;

    console.log("💰 Montants:");
    console.log("  AgreedPrice:", agreedPrice.toString(), "wei");
    console.log("  DisputeTip:", disputeTip.toString(), "wei");
    console.log("  CompletionTip:", completionTip.toString(), "wei");
    console.log("  DISPUTE_FEES:", DISPUTE_FEES.toString(), "wei");
    console.log("");

    // Vérifier les sponsors
    const buyerDisputeSponsor = await contract.buyerDisputeSponsor();
    const vendorDisputeSponsor = await contract.vendorDisputeSponsor();
    
    console.log("👥 Sponsors:");
    console.log("  Buyer dispute sponsor:", buyerDisputeSponsor);
    console.log("  Vendor dispute sponsor:", vendorDisputeSponsor);
    console.log("");

    // Vérifier les balances
    const contractBalance = await provider.getBalance(contractAddr);
    console.log("💵 Balances:");
    console.log("  Balance du contrat:", contractBalance.toString(), "wei");
    console.log("");

    // Calculer les montants requis
    const requiredAmount = DISPUTE_FEES + disputeTip + agreedPrice;
    const oldRequiredAmount = DISPUTE_FEES + disputeTip;
    const totalBalanceAfter = contractBalance + requiredAmount;
    const totalBalanceAfterOld = contractBalance + oldRequiredAmount;

    console.log("💳 Montants requis:");
    console.log("  Nouveau montant (recommandé):", requiredAmount.toString(), "wei");
    console.log("    (DISPUTE_FEES:", DISPUTE_FEES, "+ disputeTip:", disputeTip.toString(), "+ agreedPrice:", agreedPrice.toString(), ")");
    console.log("  Ancien montant (compatibilité):", oldRequiredAmount.toString(), "wei");
    console.log("    (DISPUTE_FEES:", DISPUTE_FEES, "+ disputeTip:", disputeTip.toString(), ")");
    console.log("");

    console.log("📊 Balance après envoi:");
    console.log("  Avec nouveau montant:", totalBalanceAfter.toString(), "wei");
    console.log("  Avec ancien montant:", totalBalanceAfterOld.toString(), "wei");
    console.log("  AgreedPrice requis:", agreedPrice.toString(), "wei");
    console.log("  ✅ Balance totale >= AgreedPrice (nouveau):", totalBalanceAfter >= agreedPrice ? "OUI" : "NON");
    console.log("  ✅ Balance totale >= AgreedPrice (ancien):", totalBalanceAfterOld >= agreedPrice ? "OUI" : "NON");
    console.log("");

    // Vérifier le contrat de dispute s'il existe
    try {
        const disputeContract = await contract.disputeContract();
        if (disputeContract !== ethers.ZeroAddress) {
            console.log("📄 Contrat de dispute déjà déployé:", disputeContract);
            console.log("  ⚠️  Le contrat est déjà en dispute, vous ne pouvez plus envoyer les frais.");
        } else {
            console.log("📄 Contrat de dispute: Non déployé");
        }
    } catch {
        console.log("📄 Contrat de dispute: Non déployé");
    }
    console.log("");

    // Vérifier le code du contrat pour voir s'il correspond à la version attendue
    const code = await provider.getCode(contractAddr);
    console.log("📦 Code du contrat:");
    console.log("  Taille du code:", code.length, "caractères");
    console.log("  Code non vide:", code !== "0x" ? "OUI ✅" : "NON ❌");
    console.log("");

    // Si c'est WaitSV et qu'il n'y a pas de sponsor vendor, tester la simulation
    if (state === 3n && vendorDisputeSponsor === ethers.ZeroAddress) {
        console.log("🧪 Test de simulation avec le nouveau montant...");
        const testWallet = deployer;
        try {
            await contract.connect(testWallet).sendVendorDisputeSponsorFee.staticCall({
                value: requiredAmount,
            });
            console.log("  ✅ Simulation réussie avec le nouveau montant");
        } catch (e: any) {
            const errorMsg = e?.reason || e?.message || e?.toString() || "Unknown error";
            console.log("  ❌ Simulation échouée avec le nouveau montant:", errorMsg);
            
            // Essayer avec l'ancien montant si c'est OptimisticSOX
            if (!isOptimisticSOXAccount && totalBalanceAfterOld >= agreedPrice) {
                console.log("");
                console.log("🧪 Test de simulation avec l'ancien montant (compatibilité)...");
                try {
                    await contract.connect(testWallet).sendVendorDisputeSponsorFee.staticCall({
                        value: oldRequiredAmount,
                    });
                    console.log("  ✅ Simulation réussie avec l'ancien montant");
                    console.log("  💡 Le contrat semble être une ancienne version qui attend seulement DISPUTE_FEES + disputeTip");
                } catch (e2: any) {
                    const errorMsg2 = e2?.reason || e2?.message || e2?.toString() || "Unknown error";
                    console.log("  ❌ Simulation échouée aussi avec l'ancien montant:", errorMsg2);
                }
            }
        }
    } else if (state !== 3n) {
        console.log("⚠️  Le contrat n'est pas dans l'état WaitSV, impossible de tester sendVendorDisputeSponsorFee");
    } else {
        console.log("⚠️  Un sponsor vendor est déjà défini, impossible de tester");
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

import OptimisticSOXAccountArtifact from "../../app/lib/blockchain/contracts/OptimisticSOXAccount.json";
import OptimisticSOXArtifact from "../../app/lib/blockchain/contracts/OptimisticSOX.json";

/**
 * Script de diagnostic pour analyser un contrat OptimisticSOX/OptimisticSOXAccount
 * Usage: CONTRACT_ADDR=0x... npx hardhat run scripts/diagnoseContract.ts --network localhost
 */
async function main() {
    const contractAddr = process.env.CONTRACT_ADDR;
    if (!contractAddr) {
        console.error("❌ Veuillez fournir CONTRACT_ADDR");
        console.error("Usage: CONTRACT_ADDR=0x... npx hardhat run scripts/diagnoseContract.ts --network localhost");
        process.exit(1);
    }

    const provider = ethers.provider;
    const [deployer] = await hre.ethers.getSigners();

    console.log("=".repeat(80));
    console.log("🔍 DIAGNOSTIC DU CONTRAT");
    console.log("=".repeat(80));
    console.log("");
    console.log("Adresse du contrat:", contractAddr);
    console.log("");

    // Détecter le type de contrat
    let contract: ethers.Contract;
    let isOptimisticSOXAccount = false;
    let entryPointAddr: string | null = null;

    try {
        contract = new ethers.Contract(contractAddr, OptimisticSOXAccountArtifact.abi, provider);
        try {
            entryPointAddr = await contract.entryPoint();
            isOptimisticSOXAccount = entryPointAddr !== ethers.ZeroAddress;
        } catch {
            // Si entryPoint() n'existe pas, c'est OptimisticSOX
            contract = new ethers.Contract(contractAddr, OptimisticSOXArtifact.abi, provider);
        }
    } catch {
        contract = new ethers.Contract(contractAddr, OptimisticSOXArtifact.abi, provider);
    }

    console.log("📊 Type de contrat:", isOptimisticSOXAccount ? "OptimisticSOXAccount ✅" : "OptimisticSOX");
    if (isOptimisticSOXAccount && entryPointAddr) {
        console.log("  EntryPoint:", entryPointAddr);
    }
    console.log("");

    // Informations de base
    const state = await contract.currState();
    const stateNames = ["WaitPayment", "WaitKey", "WaitSB", "WaitSV", "InDispute", "End"];
    const stateName = stateNames[Number(state)] || `Unknown (${state})`;
    
    console.log("📊 État du contrat:");
    console.log("  État:", stateName, `(${state})`);
    console.log("");

    const agreedPrice = await contract.agreedPrice();
    const disputeTip = await contract.disputeTip();
    const completionTip = await contract.completionTip();
    const DISPUTE_FEES = 10n;

    console.log("💰 Montants:");
    console.log("  AgreedPrice:", agreedPrice.toString(), "wei");
    console.log("  DisputeTip:", disputeTip.toString(), "wei");
    console.log("  CompletionTip:", completionTip.toString(), "wei");
    console.log("  DISPUTE_FEES:", DISPUTE_FEES.toString(), "wei");
    console.log("");

    // Vérifier les sponsors
    const buyerDisputeSponsor = await contract.buyerDisputeSponsor();
    const vendorDisputeSponsor = await contract.vendorDisputeSponsor();
    
    console.log("👥 Sponsors:");
    console.log("  Buyer dispute sponsor:", buyerDisputeSponsor);
    console.log("  Vendor dispute sponsor:", vendorDisputeSponsor);
    console.log("");

    // Vérifier les balances
    const contractBalance = await provider.getBalance(contractAddr);
    console.log("💵 Balances:");
    console.log("  Balance du contrat:", contractBalance.toString(), "wei");
    console.log("");

    // Calculer les montants requis
    const requiredAmount = DISPUTE_FEES + disputeTip + agreedPrice;
    const oldRequiredAmount = DISPUTE_FEES + disputeTip;
    const totalBalanceAfter = contractBalance + requiredAmount;
    const totalBalanceAfterOld = contractBalance + oldRequiredAmount;

    console.log("💳 Montants requis:");
    console.log("  Nouveau montant (recommandé):", requiredAmount.toString(), "wei");
    console.log("    (DISPUTE_FEES:", DISPUTE_FEES, "+ disputeTip:", disputeTip.toString(), "+ agreedPrice:", agreedPrice.toString(), ")");
    console.log("  Ancien montant (compatibilité):", oldRequiredAmount.toString(), "wei");
    console.log("    (DISPUTE_FEES:", DISPUTE_FEES, "+ disputeTip:", disputeTip.toString(), ")");
    console.log("");

    console.log("📊 Balance après envoi:");
    console.log("  Avec nouveau montant:", totalBalanceAfter.toString(), "wei");
    console.log("  Avec ancien montant:", totalBalanceAfterOld.toString(), "wei");
    console.log("  AgreedPrice requis:", agreedPrice.toString(), "wei");
    console.log("  ✅ Balance totale >= AgreedPrice (nouveau):", totalBalanceAfter >= agreedPrice ? "OUI" : "NON");
    console.log("  ✅ Balance totale >= AgreedPrice (ancien):", totalBalanceAfterOld >= agreedPrice ? "OUI" : "NON");
    console.log("");

    // Vérifier le contrat de dispute s'il existe
    try {
        const disputeContract = await contract.disputeContract();
        if (disputeContract !== ethers.ZeroAddress) {
            console.log("📄 Contrat de dispute déjà déployé:", disputeContract);
            console.log("  ⚠️  Le contrat est déjà en dispute, vous ne pouvez plus envoyer les frais.");
        } else {
            console.log("📄 Contrat de dispute: Non déployé");
        }
    } catch {
        console.log("📄 Contrat de dispute: Non déployé");
    }
    console.log("");

    // Vérifier le code du contrat pour voir s'il correspond à la version attendue
    const code = await provider.getCode(contractAddr);
    console.log("📦 Code du contrat:");
    console.log("  Taille du code:", code.length, "caractères");
    console.log("  Code non vide:", code !== "0x" ? "OUI ✅" : "NON ❌");
    console.log("");

    // Si c'est WaitSV et qu'il n'y a pas de sponsor vendor, tester la simulation
    if (state === 3n && vendorDisputeSponsor === ethers.ZeroAddress) {
        console.log("🧪 Test de simulation avec le nouveau montant...");
        const testWallet = deployer;
        try {
            await contract.connect(testWallet).sendVendorDisputeSponsorFee.staticCall({
                value: requiredAmount,
            });
            console.log("  ✅ Simulation réussie avec le nouveau montant");
        } catch (e: any) {
            const errorMsg = e?.reason || e?.message || e?.toString() || "Unknown error";
            console.log("  ❌ Simulation échouée avec le nouveau montant:", errorMsg);
            
            // Essayer avec l'ancien montant si c'est OptimisticSOX
            if (!isOptimisticSOXAccount && totalBalanceAfterOld >= agreedPrice) {
                console.log("");
                console.log("🧪 Test de simulation avec l'ancien montant (compatibilité)...");
                try {
                    await contract.connect(testWallet).sendVendorDisputeSponsorFee.staticCall({
                        value: oldRequiredAmount,
                    });
                    console.log("  ✅ Simulation réussie avec l'ancien montant");
                    console.log("  💡 Le contrat semble être une ancienne version qui attend seulement DISPUTE_FEES + disputeTip");
                } catch (e2: any) {
                    const errorMsg2 = e2?.reason || e2?.message || e2?.toString() || "Unknown error";
                    console.log("  ❌ Simulation échouée aussi avec l'ancien montant:", errorMsg2);
                }
            }
        }
    } else if (state !== 3n) {
        console.log("⚠️  Le contrat n'est pas dans l'état WaitSV, impossible de tester sendVendorDisputeSponsorFee");
    } else {
        console.log("⚠️  Un sponsor vendor est déjà défini, impossible de tester");
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
