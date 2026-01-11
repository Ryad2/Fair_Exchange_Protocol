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

const FILE_SIZE_BYTES = 1024 * 16;
const DISPUTE_FEES = 10n;
const SPONSOR_FEES = 5n;

type PrecontractData = {
    ct: Uint8Array;
    circuitBytes: Uint8Array;
    evaluated: Uint8Array;
    commitment: { c: Uint8Array; o: Uint8Array };
    numBlocks: number;
    numGates: number;
    key: Uint8Array;
};

async function initWasm() {
    const modulePath = join(
        __dirname,
        "../../app/lib/crypto_lib/crypto_lib_bg.wasm"
    );
    const module = await readFile(modulePath);
    initSync({ module });
}

function buildPrecontract(): PrecontractData {
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

    return {
        ct,
        circuitBytes,
        evaluated,
        commitment,
        numBlocks,
        numGates,
        key,
    };
}

async function deployDisputeContracts(
    signer: any,
    libraries: {
        entryPoint: string;
        disputeDeployer: string;
    },
    params: {
        buyer: string;
        vendor: string;
        commitment: Uint8Array;
        numBlocks: number;
        numGates: number;
    }
) {
    const OptimisticSOXAccountFactory = await ethers.getContractFactory(
        "OptimisticSOXAccount",
        {
            libraries: {
                DisputeDeployer: libraries.disputeDeployer,
            },
        }
    );

    const optimistic = await OptimisticSOXAccountFactory.connect(signer).deploy(
        libraries.entryPoint,
        params.vendor,
        params.buyer,
        1n,
        1n,
        1n,
        3600n,
        params.commitment,
        params.numBlocks,
        params.numGates,
        params.vendor,
        { value: SPONSOR_FEES }
    );
    await optimistic.waitForDeployment();
    return optimistic;
}

async function createDispute(
    signers: {
        sponsor: any;
        buyer: any;
        vendor: any;
        buyerDisputeSponsor: any;
        vendorDisputeSponsor: any;
    },
    libraries: {
        entryPoint: string;
        disputeDeployer: string;
    },
    precontract: PrecontractData
) {
    const optimistic = await deployDisputeContracts(
        signers.sponsor,
        libraries,
        {
            buyer: await signers.buyer.getAddress(),
            vendor: await signers.vendor.getAddress(),
            commitment: precontract.commitment.c,
            numBlocks: precontract.numBlocks,
            numGates: precontract.numGates,
        }
    );

    await optimistic.connect(signers.buyer).sendPayment({ value: 2n });
    await optimistic.connect(signers.vendor).sendKey(precontract.key);
    await optimistic
        .connect(signers.buyerDisputeSponsor)
        .sendBuyerDisputeSponsorFee({ value: DISPUTE_FEES + 1n });
    await optimistic
        .connect(signers.vendorDisputeSponsor)
        .sendVendorDisputeSponsorFee({
            value: DISPUTE_FEES + 1n + 1n,
        });

    const disputeAddress = await optimistic.disputeContract();
    return ethers.getContractAt("DisputeSOXAccount", disputeAddress);
}

async function reachState(
    dispute: any,
    buyer: any,
    vendor: any,
    target: "middle" | "left" | "right",
    precontract: PrecontractData
) {
    let state = Number(await dispute.currState());
    const maxRounds = Math.ceil(Math.log2(precontract.numGates)) + 5;
    let round = 0;

    while (state === 0 && round < maxRounds) {
        const challenge = Number(await dispute.chall());
        let response = ethers.ZeroHash;
        if (target === "right") {
            response = hpre_v2(
                precontract.evaluated,
                precontract.numBlocks,
                challenge
            );
        }
        await dispute.connect(buyer).respondChallenge(response);
        let opinion = true;
        if (target === "left") {
            opinion = false;
        } else if (target === "middle") {
            opinion = round === 0 ? false : true;
        }
        await dispute.connect(vendor).giveOpinion(opinion);
        state = Number(await dispute.currState());
        round++;
        if (
            (target === "middle" && state === 2) ||
            (target === "left" && state === 3) ||
            (target === "right" && state === 4)
        ) {
            break;
        }
    }

    return state;
}

