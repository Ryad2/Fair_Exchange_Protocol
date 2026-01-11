/**
 * Script complet pour tester l'envoi de preuve au contrat de dispute
 * 
 * Ce script utilise les fonctions existantes pour:
 * 1. Récupérer les données nécessaires depuis l'API
 * 2. Générer la preuve avec compute_proof_right_v2
 * 3. Envoyer la preuve via submitCommitmentRight (UserOperation)
 * 
 * Usage:
 *   cd /Applications/sox_implementation
 *   npx tsx scripts/test_send_proof_right_complete.ts [CONTRACT_ID]
 * 
 * Exemple:
 *   npx tsx scripts/test_send_proof_right_complete.ts 19
 */

import { ethers } from "ethers";
import { 
    initSync, 
    compute_proof_right_v2, 
    hex_to_bytes,
    compile_circuit_v2_wasm,
    evaluate_circuit_v2_wasm
} from "../app/lib/crypto_lib/crypto_lib";
import { readFileSync } from "fs";
import * as path from "path";
import { submitCommitmentRight } from "../app/lib/blockchain/dispute";
import { getBasicInfo } from "../app/lib/blockchain/optimistic";

const CONTRACT_ADDR = "0x8FcA62a1955c73360C11aDEd96F07aDC10C3754E";
const VENDOR_ADDR = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266";
const API_URL = process.env.API_URL || "http://localhost:3000";
const CONTRACT_ID = process.argv[2] || "19";

// ABI pour vérifier l'état
const ABI = [
    "function currState() view returns (uint8)",
    "function numGates() view returns (uint32)",
    "function numBlocks() view returns (uint32)",
    "function vendor() view returns (address)",
    "function optimisticContract() view returns (address)",
];

