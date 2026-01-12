import { ethers } from "ethers";
import Database from "better-sqlite3";
import path from "path";
import fs from "fs";
import { join } from "node:path";
import { readFile } from "node:fs/promises";
import {
    bytes_to_hex,
    compute_precontract_values_v2,
    compute_proofs_left_v2,
    evaluate_circuit_v2_wasm,
    initSync,
} from "../src/app/lib/crypto_lib/crypto_lib";

// Constants
const PROVIDER_URL = "http://127.0.0.1:8545";
const DISPUTE_CONTRACT = "0xfCb4B28B8395310bb17841280EC9b0A2e7d531F0"; // Nouveau contrat
const DB_PATH = path.join(__dirname, "../src/app/db/sox.sqlite");

// ABI minimal pour le contrat
const DISPUTE_ABI = [
    "function currState() view returns (uint8)",
    "function a() view returns (uint32)",
    "function chall() view returns (uint32)",
    "function getBuyerResponse(uint32) view returns (bytes32)",
    "function optimisticContract() view returns (address)",
    "function submitCommitmentLeft(bytes,uint32,bytes,bytes[],bytes32,bytes32[][],bytes32[][],bytes32[][])",
];

const OPTIMISTIC_ABI = [
    "function key() view returns (bytes)",
];

// Load full ABI
const DISPUTE_FULL_ABI = JSON.parse(
    fs.readFileSync(
        path.join(__dirname, "../src/app/lib/blockchain/contracts/DisputeSOXAccount.json"),
        "utf-8"
    )
).abi;

