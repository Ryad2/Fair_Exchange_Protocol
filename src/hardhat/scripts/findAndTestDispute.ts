import { ethers } from "hardhat";
import DisputeSOXAccountABI from "../artifacts/contracts/DisputeSOXAccount.sol/DisputeSOXAccount.json";
import OptimisticSOXAccountABI from "../artifacts/contracts/OptimisticSOXAccount.sol/OptimisticSOXAccount.json";

const STATE_NAMES = [
    "ChallengeBuyer",      // 0
    "WaitVendorOpinion",   // 1
    "WaitVendorData",      // 2
    "WaitVendorDataLeft",  // 3
    "WaitVendorDataRight", // 4
    "Complete",            // 5
    "Cancel",              // 6
    "End"                  // 7
];

async function main() {
    // L'adresse fournie est probablement le compte smart ou le contrat OptimisticSOXAccount
    // Essayons de trouver le contrat de dispute
    const providedAddr = process.env.CONTRACT_ADDR || "0xf2dd97Fc5b0A9ac0ea5b2DE87Dfe7c4f9fb4CE98";
    
    console.log("\n" + "=".repeat(80));
    console.log("🔍 RECHERCHE DU CONTRAT DE DISPUTE");
    console.log("=".repeat(80));
    console.log(`\n📋 Adresse fournie: ${providedAddr}\n`);

    const provider = ethers.provider;
    
    try {
        // Vérifier si c'est un contrat OptimisticSOXAccount
        const code = await provider.getCode(providedAddr);
        if (code && code !== "0x") {
            console.log("✅ Code trouvé à cette adresse (", code.length, "bytes)");
            
            // Essayer de lire disputeContract
            try {
                const optimisticContract = new ethers.Contract(
                    providedAddr,
                    OptimisticSOXAccountABI.abi,
                    provider
                );
                const disputeAddr = await optimisticContract.disputeContract();
                if (disputeAddr && disputeAddr !== ethers.ZeroAddress) {
                    console.log(`✅ Contrat de dispute trouvé: ${disputeAddr}\n`);
                    await checkDisputeState(disputeAddr, provider);
                    return;
                } else {
                    console.log("⚠️  disputeContract n'est pas défini (pas encore en dispute)\n");
                }
            } catch (e) {
                // Ce n'est pas un OptimisticSOXAccount, essayons directement comme DisputeSOXAccount
                console.log("⚠️  Ce n'est pas un OptimisticSOXAccount, essayons comme DisputeSOXAccount...\n");
                await checkDisputeState(providedAddr, provider);
                return;
            }
        }
        
        // Si aucune adresse n'a fonctionné, l'adresse fournie n'est pas valide
        console.log("❌ Impossible de trouver un contrat à cette adresse");
        console.log("\n💡 Pour utiliser ce script:");
        console.log("   1. Trouvez l'adresse du contrat OptimisticSOXAccount (depuis l'interface frontend)");
        console.log("   2. Utilisez: CONTRACT_ADDR=<ADRESSE_OPTIMISTIC> npx hardhat run scripts/findAndTestDispute.ts");
        
    } catch (error: any) {
        console.error(`\n❌ Erreur:`, error.message);
        console.error(error);
    }

    console.log("\n" + "=".repeat(80) + "\n");
}

