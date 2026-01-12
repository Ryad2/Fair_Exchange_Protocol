import { ethers } from "hardhat";
import * as path from "path";
import * as fs from "fs";
import { join } from "path";
import { readFileSync } from "fs";
import Database from "better-sqlite3";

// Import WASM functions
import {
    initSync,
    compute_precontract_values_v2,
    compute_proofs_left_v2,
    evaluate_circuit_v2_wasm,
    bytes_to_hex,
    hpre_v2,
} from "../../app/lib/crypto_lib/crypto_lib";

// Import user operations functions
import { respondChallenge, giveOpinion } from "../../app/lib/blockchain/dispute";
import { Contract } from "ethers";
import { abi } from "../../app/lib/blockchain/contracts/DisputeSOXAccount.json";
import { PROVIDER } from "../../app/lib/blockchain/config";

const DISPUTE_ADDRESS = process.env.DISPUTE_ADDRESS || "0x9B3643e64FE5765E89575c226eC5016284D472F9";

async function main() {
    console.log("=".repeat(80));
    console.log("🧪 TEST COMPLET - GATE 1 (User Operations + submitCommitmentLeft)");
    console.log("=".repeat(80));
    console.log(`\n📋 Contrat dispute: ${DISPUTE_ADDRESS}\n`);

    // Initialize WASM
    const modulePath = join(__dirname, "../../app/lib/crypto_lib/crypto_lib_bg.wasm");
    const module = readFileSync(modulePath);
    initSync({ module });
    console.log("✅ WASM initialisé\n");

    const [sponsor, buyer, vendor, sbSponsor, svSponsor] = await ethers.getSigners();
    const provider = ethers.provider;

    // Vérifier que le contrat existe
    const code = await provider.getCode(DISPUTE_ADDRESS);
    if (!code || code === "0x") {
        throw new Error(`❌ Contrat non trouvé à l'adresse ${DISPUTE_ADDRESS}`);
    }

    // Charger le contrat
    const dispute = await ethers.getContractAt("DisputeSOXAccount", DISPUTE_ADDRESS);

    // État initial
    let state = Number(await dispute.currState());
    let chall = Number(await dispute.chall());
    let a = Number(await dispute.a());
    let b = Number(await dispute.b());
    const numGates = Number(await dispute.numGates());
    const numBlocks = Number(await dispute.numBlocks());
    const commitment = await dispute.commitment();

    console.log("📊 ÉTAT INITIAL:");
    console.log("─".repeat(50));
    console.log(`État: ${state}`);
    console.log(`a: ${a}, b: ${b}, chall: ${chall}`);
    console.log(`numGates: ${numGates}, numBlocks: ${numBlocks}\n`);

    // Récupérer les parties
    const contractVendor = await dispute.vendor();
    const contractBuyer = await dispute.buyer();
    const vendorSigner = await dispute.vendorSigner();
    const buyerSigner = await dispute.buyerSigner();

    console.log("👥 PARTIES:");
    console.log("─".repeat(50));
    console.log(`Vendor: ${contractVendor}`);
    console.log(`Vendor Signer: ${vendorSigner}`);
    console.log(`Buyer: ${contractBuyer}`);
    console.log(`Buyer Signer: ${buyerSigner}\n`);

    // Trouver les signers correspondants
    const allSigners = [sponsor, buyer, vendor, sbSponsor, svSponsor];
    const vendorWallet = allSigners.find(s => s.address.toLowerCase() === contractVendor.toLowerCase());
    const buyerWallet = allSigners.find(s => s.address.toLowerCase() === contractBuyer.toLowerCase());
    const vendorSignerWallet = allSigners.find(s => s.address.toLowerCase() === vendorSigner.toLowerCase());
    const buyerSignerWallet = allSigners.find(s => s.address.toLowerCase() === buyerSigner.toLowerCase());

    if (!vendorWallet || !buyerWallet) {
        throw new Error("❌ Impossible de trouver les wallets vendor/buyer correspondants");
    }

    // Charger les données depuis la base de données
    const dbPath = path.join(__dirname, "../../app/db/sox.sqlite");
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
    const itemDescriptionBytes = new Uint8Array(Buffer.from(contractRow.item_description.slice(2), 'hex'));

    // Récupérer la clé AES
    const optimisticContractAddr = await dispute.optimisticContract();
    const optimisticContract = await ethers.getContractAt("OptimisticSOXAccount", optimisticContractAddr);
    const keyBytes = await optimisticContract.key();
    const keyHex = ethers.hexlify(keyBytes);
    const keyUint8Array = new Uint8Array(ethers.getBytes(keyHex));

    console.log("🔑 CLÉ AES:");
    console.log("─".repeat(50));
    console.log(`Clé (hex): ${keyHex}`);
    console.log(`Clé (longueur): ${keyBytes.length} bytes\n`);

    // Calculer le precontract pour obtenir le circuit évalué
    console.log("🔢 CALCUL DU PRÉCONTRAT...");
    const precontract = compute_precontract_values_v2(itemDescriptionBytes, keyUint8Array);
    const circuitBytes = precontract.circuit_bytes;
    const ct = precontract.ct;
    const evaluatedCircuit = evaluate_circuit_v2_wasm(
        circuitBytes,
        ct,
        bytes_to_hex(keyUint8Array)
    ).to_bytes();
    console.log("✅ Précontrat et circuit évalué\n");

    // ============================================
    // FORCER L'ÉTAT À WaitVendorDataLeft (6) avec chall = 1 via USER OPERATIONS
    // ============================================
    console.log("🔄 FORCEMENT DE L'ÉTAT À WaitVendorDataLeft (6) avec chall = 1 (via User Operations)...");
    console.log("─".repeat(50));

    const maxRounds = Math.ceil(Math.log2(numGates)) + 5;
    let round = 0;

    while (state !== 6 && round < maxRounds) {
        state = Number(await dispute.currState());
        chall = Number(await dispute.chall());
        a = Number(await dispute.a());
        b = Number(await dispute.b());

        console.log(`\nRound ${round + 1}:`);
        console.log(`  État: ${state}, a: ${a}, b: ${b}, chall: ${chall}`);

        if (state === 6 && chall === 1) {
            console.log("  ✅ État atteint: WaitVendorDataLeft (6) avec chall = 1");
            break;
        }

        if (state === 3) { // ChallengeBuyer
            // Vérifier si a == b (recherche binaire terminée)
            if (a === b) {
                // Si a == b, le buyer ne peut plus répondre, on passe directement à giveOpinion
                console.log(`  ⚠️  a == b (${a}), recherche binaire terminée`);
                console.log(`  📤 Vérification si buyerResponses[${chall}] est défini...`);
                try {
                    const existingResponse = await dispute.getBuyerResponse(chall);
                    if (existingResponse !== ethers.ZeroHash) {
                        console.log(`  ✅ buyerResponses[${chall}] est déjà défini`);
                        // Simuler que l'état est maintenant WaitVendorOpinion
                        state = 2;
                    } else {
                        // Le buyer doit répondre
                        console.log(`  📤 Buyer répond au challenge ${chall} via user operation...`);
                        const response = hpre_v2(evaluatedCircuit, numBlocks, chall);
                        const responseHex = bytes_to_hex(response);
                        
                        const buyerToUse = buyerSignerWallet || buyerWallet;
                        if (!buyerToUse) {
                            throw new Error("❌ Impossible de trouver le buyer signer");
                        }
                        const buyerAddr = await buyerToUse.getAddress();
                        
                        await respondChallenge(buyerAddr, DISPUTE_ADDRESS, responseHex);
                        console.log(`  ✅ User operation envoyée et confirmée`);
                    }
                } catch (error: any) {
                    console.log(`  ⚠️  Erreur: ${error.message}`);
                    // Si respondChallenge échoue avec InvalidState, buyerResponses est peut-être déjà défini
                    // On passe directement à giveOpinion
                    state = 2;
                }
            } else {
                // Le buyer doit répondre
                console.log(`  📤 Buyer répond au challenge ${chall} via user operation...`);
                const response = hpre_v2(evaluatedCircuit, numBlocks, chall);
                const responseHex = bytes_to_hex(response);
                
                const buyerToUse = buyerSignerWallet || buyerWallet;
                if (!buyerToUse) {
                    throw new Error("❌ Impossible de trouver le buyer signer");
                }
                const buyerAddr = await buyerToUse.getAddress();
                
                await respondChallenge(buyerAddr, DISPUTE_ADDRESS, responseHex);
                console.log(`  ✅ User operation envoyée et confirmée`);
            }
        }
        
        if (state === 2) { // WaitVendorOpinion
            // Le vendor doit donner son opinion via user operation (false pour forcer left)
            console.log(`  📤 Vendor donne son opinion (false) via user operation...`);
            
            // Trouver l'adresse du vendor signer
            const vendorToUse = vendorSignerWallet || vendorWallet;
            if (!vendorToUse) {
                throw new Error("❌ Impossible de trouver le vendor signer");
            }
            const vendorAddr = await vendorToUse.getAddress();
            
            // Utiliser giveOpinion (comme l'interface)
            console.log(`  📤 Envoi de giveOpinion via user operation...`);
            await giveOpinion(vendorAddr, DISPUTE_ADDRESS, false);
            console.log(`  ✅ User operation envoyée et confirmée`);
        } else {
            console.log(`  ⚠️  État inattendu: ${state}`);
            break;
        }

        // Attendre un peu pour que la transaction soit minée
        await new Promise(resolve => setTimeout(resolve, 2000));

        round++;
    }

    // Vérifier l'état final
    state = Number(await dispute.currState());
    chall = Number(await dispute.chall());
    a = Number(await dispute.a());

    console.log("\n📊 ÉTAT FINAL:");
    console.log("─".repeat(50));
    console.log(`État: ${state} ${state === 6 ? "✅ (WaitVendorDataLeft)" : "❌"}`);
    console.log(`chall: ${chall} ${chall === 1 ? "✅" : "❌"}`);
    console.log(`a: ${a}\n`);

    if (state !== 6 || chall !== 1) {
        throw new Error(`❌ Impossible d'atteindre l'état WaitVendorDataLeft (6) avec chall = 1. État actuel: ${state}, chall: ${chall}`);
    }

    // ============================================
    // TESTER submitCommitmentLeft
    // ============================================
    console.log("🧪 TEST DE submitCommitmentLeft POUR LA GATE 1...");
    console.log("─".repeat(50));

    const gateNum = 1; // 1-indexed

    // Calculer les preuves
    console.log(`📐 Calcul des preuves pour la gate ${gateNum}...`);
    const proofs = compute_proofs_left_v2(
        circuitBytes,
        evaluatedCircuit,
        ct,
        gateNum - 1, // 0-indexed
        numBlocks
    );
    console.log("✅ Preuves calculées\n");

    // Convertir les preuves
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

    // Convertir openingValue
    const openingValueBytes = ethers.getBytes(openingValueHex);

    // Test avec staticCall
    console.log("🧪 Test avec staticCall...");
    try {
        const vendorToUse = vendorSignerWallet || vendorWallet;
        if (!vendorToUse) {
            throw new Error("❌ Impossible de trouver le vendor signer");
        }

        const result = await dispute.connect(vendorToUse).submitCommitmentLeft.staticCall(
            openingValueBytes,
            gateNum,
            gateBytesArray,
            valuesArray,
            currAccArray,
            proof1Array,
            proof2Array,
            proofExtArray
        );
        console.log("✅ staticCall réussi!");
        console.log("✅ Les preuves sont valides et devraient passer sur le contrat réel\n");
    } catch (error: any) {
        console.log("❌ staticCall échoué:");
        console.log(`   Erreur: ${error.message}`);
        
        if (error.data) {
            console.log(`   Données: ${error.data}`);
        }
        if (error.reason) {
            console.log(`   Raison: ${error.reason}`);
        }
        
        throw error;
    }

    console.log("=".repeat(80));
    console.log("✅ TEST COMPLET TERMINÉ AVEC SUCCÈS!");
    console.log("=".repeat(80));
    console.log("\n📝 Résumé:");
    console.log("  ✅ État forcé à WaitVendorDataLeft (6) avec chall = 1 (via User Operations)");
    console.log("  ✅ Preuves calculées pour la gate 1");
    console.log("  ✅ staticCall réussi - les preuves sont valides");
    console.log("\n💡 Vous pouvez maintenant envoyer la transaction réelle via le frontend");
}

main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error(error);
        process.exit(1);
    });

