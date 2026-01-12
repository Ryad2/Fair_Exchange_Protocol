import { ethers } from "hardhat";
import Database from "better-sqlite3";
import { readFileSync } from "fs";
import { join } from "path";
import {
    initSync,
    compute_precontract_values_v2,
    compute_proofs_v2,
    compute_proofs_left_v2,
    evaluate_circuit_v2_wasm,
    hpre_v2,
    bytes_to_hex,
} from "../../app/lib/crypto_lib/crypto_lib";

const DISPUTE_ADDRESS = process.env.DISPUTE_ADDRESS || "0x6a90D73D17bf8d3DD5f5924fc0d5D9e8af23042d";
const DB_PATH = join(__dirname, "../../app/db/sox.sqlite");

async function main() {
    console.log("🔍 DIAGNOSTIC DU CONTRAT");
    console.log("=".repeat(80));
    console.log(`Contrat: ${DISPUTE_ADDRESS}\n`);

    // Initialize WASM
    const wasmPath = join(__dirname, "../../app/lib/crypto_lib/crypto_lib_bg.wasm");
    const wasmBytes = readFileSync(wasmPath);
    initSync({ module: wasmBytes });
    console.log("✅ WASM initialisé\n");

    // Load database
    const db = new Database(DB_PATH);
    const contractRow = db.prepare(`
        SELECT c.id, c.opening_value, c.item_description, c.commitment,
               c.optimistic_smart_contract, c.num_blocks, c.num_gates
        FROM contracts c
        LEFT JOIN disputes d ON c.id = d.contract_id
        WHERE d.dispute_smart_contract = ? OR d.dispute_smart_contract LIKE ?
    `).get(DISPUTE_ADDRESS, `%${DISPUTE_ADDRESS.slice(2).toLowerCase()}%`) as any;

    const [deployer] = await ethers.getSigners();

    // Try to get contract from blockchain
    let dispute: any = null;
    let state: number | null = null;
    let a: number | null = null;
    let b: number | null = null;
    let chall: number | null = null;
    let numBlocks: number;
    let numGates: number;
    let commitment: string;
    let optimisticAddr: string | null = null;
    let key: string | null = null;

    try {
        dispute = await ethers.getContractAt("DisputeSOXAccount", DISPUTE_ADDRESS);
        state = Number(await dispute.currState());
        a = Number(await dispute.a());
        b = Number(await dispute.b());
        chall = Number(await dispute.chall());
        numBlocks = Number(await dispute.numBlocks());
        numGates = Number(await dispute.numGates());
        commitment = await dispute.commitment();
        optimisticAddr = await dispute.optimisticContract();
        console.log(`✅ Contrat trouvé sur la blockchain\n`);
    } catch (error: any) {
        console.log(`⚠️  Contrat non accessible sur la blockchain: ${error.message}`);
        if (contractRow) {
            console.log(`   Utilisation des données de la base de données.\n`);
            numBlocks = contractRow.num_blocks;
            numGates = contractRow.num_gates;
            commitment = contractRow.commitment;
            optimisticAddr = contractRow.optimistic_smart_contract;
        } else {
            console.log(`❌ Contrat non trouvé dans la base de données non plus!`);
            db.close();
            return;
        }
    }

    const stateNames: { [key: number]: string } = {
        0: "ChallengeBuyer",
        1: "WaitSB",
        2: "WaitVendorData",
        3: "WaitVendorDataLeft",
        4: "WaitVendorDataRight",
        5: "Complete",
        6: "Cancel",
        7: "End",
    };

    console.log(`📊 ÉTAT DU CONTRAT:`);
    if (state !== null) {
        console.log(`   État: ${state} (${stateNames[state] || "UNKNOWN"})`);
        if (a !== null && b !== null && chall !== null) {
            console.log(`   a: ${a}, b: ${b}, chall: ${chall}`);
        }
    } else {
        console.log(`   État: Non disponible`);
    }
    console.log(`   numBlocks: ${numBlocks}, numGates: ${numGates}`);
    console.log(`   Commitment: ${commitment}`);
    console.log(`   OptimisticContract: ${optimisticAddr}\n`);

    // Get key from optimistic contract
    if (optimisticAddr) {
        try {
            const optimistic = await ethers.getContractAt("OptimisticSOXAccount", optimisticAddr);
            key = await optimistic.key();
            console.log(`🔑 Clé AES: ${key}\n`);
        } catch (e: any) {
            console.log(`⚠️  Impossible de récupérer la clé: ${e.message}\n`);
        }
    }

    // Check buyer responses
    if (dispute && chall !== null) {
        console.log("📋 Buyer Responses:");
        const maxCheck = Math.min(chall + 2, numGates + 1);
        for (let i = 1; i <= maxCheck; i++) {
            try {
                const response = await dispute.buyerResponses(i);
                if (response !== ethers.ZeroHash) {
                    console.log(`   buyerResponses[${i}]: ${response}`);
                }
            } catch (e) {
                // Ignore
            }
        }
        console.log();
    }

    // If state is Cancel, analyze why
    if (state === 6) {
        console.log("❌ ÉTAT: Cancel (Vendeur a perdu)");
        console.log("\n🔍 ANALYSE: Pourquoi le vendeur a perdu?\n");

        if (!dispute || chall === null || !key) {
            console.log("⚠️  Données insuffisantes pour analyser complètement");
            db.close();
            return;
        }

        // Calculate proofs and check wi ≠ wi'
        if (chall >= 1 && chall <= numGates) {
            console.log(`🧪 TEST: Simulation de submitCommitment pour challenge=${chall}\n`);

            try {
                const buyerResponse = await dispute.buyerResponses(chall);
                if (buyerResponse === ethers.ZeroHash) {
                    console.log(`❌ buyerResponses[${chall}] n'est pas défini!`);
                    db.close();
                    return;
                }

                console.log(`📊 Calcul des preuves...`);
                const openingValueHex = contractRow.opening_value.startsWith('0x') 
                    ? contractRow.opening_value 
                    : '0x' + contractRow.opening_value;
                const itemDescriptionBytes = new Uint8Array(Buffer.from(contractRow.item_description.slice(2), 'hex'));

                const keyUint8Array = new Uint8Array(ethers.getBytes(ethers.hexlify(key)));
                const precontract = compute_precontract_values_v2(itemDescriptionBytes, keyUint8Array);
                const circuit = new Uint8Array(precontract.circuit_bytes);
                const ct = new Uint8Array(precontract.ct);
                const evaluatedCircuit = evaluate_circuit_v2_wasm(circuit, ct, bytes_to_hex(keyUint8Array));
                const evaluatedCircuitBytes = evaluatedCircuit.to_bytes();

                const proofs = compute_proofs_v2(circuit, evaluatedCircuitBytes, ct, chall);
                const currAccBytes32 = ethers.hexlify(proofs.curr_acc);

                console.log(`\n📊 COMPARAISON wi vs wi':`);
                console.log(`   _currAcc (wi) calculé: ${currAccBytes32}`);
                console.log(`   buyerResponses[${chall}] (wi'): ${buyerResponse}`);

                if (buyerResponse.toLowerCase() === currAccBytes32.toLowerCase()) {
                    console.log(`\n❌ PROBLÈME IDENTIFIÉ: wi == wi'`);
                    console.log(`   buyerResponses[${chall}] == _currAcc`);
                    console.log(`   La condition wi ≠ wi' dans Step 8a a échoué!`);
                    console.log(`   C'est pourquoi le vendeur a perdu.`);
                    console.log(`\n💡 EXPLICATION:`);
                    console.log(`   Si wi == wi', cela signifie que le buyer n'a pas menti`);
                    console.log(`   (ou que les fichiers sont identiques).`);
                    console.log(`   Dans Step 8a, le vendeur doit prouver une DIVERGENCE`);
                    console.log(`   pour gagner. Sans divergence, il ne peut pas gagner.`);
                } else {
                    console.log(`\n✅ wi ≠ wi' (divergence détectée)`);
                    console.log(`   La condition wi ≠ wi' sera satisfaite.`);
                    console.log(`   Si le vendeur a perdu, le problème doit être ailleurs:`);
                    console.log(`   - Preuves invalides (proof1, proof2, proof3, proofExt)`);
                    console.log(`   - Problème d'indexation (IV dans proof2)`);
                    console.log(`   - Le contrat utilise une ancienne version du code`);
                }
            } catch (error: any) {
                console.log(`⚠️  Erreur lors de l'analyse: ${error.message}`);
                console.log(error.stack);
            }
        } else if (chall === 1) {
            console.log(`🧪 TEST: Simulation de submitCommitmentLeft pour challenge=1`);
            console.log("   (Analyse similaire à faire)");
        }
    } else if (state === 5) {
        console.log("✅ ÉTAT: Complete (Vendeur a gagné)");
    } else if (state !== null) {
        console.log(`📊 État actuel: ${stateNames[state] || "UNKNOWN"}`);
        console.log("   (Le contrat n'est pas encore dans l'état Cancel ou Complete)");
    }

    console.log("\n" + "=".repeat(80));
    db.close();
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
