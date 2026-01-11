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
    compute_proof_right_v2,
    evaluate_circuit_v2_wasm,
    hpre_v2,
    initSync,
} from "../../app/lib/crypto_lib/crypto_lib";
import EntryPointArtifact from "@account-abstraction/contracts/artifacts/EntryPoint.json";

const DISPUTE_FEES = 10n;
const SPONSOR_FEES = 5n;

const DISPUTE_STATE_NAMES = [
    "ChallengeBuyer",      // 0
    "WaitVendorOpinion",   // 1
    "WaitVendorData",      // 2
    "WaitVendorDataLeft",  // 3
    "WaitVendorDataRight", // 4
    "Complete",            // 5
    "Cancel",              // 6
    "End"                  // 7
];

function stateName(state: number): string {
    return DISPUTE_STATE_NAMES[state] || `Unknown(${state})`;
}

interface TestScenario {
    name: string;
    fileSize: number;
    fileContent: Uint8Array;
    key: Uint8Array;
    vendorWins: boolean; // true si le vendor devrait gagner (fichiers identiques), false sinon
}

async function createTestFile(size: number, pattern: number): Promise<Uint8Array> {
    const file = new Uint8Array(size);
    for (let i = 0; i < size; i++) {
        file[i] = (i * pattern) % 256;
    }
    return file;
}

async function createTestScenarios(): Promise<TestScenario[]> {
    const scenarios: TestScenario[] = [];
    
    // Scénario 1: Petit fichier (65 bytes) - Vendor gagne (fichiers identiques)
    scenarios.push({
        name: "Petit fichier (65 bytes) - Vendor gagne",
        fileSize: 65,
        fileContent: await createTestFile(65, 17),
        key: new Uint8Array([0, 17, 34, 51, 68, 85, 102, 119, 136, 153, 170, 187, 204, 221, 238, 255]),
        vendorWins: true
    });
    
    // Scénario 2: Fichier moyen (512 bytes) - Vendor gagne
    scenarios.push({
        name: "Fichier moyen (512 bytes) - Vendor gagne",
        fileSize: 512,
        fileContent: await createTestFile(512, 23),
        key: new Uint8Array([1, 18, 35, 52, 69, 86, 103, 120, 137, 154, 171, 188, 205, 222, 239, 0]),
        vendorWins: true
    });
    
    // Scénario 3: Fichier plus grand (1024 bytes) - Vendor gagne
    scenarios.push({
        name: "Fichier plus grand (1024 bytes) - Vendor gagne",
        fileSize: 1024,
        fileContent: await createTestFile(1024, 31),
        key: new Uint8Array([2, 19, 36, 53, 70, 87, 104, 121, 138, 155, 172, 189, 206, 223, 240, 1]),
        vendorWins: true
    });
    
    return scenarios;
}

