import hre from "hardhat";
import { ethers } from "hardhat";
import { parseEther } from "ethers";
import fs from "fs";
import path from "path";
import { join } from "node:path";
import { readFile } from "node:fs/promises";
import Database from "better-sqlite3";
import {
    bytes_to_hex,
    compute_precontract_values_v2,
    compute_proofs_left_v2,
    evaluate_circuit_v2_wasm,
    initSync,
} from "../../app/lib/crypto_lib/crypto_lib";

const DISPUTE_ADDRESS = process.env.DISPUTE_ADDR || "0xfCb4B28B8395310bb17841280EC9b0A2e7d531F0";

async function main() {
    const [sponsor, buyer, vendor, sbSponsor, svSponsor] = await hre.ethers.getSigners();
    const provider = ethers.provider;

    console.log("=".repeat(80));
    console.log("🧪 TEST verifyCommitmentLeft DIRECT (simulation interne)");
    console.log("=".repeat(80));
    console.log(`📋 Contrat dispute: ${DISPUTE_ADDRESS}\n`);

    // Load contract
    const dispute = await ethers.getContractAt("DisputeSOXAccount", DISPUTE_ADDRESS);

    // Get contract state
    const state = Number(await dispute.currState());
    const a = Number(await dispute.a());
    const commitment = await dispute.commitment();
    const optimisticAddr = await dispute.optimisticContract();
    const contractVendor = await dispute.vendor();
    
    // Find the signer that matches the contract vendor
    const allSigners = [sponsor, buyer, vendor, sbSponsor, svSponsor];
    const vendorSigner = allSigners.find(s => s.address.toLowerCase() === contractVendor.toLowerCase());
    
    if (!vendorSigner) {
        console.error(`❌ Aucun signer ne correspond au vendor du contrat: ${contractVendor}`);
        console.error(`   Signers disponibles:`);
        for (let i = 0; i < allSigners.length; i++) {
            console.error(`     [${i}]: ${allSigners[i].address}`);
        }
        process.exit(1);
    }
    
    console.log(`📊 État: ${state} (3 = WaitVendorDataLeft)`);
    console.log(`📊 Gate demandée (a): ${a}`);
    console.log(`📊 Vendor dans le contrat: ${contractVendor}`);
    console.log(`📊 Vendor signer trouvé: ${await vendorSigner.getAddress()}`);
    console.log();

    // Get key from optimistic contract
    const optimisticContract = await ethers.getContractAt("OptimisticSOXAccount", optimisticAddr);
    const keyBytesHex = await optimisticContract.key();
    const keyBytes = ethers.getBytes(keyBytesHex);
    // Convert to Uint8Array (compute_precontract_values_v2 expects Uint8Array, not hex string)
    const key = new Uint8Array(keyBytes);
    const keyHexString = "0x" + Array.from(keyBytes).map(b => b.toString(16).padStart(2, '0')).join('');
    console.log(`📊 Clé AES: ${keyHexString}`);
    console.log(`   Key length: ${key.length} bytes\n`);

    // Initialize WASM
    const modulePath = join(__dirname, "../../app/lib/crypto_lib/crypto_lib_bg.wasm");
    const module = await readFile(modulePath);
    initSync({ module: module });
    console.log("✅ WASM initialisé\n");

    // Read test_65bytes.bin
    const filePath = path.join(__dirname, "../../../test_65bytes.bin");
    const fileBuffer = fs.readFileSync(filePath);
    const fileContent = new Uint8Array(fileBuffer);
    console.log(`📊 Fichier test_65bytes.bin: ${fileContent.length} bytes\n`);

    // Compute precontract
    // Note: compute_precontract_values_v2 expects the key as a Uint8Array
    console.log("🔧 Calcul du precontract...");
    const precontract = compute_precontract_values_v2(fileContent, key);
    const circuitBytes = precontract.circuit_bytes;
    const ct = precontract.ct;
    const commitmentHex = "0x" + Array.from(new Uint8Array(precontract.commitment.c)).map(b => b.toString(16).padStart(2, '0')).join('');
    console.log(`✅ Precontract calculé`);
    console.log(`   Commitment calculé: ${commitmentHex}`);
    console.log(`   Commitment contrat: ${commitment}`);
    
    if (commitmentHex.toLowerCase() !== commitment.toLowerCase()) {
        console.log(`   ⚠️  ATTENTION: Commitments ne correspondent pas!`);
        console.log(`   → Le fichier ou la clé utilisés sont différents`);
    }
    console.log();

    // Evaluate circuit
    // evaluate_circuit_v2_wasm expects key as hex string (without 0x prefix)
    const keyHexStringNoPrefix = keyHexString.startsWith('0x') ? keyHexString.slice(2) : keyHexString;
    const evaluatedBytes = evaluate_circuit_v2_wasm(circuitBytes, ct, keyHexStringNoPrefix).to_bytes();
    console.log("✅ Circuit évalué\n");

    // Compute proofs
    console.log(`🔧 Calcul des preuves pour gate ${a}...`);
    const proofs = compute_proofs_left_v2(circuitBytes, evaluatedBytes, ct, a);
    console.log(`✅ Preuves calculées\n`);

    // Convert proofs
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

    // Convert to hex strings manually
    // Get opening value from database
    const dbPath = join(__dirname, "../../app/db/sox.sqlite");
    const db = new Database(dbPath);
    const contractRow = db.prepare(`
        SELECT c.opening_value, c.commitment
        FROM contracts c
        LEFT JOIN disputes d ON c.id = d.contract_id
        WHERE d.dispute_smart_contract = ?
    `).get(DISPUTE_ADDRESS);
    
    let openingValueHex: string;
    if (contractRow && contractRow.opening_value) {
        openingValueHex = contractRow.opening_value.startsWith('0x') 
            ? contractRow.opening_value 
            : '0x' + contractRow.opening_value;
        console.log(`📊 Opening value depuis la base de données: ${openingValueHex.slice(0, 20)}...\n`);
    } else {
        // Fallback: use computed opening value
        openingValueHex = "0x" + Array.from(new Uint8Array(precontract.commitment.o)).map(b => b.toString(16).padStart(2, '0')).join('');
        console.log(`⚠️  Opening value non trouvé dans la base de données, utilisation de celui calculé\n`);
    }
    db.close();
    
    const currAccHex = "0x" + Array.from(new Uint8Array(proofs.curr_acc)).map(b => b.toString(16).padStart(2, '0')).join('');
    const buyerResponse = await dispute.getBuyerResponse(a);
    
    console.log(`🔍 Comparaison curr_acc:`);
    console.log(`   curr_acc: ${currAccHex}`);
    console.log(`   buyerResponses[${a}]: ${buyerResponse}`);
    if (currAccHex.toLowerCase() === buyerResponse.toLowerCase()) {
        console.log(`   ⚠️  curr_acc == buyerResponses[${a}] (identiques)`);
    } else {
        console.log(`   ✅ curr_acc != buyerResponses[${a}] (différents)`);
    }
    console.log();

    // Try to call via execute() to simulate user operation
    // But first, we need to simulate the userOp context
    // Since verifyCommitmentLeft is internal, we can't call it directly
    // We must call submitCommitmentLeft, which requires the right msg.sender
    
    console.log("🧪 Test 1: Appel direct submitCommitmentLeft avec le bon vendor...");
    try {
        const result = await dispute.connect(vendorSigner).submitCommitmentLeft.staticCall(
            openingValueHex,
            a,
            gateBytesArray,
            valuesArray,
            currAccArray,
            proof1Array,
            proof2Array,
            proofExtArray
        );
        console.log("✅ staticCall réussi! (pas d'erreur de modificateur)\n");
        console.log("   Cela signifie que les preuves passent la vérification.\n");
    } catch (error: any) {
        console.error("❌ staticCall échoué:");
        console.error(`   Message: ${error.message || error.shortMessage || error.reason}`);
        
        const errorData = error.data || error.error?.data || error.cause?.data;
        if (errorData) {
            try {
                const parsed = dispute.interface.parseError(errorData);
                if (parsed) {
                    console.error(`   Erreur parsée: ${parsed.name}`);
                    if (parsed.args) {
                        console.error(`   Args:`, parsed.args);
                    }
                }
            } catch (e) {
                // ignore
            }
            
            // Show error selector
            if (typeof errorData === 'string' && errorData.startsWith('0x')) {
                const selector = errorData.slice(0, 10);
                console.error(`   Error selector: ${selector}`);
                if (selector === '0x9167c27a') {
                    console.error(`   → TransactionReverted() - Erreur interne au contrat`);
                } else if (selector === '0x7e9b5e6a') {
                    console.error(`   → UnexpectedSender() - Le wallet n'est pas le vendor`);
                } else if (selector === '0xd2a8406a') {
                    console.error(`   → InvalidState() - Le contrat n'est pas dans le bon état`);
                }
            }
        }
        console.log();
        
        // Additional diagnostics
        const errorMsg = error.message || error.shortMessage || error.reason || '';
        const errorDataStr = typeof errorData === 'string' ? errorData : '';
        
        if (errorMsg.includes('UnexpectedSender') || errorDataStr.includes('0x7e9b5e6a')) {
            console.log("💡 Problème: Le wallet utilisé n'est pas le vendor du contrat.");
            console.log("   (Mais on devrait utiliser le bon signer maintenant...)");
        } else if (errorMsg.includes('TransactionReverted') || errorDataStr.includes('0x9167c27a')) {
            console.log("💡 Problème: Erreur interne au contrat (TransactionReverted).");
            console.log("   Cela peut être dû à:");
            console.log("   1. Les preuves ne passent pas la vérification");
            console.log("   2. Un problème avec l'évaluation de la gate (AES, etc.)");
            console.log("   3. Un problème avec le commitment/opening value");
            console.log("   4. Un autre problème dans verifyCommitmentLeft");
        } else if (errorMsg.includes('Commitment and opening value do not match')) {
            console.log("💡 Problème: Le commitment et l'opening value ne correspondent pas!");
            console.log("   Cela signifie que:");
            console.log("   1. L'opening value utilisé ne correspond pas au commitment du contrat");
            console.log("   2. Il faut utiliser l'opening value de la base de données, pas celui calculé");
            console.log("   3. Ou le fichier/clé utilisés ne correspondent pas à ceux du contrat");
        }
        console.log();
    }

    console.log("✅ Test terminé");
}

main().catch((error) => {
    console.error("❌ Erreur:", error);
    process.exit(1);
});
