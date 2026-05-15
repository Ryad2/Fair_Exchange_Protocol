import { expect } from "chai";
import hre from "hardhat";
import { execFile } from "node:child_process";
import { constants } from "node:fs";
import { access, mkdtemp, open, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { performance } from "node:perf_hooks";
import { promisify } from "node:util";

const { ethers } = hre;
const execFileAsync = promisify(execFile);

const FILE_SIZE_BYTES = Number(
    process.env.SOX_FULL_DISPUTE_SIZE_BYTES ?? 1024 * 1024 * 1024
);
const EXPECTED_BLOCKS = Math.ceil(FILE_SIZE_BYTES / 64);
const EXPECTED_GATES = EXPECTED_BLOCKS * 2 + (FILE_SIZE_BYTES % 64 > 55 ? 8 : 5);
const KEY_HEX = "000102030405060708090a0b0c0d0e0f";
const KEY_BYTES16 = "0x" + KEY_HEX;

const AGREED_PRICE = 100n;
const COMPLETION_TIP = 5n;
const DISPUTE_TIP = 3n;
const SPONSOR_FEES = 5n;
const DISPUTE_FEES = 10n;
const TIMEOUT_INCREMENT = 60n;

type PrecontractCliOutput = {
    description_hex: string;
    h_ct_hex: string;
    h_circuit_hex: string;
    commitment_c_hex: string;
    commitment_o_hex: string;
    num_blocks: number;
    num_gates: number;
    ciphertext_path: string;
    circuit_path: string;
    key_hex: string;
};

type NativeDisputeOutput = {
    plaintext_bytes: number;
    num_blocks: number;
    num_gates: number;
    direction: string;
    rounds: Array<{
        round: number;
        challenge: number;
        hpre_hex: string;
        hpre_ms: number;
    }>;
    final_left: {
        gate_num: number;
        gate_bytes_hex: string;
        values_hex: string[];
        curr_acc_hex: string;
        proof1: string[][];
        proof2: string[][];
        proof_ext: string[][];
    };
    timings: {
        load_plaintext_ms: number;
        load_ciphertext_head_ms: number;
        all_hpre_ms: number;
        final_step_ms: number;
        total_ms: number;
    };
};

async function gasOf(txPromise: Promise<any>) {
    const tx = await txPromise;
    const receipt = await tx.wait();
    if (!receipt) {
        throw new Error("Missing transaction receipt");
    }
    return receipt.gasUsed as bigint;
}

function hex32(hexWithoutPrefix: string) {
    return "0x" + hexWithoutPrefix;
}

function expectedLeftPathRounds(numGates: number) {
    let a = 1;
    let b = numGates + 1;
    let rounds = 0;
    while (a !== b) {
        b = Math.floor((a + b) / 2);
        rounds += 1;
    }
    return rounds;
}

async function deploySharedContext() {
    const [sponsor, buyer, vendor, buyerDisputeSponsor, vendorDisputeSponsor, other] =
        await ethers.getSigners();

    const EntryPointFactory = await ethers.getContractFactory("MockEntryPoint");
    const entryPoint = await EntryPointFactory.connect(other).deploy();
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

    const HardcodedSha256CircuitLibFactory = await ethers.getContractFactory(
        "HardcodedSha256CircuitLib",
        {
            libraries: {
                AccumulatorVerifier: await accumulatorVerifier.getAddress(),
                SHA256Evaluator: await sha256Evaluator.getAddress(),
            },
        }
    );
    const hardcodedSha256CircuitLib = await HardcodedSha256CircuitLibFactory.deploy();
    await hardcodedSha256CircuitLib.waitForDeployment();

    const DisputeDeployerHardcodedSHA256Factory = await ethers.getContractFactory(
        "DisputeDeployerHardcodedSHA256",
        {
            libraries: {
                AccumulatorVerifier: await accumulatorVerifier.getAddress(),
                CommitmentOpener: await commitmentOpener.getAddress(),
                HardcodedSha256CircuitLib: await hardcodedSha256CircuitLib.getAddress(),
            },
        }
    );
    const disputeDeployerHardcodedSHA256 =
        await DisputeDeployerHardcodedSHA256Factory.deploy();
    await disputeDeployerHardcodedSHA256.waitForDeployment();

    return {
        sponsor,
        buyer,
        vendor,
        buyerDisputeSponsor,
        vendorDisputeSponsor,
        entryPoint,
        hardcodedSha256CircuitLib,
        disputeDeployerHardcodedSHA256,
    };
}

describe("Native CLI 1 GiB hardcoded SHA256 full dispute", function () {
    this.timeout(45 * 60 * 1000);

    let tempDir: string;
    let inputPath: string;
    let precontractCli: string;
    let disputeCli: string;

    before(async function () {
        precontractCli = join(__dirname, "../../../wasm/target/release/precontract_cli");
        disputeCli = join(
            __dirname,
            "../../../wasm/target/release/hardcoded_sha256_dispute_cli"
        );

        try {
            await access(precontractCli, constants.X_OK);
            await access(disputeCli, constants.X_OK);
        } catch {
            console.log("Skipping 1 GiB full dispute benchmark: native CLIs are missing");
            this.skip();
        }

        tempDir = await mkdtemp(join(tmpdir(), "sox-full-dispute-1g-"));
        inputPath = join(tempDir, `input-${FILE_SIZE_BYTES}.bin`);
        const handle = await open(inputPath, "w");
        await handle.truncate(FILE_SIZE_BYTES);
        await handle.close();
    });

    after(async function () {
        if (tempDir) {
            await rm(tempDir, { recursive: true, force: true });
        }
    });

    it("runs precontract, every challenge round, Step 8 left, and finalization", async function () {
        const preStarted = performance.now();
        const { stdout: preStdout } = await execFileAsync(
            precontractCli,
            [inputPath, KEY_HEX],
            { maxBuffer: 1024 * 1024 }
        );
        const precontractMs = performance.now() - preStarted;
        const pre = JSON.parse(preStdout) as PrecontractCliOutput;

        expect(pre.num_blocks).to.equal(EXPECTED_BLOCKS);
        expect(pre.num_gates).to.equal(EXPECTED_GATES);

        // The hardcoded dispute benchmark does not need the serialized generic circuit.
        await rm(pre.circuit_path, { force: true });

        const disputeStarted = performance.now();
        const { stdout: disputeStdout } = await execFileAsync(
            disputeCli,
            [
                inputPath,
                pre.ciphertext_path,
                pre.num_blocks.toString(),
                pre.num_gates.toString(),
            ],
            { maxBuffer: 1024 * 1024 }
        );
        const nativeDisputeMs = performance.now() - disputeStarted;
        const native = JSON.parse(disputeStdout) as NativeDisputeOutput;

        expect(native.rounds).to.have.length(expectedLeftPathRounds(pre.num_gates));
        expect(native.final_left.gate_num).to.equal(1);

        const shared = await deploySharedContext();
        const OptimisticFactory = await ethers.getContractFactory(
            "OptimisticSOXAccountHardcodedSHA256",
            {
                libraries: {
                    DisputeDeployerHardcodedSHA256:
                        await shared.disputeDeployerHardcodedSHA256.getAddress(),
                    HardcodedSha256CircuitLib:
                        await shared.hardcodedSha256CircuitLib.getAddress(),
                },
            }
        );
        const ciphertextIv =
            "0x" + native.final_left.gate_bytes_hex.slice(2 + 7 * 2, 2 + 23 * 2);

        const deployStarted = performance.now();
        const optimistic = await OptimisticFactory.connect(shared.sponsor).deploy(
            await shared.entryPoint.getAddress(),
            await shared.vendor.getAddress(),
            await shared.buyer.getAddress(),
            AGREED_PRICE,
            COMPLETION_TIP,
            DISPUTE_TIP,
            TIMEOUT_INCREMENT,
            hex32(pre.commitment_c_hex),
            BigInt(pre.num_blocks),
            BigInt(pre.num_gates),
            await shared.vendor.getAddress(),
            hex32(pre.description_hex),
            BigInt(FILE_SIZE_BYTES),
            ciphertextIv,
            { value: SPONSOR_FEES }
        );
        await optimistic.waitForDeployment();
        const deployReceipt = await optimistic.deploymentTransaction()?.wait();
        if (!deployReceipt) throw new Error("Missing optimistic deployment receipt");
        const optimisticDeployMs = performance.now() - deployStarted;

        const paymentGas = await gasOf(
            optimistic
                .connect(shared.buyer)
                .sendPayment({ value: AGREED_PRICE + COMPLETION_TIP })
        );
        const keyGas = await gasOf(optimistic.connect(shared.vendor).sendKey(KEY_BYTES16));
        const buyerSponsorGas = await gasOf(
            optimistic
                .connect(shared.buyer)
                .sendBuyerSelfDisputeSponsorFee({ value: DISPUTE_FEES + DISPUTE_TIP })
        );
        const triggerGas = await gasOf(
            optimistic
                .connect(shared.vendor)
                .sendVendorSelfDisputeSponsorFee({
                    value: DISPUTE_FEES + DISPUTE_TIP + AGREED_PRICE,
                })
        );

        const disputeAddress = await optimistic.disputeContract();
        const dispute = await ethers.getContractAt(
            "DisputeSOXAccountHardcodedSHA256",
            disputeAddress
        );

        let respondGas = 0n;
        let opinionGas = 0n;
        const onchainDisputeStarted = performance.now();
        for (const round of native.rounds) {
            expect(await dispute.chall()).to.equal(BigInt(round.challenge));
            respondGas += await gasOf(
                dispute.connect(shared.buyer).respondChallenge(round.hpre_hex)
            );
            opinionGas += await gasOf(dispute.connect(shared.vendor).giveOpinion(false));
        }

        expect(await dispute.currState()).to.equal(3n); // WaitVendorDataLeft

        const submitGas = await gasOf(
            dispute.connect(shared.vendor).submitCommitmentLeft(
                hex32(pre.commitment_o_hex),
                native.final_left.gate_num,
                "0x",
                native.final_left.values_hex,
                native.final_left.curr_acc_hex,
                [],
                native.final_left.proof2,
                native.final_left.proof_ext
            )
        );
        expect(await dispute.currState()).to.equal(5n); // Complete

        const finalizeGas = await gasOf(dispute.connect(shared.buyer).completeDispute());
        expect(await dispute.currState()).to.equal(7n); // End
        const onchainDisputeMs = performance.now() - onchainDisputeStarted;

        const optimisticPathGas =
            deployReceipt.gasUsed + paymentGas + keyGas + buyerSponsorGas + triggerGas;
        const disputeExecutionGas = respondGas + opinionGas + submitGas + finalizeGas;
        const totalGas = optimisticPathGas + disputeExecutionGas;

        console.log(
            "FULL_DISPUTE_1G_HARDCODED_JSON=" +
                JSON.stringify({
                    fileSizeBytes: FILE_SIZE_BYTES,
                    numBlocks: pre.num_blocks,
                    numGates: pre.num_gates,
                    rounds: native.rounds.length,
                    direction: native.direction,
                    timingsMs: {
                        precontractCliWall: precontractMs,
                        nativeDisputeCliWall: nativeDisputeMs,
                        nativeHpreTotal: native.timings.all_hpre_ms,
                        nativeDisputeCliInternalTotal: native.timings.total_ms,
                        optimisticDeployWall: optimisticDeployMs,
                        onchainDisputeWall: onchainDisputeMs,
                    },
                    gas: {
                        optimisticDeploy: deployReceipt.gasUsed.toString(),
                        payment: paymentGas.toString(),
                        key: keyGas.toString(),
                        buyerSelfSponsor: buyerSponsorGas.toString(),
                        triggerDispute: triggerGas.toString(),
                        respondChallengeTotal: respondGas.toString(),
                        giveOpinionTotal: opinionGas.toString(),
                        submitCommitmentLeftNoGateBytes: submitGas.toString(),
                        finalize: finalizeGas.toString(),
                        optimisticPathTotal: optimisticPathGas.toString(),
                        disputeExecutionTotal: disputeExecutionGas.toString(),
                        total: totalGas.toString(),
                    },
                    hpreMs: native.rounds.map((round) => ({
                        round: round.round,
                        challenge: round.challenge,
                        ms: round.hpre_ms,
                    })),
                })
        );

        expect(totalGas).to.be.greaterThan(0n);
    });

    it("measures a direct three-iteration hardcoded SHA256 dispute with external sponsors", async function () {
        const preStarted = performance.now();
        const { stdout: preStdout } = await execFileAsync(
            precontractCli,
            [inputPath, KEY_HEX],
            { maxBuffer: 1024 * 1024 }
        );
        const precontractMs = performance.now() - preStarted;
        const pre = JSON.parse(preStdout) as PrecontractCliOutput;

        expect(pre.num_blocks).to.equal(EXPECTED_BLOCKS);
        expect(pre.num_gates).to.equal(EXPECTED_GATES);
        await rm(pre.circuit_path, { force: true });

        const disputeStarted = performance.now();
        const { stdout: disputeStdout } = await execFileAsync(
            disputeCli,
            [
                inputPath,
                pre.ciphertext_path,
                pre.num_blocks.toString(),
                pre.num_gates.toString(),
            ],
            { maxBuffer: 1024 * 1024 }
        );
        const nativeDisputeMs = performance.now() - disputeStarted;
        const native = JSON.parse(disputeStdout) as NativeDisputeOutput;

        expect(native.rounds).to.have.length(expectedLeftPathRounds(pre.num_gates));
        expect(native.final_left.gate_num).to.equal(1);

        const shared = await deploySharedContext();
        const OptimisticFactory = await ethers.getContractFactory(
            "OptimisticSOXAccountHardcodedSHA256",
            {
                libraries: {
                    DisputeDeployerHardcodedSHA256:
                        await shared.disputeDeployerHardcodedSHA256.getAddress(),
                    HardcodedSha256CircuitLib:
                        await shared.hardcodedSha256CircuitLib.getAddress(),
                },
            }
        );
        const ciphertextIv =
            "0x" + native.final_left.gate_bytes_hex.slice(2 + 7 * 2, 2 + 23 * 2);

        const deployStarted = performance.now();
        const optimistic = await OptimisticFactory.connect(shared.sponsor).deploy(
            await shared.entryPoint.getAddress(),
            await shared.vendor.getAddress(),
            await shared.buyer.getAddress(),
            AGREED_PRICE,
            COMPLETION_TIP,
            DISPUTE_TIP,
            TIMEOUT_INCREMENT,
            hex32(pre.commitment_c_hex),
            BigInt(pre.num_blocks),
            BigInt(pre.num_gates),
            await shared.vendor.getAddress(),
            hex32(pre.description_hex),
            BigInt(FILE_SIZE_BYTES),
            ciphertextIv,
            { value: SPONSOR_FEES }
        );
        await optimistic.waitForDeployment();
        const deployReceipt = await optimistic.deploymentTransaction()?.wait();
        if (!deployReceipt) throw new Error("Missing optimistic deployment receipt");
        const optimisticDeployMs = performance.now() - deployStarted;

        const paymentGas = await gasOf(
            optimistic
                .connect(shared.buyer)
                .sendPayment({ value: AGREED_PRICE + COMPLETION_TIP })
        );
        const keyGas = await gasOf(optimistic.connect(shared.vendor).sendKey(KEY_BYTES16));

        const authHash = await optimistic.buyerUnhappyAuthorizationHash(
            await shared.buyerDisputeSponsor.getAddress()
        );
        const authSignature = await shared.buyer.signMessage(ethers.getBytes(authHash));
        const buyerSponsorGas = await gasOf(
            optimistic
                .connect(shared.buyerDisputeSponsor)
                .sendBuyerDisputeSponsorFeeWithAuthorization(authSignature, {
                    value: DISPUTE_FEES + DISPUTE_TIP,
                })
        );
        const triggerGas = await gasOf(
            optimistic.connect(shared.vendorDisputeSponsor).sendVendorDisputeSponsorFee({
                value: DISPUTE_FEES + DISPUTE_TIP + AGREED_PRICE,
            })
        );

        const disputeAddress = await optimistic.disputeContract();
        const dispute = await ethers.getContractAt(
            "DisputeSOXAccountHardcodedSHA256",
            disputeAddress
        );

        const signersByAddress = new Map<string, any>();
        for (const signer of [
            shared.buyer,
            shared.vendor,
            shared.buyerDisputeSponsor,
            shared.vendorDisputeSponsor,
        ]) {
            signersByAddress.set((await signer.getAddress()).toLowerCase(), signer);
        }
        const signerFor = async (address: string) => {
            const signer = signersByAddress.get(address.toLowerCase());
            if (!signer) {
                throw new Error(`No signer for dispute actor ${address}`);
            }
            return signer;
        };

        const corruptedCurrAcc = ethers.keccak256(
            ethers.toUtf8Bytes("bad hardcoded current accumulator")
        );

        let respondGas = 0n;
        let opinionGas = 0n;
        const respondGasByCycle: bigint[] = [];
        const opinionGasByCycle: bigint[] = [];
        const submitGasByCycle: bigint[] = [];
        const cycleOutcomes: string[] = [];

        const runChallengeRounds = async () => {
            let cycleRespondGas = 0n;
            let cycleOpinionGas = 0n;
            for (const round of native.rounds) {
                expect(await dispute.chall()).to.equal(BigInt(round.challenge));
                const buyerSigner = await signerFor(await dispute.buyer());
                const vendorSigner = await signerFor(await dispute.vendor());
                cycleRespondGas += await gasOf(
                    dispute.connect(buyerSigner).respondChallenge(round.hpre_hex)
                );
                cycleOpinionGas += await gasOf(
                    dispute.connect(vendorSigner).giveOpinion(false)
                );
            }
            respondGasByCycle.push(cycleRespondGas);
            opinionGasByCycle.push(cycleOpinionGas);
            respondGas += cycleRespondGas;
            opinionGas += cycleOpinionGas;
            expect(await dispute.currState()).to.equal(3n); // WaitVendorDataLeft
        };

        const submitLeft = async (
            currAcc: string,
            proofExt: string[][],
            expectedStateAfter: bigint
        ) => {
            const vendorSigner = await signerFor(await dispute.vendor());
            const submitGas = await gasOf(
                dispute.connect(vendorSigner).submitCommitmentLeft(
                    hex32(pre.commitment_o_hex),
                    native.final_left.gate_num,
                    "0x",
                    native.final_left.values_hex,
                    currAcc,
                    [],
                    native.final_left.proof2,
                    proofExt
                )
            );
            submitGasByCycle.push(submitGas);
            expect(await dispute.currState()).to.equal(expectedStateAfter);
            return submitGas;
        };

        const onchainDisputeStarted = performance.now();

        // Cycle 1: valid Step 8 makes B lose, so Step 9 replaces B by SB and restarts.
        await runChallengeRounds();
        await submitLeft(native.final_left.curr_acc_hex, native.final_left.proof_ext, 0n); // ChallengeBuyer
        cycleOutcomes.push("valid left proof: buyer loses, B becomes SB");

        // Cycle 2: corrupted currAcc still exercises the hardcoded Step 8 verifier
        // after proof2 succeeds, but makes V lose so Step 9 replaces V by SV.
        await runChallengeRounds();
        await submitLeft(corruptedCurrAcc, native.final_left.proof_ext, 0n); // ChallengeBuyer
        cycleOutcomes.push("corrupted currAcc: vendor loses, V becomes SV");

        // Cycle 3: valid Step 8 makes the current buyer lose. Since buyer == SB,
        // Step 9 terminates without a fourth Step 7+8 loop.
        await runChallengeRounds();
        await submitLeft(native.final_left.curr_acc_hex, native.final_left.proof_ext, 5n); // Complete
        cycleOutcomes.push("valid left proof: buyer sponsor loses, dispute completes");

        const finalizeGas = await gasOf(
            dispute.connect(await signerFor(await dispute.buyer())).completeDispute()
        );
        expect(await dispute.currState()).to.equal(7n); // End
        const onchainDisputeMs = performance.now() - onchainDisputeStarted;

        const optimisticPathGas =
            deployReceipt.gasUsed + paymentGas + keyGas + buyerSponsorGas + triggerGas;
        const submitGasTotal = submitGasByCycle.reduce((sum, gas) => sum + gas, 0n);
        const disputeExecutionGas =
            respondGas + opinionGas + submitGasTotal + finalizeGas;
        const totalGas = optimisticPathGas + disputeExecutionGas;

        console.log(
            "THREE_ITERATION_1G_HARDCODED_EXTERNAL_JSON=" +
                JSON.stringify({
                    fileSizeBytes: FILE_SIZE_BYTES,
                    numBlocks: pre.num_blocks,
                    numGates: pre.num_gates,
                    cycles: 3,
                    roundsPerCycle: native.rounds.length,
                    step78Executions: native.rounds.length * 3,
                    cycleOutcomes,
                    timingsMs: {
                        precontractCliWall: precontractMs,
                        nativeDisputeCliWall: nativeDisputeMs,
                        nativeHpreOnePassTotal: native.timings.all_hpre_ms,
                        nativeDisputeCliInternalTotal: native.timings.total_ms,
                        optimisticDeployWall: optimisticDeployMs,
                        onchainDisputeWall: onchainDisputeMs,
                    },
                    gas: {
                        optimisticDeploy: deployReceipt.gasUsed.toString(),
                        payment: paymentGas.toString(),
                        key: keyGas.toString(),
                        buyerSponsorExternal: buyerSponsorGas.toString(),
                        triggerDispute: triggerGas.toString(),
                        respondChallengeByCycle: respondGasByCycle.map((gas) =>
                            gas.toString()
                        ),
                        respondChallengeTotal: respondGas.toString(),
                        giveOpinionByCycle: opinionGasByCycle.map((gas) =>
                            gas.toString()
                        ),
                        giveOpinionTotal: opinionGas.toString(),
                        submitCommitmentLeftByCycle: submitGasByCycle.map((gas) =>
                            gas.toString()
                        ),
                        submitCommitmentLeftTotal: submitGasTotal.toString(),
                        finalize: finalizeGas.toString(),
                        optimisticPathTotal: optimisticPathGas.toString(),
                        disputeExecutionTotalAfterTrigger: disputeExecutionGas.toString(),
                        totalIncludingOptimisticPath: totalGas.toString(),
                    },
                })
        );

        expect(disputeExecutionGas).to.be.greaterThan(0n);
    });
});
