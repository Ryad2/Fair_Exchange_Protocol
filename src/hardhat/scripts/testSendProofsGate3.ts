import hre from "hardhat";
import { ethers } from "hardhat";
import { parseEther } from "ethers";
import * as fs from "fs";
import * as path from "path";
import { join } from "node:path";
import { readFile } from "node:fs/promises";
import {
    bytes_to_hex,
    compute_precontract_values_v2,
    compute_proofs_v2,
    evaluate_circuit_v2_wasm,
    initSync,
} from "../../app/lib/crypto_lib/crypto_lib";


const STATE_NAMES = [
    "ChallengeBuyer",      // 0
    "WaitVendorOpinion",   // 1
    "WaitVendorData",      // 2
    "WaitVendorDataLeft",  // 3
    "WaitVendorDataRight", // 4
    "Complete",            // 5
    "Cancel",              // 6
    "End"                  // 7
];

async function main() {
    // Initialiser WASM
    const modulePath = join(__dirname, "../../app/lib/crypto_lib/crypto_lib_bg.wasm");
    const module = await readFile(modulePath);
    initSync({ module: module });

    const disputeAddr = process.env.DISPUTE_ADDR || "0x0b545A095e837d23a74340A75798B519fA27bcbD";
    
    if (!ethers.isAddress(disputeAddr)) {
        console.error("❌ Adresse invalide:", disputeAddr);
        process.exit(1);
    }

    console.log("\n" + "=".repeat(80));
    console.log("🧪 TEST ENVOI DES PREUVES POUR LA GATE 3");
    console.log("=".repeat(80));
    console.log(`\n📋 Contrat de dispute: ${disputeAddr}\n`);

    const [sponsor, buyer, vendor, sbSponsor, svSponsor] = await hre.ethers.getSigners();
    const provider = ethers.provider;
    
    const dispute = await ethers.getContractAt("DisputeSOXAccount", disputeAddr);

    try {
        // Vérifier si le contrat existe
        const code = await provider.getCode(disputeAddr);
        if (!code || code === "0x") {
            console.error("❌ Aucun contrat trouvé à cette adresse!");
            process.exit(1);
        }
        console.log("✅ Contrat trouvé (code:", code.length, "bytes)\n");

        // Récupérer l'état actuel
        const state = await dispute.currState();
        const stateNum = Number(state);
        console.log(`🔹 État actuel: ${stateNum} (${STATE_NAMES[stateNum] || "UNKNOWN"})`);

        // Récupérer les informations du contrat
        const chall = await dispute.chall();
        const a = await dispute.a();
        const numBlocks = await dispute.numBlocks();
        const numGates = await dispute.numGates();
        const commitmentOnChain = await dispute.commitment();
        const optimisticContractAddr = await dispute.optimisticContract();
        const vendorSigner = await dispute.vendorSigner();
        
        console.log(`🔹 Challenge actuel: ${chall}`);
        console.log(`🔹 Gate demandée (a): ${a}`);
        console.log(`🔹 Nombre de blocs: ${numBlocks}`);
        console.log(`🔹 Nombre de gates: ${numGates}`);
        console.log(`🔹 Commitment: ${commitmentOnChain}`);
        console.log(`🔹 Contrat OptimisticSOXAccount: ${optimisticContractAddr}`);
        console.log(`🔹 VendorSigner: ${vendorSigner}\n`);

        // Utiliser la gate demandée par le contrat
        const gateNum = Number(a);
        console.log(`✅ Gate demandée: ${gateNum}\n`);

        // Vérifier l'état
        if (stateNum !== 2) {
            console.error(`❌ L'état actuel est ${STATE_NAMES[stateNum]} (${stateNum}), pas WaitVendorData (2)!`);
            process.exit(1);
        }
        console.log(`✅ État confirmé: WaitVendorData (2)\n`);

        // Récupérer la clé AES depuis OptimisticSOXAccount
        const optimisticContract = await ethers.getContractAt("OptimisticSOXAccount", optimisticContractAddr);
        const keyBytes = await optimisticContract.key();
        if (!keyBytes || keyBytes.length === 0) {
            console.error("❌ Clé AES non définie dans OptimisticSOXAccount!");
            process.exit(1);
        }
        // Convertir la clé en Uint8Array (key() retourne bytes memory)
        const key = new Uint8Array(ethers.getBytes(keyBytes));
        if (key.length !== 16) {
            console.error(`❌ Clé AES invalide: longueur ${key.length} bytes (attendu: 16 bytes)!`);
            console.error(`   Clé: ${bytes_to_hex(key)}`);
            process.exit(1);
        }
        console.log(`✅ Clé AES récupérée: ${bytes_to_hex(key).slice(0, 20)}... (${key.length} bytes)\n`);

        // Vérifier les réponses du buyer
        console.log("📊 Réponses du buyer:");
        const buyerResponse2 = await dispute.getBuyerResponse(2);
        const buyerResponse3 = await dispute.getBuyerResponse(3);
        if (buyerResponse2 !== ethers.ZeroHash) {
            console.log(`   Challenge 2: ${buyerResponse2.slice(0, 20)}... ✅`);
        } else {
            console.log(`   Challenge 2: NON DÉFINI ❌`);
        }
        if (buyerResponse3 !== ethers.ZeroHash) {
            console.log(`   Challenge 3: ${buyerResponse3.slice(0, 20)}... ✅`);
        } else {
            console.log(`   Challenge 3: NON DÉFINI ❌`);
        }
        console.log("");

        // Lire le fichier test_65bytes.bin et calculer le precontract
        const testFile = path.join(__dirname, "../../../test_65bytes.bin");
        if (!fs.existsSync(testFile)) {
            console.error("❌ Fichier test_65bytes.bin non trouvé!");
            console.error("   Chemin recherché:", testFile);
            process.exit(1);
        }
        
        console.log("📁 Lecture du fichier test_65bytes.bin...");
        const fileBuffer = fs.readFileSync(testFile);
        const fileContent = new Uint8Array(fileBuffer);
        console.log(`✅ Fichier lu: ${fileContent.length} bytes\n`);

        // Calculer le precontract pour obtenir l'opening value
        console.log("📝 Calcul du precontract (chiffrement + circuit + commitment)...");
        const precontract = compute_precontract_values_v2(fileContent, key);
        const precontractCommitment = precontract.commitment; // { c: Uint8Array, o: Uint8Array }
        const openingValue = precontractCommitment.o;
        const openingValueHex = bytes_to_hex(openingValue);
        const circuitBytes = precontract.circuit_bytes;
        const ct = precontract.ct;
        const computedCommitmentHex = bytes_to_hex(precontractCommitment.c);
        
        // Vérifier que le commitment correspond
        if (computedCommitmentHex.toLowerCase() !== commitmentOnChain.toLowerCase()) {
            console.error("❌ Le commitment calculé ne correspond pas au commitment on-chain!");
            console.error(`   Calculé: ${computedCommitmentHex.slice(0, 20)}...`);
            console.error(`   On-chain: ${commitmentOnChain.slice(0, 20)}...`);
            console.error("   💡 Vous devez utiliser le même fichier que celui utilisé lors de la création du contrat");
            process.exit(1);
        }
        console.log(`✅ Commitment correspond: ${computedCommitmentHex.slice(0, 20)}...`);
        console.log(`✅ Opening value: ${openingValueHex.slice(0, 20)}...\n`);

        // Évaluer le circuit
        console.log("🔧 Évaluation du circuit...");
        const evaluatedBytes = evaluate_circuit_v2_wasm(
            circuitBytes,
            ct,
            bytes_to_hex(key)
        ).to_bytes();
        console.log(`✅ Circuit évalué: ${evaluatedBytes.length} bytes\n`);

        // Générer les preuves pour la gate 3
        console.log(`🔧 Génération des preuves pour la gate ${gateNum}...`);
        const proofs = compute_proofs_v2(circuitBytes, evaluatedBytes, ct, gateNum);
        
        console.log(`✅ Preuves générées:`);
        console.log(`   - proof1: ${proofs.proof1.length} couches`);
        console.log(`   - proof2: ${proofs.proof2.length} couches`);
        console.log(`   - proof3: ${proofs.proof3.length} couches`);
        console.log(`   - proof_ext: ${proofs.proof_ext.length} couches\n`);

        // Préparer les paramètres pour submitCommitment
        const gateBytesArray = new Uint8Array(proofs.gate_bytes);
        const valuesArray = proofs.values.map((v: Uint8Array) => new Uint8Array(v));
        const currAccArray = new Uint8Array(proofs.curr_acc);
        const proof1Array = proofs.proof1.map((level: Uint8Array[]) =>
            level.map((v: Uint8Array) => bytes_to_hex(new Uint8Array(v)))
        );
        const proof2Array = proofs.proof2.map((level: Uint8Array[]) =>
            level.map((v: Uint8Array) => bytes_to_hex(new Uint8Array(v)))
        );
        const proof3Array = proofs.proof3.map((level: Uint8Array[]) =>
            level.map((v: Uint8Array) => bytes_to_hex(new Uint8Array(v)))
        );
        const proofExtArray = proofs.proof_ext.map((level: Uint8Array[]) =>
            level.map((v: Uint8Array) => bytes_to_hex(new Uint8Array(v)))
        );
        
        console.log("📤 Préparation de l'envoi des preuves...");
        console.log(`   Gate number: ${gateNum}`);
        console.log(`   Gate bytes length: ${gateBytesArray.length}`);
        console.log(`   Values count: ${valuesArray.length}`);
        console.log(`   Current acc: ${bytes_to_hex(currAccArray).slice(0, 20)}...\n`);

        // Trouver le signer qui correspond au vendorSigner
        const signers = await ethers.getSigners();
        let vendorSignerAccount = null;
        for (const signer of signers) {
            if ((await signer.getAddress()).toLowerCase() === vendorSigner.toLowerCase()) {
                vendorSignerAccount = signer;
                break;
            }
        }

        if (!vendorSignerAccount) {
            console.error(`❌ Aucun signer trouvé correspondant au vendorSigner ${vendorSigner}`);
            console.error("   Signers disponibles:");
            for (const signer of signers) {
                console.error(`   - ${await signer.getAddress()}`);
            }
            process.exit(1);
        }

        console.log(`✅ Signer trouvé: ${await vendorSignerAccount.getAddress()}\n`);

        // Envoyer les preuves
        console.log("📤 Envoi des preuves via submitCommitment...");
        console.log(`   Opening value: ${openingValueHex.slice(0, 20)}...`);
        console.log(`   Gate number: ${gateNum}`);
        console.log(`   Gate bytes length: ${gateBytesArray.length}`);
        console.log(`   Values count: ${valuesArray.length}`);
        console.log(`   Current acc: ${bytes_to_hex(currAccArray).slice(0, 20)}...\n`);
        
        try {
            const tx = await dispute.connect(vendorSignerAccount).submitCommitment(
                openingValueHex,
                gateNum,
                gateBytesArray,
                valuesArray.map((v) => bytes_to_hex(v)),
                bytes_to_hex(currAccArray),
                proof1Array,
                proof2Array,
                proof3Array,
                proofExtArray
            );
            console.log("✅ Transaction envoyée:", tx.hash);
            console.log("⏳ Attente de confirmation...");
            const receipt = await tx.wait();
            console.log("✅ Transaction confirmée dans le bloc:", receipt?.blockNumber);
            
            // Vérifier l'état après
            const newState = await dispute.currState();
            const newStateNum = Number(newState);
            console.log(`\n📊 Nouvel état: ${newStateNum} (${STATE_NAMES[newStateNum] || "UNKNOWN"})`);
            
            if (newStateNum === 5) {
                console.log("🎉 VENDOR GAGNE (dispute complétée)");
            } else if (newStateNum === 6) {
                console.log("❌ BUYER GAGNE (dispute annulée - vendor a perdu)");
            } else if (newStateNum === 0) {
                console.log("🔄 Retour à ChallengeBuyer (nouveaux rounds)");
            } else {
                console.log("⚠️  État inattendu");
            }

        } catch (error: any) {
            console.error("❌ Erreur lors de l'envoi des preuves:");
            console.error("   Message:", error.message);
            if (error.reason) {
                console.error("   Raison:", error.reason);
            }
            if (error.data) {
                console.error("   Données:", error.data);
            }
            throw error;
        }

    } catch (error: any) {
        console.error(`\n❌ Erreur:`, error.message);
        if (error.data) {
            console.error(`   Données d'erreur:`, error.data);
        }
        console.error(error);
    }

    console.log("\n" + "=".repeat(80) + "\n");
}

main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error(error);
        process.exit(1);
    });
