import { expect } from "chai";
import hre from "hardhat";
import { parseEther } from "ethers";
import {
    bytes_to_hex,
    compute_precontract_values_v2,
    compute_proofs_v2,
    evaluate_circuit_v2_wasm,
    hpre_v2,
    initSync,
} from "../../../app/lib/crypto_lib/crypto_lib";

const { ethers } = hre;

const FILE_SIZE_BYTES = 4 * 1024 * 1024;
const AGREED_PRICE = parseEther("1.0");
const COMPLETION_TIP = parseEther("0.1");
const DISPUTE_TIP = parseEther("0.12");
const TIMEOUT_INCREMENT = 3600n;
const SPONSOR_FEES = 5n;
const DISPUTE_FEES = 10n;

const KEY_BYTES = new Uint8Array([
    0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08,
    0x09, 0x0a, 0x0b, 0x0c, 0x0d, 0x0e, 0x0f, 0x10,
]);

const HANA_REFERENCE = {
    optimisticDeployment: 2_077_362n,
    optimisticExecution: 222_839n,
    optimisticTotal: 2_300_201n,
    disputeDeployment: 4_651_201n,
    exchangeAndDisputeTriggering: 4_977_003n,
    optimisticWithDisputeInitTotal: 7_054_365n,
    challengeRound: 82_624n,
    validateUserOp: 59_752n,
    execute: 26_102n,
    proofSubmissionByGate: {
        "AES-128 CTR encrypt/decrypt": 5_200_000n,
        "SHA256 compression": 320_000n,
        "COMP (equality check)": 175_000n,
        CONST: 50_000n,
        XOR: 60_000n,
    } as Record<string, bigint>,
};

type CurrentMeasurement = {
    optimisticDeployment: bigint;
    optimisticExecution: bigint;
    optimisticTotal: bigint;
    disputeDeployment: bigint;
    exchangeAndDisputeTriggering: bigint;
    optimisticWithDisputeInitTotal: bigint;
    challengeRoundFirst: bigint;
    challengeRoundAverage: bigint;
    challengeRoundsToState2: number;
    validateUserOp: bigint;
    execute: bigint;
    submitCommitment: bigint;
    submitCommitmentGateType: string;
};

let wasmInitialized = false;

function makeFile(length: number) {
    const file = new Uint8Array(length);
    for (let i = 0; i < file.length; i++) {
        file[i] = (i + 1) % 256;
    }
    return file;
}

function hexlifyBytes(bytes: Uint8Array) {
    return ethers.hexlify(new Uint8Array(bytes));
}

function proofToHex(proof: any): string[][] {
    return proof.map((level: Uint8Array[]) =>
        level.map((value: Uint8Array) => hexlifyBytes(value))
    );
}

function bytesArrayToHex(values: Uint8Array[]): string[] {
    return values.map((value) => hexlifyBytes(value));
}

function deltaString(current: bigint, reference: bigint) {
    const delta = current - reference;
    const sign = delta >= 0n ? "+" : "";
    const pct = Number(delta) / Number(reference) * 100;
    return `${sign}${delta.toString()} (${pct.toFixed(2)}%)`;
}

function opcodeName(opcode: number) {
    switch (opcode) {
        case 0x01:
            return "AES-128 CTR encrypt/decrypt";
        case 0x02:
            return "SHA256 compression";
        case 0x03:
            return "CONST";
        case 0x04:
            return "XOR";
        case 0x05:
            return "COMP (equality check)";
        default:
            return `opcode 0x${opcode.toString(16).padStart(2, "0")}`;
    }
}

async function initWasmOnce() {
    if (wasmInitialized) {
        return;
    }
    const { readFile } = await import("node:fs/promises");
    const { join } = await import("node:path");
    const wasmPath = join(__dirname, "../../../app/lib/crypto_lib/crypto_lib_bg.wasm");
    const wasmBytes = await readFile(wasmPath);
    initSync({ module: wasmBytes });
    wasmInitialized = true;
}

async function gasOf(txPromise: Promise<any>) {
    const tx = await txPromise;
    const receipt = await tx.wait();
    if (!receipt) {
        throw new Error("Missing transaction receipt");
    }
    return receipt.gasUsed as bigint;
}

function packedUserOp(sender: string, nonce: number, signature: string) {
    return {
        sender,
        nonce,
        initCode: "0x",
        callData: "0x",
        accountGasLimits: ethers.ZeroHash,
        preVerificationGas: 0,
        gasFees: ethers.ZeroHash,
        paymasterAndData: "0x",
        signature,
    };
}