async function runScenario(
    scenario: TestScenario,
    signers: any,
    libraries: any,
    entryPointAddr: string
): Promise<boolean> {
    console.log("\n" + "=".repeat(80));
    console.log(`🧪 SCÉNARIO: ${scenario.name}`);
    console.log("=".repeat(80));
    
    try {
        // Initialiser WASM
        const modulePath = join(__dirname, "../../app/lib/crypto_lib/crypto_lib_bg.wasm");
        const module = await readFile(modulePath);
        initSync({ module: module });
        
        // Calculer le precontract
        console.log("📝 Calcul du precontract...");
        const precontract = compute_precontract_values_v2(scenario.fileContent, scenario.key);
        const commitment = precontract.commitment;
        const commitmentHex = bytes_to_hex(commitment.c);
        const openingValueHex = bytes_to_hex(commitment.o);
        const numBlocks = precontract.num_blocks;
        const numGates = precontract.num_gates;
        const circuitBytes = precontract.circuit_bytes;
        const ct = precontract.ct;
        
        console.log(`  ✅ Precontract calculé:`);
        console.log(`     numBlocks: ${numBlocks}`);
        console.log(`     numGates: ${numGates}`);
        console.log(`     commitment: ${commitmentHex.slice(0, 20)}...`);
        
        // Évaluer le circuit
        console.log("📝 Évaluation du circuit...");
        const evaluatedBytes = evaluate_circuit_v2_wasm(
            circuitBytes,
            ct,
            bytes_to_hex(scenario.key)
        ).to_bytes();
        console.log("  ✅ Circuit évalué");
        
        // Déployer OptimisticSOXAccount
        console.log("🚀 Déploiement de OptimisticSOXAccount...");
        const OptimisticSOXAccountFactory = await ethers.getContractFactory(
            "OptimisticSOXAccount",
            {
                libraries: {
                    DisputeDeployer: libraries.disputeDeployer,
                },
            }
        );
        
        const sponsorAmount = parseEther("1");
        const agreedPrice = parseEther("0.001");
        const completionTip = parseEther("0.0001");
        const disputeTip = parseEther("0.0001");
        const timeoutIncrement = 3600n;
        
        const optimisticAccount = await OptimisticSOXAccountFactory.connect(signers.sponsor).deploy(
            entryPointAddr,
            await signers.buyer.getAddress(),
            await signers.vendor.getAddress(),
            agreedPrice,
            completionTip,
            disputeTip,
            timeoutIncrement,
            commitmentHex,
            numBlocks,
            numGates,
            await signers.vendor.getAddress(),
            {
                value: sponsorAmount,
            }
        );
        await optimisticAccount.waitForDeployment();
        const optimisticAddress = await optimisticAccount.getAddress();
        console.log(`  ✅ OptimisticSOXAccount déployé à: ${optimisticAddress}`);
        
        // Envoyer le paiement
        console.log("💳 Envoi du paiement...");
        await optimisticAccount.connect(signers.buyer).sendPayment({
            value: agreedPrice + completionTip,
        });
        console.log("  ✅ Paiement envoyé");
        
        // Envoyer la clé
        console.log("🔑 Envoi de la clé...");
        const keyHex = bytes_to_hex(scenario.key);
        const keyBytes = ethers.getBytes(keyHex);
        await optimisticAccount.connect(signers.vendor).sendKey(keyBytes);
        console.log("  ✅ Clé envoyée");
        
        // Lancer la dispute
        console.log("⚔️  Lancement de la dispute...");
        await optimisticAccount.connect(signers.buyerDisputeSponsor).sendBuyerDisputeSponsorFee({
            value: SPONSOR_FEES + disputeTip,
        });
        await optimisticAccount.connect(signers.vendorDisputeSponsor).sendVendorDisputeSponsorFee({
            value: SPONSOR_FEES + disputeTip,
        });
        
        const disputeAddress = await optimisticAccount.disputeContract();
        console.log(`  ✅ Dispute lancée à: ${disputeAddress}`);
        
        const dispute = await ethers.getContractAt("DisputeSOXAccount", disputeAddress);
        
        // Résoudre la dispute complètement
        console.log("⚔️  Résolution complète de la dispute...");
        let state = Number(await dispute.currState());
        console.log(`  📊 État initial: ${stateName(state)}`);
        
        const maxRounds = 20;
        let roundCount = 0;
        
        // Phase 1: Challenge-response rounds
        while (state === 0 && roundCount < maxRounds) {
            const challenge = Number(await dispute.chall());
            console.log(`  🔄 Round ${roundCount + 1}: challenge = ${challenge}`);
            
            const response = hpre_v2(evaluatedBytes, numBlocks, challenge);
            const responseHex = bytes_to_hex(response);
            await dispute.connect(signers.buyer).respondChallenge(responseHex);
            console.log(`    ✅ Buyer a répondu`);
            
            const computedResponse = hpre_v2(evaluatedBytes, numBlocks, challenge);
            const computedResponseHex = bytes_to_hex(computedResponse);
            const latestResponse = await dispute.getLatestBuyerResponse();
            const vendorAgrees = computedResponseHex === latestResponse;
            
            await dispute.connect(signers.vendor).giveOpinion(vendorAgrees);
            console.log(`    ${vendorAgrees ? "✅" : "❌"} Vendor ${vendorAgrees ? "agreed" : "disagreed"}`);
            
            state = Number(await dispute.currState());
            roundCount++;
            
            if (state !== 0) {
                break;
            }
        }
        
        if (state === 0) {
            throw new Error(`Trop de rounds (${roundCount})`);
        }
        
        console.log(`  ✅ Sortie des rounds après ${roundCount} rounds. État: ${stateName(state)}`);
        
        // Phase 2: Envoyer les preuves
        const maxPhases = 10;
        let phaseCount = 0;
        
        while ((state === 2 || state === 3 || state === 4) && phaseCount < maxPhases) {
            phaseCount++;
            const gateNum = Number(await dispute.a());
            console.log(`  📤 Phase ${phaseCount}: État ${stateName(state)}, gate ${gateNum}`);
            
            if (state === 4) {
                // WaitVendorDataRight
                const proof = compute_proof_right_v2(evaluatedBytes, numBlocks, numGates);
                const proofBytes32: string[][] = proof.map((layer: Uint8Array[]) =>
                    layer.map((item: Uint8Array) => ethers.hexlify(new Uint8Array(item)))
                );
                await dispute.connect(signers.vendor).submitCommitmentRight(proofBytes32);
                console.log(`    ✅ submitCommitmentRight envoyé`);
                
            } else if (state === 3) {
                // WaitVendorDataLeft
                const proofs = compute_proofs_left_v2(circuitBytes, evaluatedBytes, ct, gateNum);
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
                await dispute.connect(signers.vendor).submitCommitmentLeft(
                    openingValueHex,
                    gateNum,
                    gateBytesArray,
                    valuesArray,
                    currAccArray,
                    proof1Array,
                    proof2Array,
                    proofExtArray
                );
                console.log(`    ✅ submitCommitmentLeft envoyé`);
                
            } else if (state === 2) {
                // WaitVendorData
                const proofs = compute_proofs_v2(circuitBytes, evaluatedBytes, ct, gateNum);
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
                await dispute.connect(signers.vendor).submitCommitment(
                    openingValueHex,
                    gateNum,
                    gateBytesArray,
                    valuesArray,
                    currAccArray,
                    proof1Array,
                    proof2Array,
                    proof3Array,
                    proofExtArray
                );
                console.log(`    ✅ submitCommitment envoyé`);
            }
            
            state = Number(await dispute.currState());
            console.log(`    📊 Nouvel état: ${stateName(state)}`);
            
            if (state === 5 || state === 6 || state === 7) {
                break;
            }
        }
        
        // Phase 3: Finaliser
        if (state === 5) {
            await dispute.connect(signers.buyer).completeDispute();
            state = Number(await dispute.currState());
        } else if (state === 6) {
            await dispute.connect(signers.vendor).cancelDispute();
            state = Number(await dispute.currState());
        }
        
        const lastLosingPartyWasVendor = await dispute.lastLosingPartyWasVendor();
        const vendorWon = state === 7 && !lastLosingPartyWasVendor;
        const buyerWon = state === 7 && lastLosingPartyWasVendor;
        
        console.log(`\n📊 Résultat final:`);
        console.log(`  État: ${stateName(state)}`);
        console.log(`  Dernier perdant: ${lastLosingPartyWasVendor ? "Vendor" : "Buyer"}`);
        console.log(`  Vendor a gagné: ${vendorWon}`);
        console.log(`  Buyer a gagné: ${buyerWon}`);
        
        const expectedVendorWins = scenario.vendorWins;
        const testPassed = (expectedVendorWins && vendorWon) || (!expectedVendorWins && buyerWon);
        
        if (testPassed) {
            console.log(`\n✅ TEST RÉUSSI: Le résultat correspond au scénario attendu`);
        } else {
            console.log(`\n❌ TEST ÉCHOUÉ: Le résultat ne correspond pas au scénario attendu`);
            console.log(`  Attendu: ${expectedVendorWins ? "Vendor gagne" : "Buyer gagne"}`);
            console.log(`  Obtenu: ${vendorWon ? "Vendor gagne" : buyerWon ? "Buyer gagne" : "Inconnu"}`);
        }
        
        return testPassed;
        
    } catch (error: any) {
        console.error(`\n❌ ERREUR dans le scénario:`, error.message);
        console.error(error);
        return false;
    }
}