async function runScenario(
    name: string,
    target: "middle" | "left" | "right",
    signers: {
        sponsor: any;
        buyer: any;
        vendor: any;
        buyerDisputeSponsor: any;
        vendorDisputeSponsor: any;
    },
    libraries: {
        entryPoint: string;
        disputeDeployer: string;
    },
    precontract: PrecontractData
) {
    console.log("");
    console.log(`Scenario: ${name}`);
    const dispute = await createDispute(signers, libraries, precontract);

    const state = await reachState(
        dispute,
        signers.buyer,
        signers.vendor,
        target,
        precontract
    );
    if (
        (target === "middle" && state !== 2) ||
        (target === "left" && state !== 3) ||
        (target === "right" && state !== 4)
    ) {
        console.log(
            `  Could not reach expected state for ${name}. Current state: ${state}`
        );
        return;
    }

    const gateNum = Number(await dispute.a());
    console.log("  Gate number:", gateNum);

    if (state === 4) {
        const proof = compute_proof_right_v2(
            precontract.evaluated,
            precontract.numBlocks,
            precontract.numGates
        );
        const proofBytes32: string[][] = proof.map(
            (layer: Uint8Array[]) =>
                layer.map((item: Uint8Array) =>
                    ethers.hexlify(new Uint8Array(item))
                )
        );

        await dispute
            .connect(signers.vendor)
            .submitCommitmentRight.staticCall(proofBytes32);
        const tx = await dispute
            .connect(signers.vendor)
            .submitCommitmentRight(proofBytes32);
        await tx.wait();
        console.log("  submitCommitmentRight OK");
        return;
    }

    if (state === 3) {
        const proofs = compute_proofs_left_v2(
            precontract.circuitBytes,
            precontract.evaluated,
            precontract.ct,
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

        await dispute
            .connect(signers.vendor)
            .submitCommitmentLeft.staticCall(
                precontract.commitment.o,
                gateNum,
                gateBytesArray,
                valuesArray,
                currAccArray,
                proof1Array,
                proof2Array,
                proofExtArray
            );
        const tx = await dispute
            .connect(signers.vendor)
            .submitCommitmentLeft(
                precontract.commitment.o,
                gateNum,
                gateBytesArray,
                valuesArray,
                currAccArray,
                proof1Array,
                proof2Array,
                proofExtArray
            );
        await tx.wait();
        console.log("  submitCommitmentLeft OK");
        return;
    }

    const proofs = compute_proofs_v2(
        precontract.circuitBytes,
        precontract.evaluated,
        precontract.ct,
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

    await dispute.connect(signers.vendor).submitCommitment.staticCall(
        precontract.commitment.o,
        gateNum,
        gateBytesArray,
        valuesArray,
        currAccArray,
        proof1Array,
        proof2Array,
        proof3Array,
        proofExtArray
    );
    const tx = await dispute.connect(signers.vendor).submitCommitment(
        precontract.commitment.o,
        gateNum,
        gateBytesArray,
        valuesArray,
        currAccArray,
        proof1Array,
        proof2Array,
        proof3Array,
        proofExtArray
    );
    await tx.wait();
    console.log("  submitCommitment OK");
}

async function main() {
    const [sponsor, buyer, vendor, buyerDisputeSponsor, vendorDisputeSponsor] =
        await ethers.getSigners();

    console.log("Accumulator proof scenario (real proofs)");
    await initWasm();
    const precontract = buildPrecontract();
    console.log(
        `numBlocks=${precontract.numBlocks} numGates=${precontract.numGates}`
    );

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

    const signers = {
        sponsor,
        buyer,
        vendor,
        buyerDisputeSponsor,
        vendorDisputeSponsor,
    };
    const libraries = {
        entryPoint: await entryPoint.getAddress(),
        disputeDeployer: await disputeDeployer.getAddress(),
    };

    await runScenario(
        "Step 8a (submitCommitment / middle gate)",
        "middle",
        signers,
        libraries,
        precontract
    );
    await runScenario(
        "Step 8b (submitCommitmentLeft / first gate)",
        "left",
        signers,
        libraries,
        precontract
    );
    await runScenario(
        "Step 8c (submitCommitmentRight / last gate)",
        "right",
        signers,
        libraries,
        precontract
    );
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
