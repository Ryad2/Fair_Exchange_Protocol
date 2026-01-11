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
    evaluate_circuit_v2_wasm,
    hpre_v2,
    initSync,
} from "../../app/lib/crypto_lib/crypto_lib";
import EntryPointArtifact from "@account-abstraction/contracts/artifacts/EntryPoint.json";

const DISPUTE_FEES = 10n;
const SPONSOR_FEES = 5n;

async function main() {
    const [sponsor, buyer, vendor, sbSponsor, svSponsor] = await hre.ethers.getSigners();
    const provider = ethers.provider;

    console.log("=".repeat(80));
    console.log("🧪 TEST ACCUMULATOR PROOF RIGHT - DEBUG");
    console.log("=".repeat(80));
    console.log("\n📋 Comptes:");
    console.log("  Sponsor:", await sponsor.getAddress());
    console.log("  Buyer:", await buyer.getAddress());
    console.log("  Vendor:", await vendor.getAddress());
    console.log("");

    // ============================================
    // ÉTAPE 0: Initialiser WASM et préparer le fichier
    // ============================================
    console.log("📁 ÉTAPE 0: Initialisation WASM et préparation du fichier test_65bytes.bin...");
    
    const modulePath = join(__dirname, "../../app/lib/crypto_lib/crypto_lib_bg.wasm");
    const module = await readFile(modulePath);
    initSync({ module: module });
    console.log("  ✅ WASM module initialisé");
    
    const filePath = path.join(__dirname, "../../../test_65bytes.bin");
    if (!fs.existsSync(filePath)) {
        throw new Error(`❌ Fichier non trouvé: ${filePath}`);
    }
    
    const fileBuffer = fs.readFileSync(filePath);
    const fileContent = new Uint8Array(fileBuffer);
    console.log(`  ✅ Fichier lu: ${fileContent.length} bytes`);
    
    let key = new Uint8Array(16);
    for (let i = 0; i < key.length; i++) {
        key[i] = (i * 17) % 256;
    }
    console.log("  🔑 Clé générée");
    
    console.log("  📝 Calcul du precontract...");
    const precontract = compute_precontract_values_v2(fileContent, key);
    const commitment = precontract.commitment;
    const commitmentHex = bytes_to_hex(commitment.c);
    const numBlocks = precontract.num_blocks;
    const numGates = precontract.num_gates;
    const circuitBytes = precontract.circuit_bytes;
    const ct = precontract.ct;
    
    console.log(`  ✅ Precontract calculé:`);
    console.log(`     numBlocks: ${numBlocks}`);
    console.log(`     numGates: ${numGates}`);
    console.log(`     commitment: ${commitmentHex.slice(0, 20)}...`);
    
    const evaluatedBytes = evaluate_circuit_v2_wasm(
        circuitBytes,
        ct,
        bytes_to_hex(key)
    ).to_bytes();
    console.log("  ✅ Circuit évalué");
    console.log("");

    // ============================================
    // ÉTAPE 1: Déployer EntryPoint et libraries
    // ============================================
    console.log("🔐 ÉTAPE 1: Déploiement EntryPoint et libraries...");
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

    console.log("  ✅ Libraries déployées");
    console.log("");

    // ============================================
    // ÉTAPE 2: Déployer OptimisticSOXAccount et déclencher la dispute
    // ============================================
    console.log("🚀 ÉTAPE 2: Déploiement et configuration jusqu'à la dispute...");
    const OptimisticSOXAccountFactory = await ethers.getContractFactory("OptimisticSOXAccount", {
        libraries: {
            DisputeDeployer: await disputeDeployer.getAddress(),
        },
    });

    const sponsorAmount = parseEther("1");
    const agreedPrice = parseEther("0.001");
    const completionTip = parseEther("0.0001");
    const disputeTip = parseEther("0.0001");
    const timeoutIncrement = 3600n;

    const optimisticAccount = await OptimisticSOXAccountFactory.connect(sponsor).deploy(
        await entryPoint.getAddress(),
        await vendor.getAddress(),
        await buyer.getAddress(),
        agreedPrice,
        completionTip,
        disputeTip,
        timeoutIncrement,
        commitmentHex,
        numBlocks,
        numGates,
        await vendor.getAddress(),
        { value: sponsorAmount }
    );
    await optimisticAccount.waitForDeployment();

    await optimisticAccount.connect(buyer).sendPayment({ value: agreedPrice + completionTip });
    const keyHex = bytes_to_hex(key);
    const keyBytes = ethers.getBytes(keyHex);
    await optimisticAccount.connect(vendor).sendKey(keyBytes);
    await optimisticAccount.connect(sbSponsor).sendBuyerDisputeSponsorFee({
        value: DISPUTE_FEES + disputeTip,
    });
    await optimisticAccount.connect(svSponsor).sendVendorDisputeSponsorFee({
        value: DISPUTE_FEES + disputeTip + agreedPrice,
    });
    
    const disputeAddress = await optimisticAccount.disputeContract();
    const dispute = await ethers.getContractAt("DisputeSOXAccount", disputeAddress);
    console.log("  ✅ DisputeSOXAccount:", disputeAddress);
    console.log("");

    // ============================================
    // ÉTAPE 3: Naviguer jusqu'à WaitVendorDataRight
    // ============================================
    console.log("⚔️  ÉTAPE 3: Navigation jusqu'à WaitVendorDataRight...");
    let state = Number(await dispute.currState());
    const maxRounds = Math.ceil(Math.log2(numGates)) + 10;
    let roundCount = 0;
    
    while (state === 0 && roundCount < maxRounds) {
        const challenge = Number(await dispute.chall());
        console.log(`  🔄 Round ${roundCount + 1}: challenge = ${challenge} (1-indexed)`);
        
        const response = hpre_v2(evaluatedBytes, numBlocks, challenge);
        const responseHex = bytes_to_hex(response);
        await dispute.connect(buyer).respondChallenge(responseHex);
        
        const computedResponse = hpre_v2(evaluatedBytes, numBlocks, challenge);
        const computedResponseHex = bytes_to_hex(computedResponse);
        const latestResponse = await dispute.getLatestBuyerResponse();
        const vendorAgrees = computedResponseHex === latestResponse;
        
        await dispute.connect(vendor).giveOpinion(vendorAgrees);
        
        state = Number(await dispute.currState());
        roundCount++;
        
        if (state === 4) { // WaitVendorDataRight
            break;
        }
    }
    
    if (state !== 4) {
        throw new Error(`❌ État inattendu: ${state}, attendu: 4 (WaitVendorDataRight)`);
    }
    
    const chall = Number(await dispute.chall());
    console.log(`  ✅ État: WaitVendorDataRight, chall: ${chall}, numGates: ${numGates}`);
    console.log("");

    // ============================================
    // ÉTAPE 4: Vérifier buyerResponses
    // ============================================
    console.log("🔍 ÉTAPE 4: Vérification des buyerResponses...");
    const response9 = await dispute.buyerResponses(9);
    const response10 = await dispute.buyerResponses(10);
    const responseNumGates = await dispute.buyerResponses(numGates);
    
    console.log(`  buyerResponses[9]: ${response9}`);
    console.log(`  buyerResponses[10]: ${response10}`);
    console.log(`  buyerResponses[${numGates}]: ${responseNumGates}`);
    
    // Calculer hpre(9) et hpre(10)
    const hpre9 = hpre_v2(evaluatedBytes, numBlocks, 9);
    const hpre10 = hpre_v2(evaluatedBytes, numBlocks, 10);
    const hpre9Hex = bytes_to_hex(hpre9);
    const hpre10Hex = bytes_to_hex(hpre10);
    
    console.log(`  hpre(9): ${hpre9Hex}`);
    console.log(`  hpre(10): ${hpre10Hex}`);
    console.log(`  hpre(9) === hpre(10): ${hpre9Hex === hpre10Hex}`);
    console.log(`  buyerResponses[9] === hpre(9): ${response9 === hpre9Hex}`);
    console.log(`  buyerResponses[${numGates}] === hpre(${numGates}): ${responseNumGates === hpre9Hex}`);
    console.log("");

    // ============================================
    // ÉTAPE 5: Générer la preuve
    // ============================================
    console.log("📝 ÉTAPE 5: Génération de la preuve avec compute_proof_right_v2...");
    const proof = compute_proof_right_v2(evaluatedBytes, numBlocks, numGates);
    
    console.log(`  ✅ Preuve générée: ${proof.length} niveaux`);
    for (let i = 0; i < proof.length; i++) {
        console.log(`    Niveau ${i}: ${proof[i].length} éléments`);
    }
    console.log("");

    // ============================================
    // ÉTAPE 6: Préparer les données pour la vérification
    // ============================================
    console.log("🔧 ÉTAPE 6: Préparation des données pour la vérification...");
    
    // Valeur attendue: keccak256([0x01, 0x00, ..., 0x00]) - COMP gate retourne 64 bytes
    const trueBytes = new Uint8Array(64);
    trueBytes[0] = 0x01; // First byte is 1, rest are zeros
    const trueBytesHex = bytes_to_hex(trueBytes);
    const expectedValue = ethers.keccak256(trueBytesHex);
    console.log(`  Valeur attendue (keccak256([0x01, 0x00, ..., 0x00])): ${expectedValue}`);
    
    // Index du dernier gate: numGates - 1 (0-indexed dans gate_outputs)
    const lastGateIdx = numGates - 1;
    console.log(`  Index du dernier gate (0-indexed): ${lastGateIdx}`);
    
    // Root: buyerResponses[numGates] = hpre(numGates) = hpre(numGates + 1)
    const root = responseNumGates;
    console.log(`  Root (buyerResponses[${numGates}]): ${root}`);
    console.log("");

    // ============================================
    // ÉTAPE 7: Convertir la preuve en format Solidity
    // ============================================
    console.log("🔄 ÉTAPE 7: Conversion de la preuve en format Solidity...");
    const proofBytes32: string[][] = proof.map((layer: Uint8Array[]) =>
        layer.map((item: Uint8Array) => {
            const itemBytes = new Uint8Array(item);
            if (itemBytes.length !== 32) {
                throw new Error(`Proof item length is ${itemBytes.length}, expected 32`);
            }
            return ethers.hexlify(itemBytes);
        })
    );
    console.log(`  ✅ Preuve convertie: ${proofBytes32.length} niveaux`);
    console.log("");

    // ============================================
    // ÉTAPE 8: Tester la vérification avec AccumulatorVerifier directement
    // ============================================
    console.log("🧪 ÉTAPE 8: Test de la vérification avec AccumulatorVerifier...");
    
    const TestAccumulatorVerifierFactory = await ethers.getContractFactory("TestAccumulatorVerifier", {
        libraries: {
            AccumulatorVerifier: await accumulatorVerifier.getAddress(),
        },
    });
    const testVerifier = await TestAccumulatorVerifierFactory.deploy();
    await testVerifier.waitForDeployment();
    
    const idxArr = [lastGateIdx];
    const trueKeccakArr = [expectedValue];
    
    console.log(`  Paramètres de vérification:`);
    console.log(`    root: ${root}`);
    console.log(`    indices: [${idxArr.join(", ")}]`);
    console.log(`    valuesKeccak: [${trueKeccakArr.join(", ")}]`);
    console.log(`    proof: ${proofBytes32.length} niveaux`);
    
    try {
        const verified = await testVerifier.verify(
            root,
            idxArr,
            trueKeccakArr,
            proofBytes32
        );
        
        console.log(`  ✅ Résultat de la vérification: ${verified}`);
        
        if (verified) {
            console.log("  🎉 La vérification a RÉUSSI! Le vendor devrait gagner.");
        } else {
            console.log("  ❌ La vérification a ÉCHOUÉ! Le vendor va perdre.");
            console.log("  🔍 Il faut investiguer pourquoi la vérification échoue...");
        }
    } catch (error: any) {
        console.log(`  ❌ Erreur lors de la vérification: ${error.message}`);
    }
    console.log("");

    // ============================================
    // ÉTAPE 9: Vérifier la valeur réelle du dernier gate
    // ============================================
    console.log("🔍 ÉTAPE 9: Vérification de la valeur réelle du dernier gate...");
    
    // Le dernier gate devrait être un COMP gate qui retourne 0x01 si les fichiers sont identiques
    // On peut vérifier en regardant les valeurs évaluées
    const evaluated = JSON.parse(JSON.stringify(evaluatedBytes)); // Simple way to inspect
    console.log(`  Taille des valeurs évaluées: ${evaluatedBytes.length} bytes`);
    console.log(`  numBlocks: ${numBlocks}, numGates: ${numGates}`);
    console.log(`  Le dernier gate devrait être à l'index ${numBlocks + numGates - 1} dans evaluated.values`);
    console.log("");

    // ============================================
    // ÉTAPE 10: Tester submitCommitmentRight dans le contrat
    // ============================================
    console.log("🧪 ÉTAPE 10: Test de submitCommitmentRight dans le contrat...");
    
    try {
        const tx = await dispute.connect(vendor).submitCommitmentRight(proofBytes32);
        const receipt = await tx.wait();
        
        const newState = Number(await dispute.currState());
        console.log(`  ✅ Transaction réussie! Gas utilisé: ${receipt!.gasUsed.toString()}`);
        console.log(`  📊 Nouvel état: ${newState}`);
        
        if (newState === 0) {
            console.log("  ✅ État: ChallengeBuyer (Step 9 continue)");
        } else if (newState === 5) {
            console.log("  🎉 État: Complete (Vendor gagne!)");
        } else if (newState === 6) {
            console.log("  ❌ État: Cancel (Buyer gagne, vendor perd)");
        }
    } catch (error: any) {
        console.log(`  ❌ Erreur lors de submitCommitmentRight: ${error.message}`);
        if (error.data) {
            console.log(`  Données d'erreur: ${error.data}`);
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

