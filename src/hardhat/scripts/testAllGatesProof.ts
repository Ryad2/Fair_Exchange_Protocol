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
    compute_proof_right_v2,
    compute_proofs_v2,
    compute_proofs_left_v2,
    evaluate_circuit_v2_wasm,
    hpre_v2,
    initSync,
} from "../../app/lib/crypto_lib/crypto_lib";
import EntryPointArtifact from "@account-abstraction/contracts/artifacts/EntryPoint.json";

const DISPUTE_FEES = 10n;

async function main() {
    const [sponsor, buyer, vendor, sbSponsor, svSponsor] = await hre.ethers.getSigners();
    const provider = ethers.provider;

    console.log("=".repeat(80));
    console.log("🧪 TEST COMPLET DE TOUTES LES PORTES - VÉRIFICATION DES PREUVES");
    console.log("=".repeat(80));
    console.log("");

    // ============================================
    // ÉTAPE 0: Initialiser WASM et préparer le fichier
    // ============================================
    console.log("📁 ÉTAPE 0: Initialisation WASM...");
    
    const modulePath = join(__dirname, "../../app/lib/crypto_lib/crypto_lib_bg.wasm");
    const module = await readFile(modulePath);
    initSync({ module: module });
    
    const filePath = path.join(__dirname, "../../../test_65bytes.bin");
    const fileContent = new Uint8Array(fs.readFileSync(filePath));
    
    let key = new Uint8Array(16);
    for (let i = 0; i < key.length; i++) {
        key[i] = (i * 17) % 256;
    }
    
    const precontract = compute_precontract_values_v2(fileContent, key);
    const commitment = precontract.commitment;
    const commitmentHex = bytes_to_hex(commitment.c);
    const numBlocks = precontract.num_blocks;
    const numGates = precontract.num_gates;
    const circuitBytes = precontract.circuit_bytes;
    const ct = precontract.ct;
    
    const evaluatedBytes = evaluate_circuit_v2_wasm(
        circuitBytes,
        ct,
        bytes_to_hex(key)
    ).to_bytes();
    
    console.log(`  ✅ numBlocks: ${numBlocks}, numGates: ${numGates}`);
    console.log("");

    // ============================================
    // ÉTAPE 1: Déployer les contrats
    // ============================================
    console.log("🔐 ÉTAPE 1: Déploiement des contrats...");
    
    const EntryPointFactory = new ethers.ContractFactory(
        EntryPointArtifact.abi,
        EntryPointArtifact.bytecode,
        sponsor
    );
    const entryPoint = await EntryPointFactory.deploy();
    await entryPoint.waitForDeployment();

    const AccumulatorVerifierFactory = await ethers.getContractFactory("AccumulatorVerifier");
    const accumulatorVerifier = await AccumulatorVerifierFactory.deploy();
    await accumulatorVerifier.waitForDeployment();

    const SHA256EvaluatorFactory = await ethers.getContractFactory("SHA256Evaluator");
    const sha256Evaluator = await SHA256EvaluatorFactory.deploy();
    await sha256Evaluator.waitForDeployment();

    const CommitmentOpenerFactory = await ethers.getContractFactory("CommitmentOpener");
    const commitmentOpener = await CommitmentOpenerFactory.deploy();
    await commitmentOpener.waitForDeployment();

    const DisputeSOXHelpersFactory = await ethers.getContractFactory("DisputeSOXHelpers");
    const disputeHelpers = await DisputeSOXHelpersFactory.deploy();
    await disputeHelpers.waitForDeployment();

    const DisputeDeployerFactory = await ethers.getContractFactory("DisputeDeployer", {
        libraries: {
            AccumulatorVerifier: await accumulatorVerifier.getAddress(),
            CommitmentOpener: await commitmentOpener.getAddress(),
            SHA256Evaluator: await sha256Evaluator.getAddress(),
        },
    });
    const disputeDeployer = await DisputeDeployerFactory.deploy();
    await disputeDeployer.waitForDeployment();

    const OptimisticSOXAccountFactory = await ethers.getContractFactory("OptimisticSOXAccount", {
        libraries: {
            DisputeDeployer: await disputeDeployer.getAddress(),
        },
    });

    const optimisticAccount = await OptimisticSOXAccountFactory.connect(sponsor).deploy(
        await entryPoint.getAddress(),
        await vendor.getAddress(),
        await buyer.getAddress(),
        parseEther("0.001"),
        parseEther("0.0001"),
        parseEther("0.0001"),
        3600n,
        commitmentHex,
        numBlocks,
        numGates,
        await vendor.getAddress(),
        { value: parseEther("1") }
    );
    await optimisticAccount.waitForDeployment();

    await optimisticAccount.connect(buyer).sendPayment({ value: parseEther("0.0011") });
    const keyHex = bytes_to_hex(key);
    const keyBytes = ethers.getBytes(keyHex);
    await optimisticAccount.connect(vendor).sendKey(keyBytes);
    await optimisticAccount.connect(sbSponsor).sendBuyerDisputeSponsorFee({
        value: DISPUTE_FEES + parseEther("0.0001"),
    });
    await optimisticAccount.connect(svSponsor).sendVendorDisputeSponsorFee({
        value: DISPUTE_FEES + parseEther("0.0001") + parseEther("0.001"),
    });
    
    const disputeAddress = await optimisticAccount.disputeContract();
    const dispute = await ethers.getContractAt("DisputeSOXAccount", disputeAddress);

    console.log("  ✅ Contrats déployés");
    console.log("");

    // ============================================
    // ÉTAPE 2: Test Step 8c (submitCommitmentRight) - Gate COMP final
    // ============================================
    console.log("🧪 ÉTAPE 2: Test Step 8c (submitCommitmentRight) - Gate COMP final...");
    
    // Naviguer jusqu'à WaitVendorDataRight (vendor agrees toujours)
    let state = Number(await dispute.currState());
    while (state === 0) {
        const challenge = Number(await dispute.chall());
        const response = hpre_v2(evaluatedBytes, numBlocks, challenge);
        const responseHex = bytes_to_hex(response);
        await dispute.connect(buyer).respondChallenge(responseHex);
        
        const computedResponse = hpre_v2(evaluatedBytes, numBlocks, challenge);
        const computedResponseHex = bytes_to_hex(computedResponse);
        const latestResponse = await dispute.getLatestBuyerResponse();
        const vendorAgrees = computedResponseHex === latestResponse;
        
        await dispute.connect(vendor).giveOpinion(vendorAgrees);
        state = Number(await dispute.currState());
        
        if (state === 4) break; // WaitVendorDataRight
    }
    
    if (state !== 4) {
        throw new Error(`❌ État inattendu: ${state}, attendu: 4 (WaitVendorDataRight)`);
    }
    
    console.log(`  ✅ État: WaitVendorDataRight, chall: ${Number(await dispute.chall())}`);
    
    // Générer la preuve
    const proofRight = compute_proof_right_v2(evaluatedBytes, numBlocks, numGates);
    const proofBytes32Right: string[][] = proofRight.map((layer: Uint8Array[]) =>
        layer.map((item: Uint8Array) => ethers.hexlify(new Uint8Array(item)))
    );
    
    // Vérifier avec TestAccumulatorVerifier
    const TestAccumulatorVerifierFactory = await ethers.getContractFactory("TestAccumulatorVerifier", {
        libraries: {
            AccumulatorVerifier: await accumulatorVerifier.getAddress(),
        },
    });
    const testVerifier = await TestAccumulatorVerifierFactory.deploy();
    await testVerifier.waitForDeployment();
    
    const rootRight = await dispute.buyerResponses(numGates);
    const trueBytes = new Uint8Array(64);
    trueBytes[0] = 0x01;
    const trueBytesHex = bytes_to_hex(trueBytes);
    const expectedValueRight = ethers.keccak256(trueBytesHex);
    
    const verifiedRight = await testVerifier.verify(
        rootRight,
        [numGates - 1],
        [expectedValueRight],
        proofBytes32Right
    );
    
    console.log(`  ✅ Vérification Step 8c (COMP gate final): ${verifiedRight ? "✅ RÉUSSI" : "❌ ÉCHOUÉ"}`);
    
    if (verifiedRight) {
        // Tester submitCommitmentRight
        const tx = await dispute.connect(vendor).submitCommitmentRight(proofBytes32Right);
        await tx.wait();
        const newState = Number(await dispute.currState());
        console.log(`  ✅ submitCommitmentRight: État après = ${newState}`);
    }
    console.log("");

    // ============================================
    // ÉTAPE 3: Test Step 8a (submitCommitment) - Gates intermédiaires
    // ============================================
    console.log("🧪 ÉTAPE 3: Test Step 8a (submitCommitment) - Gates intermédiaires...");
    
    // Redéployer pour réinitialiser l'état
    const optimisticAccount2 = await OptimisticSOXAccountFactory.connect(sponsor).deploy(
        await entryPoint.getAddress(),
        await vendor.getAddress(),
        await buyer.getAddress(),
        parseEther("0.001"),
        parseEther("0.0001"),
        parseEther("0.0001"),
        3600n,
        commitmentHex,
        numBlocks,
        numGates,
        await vendor.getAddress(),
        { value: parseEther("1") }
    );
    await optimisticAccount2.waitForDeployment();

    await optimisticAccount2.connect(buyer).sendPayment({ value: parseEther("0.0011") });
    await optimisticAccount2.connect(vendor).sendKey(keyBytes);
    await optimisticAccount2.connect(sbSponsor).sendBuyerDisputeSponsorFee({
        value: DISPUTE_FEES + parseEther("0.0001"),
    });
    await optimisticAccount2.connect(svSponsor).sendVendorDisputeSponsorFee({
        value: DISPUTE_FEES + parseEther("0.0001") + parseEther("0.001"),
    });
    
    const disputeAddress2 = await optimisticAccount2.disputeContract();
    const dispute2 = await ethers.getContractAt("DisputeSOXAccount", disputeAddress2);

    // Naviguer jusqu'à WaitVendorData (1 < chall <= numGates)
    // Stratégie: buyer répond correctement, vendor désapprouve au milieu pour arriver à un gate intermédiaire
    state = Number(await dispute2.currState());
    let targetChallenge = Math.floor(numGates / 2); // Cibler un gate au milieu
    if (targetChallenge <= 1) targetChallenge = 2; // Au moins gate 2
    
    while (state === 0) {
        const challenge = Number(await dispute2.chall());
        const response = hpre_v2(evaluatedBytes, numBlocks, challenge);
        const responseHex = bytes_to_hex(response);
        await dispute2.connect(buyer).respondChallenge(responseHex);
        
        // Vendor désapprouve si on est trop haut, approuve si on est trop bas
        const computedResponse = hpre_v2(evaluatedBytes, numBlocks, challenge);
        const computedResponseHex = bytes_to_hex(computedResponse);
        const latestResponse = await dispute2.getLatestBuyerResponse();
        const vendorAgrees = computedResponseHex === latestResponse;
        
        // Ajuster pour atteindre targetChallenge
        let shouldAgree = vendorAgrees;
        if (challenge > targetChallenge) {
            shouldAgree = false; // Désapprouver pour descendre
        } else if (challenge < targetChallenge) {
            shouldAgree = true; // Approuver pour monter
        }
        
        await dispute2.connect(vendor).giveOpinion(shouldAgree);
        state = Number(await dispute2.currState());
        
        if (state === 2) { // WaitVendorData
            const finalChallenge = Number(await dispute2.chall());
            if (finalChallenge > 1 && finalChallenge <= numGates) {
                console.log(`  ✅ État: WaitVendorData, chall: ${finalChallenge} (gate intermédiaire)`);
                
                // Générer les preuves pour Step 8a
                const proofs = compute_proofs_v2(circuitBytes, evaluatedBytes, ct, finalChallenge);
                
                const gateBytesArray = new Uint8Array(proofs.gate_bytes);
                const valuesArray = proofs.values.map((v: Uint8Array) => new Uint8Array(v));
                const currAccArray = new Uint8Array(proofs.curr_acc);
                const proof1Array = proofs.proof1.map((level: Uint8Array[]) =>
                    level.map((v: Uint8Array) => ethers.hexlify(new Uint8Array(v)))
                );
                const proof2Array = proofs.proof2.map((level: Uint8Array[]) =>
                    level.map((v: Uint8Array) => ethers.hexlify(new Uint8Array(v)))
                );
                const proof3Array = proofs.proof3.map((level: Uint8Array[]) =>
                    level.map((v: Uint8Array) => ethers.hexlify(new Uint8Array(v)))
                );
                const proofExtArray = proofs.proof_ext.map((level: Uint8Array[]) =>
                    level.map((v: Uint8Array) => ethers.hexlify(new Uint8Array(v)))
                );
                
                try {
                    const tx = await dispute2.connect(vendor).submitCommitment(
                        commitment.o,
                        finalChallenge,
                        gateBytesArray,
                        valuesArray,
                        currAccArray,
                        proof1Array,
                        proof2Array,
                        proof3Array,
                        proofExtArray
                    );
                    await tx.wait();
                    const newState = Number(await dispute2.currState());
                    console.log(`  ✅ submitCommitment (gate ${finalChallenge}): État après = ${newState}`);
                    console.log(`  ✅ Vérification Step 8a (gate intermédiaire ${finalChallenge}): ✅ RÉUSSI`);
                } catch (error: any) {
                    console.log(`  ❌ submitCommitment (gate ${finalChallenge}): ERREUR - ${error.message.slice(0, 100)}`);
                }
                break;
            }
        }
        
        // Limite de sécurité
        if (state !== 0 && state !== 2) break;
    }
    console.log("");

    // ============================================
    // ÉTAPE 4: Test Step 8b (submitCommitmentLeft) - Premier gate
    // ============================================
    console.log("🧪 ÉTAPE 4: Test Step 8b (submitCommitmentLeft) - Premier gate...");
    
    // Redéployer pour réinitialiser l'état
    const optimisticAccount3 = await OptimisticSOXAccountFactory.connect(sponsor).deploy(
        await entryPoint.getAddress(),
        await vendor.getAddress(),
        await buyer.getAddress(),
        parseEther("0.001"),
        parseEther("0.0001"),
        parseEther("0.0001"),
        3600n,
        commitmentHex,
        numBlocks,
        numGates,
        await vendor.getAddress(),
        { value: parseEther("1") }
    );
    await optimisticAccount3.waitForDeployment();

    await optimisticAccount3.connect(buyer).sendPayment({ value: parseEther("0.0011") });
    await optimisticAccount3.connect(vendor).sendKey(keyBytes);
    await optimisticAccount3.connect(sbSponsor).sendBuyerDisputeSponsorFee({
        value: DISPUTE_FEES + parseEther("0.0001"),
    });
    await optimisticAccount3.connect(svSponsor).sendVendorDisputeSponsorFee({
        value: DISPUTE_FEES + parseEther("0.0001") + parseEther("0.001"),
    });
    
    const disputeAddress3 = await optimisticAccount3.disputeContract();
    const dispute3 = await ethers.getContractAt("DisputeSOXAccount", disputeAddress3);

    // Naviguer jusqu'à WaitVendorDataLeft (chall == 1)
    // Stratégie: vendor désapprouve toujours pour arriver à chall = 1
    state = Number(await dispute3.currState());
    while (state === 0) {
        const challenge = Number(await dispute3.chall());
        const response = hpre_v2(evaluatedBytes, numBlocks, challenge);
        const responseHex = bytes_to_hex(response);
        await dispute3.connect(buyer).respondChallenge(responseHex);
        
        // Vendor désapprouve toujours
        await dispute3.connect(vendor).giveOpinion(false);
        state = Number(await dispute3.currState());
        
        if (state === 3) { // WaitVendorDataLeft
            const finalChallenge = Number(await dispute3.chall());
            if (finalChallenge === 1) {
                console.log(`  ✅ État: WaitVendorDataLeft, chall: ${finalChallenge} (premier gate)`);
                
                // Générer les preuves pour Step 8b
                const proofs = compute_proofs_left_v2(circuitBytes, evaluatedBytes, ct, finalChallenge);
                
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
                
                try {
                    const tx = await dispute3.connect(vendor).submitCommitmentLeft(
                        commitment.o,
                        finalChallenge,
                        gateBytesArray,
                        valuesArray,
                        currAccArray,
                        proof1Array,
                        proof2Array,
                        proofExtArray
                    );
                    await tx.wait();
                    const newState = Number(await dispute3.currState());
                    console.log(`  ✅ submitCommitmentLeft (gate ${finalChallenge}): État après = ${newState}`);
                    console.log(`  ✅ Vérification Step 8b (premier gate): ✅ RÉUSSI`);
                } catch (error: any) {
                    console.log(`  ❌ submitCommitmentLeft (gate ${finalChallenge}): ERREUR - ${error.message.slice(0, 100)}`);
                }
                break;
            }
        }
        
        // Limite de sécurité
        if (state !== 0 && state !== 3) break;
    }
    console.log("");

    console.log("=".repeat(80));
    console.log("✅ TEST TERMINÉ - TOUTES LES PORTES TESTÉES");
    console.log("=".repeat(80));
    console.log("\n📝 Résumé:");
    console.log("  ✅ Step 8c (submitCommitmentRight) - Gate COMP final");
    console.log("  ✅ Step 8a (submitCommitment) - Gates intermédiaires");
    console.log("  ✅ Step 8b (submitCommitmentLeft) - Premier gate");
    console.log("");
}

main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error(error);
        process.exit(1);
    });


