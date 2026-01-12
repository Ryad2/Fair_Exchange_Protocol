import { ethers } from "hardhat";
import { Contract } from "ethers";
import Database from "better-sqlite3";
import { readFileSync } from "fs";
import { join } from "path";
import {
    initSync,
    compute_precontract_values_v2,
    compute_proofs_v2,
    compute_proofs_left_v2,
    evaluate_circuit_v2_wasm,
    bytes_to_hex,
    hex_to_bytes,
} from "../../app/lib/crypto_lib/crypto_lib";

const DISPUTE_ADDRESS = "0x03EBDA66EB1A84E21eAA71A42759a2E5d03ca35c";
const OPTIMISTIC_ADDRESS = "0xa138575a030a2F4977D19Cc900781E7BE3fD2bc0";
const DB_PATH = join(__dirname, "../../app/db/sox.sqlite");

async function main() {
    console.log("🔍 DIAGNOSTIC: Pourquoi le vendeur a perdu?");
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

    if (!contractRow) {
        console.log("❌ ERREUR: Contrat non trouvé dans la base de données!");
        console.log("   Vérifiez que l'adresse est correcte.");
        db.close();
        return;
    }
    console.log(`✅ Contrat trouvé dans la base de données (ID: ${contractRow.id})\n`);

    // Try to connect to contract on blockchain
    const [deployer] = await ethers.getSigners();
    const disputeAbi = [
        "function currState() view returns (uint8)",
        "function a() view returns (uint32)",
        "function b() view returns (uint32)",
        "function chall() view returns (uint32)",
        "function optimisticContract() view returns (address)",
        "function buyerResponses(uint32) view returns (bytes32)",
        "function commitment() view returns (bytes32)",
        "function numBlocks() view returns (uint32)",
        "function numGates() view returns (uint32)",
    ];

    let dispute: Contract | null = null;
    let state: number | null = null;
    let a: number | null = null;
    let b: number | null = null;
    let chall: number | null = null;
    let numBlocks: number;
    let numGates: number;
    let commitment: string;

    // Check if contract exists on blockchain - try multiple methods
    try {
        // Method 1: Try getContractAt
        dispute = await ethers.getContractAt("DisputeSOXAccount", DISPUTE_ADDRESS);
        state = Number(await dispute.currState());
        a = Number(await dispute.a());
        b = Number(await dispute.b());
        chall = Number(await dispute.chall());
        numBlocks = Number(await dispute.numBlocks());
        numGates = Number(await dispute.numGates());
        commitment = await dispute.commitment();
        console.log(`✅ Contrat trouvé sur la blockchain\n`);
    } catch (error1: any) {
        // Method 2: Try with basic ABI
        try {
            const basicAbi = [
                "function currState() view returns (uint8)",
                "function a() view returns (uint32)",
                "function b() view returns (uint32)",
                "function chall() view returns (uint32)",
                "function numBlocks() view returns (uint32)",
                "function numGates() view returns (uint32)",
                "function commitment() view returns (bytes32)",
                "function buyerResponses(uint32) view returns (bytes32)",
                "function optimisticContract() view returns (address)",
            ];
            dispute = new Contract(DISPUTE_ADDRESS, basicAbi, deployer);
            state = Number(await dispute.currState());
            a = Number(await dispute.a());
            b = Number(await dispute.b());
            chall = Number(await dispute.chall());
            numBlocks = Number(await dispute.numBlocks());
            numGates = Number(await dispute.numGates());
            commitment = await dispute.commitment();
            console.log(`✅ Contrat trouvé avec ABI basique\n`);
        } catch (error2: any) {
            console.log(`⚠️  Contrat non accessible: ${error2.message}`);
            console.log(`   Utilisation des données de la base de données.\n`);
        }
    }

    // Use database values if blockchain values are not available
    if (numBlocks === undefined) numBlocks = contractRow.num_blocks;
    if (numGates === undefined) numGates = contractRow.num_gates;
    if (commitment === undefined) commitment = contractRow.commitment;

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
    
    if (state === null) {
        console.log("⚠️  État non disponible depuis la blockchain");
        console.log("   Le contrat doit être consulté sur le réseau de déploiement\n");
    } else {
        console.log(`📊 État actuel: ${state} (${stateNames[state] || "UNKNOWN"})`);
        if (a !== null && b !== null && chall !== null) {
            console.log(`   a: ${a}, b: ${b}, chall: ${chall}\n`);
        }
    }

    console.log(`📐 Paramètres: numBlocks=${numBlocks}, numGates=${numGates}`);
    console.log(`   Commitment: ${commitment}\n`);

    // Get optimistic contract
    let optimisticAddr: string | null = null;
    let key: string | null = null;
    if (dispute) {
        try {
            optimisticAddr = await dispute.optimisticContract();
            console.log(`📦 OptimisticContract: ${optimisticAddr}`);

            const optimisticAbi = [
                "function key() view returns (bytes16)",
                "function commitment() view returns (bytes32)",
            ];
            const optimistic = new Contract(optimisticAddr, optimisticAbi, deployer);
            key = await optimistic.key();
            console.log(`   Key: ${key}\n`);
        } catch (error: any) {
            console.log(`⚠️  Impossible de récupérer la clé depuis la blockchain: ${error.message}\n`);
        }
    }

    if (!optimisticAddr) {
        optimisticAddr = contractRow.optimistic_smart_contract;
        console.log(`📦 OptimisticContract (DB): ${optimisticAddr}\n`);
    }

    // Check buyer responses
    if (dispute) {
        console.log("📋 Buyer Responses (blockchain):");
        const maxCheck = chall !== null ? Math.min(chall + 2, numGates + 1) : numGates + 1;
        for (let i = 1; i <= maxCheck; i++) {
            try {
                const response = await dispute.buyerResponses(i);
                if (response !== ethers.ZeroHash) {
                    console.log(`   buyerResponses[${i}]: ${response}`);
                }
            } catch (error) {
                // Ignore errors
            }
        }
        console.log();
    }

    // Check if we can analyze
    if (!dispute || chall === null) {
        console.log("⚠️  Impossible d'analyser: données manquantes");
        db.close();
        return;
    }
    
    // If state is Complete or Cancel, check what happened
    if (state === 5) {
        console.log("✅ État: Complete (Vendeur a gagné)");
    } else if (state === 6) {
        console.log("❌ État: Cancel (Vendeur a perdu)");
    } else {
        console.log(`📊 État actuel: ${stateNames[state] || "UNKNOWN"}`);
        console.log("   (Le contrat n'est pas encore dans l'état Cancel ou Complete)");
    }
    
    console.log("\n🔍 ANALYSE: Vérification de la condition wi ≠ wi'");
    
    // Try to simulate proof submission for current challenge
    if (chall >= 1 && chall <= numGates) {
        console.log(`\n🧪 TEST: Simulation de submitCommitment pour challenge=${chall}`);
        
        try {
            const buyerResponse = await dispute.buyerResponses(chall);
            if (buyerResponse === ethers.ZeroHash) {
                console.log(`❌ buyerResponses[${chall}] n'est pas défini!`);
                console.log(`   Le buyer doit répondre au challenge ${chall} d'abord.`);
                db.close();
                return;
            }
            console.log(`✅ buyerResponses[${chall}] (wi') = ${buyerResponse}`);
            
            if (chall > 1) {
                const prevResponse = await dispute.buyerResponses(chall - 1);
                if (prevResponse === ethers.ZeroHash) {
                    console.log(`⚠️  buyerResponses[${chall - 1}] n'est pas défini (nécessaire pour proof3)`);
                } else {
                    console.log(`✅ buyerResponses[${chall - 1}] = ${prevResponse}`);
                }
            }
            
            // Calculate proofs and check wi ≠ wi'
            console.log("\n📊 Calcul des preuves...");
            const openingValueHex = contractRow.opening_value.startsWith('0x') 
                ? contractRow.opening_value 
                : '0x' + contractRow.opening_value;
            const itemDescriptionBytes = new Uint8Array(Buffer.from(contractRow.item_description.slice(2), 'hex'));
            
            // Get key from optimistic contract
            if (!key) {
                try {
                    const optimistic = await ethers.getContractAt("OptimisticSOXAccount", OPTIMISTIC_ADDRESS);
                    key = await optimistic.key();
                    console.log(`✅ Clé récupérée depuis OptimisticSOXAccount: ${key}`);
                } catch (e1: any) {
                    try {
                        const optimisticAbi = ["function key() view returns (bytes16)"];
                        const optimistic = new Contract(OPTIMISTIC_ADDRESS, optimisticAbi, deployer);
                        key = await optimistic.key();
                        console.log(`✅ Clé récupérée avec ABI basique: ${key}`);
                    } catch (e2: any) {
                        console.log(`⚠️  Impossible de récupérer la clé depuis la blockchain: ${e2.message}`);
                        console.log(`   Tentative avec les données de la base de données...`);
                        // Try to get from database or use a default
                        db.close();
                        return;
                    }
                }
            }
            
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
                console.log(`   La condition wi ≠ wi' dans Step 8a va échouer!`);
                console.log(`   Le vendeur ne pourra pas prouver une divergence.`);
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
        console.log(`\n🧪 TEST: Simulation de submitCommitmentLeft pour challenge=1`);
        console.log("⚠️  Pour calculer les preuves, nous avons besoin du fichier original.");
    } else if (chall === numGates + 1) {
        console.log(`\n🧪 TEST: Simulation de submitCommitmentRight`);
        try {
            const buyerResponse = await dispute.buyerResponses(numGates);
            if (buyerResponse === ethers.ZeroHash) {
                console.log(`❌ buyerResponses[${numGates}] n'est pas défini!`);
            } else {
                console.log(`✅ buyerResponses[${numGates}] = ${buyerResponse}`);
            }
        } catch (e) {
            // Ignore
        }
    }

    console.log("\n" + "=".repeat(80));
    console.log("💡 POSSIBLES CAUSES:");
    console.log("  1. Les preuves générées ne correspondent pas au code du contrat");
    console.log("     → Le contrat utilise peut-être une ancienne version sans les corrections");
    console.log("  2. La condition wi ≠ wi' dans Step 8a a échoué");
    console.log("     → buyerResponses[chall] == _currAcc (pas de divergence)");
    console.log("  3. Une des vérifications de preuve a échoué");
    console.log("     → proof1, proof2, proof3, ou proofExt invalides");
    console.log("  4. Le fichier utilisé ne correspond pas au commitment");
    console.log("     → Le commitment calculé ne correspond pas au commitment du contrat");
    console.log("  5. Les indices dans proof2 ne correspondent pas (problème IV)");
    console.log("     → Le contrat utilise peut-être l'ancienne version sans correction IV");
    console.log("=".repeat(80));
    
    db.close();
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});

