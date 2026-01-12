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

async function main() {
    const [sponsor, buyer, vendor, sbSponsor, svSponsor] = await hre.ethers.getSigners();
    const provider = ethers.provider;

    console.log("=".repeat(80));
    console.log("🧪 TEST SIMPLE: VENDOR DOIT GAGNER (fichiers identiques)");
    console.log("=".repeat(80));
    console.log("");

    // Initialiser WASM
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

    // Déployer EntryPoint
    const EntryPointFactory = new ethers.ContractFactory(
        EntryPointArtifact.abi,
        EntryPointArtifact.bytecode,
        sponsor
    );
    const entryPoint = await EntryPointFactory.deploy();
    await entryPoint.waitForDeployment();

    // Déployer les libraries
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
    
    console.log(`État: ${state} (4 = WaitVendorDataRight)`);
    console.log(`step9Count avant: ${await dispute.step9Count()}`);
    console.log(`buyer avant: ${await dispute.buyer()}`);
    console.log(`buyerDisputeSponsor: ${await dispute.buyerDisputeSponsor()}`);
    
    // Générer et envoyer la preuve
    const proof = compute_proof_right_v2(evaluatedBytes, numBlocks, numGates);
    const proofBytes32: string[][] = proof.map((layer: Uint8Array[]) =>
        layer.map((item: Uint8Array) => ethers.hexlify(new Uint8Array(item)))
    );
    
    await dispute.connect(vendor).submitCommitmentRight(proofBytes32);
    
    state = Number(await dispute.currState());
    const step9CountAfter = await dispute.step9Count();
    const lastLosingPartyWasVendor = await dispute.lastLosingPartyWasVendor();
    
    console.log(`\nÉtat après submitCommitmentRight: ${state}`);
    console.log(`step9Count après: ${step9CountAfter}`);
    console.log(`lastLosingPartyWasVendor: ${lastLosingPartyWasVendor}`);
    console.log(`buyer après: ${await dispute.buyer()}`);
    
    if (state === 0) {
        console.log("\n⚠️ État ChallengeBuyer: Step 9 optimisation appliquée (buyer remplacé par sponsor)");
        console.log("C'est normal si buyer != buyerDisputeSponsor");
    } else if (state === 5) {
        console.log("\n✅ État Complete: VENDOR GAGNE!");
    } else if (state === 6) {
        console.log("\n❌ État Cancel: BUYER GAGNE (vendor a perdu)");
    } else {
        console.log(`\n⚠️ État inattendu: ${state}`);
    }
    
    if (lastLosingPartyWasVendor) {
        console.log("❌ lastLosingPartyWasVendor = true: Vendor a perdu (INCORRECT si fichiers identiques)");
    } else {
        console.log("✅ lastLosingPartyWasVendor = false: Buyer a perdu (CORRECT si fichiers identiques)");
    }
}

main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error(error);
        process.exit(1);
    });



