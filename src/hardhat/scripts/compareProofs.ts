import { ethers } from "hardhat";
import {
    initSync,
    compute_proofs_left_v2,
    bytes_to_hex,
    hex_to_bytes,
    compute_precontract_values_v2,
    evaluate_circuit_v2_wasm,
} from "../../app/lib/crypto_lib/crypto_lib";
import { join } from "path";
import { readFileSync } from "fs";
import Database from "better-sqlite3";
import { Contract } from "ethers";

const DISPUTE_ADDRESS = process.env.DISPUTE_ADDRESS || "0x82A9286dB983093Ff234cefCea1d8fA66382876B";

async function main() {
    console.log("🔍 COMPARAISON DES PREUVES");
    console.log("=".repeat(80));
    console.log(`📋 Contrat: ${DISPUTE_ADDRESS}\n`);

    // Initialize WASM
    const wasmPath = join(__dirname, "../../app/lib/crypto_lib/crypto_lib_bg.wasm");
    const wasmBytes = readFileSync(wasmPath);
    initSync({ module: wasmBytes });
    console.log("✅ WASM initialisé\n");

    const [deployer] = await ethers.getSigners();
    
    // Try to get contract info from database first
    const dbPath = join(__dirname, "../../app/db/sox.sqlite");
    const db = new Database(dbPath);
    
    // Check if contract exists and get code
    const code = await ethers.provider.getCode(DISPUTE_ADDRESS);
    let dispute: Contract | null = null;
    let currState: bigint | null = null;
    let chall: bigint | null = null;
    let a: bigint | null = null;
    let b: bigint | null = null;
    let numGates: number | null = null;
    let numBlocks: number | null = null;
    let commitment: string | null = null;
    let vendor: string | null = null;
    let buyer: string | null = null;

    if (code !== "0x") {
        console.log(`✅ Code trouvé à l'adresse (${code.length} bytes)\n`);
        try {
            dispute = await ethers.getContractAt("DisputeSOXAccount", DISPUTE_ADDRESS);
            currState = await dispute.currState();
            chall = await dispute.chall();
            a = await dispute.a();
            b = await dispute.b();
            numGates = Number(await dispute.numGates());
            numBlocks = Number(await dispute.numBlocks());
            commitment = await dispute.commitment();
            vendor = await dispute.vendor();
            buyer = await dispute.buyer();
        } catch (e: any) {
            console.log(`⚠️  Impossible de charger le contrat: ${e.message}`);
            console.log(`   On va utiliser les données de la base de données.\n`);
        }
    } else {
        console.log(`⚠️  Aucun code trouvé à l'adresse ${DISPUTE_ADDRESS}`);
        console.log(`   On va utiliser les données de la base de données.\n`);
    }

    // Get contract info from database
    const contractRow = db.prepare(`
        SELECT c.id, c.opening_value, c.item_description, c.ciphertext,
               d.dispute_smart_contract, d.challenge, d.state
        FROM contracts c
        LEFT JOIN disputes d ON c.id = d.contract_id
        WHERE d.dispute_smart_contract = ? OR d.dispute_smart_contract LIKE ?
    `).get(DISPUTE_ADDRESS, `%${DISPUTE_ADDRESS.slice(2).toLowerCase()}%`) as any;

    if (!contractRow) {
        console.error(`❌ Contrat ${DISPUTE_ADDRESS} non trouvé dans la base de données.`);
        console.error(`   Vérifiez que l'adresse est correcte.`);
        process.exit(1);
    }

    // Use contract data from blockchain if available, otherwise from database
    if (chall === null && contractRow.challenge !== null) {
        chall = BigInt(contractRow.challenge);
    }
    if (currState === null && contractRow.state !== null) {
        currState = BigInt(contractRow.state);
    }
    if (!chall) {
        console.error(`❌ Impossible de déterminer le challenge (chall).`);
        process.exit(1);
    }

    console.log(`📊 État du contrat:`);
    console.log(`   - State: ${currState !== null ? currState : "N/A (depuis DB)"}`);
    console.log(`   - chall: ${chall}`);
    console.log(`   - a: ${a !== null ? a : "N/A"}, b: ${b !== null ? b : "N/A"}`);
    console.log(`   - numGates: ${numGates !== null ? numGates : "N/A"}`);
    console.log(`   - numBlocks: ${numBlocks !== null ? numBlocks : "N/A"}`);
    console.log(`   - Vendor: ${vendor || "N/A"}`);
    console.log(`   - Buyer: ${buyer || "N/A"}\n`);

    // Get the OptimisticSOXAccount address and key
    let optimisticContractAddr: string | null = null;
    let keyBytes: any = null;
    let keyHexString: string | null = null;
    let keyUint8Array: Uint8Array | null = null;

    if (dispute) {
        try {
            optimisticContractAddr = await dispute.optimisticContract();
            const optimisticContract = await ethers.getContractAt("OptimisticSOXAccount", optimisticContractAddr);
            keyBytes = await optimisticContract.key();
            keyHexString = ethers.hexlify(keyBytes);
            keyUint8Array = ethers.getBytes(keyHexString);
            console.log(`📊 AES Key (depuis contrat): ${keyHexString.slice(0, 20)}... (${keyUint8Array.length} bytes)\n`);
        } catch (e: any) {
            console.log(`⚠️  Impossible de récupérer la clé depuis le contrat: ${e.message}\n`);
        }
    }

    // If key not from contract, try to get from database
    if (!keyUint8Array) {
        const optimisticRow = db.prepare(`
            SELECT c.optimistic_smart_contract
            FROM contracts c
            LEFT JOIN disputes d ON c.id = d.contract_id
            WHERE d.dispute_smart_contract = ? OR d.dispute_smart_contract LIKE ?
        `).get(DISPUTE_ADDRESS, `%${DISPUTE_ADDRESS.slice(2).toLowerCase()}%`) as any;
        
        if (optimisticRow && optimisticRow.optimistic_smart_contract) {
            try {
                optimisticContractAddr = optimisticRow.optimistic_smart_contract;
                const optimisticContract = await ethers.getContractAt("OptimisticSOXAccount", optimisticContractAddr);
                keyBytes = await optimisticContract.key();
                keyHexString = ethers.hexlify(keyBytes);
                keyUint8Array = ethers.getBytes(keyHexString);
                console.log(`📊 AES Key (depuis OptimisticSOXAccount): ${keyHexString.slice(0, 20)}... (${keyUint8Array.length} bytes)\n`);
            } catch (e: any) {
                console.error(`❌ Impossible de récupérer la clé: ${e.message}`);
                process.exit(1);
            }
        } else {
            console.error(`❌ Impossible de trouver l'OptimisticSOXAccount pour ce contrat.`);
            process.exit(1);
        }
    }

    const openingValueHex = contractRow.opening_value.startsWith('0x') 
        ? contractRow.opening_value 
        : '0x' + contractRow.opening_value;
    console.log(`📊 Opening value: ${openingValueHex.slice(0, 40)}...\n`);

    // Verify commitment matches opening value
    const openingValueBytes = ethers.getBytes(openingValueHex);
    const computedCommitment = ethers.keccak256(openingValueBytes);
    if (commitment && computedCommitment.toLowerCase() !== commitment.toLowerCase()) {
        console.error(`❌ Commitment mismatch!`);
        console.error(`   Contract commitment: ${commitment}`);
        console.error(`   Computed commitment: ${computedCommitment}`);
        process.exit(1);
    } else if (commitment) {
        console.log(`✅ Commitment vérifié\n`);
    } else {
        console.log(`⚠️  Commitment non vérifié (contrat non accessible)\n`);
    }

    // Get ciphertext
    let ct: Uint8Array;
    if (contractRow.ciphertext) {
        ct = new Uint8Array(Buffer.from(contractRow.ciphertext, 'hex'));
    } else {
        console.error(`❌ Ciphertext non trouvé dans la base de données.`);
        process.exit(1);
    }
    console.log(`📊 Ciphertext: ${ct.length} bytes\n`);

    // Get circuit and evaluated circuit
    const itemDescriptionHex = contractRow.item_description.startsWith('0x') 
        ? contractRow.item_description 
        : '0x' + contractRow.item_description;
    const itemDescriptionBytes = new Uint8Array(Buffer.from(itemDescriptionHex.slice(2), 'hex'));

    console.log(`🔢 Calcul du precontract...`);
    const precontract = compute_precontract_values_v2(itemDescriptionBytes, keyUint8Array);
    const circuit = new Uint8Array(precontract.circuit_bytes);
    const evaluatedCircuit = evaluate_circuit_v2_wasm(
        circuit,
        ct,
        bytes_to_hex(keyUint8Array)
    );
    console.log(`✅ Precontract et circuits calculés\n`);

    // Compute proofs for the current challenge
    const gateNum = Number(chall); // chall is 1-indexed (gate 1, gate 2, etc.)
    console.log(`📐 Calcul des preuves pour la gate ${gateNum} (chall=${chall})...`);
    console.log(`   ⚠️  Note: gateNum=${gateNum} est 1-indexed (notation papier)\n`);

    // Test avec différents indexations
    console.log("🧪 TEST 1: compute_proofs_left_v2 avec gateNum (1-indexed)");
    const proofs1 = compute_proofs_left_v2(
        circuit,
        evaluatedCircuit,
        ct,
        gateNum, // Passer gateNum directement (1-indexed)
        numBlocks
    );
    console.log(`   gate_bytes length: ${proofs1.gate_bytes.length}`);
    console.log(`   values count: ${proofs1.values.length}`);
    console.log(`   curr_acc length: ${proofs1.curr_acc.length}`);
    console.log(`   proof1 layers: ${proofs1.proof1.length}`);
    console.log(`   proof2 layers: ${proofs1.proof2.length}`);
    console.log(`   proof_ext layers: ${proofs1.proof_ext.length}\n`);

    console.log("🧪 TEST 2: compute_proofs_left_v2 avec gateNum - 1 (0-indexed)");
    const proofs2 = compute_proofs_left_v2(
        circuit,
        evaluatedCircuit,
        ct,
        gateNum - 1, // Convertir en 0-indexed
        numBlocks
    );
    console.log(`   gate_bytes length: ${proofs2.gate_bytes.length}`);
    console.log(`   values count: ${proofs2.values.length}`);
    console.log(`   curr_acc length: ${proofs2.curr_acc.length}`);
    console.log(`   proof1 layers: ${proofs2.proof1.length}`);
    console.log(`   proof2 layers: ${proofs2.proof2.length}`);
    console.log(`   proof_ext layers: ${proofs2.proof_ext.length}\n`);

    // Préparer les arguments pour verifyCommitmentLeft
    const gateBytesArray1 = new Uint8Array(proofs1.gate_bytes);
    const valuesArray1 = proofs1.values.map((v: Uint8Array) => new Uint8Array(v));
    const currAccArray1 = new Uint8Array(proofs1.curr_acc);
    const proof1Array1 = proofs1.proof1.map((level: Uint8Array[]) =>
        level.map((v: Uint8Array) => ethers.hexlify(new Uint8Array(v)))
    );
    const proof2Array1 = proofs1.proof2.map((level: Uint8Array[]) =>
        level.map((v: Uint8Array) => ethers.hexlify(new Uint8Array(v)))
    );
    const proofExtArray1 = proofs1.proof_ext.map((level: Uint8Array[]) =>
        level.map((v: Uint8Array) => ethers.hexlify(new Uint8Array(v)))
    );

    const gateBytesArray2 = new Uint8Array(proofs2.gate_bytes);
    const valuesArray2 = proofs2.values.map((v: Uint8Array) => new Uint8Array(v));
    const currAccArray2 = new Uint8Array(proofs2.curr_acc);
    const proof1Array2 = proofs2.proof1.map((level: Uint8Array[]) =>
        level.map((v: Uint8Array) => ethers.hexlify(new Uint8Array(v)))
    );
    const proof2Array2 = proofs2.proof2.map((level: Uint8Array[]) =>
        level.map((v: Uint8Array) => ethers.hexlify(new Uint8Array(v)))
    );
    const proofExtArray2 = proofs2.proof_ext.map((level: Uint8Array[]) =>
        level.map((v: Uint8Array) => ethers.hexlify(new Uint8Array(v)))
    );

    // Test avec staticCall pour voir quelle version fonctionne
    console.log("🧪 TEST 3: staticCall avec gateNum (1-indexed) et gateNumArray[0] = gateNum");
    try {
        const result1 = await dispute.verifyCommitmentLeft.staticCall(
            openingValueBytes,
            gateNum, // _gateNum = gateNum (1-indexed)
            gateBytesArray1,
            valuesArray1,
            currAccArray1,
            proof1Array1,
            proof2Array1,
            proofExtArray1
        );
        console.log(`   ✅ verifyCommitmentLeft retourne: ${result1}\n`);
    } catch (e: any) {
        console.log(`   ❌ Erreur: ${e.message}\n`);
    }

    console.log("🧪 TEST 4: staticCall avec gateNum (1-indexed) et gateNumArray[0] = gateNum - 1");
    // Pour tester avec gateNumArray[0] = gateNum - 1, on doit modifier le contrat ou utiliser une autre approche
    // On va plutôt tester avec les preuves calculées avec gateNum - 1
    try {
        const result2 = await dispute.verifyCommitmentLeft.staticCall(
            openingValueBytes,
            gateNum, // _gateNum = gateNum (1-indexed)
            gateBytesArray2, // Preuves calculées avec gateNum - 1 (0-indexed)
            valuesArray2,
            currAccArray2,
            proof1Array2,
            proof2Array2,
            proofExtArray2
        );
        console.log(`   ✅ verifyCommitmentLeft retourne: ${result2}\n`);
    } catch (e: any) {
        console.log(`   ❌ Erreur: ${e.message}\n`);
    }

    // Comparer les gate_bytes
    console.log("📊 COMPARAISON DES GATE_BYTES:");
    console.log(`   TEST 1 (gateNum 1-indexed): ${bytes_to_hex(gateBytesArray1).slice(0, 40)}...`);
    console.log(`   TEST 2 (gateNum-1 0-indexed): ${bytes_to_hex(gateBytesArray2).slice(0, 40)}...`);
    if (bytes_to_hex(gateBytesArray1) === bytes_to_hex(gateBytesArray2)) {
        console.log(`   ✅ Les gate_bytes sont identiques\n`);
    } else {
        console.log(`   ❌ Les gate_bytes sont DIFFÉRENTS\n`);
    }

    // Comparer les curr_acc
    console.log("📊 COMPARAISON DES CURR_ACC:");
    console.log(`   TEST 1: ${ethers.hexlify(currAccArray1)}`);
    console.log(`   TEST 2: ${ethers.hexlify(currAccArray2)}`);
    if (ethers.hexlify(currAccArray1) === ethers.hexlify(currAccArray2)) {
        console.log(`   ✅ Les curr_acc sont identiques\n`);
    } else {
        console.log(`   ❌ Les curr_acc sont DIFFÉRENTS\n`);
    }

    // Vérifier buyerResponses
    const buyerResponse = await dispute.buyerResponses(gateNum);
    console.log(`📊 buyerResponses[${gateNum}]: ${buyerResponse}`);
    console.log(`   curr_acc TEST 1: ${ethers.hexlify(currAccArray1)}`);
    console.log(`   curr_acc TEST 2: ${ethers.hexlify(currAccArray2)}`);
    if (buyerResponse === ethers.hexlify(currAccArray1)) {
        console.log(`   ⚠️  TEST 1: curr_acc == buyerResponses[${gateNum}] (vendor perdrait)\n`);
    }
    if (buyerResponse === ethers.hexlify(currAccArray2)) {
        console.log(`   ⚠️  TEST 2: curr_acc == buyerResponses[${gateNum}] (vendor perdrait)\n`);
    }

    db.close();
    console.log("=".repeat(80));
    console.log("✅ COMPARAISON TERMINÉE");
    console.log("=".repeat(80));
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});

