import { ethers } from "hardhat";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import EntryPointArtifact from "@account-abstraction/contracts/artifacts/EntryPoint.json";
import {
    bytes_to_hex,
    compute_precontract_values_v2,
    compute_proofs_left_v2,
    compute_proofs_v2,
    compute_proof_right_v2,
    evaluate_circuit_v2_wasm,
    hpre_v2,
    initSync,
} from "../../app/lib/crypto_lib/crypto_lib";

const DISPUTE_FEES = 10n;
const SPONSOR_FEES = 5n;
const FILE_SIZE_BYTES = 1024 * 16;

const STATE_NAMES = [
    "ChallengeBuyer",
    "WaitVendorOpinion",
    "WaitVendorData",
    "WaitVendorDataLeft",
    "WaitVendorDataRight",
    "Complete",
    "Cancel",
    "End",
];

type LieMode = "none" | "buyer" | "vendor";

function getLieMode(): LieMode {
    const value = (process.env.LIE_MODE || "none").toLowerCase();
    if (value === "buyer" || value === "vendor") return value;
    return "none";
}

function stateName(state: number): string {
    return STATE_NAMES[state] || `Unknown(${state})`;
}

function toHexBytes(value: Uint8Array): string {
    return ethers.hexlify(value);
}

function flipFirstByte(value: Uint8Array): Uint8Array {
    const copy = new Uint8Array(value);
    copy[0] ^= 0x01;
    return copy;
}

function resolveSigner(
    signerMap: Map<string, any>,
    address: string,
    label: string
) {
    const signer = signerMap.get(address.toLowerCase());
    if (!signer) {
        throw new Error(`Signer introuvable pour ${label}: ${address}`);
    }
    return signer;
}

