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

// Contract address to test (Dispute contract address)
const DISPUTE_ADDRESS = process.env.DISPUTE_ADDRESS;
if (!DISPUTE_ADDRESS) {
    console.error("❌ DISPUTE_ADDRESS doit être défini (ex: DISPUTE_ADDRESS=0x... npx hardhat run ...)");
    process.exit(1);
}

async function main() {
    console.log("🔍 DIAGNOSTIC: submitCommitmentLeft pour chall=1\n");
    console.log("=".repeat(80));
    
    // Initialize WASM
    const wasmPath = join(__dirname, "../../app/lib/crypto_lib/crypto_lib_bg.wasm");
    const wasmBytes = readFileSync(wasmPath);
    initSync({ module: wasmBytes });
    console.log("✅ WASM initialisé\n");
    
    const [deployer, buyer, vendor, sbSponsor, svSponsor] = await ethers.getSigners();
    console.log(`\n📋 Compte utilisateur: ${deployer.address}`);
    console.log(`📋 Contrat Dispute: ${DISPUTE_ADDRESS}\n`);
    
    // Get the dispute contract
    const dispute = await ethers.getContractAt("DisputeSOXAccount", DISPUTE_ADDRESS);
    
    // Check contract state
    const state = Number(await dispute.currState());
    const chall = Number(await dispute.chall());
    const vendorAddr = await dispute.vendor();
    const buyerAddr = await dispute.buyer();
    
    // State enum: ChallengeBuyer=0, WaitVendorOpinion=1, WaitVendorData=2, WaitVendorDataLeft=3, WaitVendorDataRight=4, Complete=5, Cancel=6, End=7
    // But actually: WaitVendorDataLeft = 3, WaitVendorDataRight = 4, etc.
    // Let me check: based on testGate1UserOp.ts, state 6 = WaitVendorDataLeft
    const stateNames = ["ChallengeBuyer", "WaitVendorOpinion", "WaitVendorData", "WaitVendorDataLeft", "WaitVendorDataRight", "Complete", "Cancel", "End"];
    
    console.log(`📊 État du contrat:`);
    console.log(`   - State: ${state} (${stateNames[state] || "Unknown"})`);
    console.log(`   - chall: ${chall} (devrait être 1 pour Step 8b)`);
    console.log(`   - Vendor: ${vendorAddr}`);
    console.log(`   - Buyer: ${buyerAddr}\n`);
    
    // WaitVendorDataLeft = 3 (based on enum, 0-indexed)
    if (state !== 3) {
        console.error(`❌ Le contrat n'est pas dans l'état WaitVendorDataLeft (3). État actuel: ${state} (${stateNames[state] || "Unknown"})`);
        console.error(`   Il faut que le contrat soit dans l'état WaitVendorDataLeft (3) avec chall=1.`);
        process.exit(1);
    }
    
    if (chall !== 1) {
        console.error(`❌ Le chall n'est pas 1. chall actuel: ${chall}`);
        console.error(`   Ce script teste spécifiquement le cas chall=1 (Step 8b).`);
        console.error(`   Le contrat est dans l'état WaitVendorDataLeft, mais avec chall=${chall} au lieu de chall=1.`);
        process.exit(1);
    }
    
    // Get contract details
    const numGates = Number(await dispute.numGates());
    const numBlocks = Number(await dispute.numBlocks());
    const commitment = await dispute.commitment();
    
    console.log(`📊 Détails du contrat:`);
    console.log(`   - numGates: ${numGates}`);
    console.log(`   - numBlocks: ${numBlocks}`);
    console.log(`   - commitment: ${commitment}\n`);
    
    // Get the OptimisticSOXAccount address
    const optimisticContractAddr = await dispute.optimisticContract();
    console.log(`📊 OptimisticSOXAccount: ${optimisticContractAddr}\n`);
    
    // Get the key from OptimisticSOXAccount
    const optimisticContract = await ethers.getContractAt("OptimisticSOXAccount", optimisticContractAddr);
    const keyBytes = await optimisticContract.key();
    const keyHexString = ethers.hexlify(keyBytes);
    const keyBytesArray = ethers.getBytes(keyHexString);
    console.log(`📊 AES Key (bytes16): ${keyHexString}`);
    console.log(`   Length (hex string): ${keyHexString.length} chars`);
    console.log(`   Length (bytes): ${keyBytesArray.length} bytes (should be 16)\n`);
    
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
        console.error(`❌ Contrat non trouvé dans la base de données pour ${DISPUTE_ADDRESS}`);
        process.exit(1);
    }
    
    if (!contractRow.opening_value) {
        console.error(`❌ Opening value non trouvé dans la base de données pour contract_id ${contractRow.id}`);
        process.exit(1);
    }
    
    let openingValueHex = contractRow.opening_value;
    if (!openingValueHex.startsWith('0x')) {
        openingValueHex = '0x' + openingValueHex;
    }
    console.log(`📊 Opening value: ${openingValueHex.slice(0, 40)}...`);
    console.log(`   Length: ${openingValueHex.length - 2} hex chars (should be 64 for 32 bytes)\n`);
    
    // Verify commitment matches opening value
    const openingValueBytes = ethers.getBytes(openingValueHex);
    const computedCommitment = ethers.keccak256(openingValueBytes);
    if (computedCommitment.toLowerCase() !== commitment.toLowerCase()) {
        console.error(`❌ Commitment mismatch!`);
        console.error(`   Contract commitment: ${commitment}`);
        console.error(`   Computed commitment: ${computedCommitment}`);
        process.exit(1);
    }
    console.log(`✅ Commitment vérifié - l'opening value correspond\n`);
    
    // Get circuit and evaluated circuit - we need to compute them
    // First get item_description
    const contractDetails = db.prepare(`
        SELECT item_description 
        FROM contracts 
        WHERE id = ?
    `).get(contractRow.id) as any;
    
    if (!contractDetails || !contractDetails.item_description) {
        console.error(`❌ item_description non trouvé pour contract_id ${contractRow.id}`);
        process.exit(1);
    }
    
    const itemDescriptionHex = contractDetails.item_description.startsWith('0x') 
        ? contractDetails.item_description 
        : '0x' + contractDetails.item_description;
    const itemDescriptionBytes = new Uint8Array(Buffer.from(itemDescriptionHex.slice(2), 'hex'));
    
    // Compute precontract to get circuit and evaluated circuit
    console.log(`🔢 Calcul du precontract...`);
    const keyUint8Array = ethers.getBytes(keyHexString);
    const precontract = compute_precontract_values_v2(itemDescriptionBytes, keyUint8Array);
    const circuit = new Uint8Array(precontract.circuit_bytes);
    const ct = new Uint8Array(precontract.ct);
    const evaluatedCircuit = evaluate_circuit_v2_wasm(
        circuit,
        ct,
        bytes_to_hex(keyUint8Array)
    ).to_bytes();
    
    console.log(`📊 Données precontract:`);
    console.log(`   - ct length: ${ct.length} bytes`);
    console.log(`   - circuit length: ${circuit.length} bytes`);
    console.log(`   - evaluated_circuit length: ${evaluatedCircuit.length} bytes\n`);
    
    // Generate proofs for chall=1 (Step 8b)
    console.log(`🔨 Génération des preuves pour chall=1 (Step 8b)...`);
    const proofs = compute_proofs_left_v2(
        circuit,
        evaluatedCircuit,
        ct,
        1 // chall=1 (1-indexed, matching paper notation)
    );
    
    console.log(`✅ Preuves générées:`);
    console.log(`   - gate_bytes length: ${proofs.gate_bytes.length} bytes (should be 64)`);
    console.log(`   - values count: ${proofs.values.length}`);
    console.log(`   - curr_acc length: ${proofs.curr_acc.length} bytes (should be 32)`);
    console.log(`   - proof1 layers: ${proofs.proof1.length}`);
    console.log(`   - proof2 layers: ${proofs.proof2.length}`);
    console.log(`   - proof_ext layers: ${proofs.proof_ext.length}\n`);
    
    // Convert proofs to contract format
    const gateBytesUint8 = new Uint8Array(proofs.gate_bytes);
    const valuesArray = proofs.values.map(v => new Uint8Array(v));
    const currAccArray = new Uint8Array(proofs.curr_acc);
    
    // Convert proofs to hex strings for encoding
    const proof1Hex = proofs.proof1.map(layer => 
        layer.map(item => bytes_to_hex(new Uint8Array(item)))
    );
    const proof2Hex = proofs.proof2.map(layer => 
        layer.map(item => bytes_to_hex(new Uint8Array(item)))
    );
    const proofExtHex = proofs.proof_ext.map(layer => 
        layer.map(item => bytes_to_hex(new Uint8Array(item)))
    );
    
    console.log(`📦 Conversion des preuves terminée\n`);
    
    // Verify gate_bytes length
    if (gateBytesUint8.length !== 64) {
        console.error(`❌ gate_bytes.length = ${gateBytesUint8.length}, attendu 64`);
        process.exit(1);
    }
    
    // Try staticCall first to diagnose the error
    console.log(`🧪 Test avec staticCall pour diagnostiquer l'erreur...\n`);
    
    // Get vendor signer - find the signer matching vendor address
    const vendorSigner = await dispute.vendorSigner();
    const allSigners = [deployer, buyer, vendor, sbSponsor, svSponsor];
    const vendorWallet = allSigners.find(s => s.address.toLowerCase() === vendorSigner.toLowerCase()) || 
                         allSigners.find(s => s.address.toLowerCase() === vendorAddr.toLowerCase());
    if (!vendorWallet) {
        console.error(`❌ Impossible de trouver le signer pour ${vendorAddr} ou ${vendorSigner}`);
        process.exit(1);
    }
    const disputeConnected = dispute.connect(vendorWallet);
    
    try {
        const result = await disputeConnected.submitCommitmentLeft.staticCall(
            openingValueHex,
            1, // gateNum (1-indexed)
            gateBytesUint8,
            valuesArray,
            currAccArray,
            proof1Hex,
            proof2Hex,
            proofExtHex
        );
        console.log(`✅ staticCall réussi! La transaction devrait fonctionner.\n`);
    } catch (error: any) {
        console.error(`❌ staticCall échoué:`);
        console.error(`   Error: ${error.message}`);
        
        // Try to decode the error
        const errorData = error?.data || error?.error?.data || error?.cause?.data;
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
                console.error(`   Impossible de parser l'erreur`);
            }
        }
        
        console.error(`\n   Cette erreur sera également produite par la UserOperation.\n`);
        process.exit(1);
    }
    
    // If staticCall succeeds, try with UserOperation
    console.log(`📤 Envoi via UserOperation...\n`);
    
    // Import UserOperation functions
    const { sendUserOperation } = await import("../../app/lib/blockchain/userops");
    const { PK_SK_MAP } = await import("../../app/lib/blockchain/config");
    
    try {
        const callData = dispute.interface.encodeFunctionData("submitCommitmentLeft", [
            openingValueHex,
            1, // gateNum
            gateBytesUint8,
            valuesArray,
            currAccArray,
            proof1Hex,
            proof2Hex,
            proofExtHex
        ]);
        
        console.log(`📝 CallData encodé (${callData.length} chars)\n`);
        
        // Encode execute() call (like sendDisputeUserOp does)
        const executeData = dispute.interface.encodeFunctionData("execute", [
            DISPUTE_ADDRESS, // target: le contrat dispute lui-même
            0,            // value: 0 (pas d'ETH envoyé)
            callData,     // data: les données de la fonction à appeler
        ]);
        
        // Get private key for vendor from config
        const { PK_SK_MAP } = await import("../../app/lib/blockchain/config");
        // PK_SK_MAP keys are stored as-is from ALL_PUBLIC_KEYS
        // Try exact match first, then lowercase
        let vendorPrivateKeyForUserOp = PK_SK_MAP.get(vendorAddr);
        if (!vendorPrivateKeyForUserOp) {
            vendorPrivateKeyForUserOp = PK_SK_MAP.get(vendorAddr.toLowerCase());
        }
        if (!vendorPrivateKeyForUserOp) {
            console.error(`❌ Clé privée non trouvée dans PK_SK_MAP pour ${vendorAddr}`);
            console.error(`   PK_SK_MAP keys:`, Array.from(PK_SK_MAP.keys()).slice(0, 5));
            throw new Error(`❌ Clé privée non trouvée dans PK_SK_MAP pour ${vendorAddr}`);
        }
        
        console.log(`🔐 Envoi UserOperation avec signer: ${vendorAddr}\n`);
        
        const userOpHash = await sendUserOperation({
            sender: DISPUTE_ADDRESS, // Le contrat dispute est le compte abstrait ERC-4337
            callData: executeData,
            signerPrivateKey: vendorPrivateKeyForUserOp, // La clé privée correspondant à vendorSigner
        });
        
        console.log(`✅ UserOperation envoyée: ${userOpHash}\n`);
        console.log(`⏳ En attente de la confirmation...`);
        
        // Wait for receipt
        const { waitForUserOperationReceipt } = await import("../../app/lib/blockchain/userops");
        const receipt = await waitForUserOperationReceipt(userOpHash);
        
        if (receipt.success) {
            console.log(`✅ UserOperation confirmée avec succès!`);
        } else {
            console.error(`❌ UserOperation échouée:`);
            console.error(`   Reason: ${(receipt as any).reason}`);
            console.error(`   Receipt:`, JSON.stringify(receipt, null, 2));
            process.exit(1);
        }
    } catch (error: any) {
        console.error(`❌ Erreur lors de l'envoi de la UserOperation:`);
        console.error(`   ${error.message}`);
        if (error.stack) {
            console.error(`   Stack: ${error.stack}`);
        }
        process.exit(1);
    }
    
    db.close();
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});

