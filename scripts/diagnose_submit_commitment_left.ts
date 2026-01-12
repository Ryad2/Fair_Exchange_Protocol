import { ethers } from "ethers";
import Database from "better-sqlite3";
import path from "path";
import { readFileSync } from "fs";
import init, {
    bytes_to_hex,
    hex_to_bytes,
    compile_circuit_v2_wasm,
    evaluate_circuit_v2_wasm,
    compute_proofs_left_v2,
} from "../src/app/lib/crypto_lib";

const PROVIDER_URL = "http://127.0.0.1:8545";
const DISPUTE_CONTRACT = "0xfCb4B28B8395310bb17841280EC9b0A2e7d531F0";
const DB_PATH = path.join(__dirname, "../src/app/db/sox.sqlite");
const GATE_NUM = 1;

async function main() {
    console.log("🔍 Diagnostic de submitCommitmentLeft\n");
    
    // Initialize WASM
    const wasmPath = path.join(__dirname, "../src/app/lib/crypto_lib_bg.wasm");
    const wasmBytes = readFileSync(wasmPath);
    await init(wasmBytes);
    
    // Connect to provider
    const provider = new ethers.JsonRpcProvider(PROVIDER_URL);
    const [signer] = await provider.listAccounts();
    if (!signer) {
        throw new Error("Aucun compte disponible");
    }
    
    // Load contract
    const disputeABI = JSON.parse(
        readFileSync(path.join(__dirname, "../src/app/lib/blockchain/contracts/DisputeSOXAccount.json"), "utf-8")
    ).abi;
    const dispute = new ethers.Contract(DISPUTE_CONTRACT, disputeABI, provider);
    
    // Get contract state
    const state = await dispute.state();
    console.log(`📊 État du contrat: ${state}`);
    if (Number(state) !== 3) {
        console.warn(`⚠️  Le contrat n'est pas dans l'état WaitVendorDataLeft (3), mais ${state}`);
    }
    
    // Get commitment and opening value from DB
    const db = new Database(DB_PATH);
    const contractRow = db.prepare(`
        SELECT c.opening_value, c.item_description, c.commitment,
               c.optimistic_smart_contract
        FROM contracts c
        LEFT JOIN disputes d ON c.id = d.contract_id
        WHERE d.dispute_smart_contract = ?
    `).get(DISPUTE_CONTRACT) as any;
    
    if (!contractRow) {
        throw new Error(`❌ Contrat non trouvé dans la base de données`);
    }
    
    const openingValueHex = contractRow.opening_value.startsWith('0x') 
        ? contractRow.opening_value 
        : '0x' + contractRow.opening_value;
    
    console.log(`\n📋 Données du contrat:`);
    console.log(`   Opening value: ${openingValueHex.slice(0, 40)}...`);
    console.log(`   Commitment DB: ${contractRow.commitment}`);
    
    // Verify commitment
    const contractCommitment = await dispute.commitment();
    const openingValueBytes = ethers.getBytes(openingValueHex);
    const calculatedCommitment = ethers.keccak256(openingValueBytes);
    console.log(`   Commitment contrat: ${contractCommitment}`);
    console.log(`   Commitment calculé: ${calculatedCommitment}`);
    
    if (calculatedCommitment.toLowerCase() !== contractCommitment.toLowerCase()) {
        console.error(`❌ L'opening value ne correspond PAS au commitment!`);
        db.close();
        process.exit(1);
    }
    console.log(`✅ Commitment vérifié\n`);
    
    // Get key from OptimisticSOXAccount
    const optimisticABI = JSON.parse(
        readFileSync(path.join(__dirname, "../src/app/lib/blockchain/contracts/OptimisticSOXAccount.json"), "utf-8")
    ).abi;
    const optimistic = new ethers.Contract(contractRow.optimistic_smart_contract, optimisticABI, provider);
    const keyHex = await optimistic.key();
    const keyBytes = ethers.getBytes(keyHex);
    console.log(`📋 Clé AES: ${keyHex.slice(0, 20)}...`);
    
    // Get circuit data
    console.log(`\n📋 Calcul des données du circuit...`);
    const itemDescription = hex_to_bytes(contractRow.item_description);
    
    // Load ciphertext (we'll need to fetch it or use a test file)
    // For now, let's use a placeholder - you may need to adjust this
    const ctPath = path.join(__dirname, "../public/test_65bytes.bin");
    let ct: Uint8Array;
    try {
        ct = new Uint8Array(readFileSync(ctPath));
    } catch (e) {
        console.error(`❌ Impossible de charger le ciphertext depuis ${ctPath}`);
        console.error(`   Vous devez mettre le fichier ciphertext à cet emplacement`);
        db.close();
        process.exit(1);
    }
    
    // Compile circuit
    const circuit = compile_circuit_v2_wasm(ct, itemDescription);
    console.log(`✅ Circuit compilé`);
    
    // Evaluate circuit
    const evaluatedCircuit = evaluate_circuit_v2_wasm(circuit, ct, keyBytes).to_bytes();
    console.log(`✅ Circuit évalué`);
    
    // Compute proofs
    console.log(`\n📋 Calcul des preuves pour gate ${GATE_NUM}...`);
    const { gate_bytes, values, curr_acc, proof1, proof2, proof_ext } = compute_proofs_left_v2(
        circuit,
        evaluatedCircuit,
        ct,
        GATE_NUM
    );
    console.log(`✅ Preuves calculées`);
    console.log(`   Gate bytes length: ${gate_bytes.length} bytes`);
    console.log(`   Values count: ${values.length}`);
    console.log(`   curr_acc: ${bytes_to_hex(curr_acc).slice(0, 20)}...`);
    console.log(`   proof1 layers: ${proof1.length}`);
    console.log(`   proof2 layers: ${proof2.length}`);
    console.log(`   proof_ext layers: ${proof_ext.length}`);
    
    // Check buyer response
    const buyerResponse = await dispute.getBuyerResponse(GATE_NUM);
    const currAccHex = ethers.hexlify(curr_acc);
    console.log(`\n📋 Comparaison avec buyer response:`);
    console.log(`   curr_acc: ${currAccHex.slice(0, 20)}...`);
    console.log(`   buyerResponses[${GATE_NUM}]: ${buyerResponse.slice(0, 20)}...`);
    if (currAccHex.toLowerCase() === buyerResponse.toLowerCase()) {
        console.warn(`⚠️  curr_acc est égal à buyerResponses[${GATE_NUM}]!`);
    }
    
    // Prepare parameters
    const gateBytesHex = ethers.hexlify(gate_bytes);
    const valuesHex = values.map(v => ethers.hexlify(v));
    const proof1Hex = proof1.map(layer => layer.map(p => ethers.hexlify(p)));
    const proof2Hex = proof2.map(layer => layer.map(p => ethers.hexlify(p)));
    const proofExtHex = proof_ext.map(layer => layer.map(p => ethers.hexlify(p)));
    
    // Get vendor address
    const vendor = await dispute.vendor();
    const vendorSigner = await dispute.vendorSigner();
    console.log(`\n📋 Vendor:`);
    console.log(`   vendor: ${vendor}`);
    console.log(`   vendorSigner: ${vendorSigner}`);
    
    // Try staticCall to verify
    console.log(`\n🧪 Test avec staticCall...`);
    try {
        const result = await dispute.submitCommitmentLeft.staticCall(
            openingValueHex,
            GATE_NUM,
            gateBytesHex,
            valuesHex,
            currAccHex,
            proof1Hex,
            proof2Hex,
            proofExtHex,
            { from: vendorSigner }
        );
        console.log(`✅ staticCall réussi! (retour: ${result})`);
    } catch (error: any) {
        console.error(`❌ staticCall échoué:`);
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
                // Try to decode as Error(string)
                try {
                    if (errorData.startsWith('0x08c379a0')) {
                        const decoded = dispute.interface.decodeErrorResult("Error(string)", errorData);
                        console.error(`   Erreur décodée: ${decoded[0]}`);
                    }
                } catch (e2) {
                    // ignore
                }
            }
        }
        
        // Check if it's TransactionReverted
        if (error.message?.includes('0x9167c27a') || error.message?.includes('TransactionReverted')) {
            console.error(`\n⚠️  TransactionReverted détectée!`);
            console.error(`   Cela peut être dû à:`);
            console.error(`   1. openCommitment échoue (mais commitment vérifié ✅)`);
            console.error(`   2. Les preuves ne passent pas (AccumulatorVerifier.verify échoue)`);
            console.error(`   3. L'évaluation de la gate échoue (EvaluatorSOX_V2.evaluateGateFromSons)`);
            console.error(`   4. Un autre appel interne qui revert`);
        }
        
        db.close();
        process.exit(1);
    }
    
    console.log(`\n✅ Tous les tests ont réussi!`);
    db.close();
}

main().catch(console.error);

