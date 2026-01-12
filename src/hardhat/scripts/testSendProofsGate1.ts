import hre from "hardhat";
import { ethers } from "hardhat";
import { parseEther } from "ethers";
import fs from "fs";
import path from "path";
import { join } from "node:path";
import { readFile } from "node:fs/promises";
import {
    bytes_to_hex,
    compute_precontract_values_v2,
    compute_proofs_v2,
    compute_proofs_left_v2,
    evaluate_circuit_v2_wasm,
    initSync,
} from "../../app/lib/crypto_lib/crypto_lib";

const DISPUTE_STATE_NAMES = [
    "ChallengeBuyer",
    "WaitVendorOpinion",
    "WaitVendorData",
    "WaitVendorDataLeft",
    "WaitVendorDataRight",
    "Complete",
    "Cancel",
    "End",
];

function stateName(state: number): string {
    return DISPUTE_STATE_NAMES[state] || `Unknown(${state})`;
}

const TARGET_GATE = 1; // Porte 1 à tester
const DISPUTE_ADDRESS = process.env.DISPUTE_ADDR || "0xB1d2b436209ca0f8FdF5e1E6ef53bb1A0f5B8614";

async function main() {
    const [sponsor, buyer, vendor, sbSponsor, svSponsor] = await hre.ethers.getSigners();
    const provider = ethers.provider;

    console.log("=".repeat(80));
    console.log(`🧪 TEST ENVOI DES PREUVES - PORTE ${TARGET_GATE} AVEC test_65bytes.bin`);
    console.log("=".repeat(80));
    console.log(`\n📋 Contrat dispute: ${DISPUTE_ADDRESS}\n`);
    console.log("📋 Comptes:");
    console.log("  Vendor:", await vendor.getAddress());
    console.log("");

    // Vérifier que le contrat existe
    const code = await provider.getCode(DISPUTE_ADDRESS);
    if (!code || code === "0x") {
        throw new Error(`❌ Contrat non trouvé à l'adresse ${DISPUTE_ADDRESS}`);
    }

    // Charger le contrat (utiliser getContractAt pour éviter les problèmes de linking)
    const dispute = await ethers.getContractAt("DisputeSOXAccount", DISPUTE_ADDRESS);

    // Vérifier l'état actuel
    const state = Number(await dispute.currState());
    console.log(`📊 État actuel: ${state} (${stateName(state)})`);

    if (state !== 2 && state !== 3) {
        console.log(`⚠️  ATTENTION: Le contrat doit être dans l'état WaitVendorData (2) ou WaitVendorDataLeft (3)`);
        console.log(`   État actuel: ${stateName(state)}`);
        console.log(`   Veuillez attendre que le contrat passe en WaitVendorData ou WaitVendorDataLeft`);
        return;
    }

    const chall = Number(await dispute.chall());
    const a = Number(await dispute.a());
    const numBlocks = Number(await dispute.numBlocks());
    const numGates = Number(await dispute.numGates());
    const commitment = await dispute.commitment();
    const optimisticContractAddr = await dispute.optimisticContract();

    console.log(`📊 Challenge actuel: ${chall}`);
    console.log(`📊 Gate demandée (a): ${a}`);
    console.log(`📊 Nombre de blocs: ${numBlocks}`);
    console.log(`📊 Nombre de gates: ${numGates}`);
    console.log("");

    // Vérifier que la gate demandée correspond à TARGET_GATE
    if (a !== TARGET_GATE) {
        console.log(`⚠️  La gate demandée (${a}) ne correspond pas à TARGET_GATE (${TARGET_GATE})`);
        console.log(`   Le script va calculer les preuves pour la gate ${a} au lieu de ${TARGET_GATE}`);
    }

    // ============================================
    // ÉTAPE 0: Initialiser WASM et préparer le fichier
    // ============================================
    console.log("📁 ÉTAPE 0: Initialisation WASM et préparation du fichier test_65bytes.bin...");
    
    // Initialiser WASM
    const modulePath = join(__dirname, "../../app/lib/crypto_lib/crypto_lib_bg.wasm");
    const module = await readFile(modulePath);
    initSync({ module: module });
    console.log("  ✅ WASM module initialisé");
    
    // Lire le fichier
    const filePath = path.join(__dirname, "../../../test_65bytes.bin");
    if (!fs.existsSync(filePath)) {
        throw new Error(`❌ Fichier non trouvé: ${filePath}`);
    }
    
    const fileBuffer = fs.readFileSync(filePath);
    const fileContent = new Uint8Array(fileBuffer);
    console.log(`  ✅ Fichier lu: ${fileContent.length} bytes`);
    
    // Générer la clé et calculer le precontract
    let key = new Uint8Array(16);
    for (let i = 0; i < key.length; i++) {
        key[i] = (i * 17) % 256;
    }
    console.log("  🔑 Clé générée");
    
    console.log("  📝 Calcul du precontract (chiffrement + circuit + commitment)...");
    const precontract = compute_precontract_values_v2(fileContent, key);
    const commitmentCalculated = precontract.commitment;
    const commitmentHex = bytes_to_hex(commitmentCalculated.c);
    const openingValueHex = bytes_to_hex(commitmentCalculated.o);
    const circuitBytes = precontract.circuit_bytes;
    const ct = precontract.ct;
    
    console.log(`  ✅ Precontract calculé:`);
    console.log(`     commitment calculé: ${commitmentHex.slice(0, 20)}...`);
    console.log(`     commitment du contrat: ${commitment.slice(0, 20)}...`);
    
    // Vérifier que le commitment correspond
    if (commitmentHex.toLowerCase() !== commitment.toLowerCase()) {
        console.log(`  ⚠️  ATTENTION: Le commitment calculé ne correspond pas au commitment du contrat!`);
        console.log(`     Calculé: ${commitmentHex}`);
        console.log(`     Contrat: ${commitment}`);
        console.log(`     Cela peut causer des erreurs lors de la vérification`);
    }
    
    // Évaluer le circuit
    console.log("  📝 Évaluation du circuit...");
    const evaluatedBytes = evaluate_circuit_v2_wasm(
        circuitBytes,
        ct,
        bytes_to_hex(key)
    ).to_bytes();
    console.log("  ✅ Circuit évalué");
    console.log("");

    // ============================================
    // ÉTAPE 1: Calculer les preuves pour la gate demandée
    // ============================================
    const gateNum = a; // Utiliser la gate demandée par le contrat
    
    let proofs: any;
    if (state === 3) {
        // WaitVendorDataLeft - utiliser compute_proofs_left_v2
        console.log(`📝 ÉTAPE 1: Calcul des preuves avec compute_proofs_left_v2 pour la gate ${gateNum}...`);
        proofs = compute_proofs_left_v2(circuitBytes, evaluatedBytes, ct, gateNum);
        console.log(`  ✅ Preuves calculées pour la gate ${gateNum} (submitCommitmentLeft)`);
    } else {
        // WaitVendorData - utiliser compute_proofs_v2
        console.log(`📝 ÉTAPE 1: Calcul des preuves avec compute_proofs_v2 pour la gate ${gateNum}...`);
        proofs = compute_proofs_v2(circuitBytes, evaluatedBytes, ct, gateNum);
        console.log(`  ✅ Preuves calculées pour la gate ${gateNum} (submitCommitment)`);
    }
    
    console.log(`     gate_bytes length: ${proofs.gate_bytes.length} bytes`);
    console.log(`     values count: ${proofs.values.length}`);
    console.log(`     proof1 layers: ${proofs.proof1.length}`);
    console.log(`     proof2 layers: ${proofs.proof2.length}`);
    if (proofs.proof3) {
        console.log(`     proof3 layers: ${proofs.proof3.length}`);
    }
    console.log(`     proof_ext layers: ${proofs.proof_ext.length}`);
    console.log("");

    // ============================================
    // ÉTAPE 2: Préparer les paramètres
    // ============================================
    console.log("📦 ÉTAPE 2: Préparation des paramètres...");
    
    const gateBytesArray = new Uint8Array(proofs.gate_bytes);
    const valuesArray = proofs.values.map((v: Uint8Array) => new Uint8Array(v));
    const currAccArray = new Uint8Array(proofs.curr_acc);
    
    // Convertir les preuves en format bytes32[][]
    const proof1Array = proofs.proof1.map((level: Uint8Array[]) =>
        level.map((v: Uint8Array) => ethers.hexlify(new Uint8Array(v)))
    );
    const proof2Array = proofs.proof2.map((level: Uint8Array[]) =>
        level.map((v: Uint8Array) => ethers.hexlify(new Uint8Array(v)))
    );
    const proofExtArray = proofs.proof_ext.map((level: Uint8Array[]) =>
        level.map((v: Uint8Array) => ethers.hexlify(new Uint8Array(v)))
    );
    
    // proof3 n'existe que pour submitCommitment (state === 2)
    let proof3Array: string[][] | undefined;
    if (state === 2 && proofs.proof3) {
        proof3Array = proofs.proof3.map((level: Uint8Array[]) =>
            level.map((v: Uint8Array) => ethers.hexlify(new Uint8Array(v)))
        );
    }
    
    console.log("  ✅ Paramètres préparés");
    console.log(`     openingValue: ${openingValueHex.slice(0, 20)}...`);
    console.log(`     gateNum: ${gateNum}`);
    console.log(`     gateBytes: ${gateBytesArray.length} bytes`);
    console.log(`     values: ${valuesArray.length} éléments`);
    console.log("");

    // ============================================
    // ÉTAPE 3: Vérifier avec staticCall d'abord
    // ============================================
    console.log("🔍 ÉTAPE 3: Test avec staticCall...");
    
    try {
        if (state === 3) {
            // WaitVendorDataLeft - submitCommitmentLeft
            await dispute.connect(vendor).submitCommitmentLeft.staticCall(
                openingValueHex,
                gateNum,
                gateBytesArray,
                valuesArray,
                currAccArray,
                proof1Array,
                proof2Array,
                proofExtArray
            );
            console.log("  ✅ staticCall réussi pour submitCommitmentLeft - La transaction devrait passer");
        } else {
            // WaitVendorData - submitCommitment
            await dispute.connect(vendor).submitCommitment.staticCall(
                openingValueHex,
                gateNum,
                gateBytesArray,
                valuesArray,
                currAccArray,
                proof1Array,
                proof2Array,
                proof3Array!,
                proofExtArray
            );
            console.log("  ✅ staticCall réussi pour submitCommitment - La transaction devrait passer");
        }
    } catch (staticCallError: any) {
        console.log(`  ❌ staticCall échoué: ${staticCallError.message}`);
        console.log(`  ❌ Cela signifie que la transaction va échouer`);
        
        // Afficher plus de détails sur l'erreur
        if (staticCallError.data) {
            console.log(`  📋 Données d'erreur: ${staticCallError.data}`);
        }
        if (staticCallError.reason) {
            console.log(`  📋 Raison: ${staticCallError.reason}`);
        }
        
        throw staticCallError;
    }
    console.log("");

    // ============================================
    // ÉTAPE 4: Envoyer la transaction
    // ============================================
    if (state === 3) {
        console.log("📤 ÉTAPE 4: Envoi de submitCommitmentLeft...");
        
        try {
            const tx = await dispute.connect(vendor).submitCommitmentLeft(
                openingValueHex,
                gateNum,
                gateBytesArray,
                valuesArray,
                currAccArray,
                proof1Array,
                proof2Array,
                proofExtArray
            );
            
            console.log(`  ⏳ Transaction envoyée: ${tx.hash}`);
            const receipt = await tx.wait();
            console.log("  ✅ submitCommitmentLeft envoyé et confirmé");
            console.log(`     Block: ${receipt?.blockNumber}`);
            console.log(`     Gas utilisé: ${receipt?.gasUsed?.toString()}`);
            
            // Vérifier le nouvel état
            const newState = Number(await dispute.currState());
            console.log(`  📊 Nouvel état après submitCommitmentLeft: ${newState} (${stateName(newState)})`);
            
        } catch (error: any) {
            console.log(`  ❌ ERREUR lors de submitCommitmentLeft: ${error.message}`);
            
            // Afficher plus de détails
            if (error.data) {
                console.log(`  📋 Données d'erreur: ${error.data}`);
            }
            if (error.reason) {
                console.log(`  📋 Raison: ${error.reason}`);
            }
            if (error.code) {
                console.log(`  📋 Code d'erreur: ${error.code}`);
            }
            
            throw error;
        }
    } else {
        console.log("📤 ÉTAPE 4: Envoi de submitCommitment...");
        
        try {
            const tx = await dispute.connect(vendor).submitCommitment(
                openingValueHex,
                gateNum,
                gateBytesArray,
                valuesArray,
                currAccArray,
                proof1Array,
                proof2Array,
                proof3Array!,
                proofExtArray
            );
            
            console.log(`  ⏳ Transaction envoyée: ${tx.hash}`);
            const receipt = await tx.wait();
            console.log("  ✅ submitCommitment envoyé et confirmé");
            console.log(`     Block: ${receipt?.blockNumber}`);
            console.log(`     Gas utilisé: ${receipt?.gasUsed?.toString()}`);
            
            // Vérifier le nouvel état
            const newState = Number(await dispute.currState());
            console.log(`  📊 Nouvel état après submitCommitment: ${newState} (${stateName(newState)})`);
            
        } catch (error: any) {
            console.log(`  ❌ ERREUR lors de submitCommitment: ${error.message}`);
            
            // Afficher plus de détails
            if (error.data) {
                console.log(`  📋 Données d'erreur: ${error.data}`);
            }
            if (error.reason) {
                console.log(`  📋 Raison: ${error.reason}`);
            }
            if (error.code) {
                console.log(`  📋 Code d'erreur: ${error.code}`);
            }
            
            throw error;
        }
    }
    
    console.log("");
    console.log("=".repeat(80));
    console.log("✅ TEST TERMINÉ");
    console.log("=".repeat(80));
}

main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error(error);
        process.exit(1);
    });

