import { ethers } from "hardhat";
import DisputeSOXAccountABI from "../artifacts/contracts/DisputeSOXAccount.sol/DisputeSOXAccount.json";
import OptimisticSOXAccountABI from "../artifacts/contracts/OptimisticSOXAccount.sol/OptimisticSOXAccount.json";
import * as fs from "fs";
import * as path from "path";

// Import WASM functions (you'll need to adjust the path based on your setup)
// For now, we'll assume the WASM functions are available via a global object or require

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
    const disputeAddr = process.env.DISPUTE_ADDR || "0xf2dd97Fc5b0A9ac0ea5b2DE87Dfe7c4f9fb4CE98";
    
    if (!ethers.isAddress(disputeAddr)) {
        console.error("❌ Adresse invalide:", disputeAddr);
        process.exit(1);
    }

    console.log("\n" + "=".repeat(80));
    console.log("🧪 TEST ENVOI DES PREUVES");
    console.log("=".repeat(80));
    console.log(`\n📋 Contrat de dispute: ${disputeAddr}\n`);

    const provider = ethers.provider;
    const dispute = new ethers.Contract(disputeAddr, DisputeSOXAccountABI.abi, provider);

    try {
        // Vérifier si le contrat existe
        const code = await provider.getCode(disputeAddr);
        if (!code || code === "0x") {
            console.error("❌ Aucun contrat trouvé à cette adresse!");
            process.exit(1);
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
            console.error("❌ Clé AES non définie dans OptimisticSOXAccount!");
            process.exit(1);
        }
        console.log(`✅ Clé AES récupérée: ${ethers.hexlify(key).slice(0, 20)}...\n`);

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
        if (stateNum === 2) {
            // WaitVendorData - submitCommitment
            console.log("📤 État: WaitVendorData (submitCommitment)");
            console.log(`   Gate demandée: ${a} (1-indexed, gate ${Number(a) - 1} en 0-indexed)`);
            console.log("   ⚠️  Pour envoyer les preuves, utilisez compute_proofs_v2 avec challenge =", a);
            
        } else if (stateNum === 3) {
            // WaitVendorDataLeft - submitCommitmentLeft
            console.log("📤 État: WaitVendorDataLeft (submitCommitmentLeft)");
            console.log(`   Gate demandée: ${a} (devrait être 1)`);
            console.log("   ⚠️  Pour envoyer les preuves, utilisez compute_proofs_left_v2 avec challenge =", a);
            
        } else if (stateNum === 4) {
            // WaitVendorDataRight - submitCommitmentRight
            console.log("📤 État: WaitVendorDataRight (submitCommitmentRight)");
            console.log(`   Challenge: ${chall} (devrait être ${Number(numGates) + 1})`);
            console.log("   ⚠️  Pour envoyer les preuves, utilisez compute_proof_right_v2");
            console.log("   ⚠️  Vérifier que buyerResponses[numGates] est défini");
            
            const buyerResponseNumGates = await dispute.getBuyerResponse(numGates);
            if (buyerResponseNumGates === ethers.ZeroHash) {
                console.log("   ❌ buyerResponses[numGates] n'est PAS défini!");
            } else {
                console.log(`   ✅ buyerResponses[numGates] est défini: ${buyerResponseNumGates.slice(0, 20)}...`);
            }
            
        } else {
            console.log(`   ⚠️  L'état actuel (${STATE_NAMES[stateNum]}) n'est pas un état d'envoi de preuves`);
            console.log("   💡 Les preuves ne peuvent être envoyées que dans les états:");
            console.log("      - WaitVendorData (2)");
            console.log("      - WaitVendorDataLeft (3)");
            console.log("      - WaitVendorDataRight (4)");
        }

        console.log("\n" + "=".repeat(80));
        console.log("📝 INSTRUCTIONS POUR ENVOYER LES PREUVES");
        console.log("=".repeat(80));
        console.log("\n1. Récupérez le ciphertext depuis l'API ou le fichier téléchargé");
        console.log("2. Utilisez les fonctions WASM pour générer les preuves:");
        if (stateNum === 3) {
            console.log(`   - compute_proofs_left_v2(circuit, evaluated_circuit, ct, ${a})`);
        } else if (stateNum === 4) {
            console.log(`   - compute_proof_right_v2(evaluated_circuit, ${numBlocks}, ${numGates})`);
        } else if (stateNum === 2) {
            console.log(`   - compute_proofs_v2(circuit, evaluated_circuit, ct, ${a})`);
        }
        console.log("3. Utilisez l'interface frontend ou un script pour envoyer les preuves via UserOperation");
        console.log("\n");

    } catch (error: any) {
        console.error(`\n❌ Erreur:`, error.message);
        if (error.data) {
            console.error(`   Données d'erreur:`, error.data);
        }
        console.error(error);
    }

    console.log("=".repeat(80) + "\n");
}

main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error(error);
        process.exit(1);
    });


