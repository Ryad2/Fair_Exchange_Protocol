import { ethers } from "hardhat";
import * as path from "path";
import * as fs from "fs";
import { join } from "path";
import { readFileSync } from "fs";

// Import WASM functions
import {
    initSync,
    compute_precontract_values_v2,
    compute_proofs_left_v2,
    evaluate_circuit_v2_wasm,
    bytes_to_hex,
} from "../../app/lib/crypto_lib/crypto_lib";


const DISPUTE_ADDRESS = process.env.DISPUTE_ADDRESS || "0x9B3643e64FE5765E89575c226eC5016284D472F9";

async function main() {
    console.log("=".repeat(80));
    console.log("🧪 TEST FORCÉ - GATE 1 (submitCommitmentLeft)");
    console.log("=".repeat(80));
    console.log(`\n📋 Contrat dispute: ${DISPUTE_ADDRESS}\n`);

    // Initialize WASM
    const modulePath = join(__dirname, "../../app/lib/crypto_lib/crypto_lib_bg.wasm");
    const module = readFileSync(modulePath);
    initSync({ module });
    console.log("✅ WASM initialisé\n");

    const [signer0, signer1, signer2] = await ethers.getSigners();
    const provider = ethers.provider;

    // Vérifier que le contrat existe
    const code = await provider.getCode(DISPUTE_ADDRESS);
    if (!code || code === "0x") {
        throw new Error(`❌ Contrat non trouvé à l'adresse ${DISPUTE_ADDRESS}`);
    }

    // Charger le contrat
    const dispute = await ethers.getContractAt("DisputeSOXAccount", DISPUTE_ADDRESS);

    // Vérifier l'état actuel
    const state = Number(await dispute.currState());
    const chall = Number(await dispute.a());
    const b = Number(await dispute.b());
    const challNum = Number(await dispute.chall());
    const numGates = Number(await dispute.numGates());
    const numBlocks = Number(await dispute.numBlocks());
    const commitment = await dispute.commitment();

    console.log("📊 ÉTAT ACTUEL DU CONTRAT:");
    console.log("─".repeat(50));
    console.log(`État: ${state} (${state === 6 ? "WaitVendorDataLeft ✅" : state === 3 ? "ChallengeBuyer ⚠️" : "Autre ⚠️"})`);
    console.log(`a: ${chall}, b: ${b}, chall: ${challNum}`);
    console.log(`numGates: ${numGates}, numBlocks: ${numBlocks}`);
    console.log(`commitment: ${commitment}\n`);

    // Si l'état n'est pas WaitVendorDataLeft (6), on doit simuler le flux
    if (state !== 6 || challNum !== 1) {
        console.log("⚠️  Le contrat n'est pas dans l'état WaitVendorDataLeft (6) avec chall=1");
        console.log("   Simulation du flux pour atteindre cet état...\n");
        
        // Pour un vrai test, on devrait forcer le contrat à cet état
        // Mais ici, on va juste vérifier qu'on peut tester avec l'état actuel
        console.log("❌ Pour tester gate 1, le contrat doit être dans l'état WaitVendorDataLeft (6)");
        console.log("   avec chall = 1 (gate 1)");
        console.log("\n💡 Pour forcer cet état, vous devez:");
        console.log("   1. Faire répondre le buyer au challenge (respondChallenge)");
        console.log("   2. Faire donner son opinion au vendor (giveOpinion(false))");
        console.log("   3. Répéter jusqu'à ce que chall == 1");
        console.log("   4. Alors l'état passera à WaitVendorDataLeft (6)");
        return;
    }

    console.log("✅ Le contrat est dans l'état WaitVendorDataLeft (6) avec chall=1\n");

    // Récupérer les parties
    const vendor = await dispute.vendor();
    const vendorSigner = await dispute.vendorSigner();
    const buyer = await dispute.buyer();
    const buyerSigner = await dispute.buyerSigner();

    console.log("👥 PARTIES:");
    console.log("─".repeat(50));
    console.log(`Vendor: ${vendor}`);
    console.log(`Vendor Signer: ${vendorSigner}`);
    console.log(`Buyer: ${buyer}`);
    console.log(`Buyer Signer: ${buyerSigner}\n`);

    // Récupérer la clé AES
    const optimisticContractAddr = await dispute.optimisticContract();
    const optimisticContract = await ethers.getContractAt("OptimisticSOXAccount", optimisticContractAddr);
    const keyBytes = await optimisticContract.key();
    const keyHex = ethers.hexlify(keyBytes);
    console.log("🔑 CLÉ AES:");
    console.log("─".repeat(50));
    console.log(`Clé (hex): ${keyHex}`);
    console.log(`Clé (longueur): ${keyBytes.length} bytes\n`);

    // Charger le fichier de test
    const testFile = path.join(__dirname, "../../app/public/test_65bytes.bin");
    if (!fs.existsSync(testFile)) {
        throw new Error(`❌ Fichier de test non trouvé: ${testFile}`);
    }
    const fileContent = fs.readFileSync(testFile);
    console.log("📄 FICHIER DE TEST:");
    console.log("─".repeat(50));
    console.log(`Fichier: ${testFile}`);
    console.log(`Taille: ${fileContent.length} bytes\n`);

    // Charger le circuit
    const circuitPath = path.join(__dirname, "../../app/public/circuit.bin");
    if (!fs.existsSync(circuitPath)) {
        throw new Error(`❌ Circuit non trouvé: ${circuitPath}`);
    }
    const circuit = fs.readFileSync(circuitPath);
    console.log("🔌 CIRCUIT:");
    console.log("─".repeat(50));
    console.log(`Circuit: ${circuitPath}`);
    console.log(`Taille: ${circuit.length} bytes\n`);

    // Convertir la clé en Uint8Array
    const keyUint8Array = new Uint8Array(ethers.getBytes(keyHex));
    if (keyUint8Array.length !== 16) {
        throw new Error(`❌ Clé invalide: ${keyUint8Array.length} bytes (attendu: 16 bytes)`);
    }

    // Calculer les valeurs de précontrat
    console.log("🔢 CALCUL DES VALEURS DE PRÉCONTRAT...");
    const precontractValues = compute_precontract_values_v2(
        new Uint8Array(fileContent),
        new Uint8Array(circuit),
        keyUint8Array
    );
    console.log("✅ Valeurs de précontrat calculées\n");

    // Vérifier le commitment
    const calculatedCommitment = ethers.keccak256(precontractValues.opening_value);
    if (calculatedCommitment.toLowerCase() !== commitment.toLowerCase()) {
        console.log("⚠️  ATTENTION: Le commitment calculé ne correspond pas au commitment du contrat!");
        console.log(`   Commitment du contrat: ${commitment}`);
        console.log(`   Commitment calculé: ${calculatedCommitment}`);
        console.log("   On continue quand même pour le test...\n");
    } else {
        console.log("✅ Commitment vérifié\n");
    }

    // Évaluer le circuit pour obtenir les valeurs des gates
    console.log("🔍 ÉVALUATION DU CIRCUIT...");
    const evaluatedCircuit = evaluate_circuit_v2_wasm(
        new Uint8Array(circuit),
        precontractValues.opening_value,
        keyUint8Array
    );
    console.log("✅ Circuit évalué\n");

    // Calculer les preuves pour la gate 1 (chall = 1, mais 0-indexed = 0)
    const gateNum = 1; // 1-indexed
    console.log(`📐 CALCUL DES PREUVES POUR LA GATE ${gateNum}...`);
    const proofs = compute_proofs_left_v2(
        new Uint8Array(circuit),
        evaluatedCircuit,
        precontractValues.opening_value,
        gateNum - 1, // 0-indexed
        numBlocks
    );
    console.log("✅ Preuves calculées\n");

    // Convertir les preuves en format hex
    const proof1Hex = proofs.proof1.map((p: Uint8Array) => bytes_to_hex(p));
    const proof2Hex = proofs.proof2.map((p: Uint8Array) => bytes_to_hex(p));
    const proofExtHex = proofs.proof_ext.map((p: Uint8Array) => bytes_to_hex(p));

    // Convertir les valeurs en format hex
    const valuesHex = proofs.values.map((v: Uint8Array) => bytes_to_hex(v));
    const currAccHex = bytes_to_hex(proofs.curr_acc);

    // Convertir gateBytes (64 bytes pour V2)
    const gateBytesHex = bytes_to_hex(proofs.gate_bytes);

    // Convertir openingValue
    const openingValueHex = bytes_to_hex(precontractValues.opening_value);

    console.log("📋 DONNÉES DES PREUVES:");
    console.log("─".repeat(50));
    console.log(`Gate Num (1-indexed): ${gateNum}`);
    console.log(`Gate Bytes (hex): ${gateBytesHex.slice(0, 66)}...`);
    console.log(`Values count: ${valuesHex.length}`);
    console.log(`Curr Acc (hex): ${currAccHex.slice(0, 66)}...`);
    console.log(`Proof1 count: ${proof1Hex.length}`);
    console.log(`Proof2 count: ${proof2Hex.length}`);
    console.log(`ProofExt count: ${proofExtHex.length}\n`);

    // Préparer les données pour submitCommitmentLeft
    const openingValueBytes = ethers.getBytes(openingValueHex);
    const gateBytesUint8 = ethers.getBytes(gateBytesHex);
    const valuesArray = valuesHex.map((v: string) => ethers.getBytes(v));
    const currAccArray = ethers.getBytes(currAccHex);
    const proof1Array = proof1Hex.map((p: string) => ethers.getBytes(p));
    const proof2Array = proof2Hex.map((p: string) => ethers.getBytes(p));
    const proofExtArray = proofExtHex.map((p: string) => ethers.getBytes(p));

    // Convertir en format bytes32[][]
    const proof1Bytes32 = proof1Array.map((p: Uint8Array) => {
        const result: string[] = [];
        for (let i = 0; i < p.length; i += 32) {
            const chunk = p.slice(i, i + 32);
            result.push(ethers.hexlify(chunk));
        }
        return result;
    });
    const proof2Bytes32 = proof2Array.map((p: Uint8Array) => {
        const result: string[] = [];
        for (let i = 0; i < p.length; i += 32) {
            const chunk = p.slice(i, i + 32);
            result.push(ethers.hexlify(chunk));
        }
        return result;
    });
    const proofExtBytes32 = proofExtArray.map((p: Uint8Array) => {
        const result: string[] = [];
        for (let i = 0; i < p.length; i += 32) {
            const chunk = p.slice(i, i + 32);
            result.push(ethers.hexlify(chunk));
        }
        return result;
    });

    // Test avec staticCall
    console.log("🧪 TEST AVEC staticCall...");
    try {
        const result = await dispute.submitCommitmentLeft.staticCall(
            openingValueBytes,
            gateNum,
            gateBytesUint8,
            valuesArray,
            currAccArray,
            proof1Bytes32,
            proof2Bytes32,
            proofExtBytes32
        );
        console.log("✅ staticCall réussi!\n");
        console.log("✅ Les preuves sont valides et devraient passer sur le contrat réel\n");
    } catch (error: any) {
        console.log("❌ staticCall échoué:");
        console.log(`   Erreur: ${error.message}`);
        
        // Essayer de décoder l'erreur
        if (error.data) {
            console.log(`   Données: ${error.data}`);
        }
        if (error.reason) {
            console.log(`   Raison: ${error.reason}`);
        }
        
        console.log("\n⚠️  Les preuves ne passent pas. Vérifiez:");
        console.log("   1. Que le commitment correspond à l'opening value");
        console.log("   2. Que les preuves sont correctes");
        console.log("   3. Que la clé AES est correcte");
        console.log("   4. Que l'état du contrat est correct");
    }

    console.log("\n" + "=".repeat(80));
    console.log("✅ TEST TERMINÉ");
    console.log("=".repeat(80));
}

main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error(error);
        process.exit(1);
    });