async function checkDisputeState(disputeAddr: string, provider: any) {
    console.log("\n" + "=".repeat(80));
    console.log("📊 ÉTAT DU CONTRAT DE DISPUTE");
    console.log("=".repeat(80));
    console.log(`\n📋 Contrat: ${disputeAddr}\n`);

    const dispute = new ethers.Contract(disputeAddr, DisputeSOXAccountABI.abi, provider);

    try {
        // Vérifier si le contrat existe
        const code = await provider.getCode(disputeAddr);
        if (!code || code === "0x") {
            console.error("❌ Aucun contrat trouvé à cette adresse!");
            return;
        }
        console.log("✅ Contrat trouvé (code:", code.length, "bytes)\n");

        // Récupérer l'état actuel
        const state = await dispute.currState();
        const stateNum = Number(state);
        console.log(`🔹 État actuel: ${stateNum} (${STATE_NAMES[stateNum] || "UNKNOWN"})`);

        // Récupérer les informations du contrat
        const chall = await dispute.chall();
        const a = await dispute.a();
        const numBlocks = await dispute.numBlocks();
        const numGates = await dispute.numGates();
        const commitment = await dispute.commitment();
        const optimisticContractAddr = await dispute.optimisticContract();
        
        console.log(`🔹 Challenge actuel: ${chall}`);
        console.log(`🔹 Gate demandée (a): ${a}`);
        console.log(`🔹 Nombre de blocs: ${numBlocks}`);
        console.log(`🔹 Nombre de gates: ${numGates}`);
        console.log(`🔹 Commitment: ${commitment}`);
        console.log(`🔹 Contrat OptimisticSOXAccount: ${optimisticContractAddr}\n`);

        // Récupérer le vendor signer
        const vendorSigner = await dispute.vendorSigner();
        console.log(`🔹 VendorSigner: ${vendorSigner}\n`);

        // Récupérer la clé AES depuis OptimisticSOXAccount
        const optimisticContract = new ethers.Contract(
            optimisticContractAddr,
            OptimisticSOXAccountABI.abi,
            provider
        );
        const key = await optimisticContract.key();
        if (!key || key.length === 0) {
            console.log("⚠️  Clé AES non définie dans OptimisticSOXAccount!\n");
        } else {
            console.log(`✅ Clé AES récupérée: ${ethers.hexlify(key).slice(0, 20)}...\n`);
        }

        // Vérifier les réponses du buyer
        console.log("📊 Réponses du buyer:");
        for (let i = 1; i <= Math.min(Number(chall), Number(numGates) + 1); i++) {
            try {
                const response = await dispute.getBuyerResponse(i);
                if (response !== ethers.ZeroHash) {
                    console.log(`   Challenge ${i}: ${response.slice(0, 20)}...`);
                } else {
                    console.log(`   Challenge ${i}: NON DÉFINI ❌`);
                }
            } catch (e) {
                console.log(`   Challenge ${i}: ERREUR ❌`);
            }
        }
        console.log("");

        // Déterminer quelle fonction appeler selon l'état
        console.log("\n" + "=".repeat(80));
        console.log("📤 INSTRUCTIONS POUR ENVOYER LES PREUVES");
        console.log("=".repeat(80));
        
        if (stateNum === 2) {
            // WaitVendorData - submitCommitment
            console.log("\n📤 État: WaitVendorData (submitCommitment)");
            console.log(`   Gate demandée: ${a} (1-indexed, gate ${Number(a) - 1} en 0-indexed)`);
            console.log(`   ⚠️  Utilisez compute_proofs_v2(circuit, evaluated_circuit, ct, ${a})`);
            
        } else if (stateNum === 3) {
            // WaitVendorDataLeft - submitCommitmentLeft
            console.log("\n📤 État: WaitVendorDataLeft (submitCommitmentLeft)");
            console.log(`   Gate demandée: ${a} (devrait être 1)`);
            console.log(`   ⚠️  Utilisez compute_proofs_left_v2(circuit, evaluated_circuit, ct, ${a})`);
            
        } else if (stateNum === 4) {
            // WaitVendorDataRight - submitCommitmentRight
            console.log("\n📤 État: WaitVendorDataRight (submitCommitmentRight)");
            console.log(`   Challenge: ${chall} (devrait être ${Number(numGates) + 1})`);
            console.log(`   ⚠️  Utilisez compute_proof_right_v2(evaluated_circuit, ${numBlocks}, ${numGates})`);
            console.log(`   ⚠️  Vérifier que buyerResponses[numGates] est défini`);
            
            const buyerResponseNumGates = await dispute.getBuyerResponse(numGates);
            if (buyerResponseNumGates === ethers.ZeroHash) {
                console.log("   ❌ buyerResponses[numGates] n'est PAS défini!");
            } else {
                console.log(`   ✅ buyerResponses[numGates] est défini: ${buyerResponseNumGates.slice(0, 20)}...`);
            }
            
        } else {
            console.log(`\n⚠️  L'état actuel (${STATE_NAMES[stateNum]}) n'est pas un état d'envoi de preuves`);
            console.log("   💡 Les preuves ne peuvent être envoyées que dans les états:");
            console.log("      - WaitVendorData (2)");
            console.log("      - WaitVendorDataLeft (3)");
            console.log("      - WaitVendorDataRight (4)");
        }

    } catch (error: any) {
        console.error(`\n❌ Erreur lors de la lecture du contrat:`, error.message);
        if (error.data) {
            console.error(`   Données d'erreur:`, error.data);
        }
        console.error(error);
    }

    console.log("\n" + "=".repeat(80) + "\n");
}

main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error(error);
        process.exit(1);
    });


