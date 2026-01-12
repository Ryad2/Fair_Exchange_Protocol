import hre from "hardhat";
import { ethers } from "hardhat";
import { readFileSync } from "fs";
import { join } from "path";
import Database from "better-sqlite3";
import path from "path";

// WASM imports
import {
    initSync,
    compute_precontract_values_v2,
    compute_proofs_left_v2,
    evaluate_circuit_v2_wasm,
    bytes_to_hex,
    hex_to_bytes,
} from "../../app/lib/crypto_lib/crypto_lib";

const DISPUTE_ADDRESS = process.env.DISPUTE_ADDRESS || "0x752BfcC0239e23D3f283B708E24F87B28f62E094";
const GATE_NUM = 1;

async function main() {
    console.log("🔍 Test de submitCommitmentLeft avec UserOperation\n");
    console.log(`📋 Dispute: ${DISPUTE_ADDRESS}`);
    console.log(`📋 Gate: ${GATE_NUM}\n`);

    const [sponsor, buyer, vendor, sbSponsor, svSponsor] = await hre.ethers.getSigners();
    const provider = hre.ethers.provider;

    // Load dispute contract
    const disputeABI = JSON.parse(
        readFileSync(join(__dirname, "../../app/lib/blockchain/contracts/DisputeSOXAccount.json"), "utf-8")
    ).abi;
    const dispute = new ethers.Contract(DISPUTE_ADDRESS, disputeABI, provider);

    // Get contract state
    const state = await dispute.currState();
    const stateNames = ["ChallengeBuyer", "WaitVendorOpinion", "WaitVendorData", "WaitVendorDataLeft", "WaitVendorDataRight", "Complete", "Cancel", "End"];
    console.log(`📊 État: ${stateNames[Number(state)]} (${state})`);
    
    if (state !== 3n) {
        console.error(`❌ Le contrat doit être dans l'état WaitVendorDataLeft (3). État actuel: ${stateNames[Number(state)]} (${state})`);
        process.exit(1);
    }

    // Get optimistic contract address
    const optimisticAddr = await dispute.optimisticContract();
    console.log(`📊 OptimisticSOXAccount: ${optimisticAddr}\n`);

    // Load database
    const dbPath = path.join(__dirname, "../../../src/app/db/sox.sqlite");
    const db = Database(dbPath);

    const contractRow = db.prepare(`
        SELECT c.opening_value, c.item_description, c.commitment,
               c.optimistic_smart_contract
        FROM contracts c
        LEFT JOIN disputes d ON c.id = d.contract_id
        WHERE d.dispute_smart_contract = ?
    `).get(DISPUTE_ADDRESS) as any;
    
    if (!contractRow) {
        throw new Error(`❌ Contrat non trouvé dans la base de données`);
    }

    const openingValueHex = contractRow.opening_value.startsWith('0x') 
        ? contractRow.opening_value 
        : '0x' + contractRow.opening_value;
    
    console.log(`📋 Opening value: ${openingValueHex.slice(0, 40)}...`);

    // Get key from OptimisticSOXAccount
    const optimisticABI = JSON.parse(
        readFileSync(join(__dirname, "../../app/lib/blockchain/contracts/OptimisticSOXAccount.json"), "utf-8")
    ).abi;
    const optimistic = new ethers.Contract(optimisticAddr, optimisticABI, provider);
    const keyHex = await optimistic.key();
    const keyBytes = ethers.getBytes(keyHex);
    const key = new Uint8Array(keyBytes);
    console.log(`📋 Clé AES: ${keyHex.slice(0, 20)}... (${key.length} bytes)\n`);

    // Initialize WASM
    const modulePath = join(__dirname, "../../app/lib/crypto_lib/crypto_lib_bg.wasm");
    const module = readFileSync(modulePath);
    initSync({ module });
    console.log("✅ WASM initialisé\n");

    // Load item description (ciphertext)
    const itemDescriptionBytes = hex_to_bytes(contractRow.item_description);
    console.log(`📋 Ciphertext: ${itemDescriptionBytes.length} bytes\n`);

    // Compute precontract
    console.log("🔧 Calcul du precontract...");
    const precontract = compute_precontract_values_v2(itemDescriptionBytes, key);
    const circuitBytes = precontract.circuit_bytes;
    const ct = precontract.ct;
    console.log(`✅ Precontract calculé\n`);

    // Evaluate circuit
    console.log("🔧 Évaluation du circuit...");
    const keyHexString = "0x" + Array.from(key).map(b => b.toString(16).padStart(2, '0')).join('');
    const keyHexStringNoPrefix = keyHexString.startsWith('0x') ? keyHexString.slice(2) : keyHexString;
    const evaluatedCircuit = evaluate_circuit_v2_wasm(circuitBytes, ct, keyHexStringNoPrefix).to_bytes();
    console.log(`✅ Circuit évalué (${evaluatedCircuit.length} gates)\n`);

    // Get gate number from contract
    const gateNum = Number(await dispute.a());
    console.log(`📋 Gate demandée (a): ${gateNum}\n`);

    // Use gate from contract, or fallback to GATE_NUM
    const actualGateNum = gateNum || GATE_NUM;
    console.log(`🔧 Calcul des preuves pour la gate ${actualGateNum}...`);
    const proofs = compute_proofs_left_v2(
        circuitBytes,
        evaluatedCircuit,
        ct,
        actualGateNum
    );
    console.log(`✅ Preuves calculées\n`);

    // Convert proofs to format expected by contract
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

    console.log("📤 Envoi de submitCommitmentLeft via staticCall...");
    
    // Use vendor signer for staticCall
    const vendorAddr = await dispute.vendor();
    const vendorSignerAddr = await dispute.vendorSigner();
    console.log(`📋 Vendor: ${vendorAddr}`);
    console.log(`📋 VendorSigner: ${vendorSignerAddr}\n`);

    // Find the vendor signer account
        const allSigners = [sponsor, buyer, vendor, sbSponsor, svSponsor];
    const vendorSignerWallet = allSigners.find(s => s.address.toLowerCase() === vendorSignerAddr.toLowerCase());
    
        if (!vendorSignerWallet) {
        console.error(`❌ Aucun signer ne correspond au vendorSigner du contrat: ${vendorSignerAddr}`);
        console.error(`   Signers disponibles:`);
        for (let i = 0; i < allSigners.length; i++) {
            console.error(`     [${i}]: ${await allSigners[i].getAddress()}`);
        }
        process.exit(1);
    }
    
    console.log(`📋 VendorSigner trouvé: ${await vendorSignerWallet.getAddress()}\n`);

    try {
        const result = await dispute.connect(vendorSignerWallet).submitCommitmentLeft.staticCall(
            openingValueHex,
            actualGateNum,
            gateBytesArray,
            valuesArray,
            currAccArray,
            proof1Array,
            proof2Array,
            proofExtArray
        );
        console.log("✅ staticCall réussi!");
        console.log(`   Résultat: ${result}`);
    } catch (error: any) {
        console.error("❌ staticCall échoué:");
        console.error(`   Message: ${error.message}`);
        
        // Try to decode error
        const errorData = error.data || error.error?.data || error.cause?.data;
        if (errorData) {
            console.error(`   Error data: ${errorData}`);
            try {
                const parsed = dispute.interface.parseError(errorData);
                if (parsed) {
                    console.error(`   Erreur parsée: ${parsed.name}`);
                    if (parsed.args) {
                        console.error(`   Args:`, parsed.args);
                    }
                }
            } catch (e) {
                // Try Error(string)
                try {
                    if (typeof errorData === 'string' && errorData.startsWith('0x08c379a0')) {
                        const decoded = dispute.interface.decodeErrorResult("Error(string)", errorData);
                        console.error(`   Erreur décodée: ${decoded[0]}`);
                    }
                } catch (e2) {
                    // ignore
                }
            }
        }
        
        db.close();
        process.exit(1);
    }

    console.log(`\n✅ Tous les tests ont réussi!`);
    db.close();
}

main().catch(console.error);