async function main() {
    console.log("🧪 Test complet d'envoi de preuve pour submitCommitmentRight\n");
    
    try {
        // 1. Initialiser WASM
        console.log("🔧 Initialisation WASM...");
        const wasmPath = path.join(__dirname, "../app/lib/crypto_lib/crypto_lib_bg.wasm");
        if (!require("fs").existsSync(wasmPath)) {
            throw new Error(`Fichier WASM introuvable: ${wasmPath}`);
        }
        const wasmModule = readFileSync(wasmPath);
        initSync({ module: wasmModule });
        console.log("✅ WASM initialisé\n");
        
        // 2. Se connecter au contrat
        const provider = new ethers.JsonRpcProvider("http://localhost:8545");
        const contract = new ethers.Contract(CONTRACT_ADDR, ABI, provider);
        
        console.log(`📋 Contrat: ${CONTRACT_ADDR}`);
        console.log(`📋 ID du contrat: ${CONTRACT_ID}\n`);
        
        // 3. Vérifier l'état
        const state = await contract.currState();
        const numGates = await contract.numGates();
        const numBlocks = await contract.numBlocks();
        const vendorAddr = await contract.vendor();
        const optimisticContractAddr = await contract.optimisticContract();
        
        console.log("📊 État du contrat:");
        console.log(`   État: ${state} (4 = WaitVendorDataRight)`);
        console.log(`   NumGates: ${numGates}`);
        console.log(`   NumBlocks: ${numBlocks}`);
        console.log(`   Vendor: ${vendorAddr}`);
        console.log(`   Optimistic Contract: ${optimisticContractAddr}\n`);
        
        if (Number(state) !== 4) {
            throw new Error(`Le contrat n'est pas dans l'état WaitVendorDataRight (état 4). État actuel: ${state}`);
        }
        
        // 4. Vérifier que le vendor correspond
        if (vendorAddr.toLowerCase() !== VENDOR_ADDR.toLowerCase()) {
            console.warn(`⚠️  Le vendor du contrat (${vendorAddr}) ne correspond pas à l'adresse attendue (${VENDOR_ADDR})`);
            console.log(`   Utilisation du vendor du contrat: ${vendorAddr}`);
        }
        
        // 5. Récupérer la clé depuis le contrat optimiste
        console.log("🔑 Récupération de la clé depuis le contrat optimiste...");
        const basicInfo = await getBasicInfo(optimisticContractAddr);
        if (!basicInfo || !basicInfo.key || basicInfo.key === "0x") {
            throw new Error("La clé n'est pas encore définie dans le contrat optimiste");
        }
        const key = hex_to_bytes(basicInfo.key);
        console.log(`✅ Clé récupérée: ${basicInfo.key.slice(0, 20)}...\n`);
        
        // 6. Récupérer le ciphertext depuis l'API
        console.log("📦 Récupération du ciphertext depuis l'API...");
        const fileResponse = await fetch(`${API_URL}/api/files/${CONTRACT_ID}`);
        if (!fileResponse.ok) {
            throw new Error(`Erreur lors de la récupération du fichier (${fileResponse.status}): ${await fileResponse.text()}`);
        }
        const fileData = await fileResponse.json();
        const ct = hex_to_bytes(fileData.file);
        console.log(`✅ Ciphertext récupéré: ${ct.length} bytes\n`);
        
        // 7. Récupérer item_description depuis la base de données
        console.log("📋 Récupération de item_description depuis la base de données...");
        const sqlite = require("better-sqlite3");
        const dbPath = path.resolve(process.cwd(), "src/app/db/sox.sqlite");
        if (!require("fs").existsSync(dbPath)) {
            throw new Error(`Base de données introuvable: ${dbPath}`);
        }
        const db = sqlite(dbPath);
        const stmt = db.prepare("SELECT item_description FROM contracts WHERE id = ?");
        const row = stmt.get(parseInt(CONTRACT_ID)) as { item_description: string } | undefined;
        if (!row) {
            db.close();
            throw new Error(`Contrat ${CONTRACT_ID} introuvable dans la base de données`);
        }
        const item_description = row.item_description;
        db.close();
        console.log(`✅ item_description récupéré: ${item_description.slice(0, 20)}...\n`);
        
        // 8. Compiler le circuit
        console.log("🔧 Compilation du circuit...");
        const circuit = compile_circuit_v2_wasm(ct, item_description);
        console.log("✅ Circuit compilé\n");
        
        // 9. Évaluer le circuit
        console.log("🔧 Évaluation du circuit...");
        const evaluated_circuit = evaluate_circuit_v2_wasm(circuit, ct, key).to_bytes();
        console.log(`✅ Circuit évalué: ${evaluated_circuit.length} bytes\n`);
        
        // 10. Générer la preuve
        console.log("🔧 Génération de la preuve avec compute_proof_right_v2...");
        const proof = compute_proof_right_v2(evaluated_circuit, numBlocks, numGates);
        console.log(`✅ Preuve générée: ${proof.length} couches\n`);
        
        // 11. Envoyer la preuve
        console.log("📤 Envoi de la preuve via submitCommitmentRight...");
        const userOpHash = await submitCommitmentRight(
            proof,
            vendorAddr,
            CONTRACT_ADDR
        );
        console.log(`✅ Preuve envoyée! Hash: ${userOpHash}\n`);
        
        // 12. Vérifier l'état final
        console.log("⏳ Attente de la confirmation...");
        await new Promise(resolve => setTimeout(resolve, 3000)); // Attendre 3 secondes
        
        const finalState = await contract.currState();
        console.log(`📊 État final: ${finalState}`);
        
        if (Number(finalState) === 0 || Number(finalState) === 5 || Number(finalState) === 6) {
            console.log("✅ Transaction réussie! L'état du contrat a changé.");
        } else {
            console.log("⚠️  L'état n'a pas changé comme attendu. Vérifiez la transaction.");
        }
        
        console.log("\n✅ Test terminé avec succès!");
        
    } catch (error: any) {
        console.error("\n❌ Erreur:", error);
        console.error("Message:", error?.message || error?.toString());
        if (error?.stack) {
            console.error("Stack:", error.stack);
        }
        process.exit(1);
    }
}

main();

