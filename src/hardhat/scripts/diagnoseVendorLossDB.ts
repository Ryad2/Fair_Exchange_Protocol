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
    hex_to_bytes,
} from "../../app/lib/crypto_lib/crypto_lib";
import { ethers } from "ethers";

const DISPUTE_ADDRESS = "0x03EBDA66EB1A84E21eAA71A42759a2E5d03ca35c";
const OPTIMISTIC_ADDRESS = "0xa138575a030a2F4977D19Cc900781E7BE3fD2bc0";
const DB_PATH = join(__dirname, "../../app/db/sox.sqlite";

async function main() {
    console.log("🔍 DIAGNOSTIC: Pourquoi le vendeur a perdu? (Base de données uniquement)");
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
        db.close();
        return;
    }
    console.log(`✅ Contrat trouvé dans la base de données (ID: ${contractRow.id})\n`);

    const numBlocks = contractRow.num_blocks;
    const numGates = contractRow.num_gates;
    const commitment = contractRow.commitment;
    console.log(`📐 Paramètres: numBlocks=${numBlocks}, numGates=${numGates}`);
    console.log(`   Commitment: ${commitment}\n`);

    // Get file data
    const openingValueHex = contractRow.opening_value.startsWith('0x') 
        ? contractRow.opening_value 
        : '0x' + contractRow.opening_value;
    const itemDescriptionBytes = new Uint8Array(Buffer.from(contractRow.item_description.slice(2), 'hex'));

    // Get key from optimistic contract (we'll try to get it, but if not available, we'll use a placeholder)
    console.log("🔑 Récupération de la clé AES...");
    console.log(`   OptimisticContract: ${OPTIMISTIC_ADDRESS}`);
    
    // For now, we'll calculate hpre for different challenges to see what the buyer should have responded
    console.log("\n📊 CALCUL DES ACCUMULATEURS (hpre) pour différents challenges:");
    console.log("   (Ces valeurs représentent ce que le buyer DEVRAIT avoir répondu)\n");
    
    // We need the key to calculate hpre, but we can try to infer it or use the database
    // For now, let's assume we can get it from the optimistic contract or calculate it
    
    // Calculate precontract to get circuit and evaluated circuit
    // We need the key - let's try to get it from a test or use a default
    console.log("⚠️  Pour calculer les preuves, nous avons besoin de la clé AES.");
    console.log("   La clé devrait être récupérée depuis l'OptimisticSOXAccount.");
    console.log("   Si Hardhat est en cours d'exécution, nous pouvons la récupérer.\n");
    
    // Try to get key from blockchain if possible
    try {
        const provider = new ethers.JsonRpcProvider("http://127.0.0.1:8545");
        const optimisticAbi = ["function key() view returns (bytes16)"];
        const optimistic = new ethers.Contract(OPTIMISTIC_ADDRESS, optimisticAbi, provider);
        const key = await optimistic.key();
        console.log(`✅ Clé récupérée depuis la blockchain: ${key}\n`);
        
        // Now calculate proofs
        const keyUint8Array = new Uint8Array(ethers.getBytes(ethers.hexlify(key)));
        const precontract = compute_precontract_values_v2(itemDescriptionBytes, keyUint8Array);
        const circuit = new Uint8Array(precontract.circuit_bytes);
        const ct = new Uint8Array(precontract.ct);
        const evaluatedCircuit = evaluate_circuit_v2_wasm(circuit, ct, bytes_to_hex(keyUint8Array));
        const evaluatedCircuitBytes = evaluatedCircuit.to_bytes();
        
        // Calculate hpre for challenges 1-10
        console.log("📊 Calcul de hpre pour différents challenges:");
        for (let i = 1; i <= Math.min(10, numGates + 1); i++) {
            const hpre = hpre_v2(evaluatedCircuitBytes, numBlocks, i);
            const hpreHex = bytes_to_hex(hpre);
            console.log(`   hpre(${i}) = ${hpreHex}`);
        }
        console.log();
        
        // For challenge 5 (current challenge based on previous output)
        const chall = 5;
        console.log(`\n🧪 ANALYSE POUR CHALLENGE ${chall}:`);
        const hpre5 = hpre_v2(evaluatedCircuitBytes, numBlocks, chall);
        const hpre5Hex = bytes_to_hex(hpre5);
        const hpre5Bytes32 = ethers.hexlify(hpre5);
        
        console.log(`   hpre(${chall}) calculé (wi): ${hpre5Bytes32}`);
        console.log(`\n💡 Si le buyer a répondu avec cette valeur exacte, alors:`);
        console.log(`   - wi == wi' (pas de divergence)`);
        console.log(`   - La condition wi ≠ wi' dans Step 8a va échouer`);
        console.log(`   - Le vendeur ne pourra pas prouver une divergence`);
        console.log(`   - Le vendeur perdra même avec le bon fichier`);
        
    } catch (error: any) {
        console.log(`⚠️  Impossible de récupérer la clé: ${error.message}`);
        console.log(`\n💡 POUR DIAGNOSTIQUER COMPLÈTEMENT:`);
        console.log(`   1. Assurez-vous que Hardhat est en cours d'exécution (npx hardhat node)`);
        console.log(`   2. Ou fournissez la clé AES manuellement`);
        console.log(`   3. Ou utilisez un script qui se connecte au réseau de déploiement`);
    }

    console.log("\n" + "=".repeat(80));
    console.log("💡 CAUSE PROBABLE:");
    console.log("   Le vendeur a perdu car wi == wi' (pas de divergence)");
    console.log("   Dans Step 8a, le vendeur DOIT prouver une divergence (wi ≠ wi')");
    console.log("   Si le buyer n'a pas menti, wi == wi' et le vendeur ne peut pas gagner.");
    console.log("=".repeat(80));
    
    db.close();
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});