async function main() {
    const [sponsor, buyer, vendor, sbSponsor, svSponsor] = await hre.ethers.getSigners();
    const provider = ethers.provider;
    
    console.log("=".repeat(80));
    console.log("🧪 TEST MULTIPLE SCÉNARIOS DE DISPUTE");
    console.log("=".repeat(80));
    console.log("\n📋 Comptes:");
    console.log("  Sponsor:", await sponsor.getAddress());
    console.log("  Buyer:", await buyer.getAddress());
    console.log("  Vendor:", await vendor.getAddress());
    console.log("  Buyer Dispute Sponsor:", await sbSponsor.getAddress());
    console.log("  Vendor Dispute Sponsor:", await svSponsor.getAddress());
    console.log("");
    
    // Déployer EntryPoint
    console.log("🔐 Déploiement EntryPoint...");
    const EntryPointFactory = new ethers.ContractFactory(
        EntryPointArtifact.abi,
        EntryPointArtifact.bytecode,
        sponsor
    );
    const entryPoint = await EntryPointFactory.deploy();
    await entryPoint.waitForDeployment();
    const entryPointAddress = await entryPoint.getAddress();
    console.log(`  ✅ EntryPoint déployé à: ${entryPointAddress}`);
    console.log("");
    
    // Déployer les libraries
    console.log("📚 Déploiement des libraries...");
    const AccumulatorVerifierFactory = await ethers.getContractFactory("AccumulatorVerifier");
    const accumulatorVerifier = await AccumulatorVerifierFactory.deploy();
    await accumulatorVerifier.waitForDeployment();
    
    const SHA256EvaluatorFactory = await ethers.getContractFactory("SHA256Evaluator");
    const sha256Evaluator = await SHA256EvaluatorFactory.deploy();
    await sha256Evaluator.waitForDeployment();
    
    const AES128CtrEvaluatorFactory = await ethers.getContractFactory("AES128CtrEvaluator");
    const aes128CtrEvaluator = await AES128CtrEvaluatorFactory.deploy();
    await aes128CtrEvaluator.waitForDeployment();
    
    const CommitmentOpenerFactory = await ethers.getContractFactory("CommitmentOpener");
    const commitmentOpener = await CommitmentOpenerFactory.deploy();
    await commitmentOpener.waitForDeployment();
    
    const DisputeDeployerFactory = await ethers.getContractFactory("DisputeDeployer", {
        libraries: {
            AccumulatorVerifier: await accumulatorVerifier.getAddress(),
            SHA256Evaluator: await sha256Evaluator.getAddress(),
            CommitmentOpener: await commitmentOpener.getAddress(),
        },
    });
    const disputeDeployer = await DisputeDeployerFactory.deploy();
    await disputeDeployer.waitForDeployment();
    
    console.log(`  ✅ Libraries déployées`);
    console.log("");
    
    const libraries = {
        disputeDeployer: await disputeDeployer.getAddress(),
    };
    
    const signers = {
        sponsor,
        buyer,
        vendor,
        buyerDisputeSponsor: sbSponsor,
        vendorDisputeSponsor: svSponsor,
    };
    
    // Créer les scénarios
    const scenarios = await createTestScenarios();
    
    console.log(`\n📋 ${scenarios.length} scénarios à tester:\n`);
    scenarios.forEach((scenario, index) => {
        console.log(`  ${index + 1}. ${scenario.name}`);
    });
    console.log("");
    
    // Exécuter chaque scénario
    const results: { scenario: string; passed: boolean }[] = [];
    
    for (let i = 0; i < scenarios.length; i++) {
        const scenario = scenarios[i];
        console.log(`\n\n🔹 Scénario ${i + 1}/${scenarios.length}`);
        const passed = await runScenario(scenario, signers, libraries, entryPointAddress);
        results.push({ scenario: scenario.name, passed });
    }
    
    // Résumé final
    console.log("\n\n" + "=".repeat(80));
    console.log("📊 RÉSUMÉ DES TESTS");
    console.log("=".repeat(80));
    console.log("");
    
    const passedCount = results.filter(r => r.passed).length;
    const failedCount = results.length - passedCount;
    
    results.forEach((result, index) => {
        const status = result.passed ? "✅ PASSÉ" : "❌ ÉCHOUÉ";
        console.log(`  ${index + 1}. ${status}: ${result.scenario}`);
    });
    
    console.log("");
    console.log(`✅ Tests réussis: ${passedCount}/${results.length}`);
    console.log(`❌ Tests échoués: ${failedCount}/${results.length}`);
    console.log("");
    
    if (failedCount === 0) {
        console.log("🎉 TOUS LES TESTS SONT PASSÉS!");
    } else {
        console.log("⚠️  CERTAINS TESTS ONT ÉCHOUÉ");
        process.exit(1);
    }
}

main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error(error);
        process.exit(1);
    });
