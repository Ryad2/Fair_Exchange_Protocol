import { ethers } from "hardhat";
import {
    initSync,
    compute_proofs_left_v2,
    compute_precontract_values_v2,
    evaluate_circuit_v2_wasm,
} from "../../app/lib/crypto_lib/crypto_lib";
import { join } from "path";
import { readFileSync } from "fs";
import Database from "better-sqlite3";

const DISPUTE_ADDRESS = process.env.DISPUTE_ADDRESS || "0xB76E7B83349568dbdA2D6D2D5463eA8a91016b73";

async function main() {
    console.log("🔍 ANALYSE DÉTAILLÉE DE verifyCommitmentLeft");
    console.log("=".repeat(80));
    console.log(`📋 Contrat: ${DISPUTE_ADDRESS}\n`);

    // Initialize WASM
    const wasmPath = join(__dirname, "../../app/lib/crypto_lib/crypto_lib_bg.wasm");
    const wasmBytes = readFileSync(wasmPath);
    initSync({ module: wasmBytes });
    console.log("✅ WASM initialisé\n");

    const dispute = await ethers.getContractAt("DisputeSOXAccount", DISPUTE_ADDRESS);

    // Get contract state
    const state = Number(await dispute.currState());
    const chall = Number(await dispute.chall());
    const vendorAddr = await dispute.vendor();

    console.log(`📊 État du contrat:`);
    console.log(`   - State: ${state}`);
    console.log(`   - chall: ${chall}`);
    console.log(`   - Vendor: ${vendorAddr}\n`);

    // Get contract details
    const numGates = Number(await dispute.numGates());
    const numBlocks = Number(await dispute.numBlocks());
    const commitment = await dispute.commitment();

    console.log(`📊 Détails:`);
    console.log(`   - numGates: ${numGates}`);
    console.log(`   - numBlocks: ${numBlocks}`);
    console.log(`   - commitment: ${commitment}\n`);

    // Get OptimisticSOXAccount
    const optimisticContractAddr = await dispute.optimisticContract();
    const optimisticContract = await ethers.getContractAt("OptimisticSOXAccount", optimisticContractAddr);
    const keyBytes = await optimisticContract.key();
    const keyHexString = ethers.hexlify(keyBytes);
    const keyBytesArray = ethers.getBytes(keyHexString);
    console.log(`📊 AES Key: ${keyHexString.slice(0, 20)}... (${keyBytesArray.length} bytes)\n`);

    // Get opening value from database
    const dbPath = join(__dirname, "../../app/db/sox.sqlite");
    const db = new Database(dbPath);

    const contractRow = db.prepare(`
        SELECT c.id, c.opening_value, c.optimistic_smart_contract 
        FROM contracts c
        LEFT JOIN disputes d ON c.id = d.contract_id
        WHERE d.dispute_smart_contract = ?
    `).get(DISPUTE_ADDRESS) as any;

    if (!contractRow) {
        throw new Error(`Contrat non trouvé dans la base de données pour ${DISPUTE_ADDRESS}`);
    }

    const openingValueHex = contractRow.opening_value.startsWith("0x") 
        ? contractRow.opening_value 
        : "0x" + contractRow.opening_value;
    console.log(`📊 Opening value: ${openingValueHex.slice(0, 40)}...\n`);

    // Get file data
    const filePath = join(__dirname, "../../app/public/test_65bytes.bin");
    const fileData = readFileSync(filePath);
    console.log(`📊 File: test_65bytes.bin (${fileData.length} bytes)\n`);

    // Calculate precontract values
    console.log("📐 Calcul des valeurs precontract...");
    const precontract = compute_precontract_values_v2(
        new Uint8Array(fileData),
        keyBytesArray
    );
    const circuitBytes = precontract.circuit_bytes;
    const ct = precontract.ct;
    console.log("✅ Precontract calculé\n");

    // Evaluate circuit
    console.log("📐 Évaluation du circuit...");
    const evaluatedCircuit = evaluate_circuit_v2_wasm(
        circuitBytes,
        ct,
        [],
        precontract.description
    );
    console.log("✅ Circuit évalué\n");

    // Calculate proofs for gate 1
    const gateNum = chall; // Use chall from contract
    console.log(`📐 Calcul des preuves pour gate ${gateNum}...`);
    const proofs = compute_proofs_left_v2(
        circuitBytes,
        evaluatedCircuit,
        ct,
        gateNum - 1, // 0-indexed
        numBlocks
    );
    console.log("✅ Preuves calculées\n");

    // Convert proofs
    const gateBytesUint8 = new Uint8Array(proofs.gate_bytes);
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

    const openingValueBytes = ethers.getBytes(openingValueHex);

    console.log("=".repeat(80));
    console.log("🔍 ANALYSE DE verifyCommitmentLeft");
    console.log("=".repeat(80));
    console.log("\n📋 La fonction verifyCommitmentLeft() vérifie 3 choses:\n");

    // Test opening commitment
    console.log("1️⃣  OUVERTURE DU COMMITMENT:");
    try {
        const hCircuitCt = await dispute.openCommitment.staticCall(openingValueBytes);
        console.log("   ✅ openCommitment() réussit");
        console.log(`   📊 hCircuitCt[0] (hCircuit): ${ethers.hexlify(hCircuitCt[0])}`);
        console.log(`   📊 hCircuitCt[1] (hCt): ${ethers.hexlify(hCircuitCt[1])}\n`);
    } catch (error: any) {
        console.log("   ❌ openCommitment() échoue:", error.message);
        console.log("   📋 Cela signifie que l'opening value ne correspond pas au commitment!\n");
        db.close();
        return;
    }

    // Test gate bytes length
    console.log("2️⃣  VÉRIFICATION DU GATE BYTES:");
    console.log(`   📊 gateBytes.length: ${gateBytesUint8.length} bytes (devrait être 64)`);
    if (gateBytesUint8.length === 64) {
        console.log("   ✅ Longueur correcte\n");
    } else {
        console.log("   ❌ Longueur incorrecte!\n");
        db.close();
        return;
    }

    // Test proof1
    console.log("3️⃣  VÉRIFICATION 1 (AccumulatorVerifier.verify - proof1):");
    console.log("   📋 Vérifie que le gate est dans hCircuit (circuit accumulator)");
    console.log("   📋 Paramètres:");
    const hCircuitCt = await dispute.openCommitment.staticCall(openingValueBytes);
    const gateKeccak = ethers.keccak256(gateBytesUint8);
    const gateNumArray = [gateNum - 1]; // 0-indexed
    console.log(`      - Root: hCircuitCt[0] = ${ethers.hexlify(hCircuitCt[0]).slice(0, 20)}...`);
    console.log(`      - Indices: [${gateNumArray[0]}] (gate ${gateNum} en 0-indexed)`);
    console.log(`      - Values: [${gateKeccak.slice(0, 20)}...] (keccak256(gateBytes))`);
    console.log(`      - Proof1 layers: ${proof1Array.length}`);
    
    // We can't directly test AccumulatorVerifier.verify, but we can explain what it does
    console.log("   📋 Cette vérification échoue si:");
    console.log("      - Le gate n'est pas dans le circuit accumulator");
    console.log("      - La preuve proof1 est incorrecte\n");

    // Test proof2
    console.log("4️⃣  VÉRIFICATION 2 (AccumulatorVerifier.verify - proof2):");
    console.log("   📋 Vérifie que les non-constant sons sont dans hCt (ciphertext accumulator)");
    console.log("   📋 Paramètres:");
    console.log(`      - Root: hCircuitCt[1] = ${ethers.hexlify(hCircuitCt[1]).slice(0, 20)}...`);
    console.log(`      - Proof2 layers: ${proof2Array.length}`);
    
    // Get non-constant sons (we'd need to call the contract to get this, but let's explain)
    console.log("   📋 Cette vérification échoue si:");
    console.log("      - Les non-constant sons ne sont pas dans le ciphertext accumulator");
    console.log("      - La preuve proof2 est incorrecte\n");

    // Test proofExt
    console.log("5️⃣  VÉRIFICATION 3 (AccumulatorVerifier.verifyExt - proofExt):");
    console.log("   📋 Vérifie que _currAcc contient le résultat du gate");
    console.log("   📋 Paramètres:");
    console.log(`      - i: 0 (pour Step 8b, gate 1)`);
    console.log(`      - prevRoot: bytes32(0) (pas de w_{i-1} pour gate 1)`);
    console.log(`      - currRoot: _currAcc = ${ethers.hexlify(currAccArray).slice(0, 20)}...`);
    // Evaluate gate from sons (we can't call it directly, but we can compute it)
    // The contract uses EvaluatorSOX_V2.evaluateGateFromSons internally
    console.log(`      - valuesArray length: ${valuesArray.length}`);
    console.log(`      - gateBytes length: ${gateBytesUint8.length} bytes`);
    console.log(`      - key length: ${keyBytesArray.length} bytes`);
    console.log(`      - ProofExt layers: ${proofExtArray.length}`);
    console.log("   📋 Cette vérification échoue si:");
    console.log("      - _currAcc ne contient pas le résultat du gate");
    console.log("      - La preuve proofExt est incorrecte");
    console.log("      - Pour Step 8b (i=0, prevRoot=0), verifyExt doit skippper verifyPrevious\n");

    // Now test the full verifyCommitmentLeft
    console.log("=".repeat(80));
    console.log("🧪 TEST COMPLET DE verifyCommitmentLeft()");
    console.log("=".repeat(80));
    console.log("\n📋 Appel de submitCommitmentLeft avec staticCall...\n");

    const [signer] = await ethers.getSigners();
    try {
        const result = await dispute.connect(signer).submitCommitmentLeft.staticCall(
            openingValueBytes,
            gateNum,
            gateBytesUint8,
            valuesArray,
            currAccArray,
            proof1Array,
            proof2Array,
            proofExtArray
        );
        console.log("✅ verifyCommitmentLeft() retourne TRUE");
        console.log("   📋 Toutes les vérifications ont réussi!\n");
    } catch (error: any) {
        console.log("❌ verifyCommitmentLeft() retourne FALSE");
        console.log(`   📋 Erreur: ${error.message}\n`);
        
        // Try to parse the error
        if (error.data) {
            console.log("   📋 Données d'erreur:", error.data);
            try {
                const parsed = dispute.interface.parseError(error.data);
                if (parsed) {
                    console.log(`   📋 Erreur parsée: ${parsed.name}`);
                }
            } catch (e) {
                // ignore
            }
        }
        
        console.log("\n💡 CONCLUSION:");
        console.log("   verifyCommitmentLeft() retourne FALSE car une des 3 vérifications échoue.");
        console.log("   Pour identifier laquelle, il faudrait tester chaque vérification individuellement.");
        console.log("   Cependant, comme verifyCommitmentLeft() est une fonction interne,");
        console.log("   on ne peut pas la tester directement. Il faut regarder les preuves");
        console.log("   et s'assurer qu'elles sont correctes.\n");
    }

    db.close();
}

main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error(error);
        process.exit(1);
    });