async function main() {
    const lieMode = getLieMode();
    const [sponsor, buyer, vendor, buyerDisputeSponsor, vendorDisputeSponsor] =
        await ethers.getSigners();
    const signerMap = new Map<string, any>();
    for (const signer of [
        sponsor,
        buyer,
        vendor,
        buyerDisputeSponsor,
        vendorDisputeSponsor,
    ]) {
        signerMap.set((await signer.getAddress()).toLowerCase(), signer);
    }

    console.log("=".repeat(80));
    console.log("Scenario dispute avec reponses preparees (UI-like)");
    console.log("LIE_MODE:", lieMode);
    console.log("=".repeat(80));
    console.log("Buyer :", await buyer.getAddress());
    console.log("Vendor:", await vendor.getAddress());
    console.log("");

    const modulePath = join(
        __dirname,
        "../../app/lib/crypto_lib/crypto_lib_bg.wasm"
    );
    const module = await readFile(modulePath);
    initSync({ module });

    const file = new Uint8Array(FILE_SIZE_BYTES);
    for (let i = 0; i < file.length; i++) file[i] = i % 256;
    const key = new Uint8Array(16);
    for (let i = 0; i < key.length; i++) key[i] = (i * 17) % 256;

    const precontract = compute_precontract_values_v2(file, key);
    const circuitBytes = precontract.circuit_bytes;
    const ct = precontract.ct;
    const commitment = precontract.commitment;
    const numBlocks = precontract.num_blocks;
    const numGates = precontract.num_gates;

    const evaluated = evaluate_circuit_v2_wasm(
        circuitBytes,
        ct,
        bytes_to_hex(key)
    ).to_bytes();

    const EntryPointFactory = new ethers.ContractFactory(
        EntryPointArtifact.abi,
        EntryPointArtifact.bytecode,
        sponsor
    );
    const entryPoint = await EntryPointFactory.deploy();
    await entryPoint.waitForDeployment();

    const AccumulatorVerifierFactory =
        await ethers.getContractFactory("AccumulatorVerifier");
    const accumulatorVerifier = await AccumulatorVerifierFactory.deploy();
    await accumulatorVerifier.waitForDeployment();

    const CommitmentOpenerFactory =
        await ethers.getContractFactory("CommitmentOpener");
    const commitmentOpener = await CommitmentOpenerFactory.deploy();
    await commitmentOpener.waitForDeployment();

    const SHA256EvaluatorFactory =
        await ethers.getContractFactory("SHA256Evaluator");
    const sha256Evaluator = await SHA256EvaluatorFactory.deploy();
    await sha256Evaluator.waitForDeployment();

    const DisputeDeployerFactory = await ethers.getContractFactory(
        "DisputeDeployer",
        {
            libraries: {
                AccumulatorVerifier: await accumulatorVerifier.getAddress(),
                CommitmentOpener: await commitmentOpener.getAddress(),
                SHA256Evaluator: await sha256Evaluator.getAddress(),
            },
        }
    );
    const disputeDeployer = await DisputeDeployerFactory.deploy();
    await disputeDeployer.waitForDeployment();

    const OptimisticSOXAccountFactory =
        await ethers.getContractFactory("OptimisticSOXAccount", {
            libraries: {
                DisputeDeployer: await disputeDeployer.getAddress(),
            },
        });

    const optimistic = await OptimisticSOXAccountFactory.connect(sponsor).deploy(
        await entryPoint.getAddress(),
        await vendor.getAddress(),
        await buyer.getAddress(),
        1n,
        1n,
        1n,
        3600n,
        commitment.c,
        numBlocks,
        numGates,
        await vendor.getAddress(),
        { value: SPONSOR_FEES }
    );
    await optimistic.waitForDeployment();

    await optimistic
        .connect(buyer)
        .sendPayment({ value: 2n });
    await optimistic.connect(vendor).sendKey(key);
    await optimistic
        .connect(buyerDisputeSponsor)
        .sendBuyerDisputeSponsorFee({ value: DISPUTE_FEES + 1n });
    await optimistic
        .connect(vendorDisputeSponsor)
        .sendVendorDisputeSponsorFee({
            value: DISPUTE_FEES + 1n + 1n,
        });

    const disputeAddress = await optimistic.disputeContract();
    const dispute = await ethers.getContractAt(
        "DisputeSOXAccount",
        disputeAddress
    );

    console.log("DisputeSOXAccount:", disputeAddress);
    console.log("numBlocks:", numBlocks, "numGates:", numGates);
    console.log("");

    const maxRounds = Math.ceil(Math.log2(numGates)) + 5;
    const maxPhases = 3;
    let state = Number(await dispute.currState());
    let phase = 0;

    while (phase < maxPhases && state !== 5 && state !== 6 && state !== 7) {
        let round = 0;
        while (state === 0 && round < maxRounds) {
            const challenge = Number(await dispute.chall());
            const buyerAddr = await dispute.buyer();
            const vendorAddr = await dispute.vendor();
            const buyerSigner = resolveSigner(signerMap, buyerAddr, "buyer");
            const vendorSigner = resolveSigner(signerMap, vendorAddr, "vendor");

            let response = hpre_v2(evaluated, numBlocks, challenge);
            if (lieMode === "buyer" && phase === 0 && round === 0) {
                response = flipFirstByte(response);
            }

            await dispute.connect(buyerSigner).respondChallenge(response);
            const latestResponse = await dispute.getLatestBuyerResponse();
            const computed = hpre_v2(evaluated, numBlocks, challenge);
            const vendorAgrees = toHexBytes(computed) === latestResponse;
            await dispute.connect(vendorSigner).giveOpinion(vendorAgrees);

            state = Number(await dispute.currState());
            console.log(
                `Round ${round + 1}: chall=${challenge} response=${toHexBytes(response).slice(0, 10)}... opinion=${vendorAgrees} state=${stateName(state)}`
            );
            round++;
        }

        if (state !== 2 && state !== 3 && state !== 4) {
            console.log("Etat inattendu apres challenges:", stateName(state));
            break;
        }

        const gateNum = Number(await dispute.a());
        const vendorAddr = await dispute.vendor();
        const vendorSigner = resolveSigner(signerMap, vendorAddr, "vendor");
        console.log("Etat vendeur:", stateName(state), "gateNum:", gateNum);

        if (state === 4) {
            if (lieMode === "vendor") {
                await dispute.connect(vendorSigner).submitCommitmentRight([]);
            } else {
                const proof = compute_proof_right_v2(
                    evaluated,
                    numBlocks,
                    numGates
                );
                const proofBytes32: string[][] = proof.map(
                    (layer: Uint8Array[]) =>
                        layer.map((item: Uint8Array) =>
                            ethers.hexlify(new Uint8Array(item))
                        )
                );
                await dispute
                    .connect(vendorSigner)
                    .submitCommitmentRight(proofBytes32);
            }
        } else if (state === 3) {
            const proofs = compute_proofs_left_v2(
                circuitBytes,
                evaluated,
                ct,
                gateNum
            );
            const gateBytesArray = new Uint8Array(proofs.gate_bytes);
            const valuesArray = proofs.values.map(
                (v: Uint8Array) => new Uint8Array(v)
            );
            const currAccArray = new Uint8Array(proofs.curr_acc);
            const proof1Array = proofs.proof1.map((level: Uint8Array[]) =>
                level.map((v: Uint8Array) =>
                    ethers.hexlify(new Uint8Array(v))
                )
            );
            const proof2Array = proofs.proof2.map((level: Uint8Array[]) =>
                level.map((v: Uint8Array) =>
                    ethers.hexlify(new Uint8Array(v))
                )
            );
            const proofExtArray = proofs.proof_ext.map((level: Uint8Array[]) =>
                level.map((v: Uint8Array) =>
                    ethers.hexlify(new Uint8Array(v))
                )
            );
            await dispute.connect(vendorSigner).submitCommitmentLeft(
                commitment.o,
                gateNum,
                gateBytesArray,
                valuesArray,
                currAccArray,
                proof1Array,
                proof2Array,
                proofExtArray
            );
        } else {
            const proofs = compute_proofs_v2(circuitBytes, evaluated, ct, gateNum);
            const gateBytesArray = new Uint8Array(proofs.gate_bytes);
            const valuesArray = proofs.values.map(
                (v: Uint8Array) => new Uint8Array(v)
            );
            const currAccArray = new Uint8Array(proofs.curr_acc);
            const proof1Array = proofs.proof1.map((level: Uint8Array[]) =>
                level.map((v: Uint8Array) =>
                    ethers.hexlify(new Uint8Array(v))
                )
            );
            const proof2Array = proofs.proof2.map((level: Uint8Array[]) =>
                level.map((v: Uint8Array) =>
                    ethers.hexlify(new Uint8Array(v))
                )
            );
            const proof3Array = proofs.proof3.map((level: Uint8Array[]) =>
                level.map((v: Uint8Array) =>
                    ethers.hexlify(new Uint8Array(v))
                )
            );
            const proofExtArray = proofs.proof_ext.map((level: Uint8Array[]) =>
                level.map((v: Uint8Array) =>
                    ethers.hexlify(new Uint8Array(v))
                )
            );
            await dispute.connect(vendorSigner).submitCommitment(
                commitment.o,
                gateNum,
                gateBytesArray,
                valuesArray,
                currAccArray,
                proof1Array,
                proof2Array,
                proof3Array,
                proofExtArray
            );
        }

        state = Number(await dispute.currState());
        const step9Count = await dispute.step9Count();
        console.log(
            `Apres preuve: state=${stateName(state)} step9Count=${step9Count.toString()}`
        );
        phase++;
    }

    if (state === 5 || state === 6) {
        const buyerAddr = await dispute.buyer();
        const vendorAddr = await dispute.vendor();
        if (state === 5) {
            const buyerSigner = resolveSigner(signerMap, buyerAddr, "buyer");
            await dispute.connect(buyerSigner).completeDispute();
        } else {
            const vendorSigner = resolveSigner(signerMap, vendorAddr, "vendor");
            await dispute.connect(vendorSigner).cancelDispute();
        }
        state = Number(await dispute.currState());
    }

    const finalState = state;
    const lastLosingPartyWasVendor = await dispute.lastLosingPartyWasVendor();
    console.log("");
    console.log("Etat final:", stateName(finalState));
    console.log("lastLosingPartyWasVendor:", lastLosingPartyWasVendor);
    if (finalState === 7) {
        if (lastLosingPartyWasVendor) {
            console.log("Resultat: buyer gagne (vendor a menti ou preuve invalide)");
        } else {
            console.log("Resultat: vendor gagne (buyer a menti ou accuse a tort)");
        }
    } else if (finalState === 5) {
        console.log("Resultat: vendor gagne (Complete)");
    } else if (finalState === 6) {
        console.log("Resultat: buyer gagne (Cancel)");
    } else {
        console.log(
            "Resultat: Step9 continue. Dernier perdant:",
            lastLosingPartyWasVendor ? "vendor" : "buyer"
        );
    }
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