async function deployCurrentContracts(
    buyer: any,
    vendor: any,
    sponsor: any,
    numBlocks: bigint,
    numGates: bigint,
    commitment: string
) {
    const EntryPointFactory = await ethers.getContractFactory("MockEntryPoint");
    const entryPoint = await EntryPointFactory.connect(sponsor).deploy();
    await entryPoint.waitForDeployment();

    const AccumulatorVerifierFactory = await ethers.getContractFactory("AccumulatorVerifier");
    const accumulatorVerifier = await AccumulatorVerifierFactory.deploy();
    await accumulatorVerifier.waitForDeployment();

    const CommitmentOpenerFactory = await ethers.getContractFactory("CommitmentOpener");
    const commitmentOpener = await CommitmentOpenerFactory.deploy();
    await commitmentOpener.waitForDeployment();

    const SHA256EvaluatorFactory = await ethers.getContractFactory("SHA256Evaluator");
    const sha256Evaluator = await SHA256EvaluatorFactory.deploy();
    await sha256Evaluator.waitForDeployment();

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
        AGREED_PRICE,
        COMPLETION_TIP,
        DISPUTE_TIP,
        TIMEOUT_INCREMENT,
        commitment,
        numBlocks,
        numGates,
        await vendor.getAddress(),
        { value: SPONSOR_FEES }
    );
    await optimisticAccount.waitForDeployment();

    const deploymentReceipt = await optimisticAccount.deploymentTransaction()?.wait();
    if (!deploymentReceipt) {
        throw new Error("Missing optimistic deployment receipt");
    }

    return {
        entryPoint,
        optimisticAccount,
        optimisticDeployment: deploymentReceipt.gasUsed as bigint,
    };
}

