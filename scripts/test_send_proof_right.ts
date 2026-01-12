/**
 * Script de test pour envoyer les preuves au contrat de dispute
 * 
 * Ce script:
 * 1. Vérifie l'état du contrat
 * 2. Récupère les données nécessaires depuis l'API
 * 3. Génère la preuve avec compute_proof_right_v2
 * 4. Envoie la preuve via submitCommitmentRight (UserOperation)
 * 
 * Usage:
 *   cd /Applications/sox_implementation
 *   npx ts-node scripts/test_send_proof_right.ts
 */

import { ethers } from "ethers";
import { 
    initSync, 
    compute_proof_right_v2, 
    hex_to_bytes,
    compile_circuit_v2_wasm,
    evaluate_circuit_v2_wasm
} from "./app/lib/crypto_lib/crypto_lib";
import { readFileSync } from "fs";
import * as path from "path";
import { submitCommitmentRight } from "./app/lib/blockchain/dispute";
import { PK_SK_MAP } from "./app/lib/blockchain/config";

const CONTRACT_ADDR = "0x8FcA62a1955c73360C11aDEd96F07aDC10C3754E";
const VENDOR_ADDR = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266";
const CONTRACT_ID = "19"; // Remplacer par l'ID réel du contrat
const RPC_URL = "http://127.0.0.1:8545";
const API_URL = "http://localhost:3000"; // URL de l'API Next.js

// ABI minimal pour vérifier l'état
const ABI = [
    "function currState() view returns (uint8)",
    "function numGates() view returns (uint32)",
    "function numBlocks() view returns (uint32)",
    "function vendor() view returns (address)",
];

async function main() {
    console.log("🧪 Test d'envoi de preuve pour submitCommitmentRight\n");
    
    try {
        // 1. Initialiser WASM
        console.log("🔧 Initialisation WASM...");
        const wasmPath = path.join(__dirname, "../app/lib/crypto_lib/crypto_lib_bg.wasm");
        const wasmModule = readFileSync(wasmPath);
        initSync({ module: wasmModule });
        console.log("✅ WASM initialisé\n");
        
        // 2. Se connecter au contrat
        const provider = new ethers.JsonRpcProvider(RPC_URL);
        const contract = new ethers.Contract(CONTRACT_ADDR, ABI, provider);
        
        console.log(`📋 Contrat: ${CONTRACT_ADDR}`);
        
        // 3. Vérifier l'état
        const state = await contract.currState();
        const numGates = await contract.numGates();
        const numBlocks = await contract.numBlocks();
        const vendorAddr = await contract.vendor();
        
        console.log("📊 État du contrat:");
        console.log(`   État: ${state} (4 = WaitVendorDataRight)`);
        console.log(`   NumGates: ${numGates}`);
        console.log(`   NumBlocks: ${numBlocks}`);
        console.log(`   Vendor: ${vendorAddr}\n`);
        
        if (Number(state) !== 4) {
            throw new Error(`Le contrat n'est pas dans l'état WaitVendorDataRight (état 4). État actuel: ${state}`);
        }
        
        // Vérifier que le vendor est correct
        if (vendorAddr.toLowerCase() !== VENDOR_ADDR.toLowerCase()) {
            console.warn(`⚠️  Le vendor du contrat (${vendorAddr}) ne correspond pas à l'adresse attendue (${VENDOR_ADDR})`);
            console.log(`   Utilisation du vendor du contrat: ${vendorAddr}`);
        }
        
        // 4. Vérifier que la clé privée existe pour le vendor
        const actualVendorAddr = vendorAddr.toLowerCase();
        if (!PK_SK_MAP.has(actualVendorAddr)) {
            throw new Error(`Clé privée non trouvée pour l'adresse ${actualVendorAddr}`);
        }
        console.log("✅ Clé privée trouvée pour le vendor\n");
        
        // 5. Récupérer les données depuis l'API
        console.log("📦 Récupération des données depuis l'API...");
        
        // Récupérer le ciphertext
        const fileResponse = await fetch(`${API_URL}/api/files/${CONTRACT_ID}`);
        if (!fileResponse.ok) {
            throw new Error(`Erreur lors de la récupération du fichier: ${fileResponse.status}`);
        }
        const fileData = await fileResponse.json();
        const ct = hex_to_bytes(fileData.file);
        console.log(`   ✅ Ciphertext récupéré: ${ct.length} bytes`);
        
        // Récupérer les informations du contrat (key, item_description, etc.)
        // Note: Vous devrez adapter cette partie selon votre API
        // Pour l'instant, on va supposer que vous avez accès à ces données
        
        console.log("\n⚠️  Pour compléter ce script, vous devez:");
        console.log("   1. Récupérer la clé (key) depuis le contrat optimiste ou la base de données");
        console.log("   2. Récupérer item_description depuis la base de données");
        console.log("   3. Compiler le circuit avec compile_circuit_v2_wasm");
        console.log("   4. Évaluer le circuit avec evaluate_circuit_v2_wasm");
        console.log("   5. Générer la preuve avec compute_proof_right_v2");
        console.log("   6. Envoyer la preuve avec submitCommitmentRight\n");
        
        // Exemple de code (à compléter avec les vraies données):
        /*
        const key = hex_to_bytes("0x558f8003b47eb84c1e7d445f7106ad5a"); // Récupérer depuis le contrat
        const item_description = "0x..."; // Récupérer depuis la base de données
        
        console.log("🔧 Compilation du circuit...");
        const circuit = compile_circuit_v2_wasm(ct, item_description);
        console.log("✅ Circuit compilé");
        
        console.log("🔧 Évaluation du circuit...");
        const evaluated_circuit = evaluate_circuit_v2_wasm(circuit, ct, key).to_bytes();
        console.log("✅ Circuit évalué");
        
        console.log("🔧 Génération de la preuve...");
        const proof = compute_proof_right_v2(evaluated_circuit, numBlocks, numGates);
        console.log(`✅ Preuve générée: ${proof.length} couches`);
        
        console.log("📤 Envoi de la preuve...");
        const userOpHash = await submitCommitmentRight(
            proof,
            actualVendorAddr,
            CONTRACT_ADDR
        );
        console.log(`✅ Preuve envoyée! Hash: ${userOpHash}`);
        */
        
        console.log("✅ Script terminé (exemple de code fourni, à compléter avec les vraies données)");
        
    } catch (error: any) {
        console.error("❌ Erreur:", error);
        console.error("Stack:", error.stack);
        process.exit(1);
    }
}

main();