async function main() {
    console.log("🧪 Test d'envoi des preuves avec debug détaillé");
    console.log("=".repeat(80));
    
    // Initialize WASM
    const modulePath = join(__dirname, "../src/app/lib/crypto_lib/crypto_lib_bg.wasm");
    const module = await readFile(modulePath);
    initSync({ module: module });
    console.log("✅ WASM initialisé\n");
    
    // Connect to provider
    const provider = new ethers.JsonRpcProvider(PROVIDER_URL);
    
    // Get signers (using private keys from hardhat accounts)
    // For local testing, use account #2 (vendor)
    const privateKey = "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d"; // Account #2 from hardhat
    const vendorWallet = new ethers.Wallet(privateKey, provider);
    console.log(`📊 Vendor wallet: ${await vendorWallet.getAddress()}\n`);
    
    // Load contract
    const dispute = new ethers.Contract(DISPUTE_CONTRACT, DISPUTE_FULL_ABI, provider);
    
    // Get contract state
    const state = Number(await dispute.currState());
    const a = Number(await dispute.a());
    const chall = Number(await dispute.chall());
    console.log(`📊 État du contrat:`);
    console.log(`   État: ${state} (3 = WaitVendorDataLeft)`);
    console.log(`   a(): ${a}`);
    console.log(`   chall(): ${chall}`);
    console.log(`   Gate à vérifier: ${a} (gate 1)\n`);
    
    // Get buyer response
    const buyerResponse = await dispute.getBuyerResponse(a);
    console.log(`📊 buyerResponses[${a}]: ${buyerResponse}\n`);
    
    // Get optimistic contract
    const optimisticAddr = await dispute.optimisticContract();
    console.log(`📊 OptimisticContract: ${optimisticAddr}\n`);
    
    // Get key from optimistic contract
    const optimisticContract = new ethers.Contract(optimisticAddr, OPTIMISTIC_ABI, provider);
    const keyBytesHex = await optimisticContract.key();
    const keyBytes = ethers.getBytes(keyBytesHex);
    const keyHex = ethers.hexlify(keyBytes);
    console.log(`📊 Clé AES: ${keyHex}`);
    console.log(`   Key length: ${keyBytes.length} bytes\n`);
    
    // Read database
    const db = new Database(DB_PATH);
    const contractRow = db.prepare(`
        SELECT 
            c.id,
            c.optimistic_smart_contract,
            c.item_description,
            c.commitment,
            c.opening_value,
            d.dispute_smart_contract
        FROM contracts c
        LEFT JOIN disputes d ON c.id = d.contract_id
        WHERE d.dispute_smart_contract = ?
    `).get(DISPUTE_CONTRACT);
    
    if (!contractRow) {
        console.error(`❌ Contrat ${DISPUTE_CONTRACT} non trouvé dans la base de données`);
        db.close();
        process.exit(1);
    }
    
    console.log(`📊 Données de la base de données:`);
    console.log(`   Contract ID: ${contractRow.id}`);
    console.log(`   Item description: ${contractRow.item_description}`);
    console.log(`   Commitment: ${contractRow.commitment}`);
    console.log(`   Opening value: ${contractRow.opening_value?.slice(0, 20)}...\n`);
    
    
    // Read test_65bytes.bin file (or use item_description if it's a file hash)
    const testFilePath = path.join(__dirname, "../test_65bytes.bin");
    if (!fs.existsSync(testFilePath)) {
        console.error(`❌ Fichier test_65bytes.bin non trouvé: ${testFilePath}`);
        db.close();
        process.exit(1);
    }
    
    const fileBytes = fs.readFileSync(testFilePath);
    console.log(`📊 Fichier test_65bytes.bin:`);
    console.log(`   Chemin: ${testFilePath}`);
    console.log(`   Taille: ${fileBytes.length} bytes\n`);
    
    // Use opening value from database instead of computing precontract
    // The file has already been encrypted and the commitment is in the database
    // We need to read the circuit from somewhere - let's try to get it from the API or compute it
    // For now, let's compute the precontract to get circuit and ct
    console.log("🔧 Calcul du precontract (pour obtenir circuit et ct)...");
    const keyHexString = bytes_to_hex(keyBytes);
    const precontract = compute_precontract_values_v2(fileBytes, keyHexString);
    const circuitBytes = precontract.circuit_bytes;
    const ct = precontract.ct;
    const commitmentCalculated = precontract.commitment;
    const commitmentHex = bytes_to_hex(commitmentCalculated.c);
    console.log(`✅ Precontract calculé`);
    console.log(`   Circuit size: ${circuitBytes.length} bytes`);
    console.log(`   CT size: ${ct.length} bytes`);
    console.log(`   Commitment calculé: ${commitmentHex}`);
    console.log(`   Commitment DB: ${contractRow.commitment}`);
    if (commitmentHex.toLowerCase() !== contractRow.commitment.toLowerCase()) {
        console.log(`   ⚠️  ATTENTION: Commitment calculé ne correspond pas au commitment du contrat!`);
        console.log(`   → Le fichier utilisé pourrait être différent`);
    }
    console.log();
    
    // Use opening value from database
    const openingValueHex = openingValue.startsWith("0x") ? openingValue : "0x" + openingValue;
    
    // Evaluate circuit
    console.log("🔧 Évaluation du circuit...");
    const evaluatedCircuit = evaluate_circuit_v2_wasm(circuitBytes, ct, keyHexString).to_bytes();
    console.log(`✅ Circuit évalué: ${evaluatedCircuit.length} bytes\n`);
    
    // Compute proofs
    console.log(`🔧 Calcul des preuves pour gate ${a} (challenge = ${a})...`);
    const proofs = compute_proofs_left_v2(circuitBytes, evaluatedCircuit, ct, a);
    
    console.log(`✅ Preuves calculées:`);
    console.log(`   gate_bytes length: ${proofs.gate_bytes.length} bytes`);
    console.log(`   values count: ${proofs.values.length}`);
    console.log(`   curr_acc: ${bytes_to_hex(proofs.curr_acc).slice(0, 20)}...`);
    console.log(`   proof1 layers: ${proofs.proof1.length}`);
    console.log(`   proof2 layers: ${proofs.proof2.length}`);
    console.log(`   proof_ext layers: ${proofs.proof_ext.length}\n`);
    
    // Compare curr_acc with buyerResponse
    const currAccHex = bytes_to_hex(proofs.curr_acc);
    console.log(`🔍 Comparaison:`);
    console.log(`   curr_acc: ${currAccHex}`);
    console.log(`   buyerResponses[${a}]: ${buyerResponse}`);
    if (currAccHex.toLowerCase() === buyerResponse.toLowerCase()) {
        console.log(`   ⚠️  curr_acc == buyerResponses[${a}] (les valeurs sont identiques)`);
    } else {
        console.log(`   ✅ curr_acc != buyerResponses[${a}] (les valeurs sont différentes)`);
    }
    console.log();
    
    // Convert proofs to format for contract
    const gateBytesArray = new Uint8Array(proofs.gate_bytes);
    const valuesArray = proofs.values.map((v: Uint8Array) => new Uint8Array(v));
    const currAccArray = new Uint8Array(proofs.curr_acc);
    const proof1Array = proofs.proof1.map((level: Uint8Array[]) =>
        level.map((v: Uint8Array) => ethers.hexlify(new Uint8Array(v)))
    );
    const proof2Array = proofs.proof2.map((level: Uint8Array[]) =>
        level.map((v: Uint8Array) => ethers.hexlify(new Uint8Array(v)))
    );
    const proofExtArray = proofs.proof_ext.map((level: Uint8Array[]) =>
        level.map((v: Uint8Array) => ethers.hexlify(new Uint8Array(v)))
    );
    
    // Try to call submitCommitmentLeft with staticCall first to see the error
    console.log("🧪 Test avec staticCall (simulation)...");
    console.log(`📤 Appel de submitCommitmentLeft avec staticCall...`);
    console.log(`   gateNum: ${a}`);
    console.log(`   openingValue: ${openingValueHex.slice(0, 20)}...`);
    console.log(`   gateBytes length: ${gateBytesArray.length}`);
    console.log(`   values count: ${valuesArray.length}`);
    console.log(`   currAcc: ${bytes_to_hex(proofs.curr_acc).slice(0, 20)}...`);
    console.log();
    
    try {
        await dispute.connect(vendor).submitCommitmentLeft.staticCall(
            openingValueHex,
            a, // gateNum = 1
            gateBytesArray,
            valuesArray,
            currAccArray,
            proof1Array,
            proof2Array,
            proofExtArray
        );
        console.log("✅ staticCall réussi (pas d'erreur détectée)\n");
    } catch (error: any) {
        console.error("❌ staticCall échoué:");
        console.error("   Type:", error.constructor.name);
        console.error("   Message:", error.message);
        console.error("   Short message:", error.shortMessage);
        console.error("   Reason:", error.reason);
        
        // Try to decode error data
        const errorData = error.data || error.error?.data || error.cause?.data;
        if (errorData) {
            console.error("   Error data:", errorData);
            if (typeof errorData === 'string' && errorData.startsWith('0x')) {
                const selector = errorData.slice(0, 10);
                console.error("   Error selector:", selector);
                
                // Try to decode using contract interface
                try {
                    const parsed = dispute.interface.parseError(errorData);
                    if (parsed) {
                        console.error("   Parsed error:", parsed.name);
                        if (parsed.args) {
                            console.error("   Error args:", parsed.args);
                        }
                    }
                } catch (e) {
                    // Ignore
                }
            }
        }
        
        console.error("\n   Stack:", error.stack?.split('\n').slice(0, 10).join('\n'));
        console.error();
    }
    
    db.close();
    console.log("✅ Test terminé");
}

main().catch((error) => {
    console.error("❌ Erreur fatale:", error);
    process.exit(1);
});