describe("Current implementation measured with Hana's scope", function () {
    it("measures the same scopes as Hana's report", async function () {
        await initWasmOnce();
        const [sponsor, buyer, vendor, buyerDisputeSponsor, vendorDisputeSponsor] =
            await ethers.getSigners();

        const file = makeFile(FILE_SIZE_BYTES);
        const precontract = compute_precontract_values_v2(file, KEY_BYTES);
        const evaluatedBytes = evaluate_circuit_v2_wasm(
            precontract.circuit_bytes,
            precontract.ct,
            bytes_to_hex(KEY_BYTES)
        ).to_bytes();

        const success = await deployCurrentContracts(
            buyer,
            vendor,
            sponsor,
            BigInt(precontract.num_blocks),
            BigInt(precontract.num_gates),
            hexlifyBytes(precontract.commitment.c)
        );

        const paymentGas = await gasOf(
            success.optimisticAccount.connect(buyer).sendPayment({
                value: AGREED_PRICE + COMPLETION_TIP,
            })
        );
        const keyGas = await gasOf(
            success.optimisticAccount.connect(vendor).sendKey(hexlifyBytes(KEY_BYTES))
        );
        const completeGas = await gasOf(
            success.optimisticAccount.connect(buyer).completeTransaction()
        );

        const userOpHash = ethers.id("hana-comparison-userop");
        const signature = await vendor.signMessage(ethers.getBytes(userOpHash));
        const userOp = packedUserOp(
            await success.optimisticAccount.getAddress(),
            0,
            signature
        );
        const validateUserOpGas = await gasOf(
            success.entryPoint.callValidateUserOp(
                await success.optimisticAccount.getAddress(),
                userOp,
                userOpHash,
                0
            )
        );
        const executeGas = await gasOf(
            success.optimisticAccount
                .connect(vendor)
                .execute(
                    await success.optimisticAccount.getAddress(),
                    0,
                    success.optimisticAccount.interface.encodeFunctionData("supportsERC4337")
                )
        );

        const disputeInit = await deployCurrentContracts(
            buyer,
            vendor,
            sponsor,
            BigInt(precontract.num_blocks),
            BigInt(precontract.num_gates),
            hexlifyBytes(precontract.commitment.c)
        );

        const paymentGas2 = await gasOf(
            disputeInit.optimisticAccount.connect(buyer).sendPayment({
                value: AGREED_PRICE + COMPLETION_TIP,
            })
        );
        const keyGas2 = await gasOf(
            disputeInit.optimisticAccount.connect(vendor).sendKey(hexlifyBytes(KEY_BYTES))
        );
        const authHash = await disputeInit.optimisticAccount.buyerUnhappyAuthorizationHash(
            await buyerDisputeSponsor.getAddress()
        );
        const authSignature = await buyer.signMessage(ethers.getBytes(authHash));
        const buyerSponsorGas = await gasOf(
            disputeInit.optimisticAccount
                .connect(buyerDisputeSponsor)
                .sendBuyerDisputeSponsorFeeWithAuthorization(authSignature, {
                    value: DISPUTE_FEES + DISPUTE_TIP,
                })
        );
        const disputeDeploymentGas = await gasOf(
            disputeInit.optimisticAccount
                .connect(vendorDisputeSponsor)
                .sendVendorDisputeSponsorFee({
                    value: DISPUTE_FEES + DISPUTE_TIP + AGREED_PRICE,
                })
        );

        const disputeAddress = await disputeInit.optimisticAccount.disputeContract();
        const disputeAccount = await ethers.getContractAt("DisputeSOXAccount", disputeAddress);

        let challengeRoundTotal = 0n;
        let challengeRoundFirst = 0n;
        let challengeRounds = 0;
        let state = Number(await disputeAccount.currState());
        while (state === 0 && challengeRounds < 32) {
            const challenge = Number(await disputeAccount.chall());
            const hpre = hpre_v2(evaluatedBytes, precontract.num_blocks, challenge);
            const respondGas = await gasOf(
                disputeAccount.connect(buyer).respondChallenge(hexlifyBytes(hpre))
            );
            const agree = challengeRounds !== 0;
            const opinionGas = await gasOf(
                disputeAccount.connect(vendor).giveOpinion(agree)
            );

            const roundGas = respondGas + opinionGas;
            if (challengeRounds === 0) {
                challengeRoundFirst = roundGas;
            }
            challengeRoundTotal += roundGas;
            challengeRounds++;
            state = Number(await disputeAccount.currState());
        }
        expect(state).to.equal(2);

        const gateNum = Number(await disputeAccount.a());
        const proofs = compute_proofs_v2(
            precontract.circuit_bytes,
            evaluatedBytes,
            precontract.ct,
            gateNum
        );
        const gateType = opcodeName(proofs.gate_bytes[0]);
        const submitCommitmentGas = await gasOf(
            disputeAccount.connect(vendor).submitCommitment(
                hexlifyBytes(precontract.commitment.o),
                gateNum,
                hexlifyBytes(proofs.gate_bytes),
                bytesArrayToHex(proofs.values),
                hexlifyBytes(proofs.curr_acc),
                proofToHex(proofs.proof1),
                proofToHex(proofs.proof2),
                proofToHex(proofs.proof3),
                proofToHex(proofs.proof_ext)
            )
        );

        const current: CurrentMeasurement = {
            optimisticDeployment: success.optimisticDeployment,
            optimisticExecution: paymentGas + keyGas + completeGas,
            optimisticTotal:
                success.optimisticDeployment + paymentGas + keyGas + completeGas,
            disputeDeployment: disputeDeploymentGas,
            exchangeAndDisputeTriggering:
                paymentGas2 + keyGas2 + buyerSponsorGas + disputeDeploymentGas,
            optimisticWithDisputeInitTotal:
                disputeInit.optimisticDeployment +
                paymentGas2 +
                keyGas2 +
                buyerSponsorGas +
                disputeDeploymentGas,
            challengeRoundFirst,
            challengeRoundAverage:
                challengeRoundTotal / BigInt(Math.max(challengeRounds, 1)),
            challengeRoundsToState2: challengeRounds,
            validateUserOp: validateUserOpGas,
            execute: executeGas,
            submitCommitment: submitCommitmentGas,
            submitCommitmentGateType: gateType,
        };

        const comparisonRows = [
            {
                metric: "OptimisticSOXAccount deployment",
                hana: HANA_REFERENCE.optimisticDeployment.toString(),
                current: current.optimisticDeployment.toString(),
                delta: deltaString(
                    current.optimisticDeployment,
                    HANA_REFERENCE.optimisticDeployment
                ),
            },
            {
                metric: "Payment + key disclosure + settlement",
                hana: HANA_REFERENCE.optimisticExecution.toString(),
                current: current.optimisticExecution.toString(),
                delta: deltaString(
                    current.optimisticExecution,
                    HANA_REFERENCE.optimisticExecution
                ),
            },
            {
                metric: "Total optimistic execution",
                hana: HANA_REFERENCE.optimisticTotal.toString(),
                current: current.optimisticTotal.toString(),
                delta: deltaString(current.optimisticTotal, HANA_REFERENCE.optimisticTotal),
            },
            {
                metric: "DisputeSOXAccount deployment",
                hana: HANA_REFERENCE.disputeDeployment.toString(),
                current: current.disputeDeployment.toString(),
                delta: deltaString(
                    current.disputeDeployment,
                    HANA_REFERENCE.disputeDeployment
                ),
            },
            {
                metric: "Exchange + dispute triggering",
                hana: HANA_REFERENCE.exchangeAndDisputeTriggering.toString(),
                current: current.exchangeAndDisputeTriggering.toString(),
                delta: deltaString(
                    current.exchangeAndDisputeTriggering,
                    HANA_REFERENCE.exchangeAndDisputeTriggering
                ),
            },
            {
                metric: "Optimistic deploy + dispute init total",
                hana: HANA_REFERENCE.optimisticWithDisputeInitTotal.toString(),
                current: current.optimisticWithDisputeInitTotal.toString(),
                delta: deltaString(
                    current.optimisticWithDisputeInitTotal,
                    HANA_REFERENCE.optimisticWithDisputeInitTotal
                ),
            },
            {
                metric: "One challenge round (average)",
                hana: HANA_REFERENCE.challengeRound.toString(),
                current: current.challengeRoundAverage.toString(),
                delta: deltaString(
                    current.challengeRoundAverage,
                    HANA_REFERENCE.challengeRound
                ),
            },
            {
                metric: "validateUserOp",
                hana: HANA_REFERENCE.validateUserOp.toString(),
                current: current.validateUserOp.toString(),
                delta: deltaString(current.validateUserOp, HANA_REFERENCE.validateUserOp),
            },
            {
                metric: "execute",
                hana: HANA_REFERENCE.execute.toString(),
                current: current.execute.toString(),
                delta: deltaString(current.execute, HANA_REFERENCE.execute),
            },
            {
                metric: `submitCommitment real 4MB gate (${current.submitCommitmentGateType})`,
                hana:
                    HANA_REFERENCE.proofSubmissionByGate[
                        current.submitCommitmentGateType
                    ]?.toString() ?? "n/a",
                current: current.submitCommitment.toString(),
                delta:
                    HANA_REFERENCE.proofSubmissionByGate[
                        current.submitCommitmentGateType
                    ] !== undefined
                        ? deltaString(
                              current.submitCommitment,
                              HANA_REFERENCE.proofSubmissionByGate[
                                  current.submitCommitmentGateType
                              ]
                          )
                        : "n/a",
            },
        ];

        const currentJson = {
            optimisticDeployment: current.optimisticDeployment.toString(),
            optimisticExecution: current.optimisticExecution.toString(),
            optimisticTotal: current.optimisticTotal.toString(),
            disputeDeployment: current.disputeDeployment.toString(),
            exchangeAndDisputeTriggering:
                current.exchangeAndDisputeTriggering.toString(),
            optimisticWithDisputeInitTotal:
                current.optimisticWithDisputeInitTotal.toString(),
            challengeRoundFirst: current.challengeRoundFirst.toString(),
            challengeRoundAverage: current.challengeRoundAverage.toString(),
            challengeRoundsToState2: current.challengeRoundsToState2,
            validateUserOp: current.validateUserOp.toString(),
            execute: current.execute.toString(),
            submitCommitment: current.submitCommitment.toString(),
            submitCommitmentGateType: current.submitCommitmentGateType,
        };

        console.table(comparisonRows);
        console.log(
            `HANA_CURRENT_COMPARISON_JSON=${JSON.stringify({
                fileSizeBytes: FILE_SIZE_BYTES,
                numBlocks: precontract.num_blocks,
                numGates: precontract.num_gates,
                challengeRoundsToState2: current.challengeRoundsToState2,
                challengeRoundFirst: current.challengeRoundFirst.toString(),
                challengeRoundAverage: current.challengeRoundAverage.toString(),
                current: currentJson,
            })}`
        );

        expect(current.optimisticDeployment).to.be.greaterThan(0n);
        expect(current.optimisticExecution).to.be.greaterThan(0n);
        expect(current.disputeDeployment).to.be.greaterThan(0n);
        expect(current.submitCommitment).to.be.greaterThan(0n);
    });
});
