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
const EXPECTED_GATES =
    EXPECTED_BLOCKS * 2 + (FILE_SIZE_BYTES % 64 > 55 ? 8 : 5);

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
    commitment_c_hex: string;
    commitment_o_hex: string;
    num_blocks: number;
    num_gates: number;
    ciphertext_path: string;
    circuit_path: string;
};

type NativeDisputeOutput = {
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
        proof2: string[][];
        proof_ext: string[][];
    };
    timings: {
        all_hpre_ms: number;
        total_ms: number;
    };
};

async function gasOf(txPromise: Promise<any>) {
    const tx = await txPromise;
    const receipt = await tx.wait();
    if (!receipt) throw new Error("Missing transaction receipt");
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

    const AccumulatorVerifierFactory = await ethers.getContractFactory(
        "AccumulatorVerifier"
    );
    const accumulatorVerifier = await AccumulatorVerifierFactory.deploy();
    await accumulatorVerifier.waitForDeployment();

    const CommitmentOpenerFactory = await ethers.getContractFactory(
        "CommitmentOpener"
    );
    const commitmentOpener = await CommitmentOpenerFactory.deploy();
    await commitmentOpener.waitForDeployment();

    const SHA256EvaluatorFactory = await ethers.getContractFactory(
        "SHA256Evaluator"
    );
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

    return {
        sponsor,
        buyer,
        vendor,
        buyerDisputeSponsor,
        vendorDisputeSponsor,
        entryPoint,
        disputeDeployer,
    };
}

describe("Monolithic hardcoded SHA256 mirror of Phase 4 section 5.2", function () {
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
            console.log("Skipping monolithic mirror benchmark: native CLIs are missing");
            this.skip();
        }

        tempDir = await mkdtemp(join(tmpdir(), "sox-monolithic-hardcoded-"));
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

    it("measures the monolithic hardcoded path in the same scope as section 5.2", async function () {
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
            "OptimisticSOXAccount",
            {
                libraries: {
                    DisputeDeployer: await shared.disputeDeployer.getAddress(),
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
            { value: SPONSOR_FEES }
        );
        await optimistic.waitForDeployment();
        const deployReceipt = await optimistic.deploymentTransaction()?.wait();
        if (!deployReceipt) throw new Error("Missing optimistic deployment receipt");
        const optimisticDeployMs = performance.now() - deployStarted;

        const configureGas = await gasOf(
            optimistic.connect(shared.vendor).configureHardcodedSha256Circuit(
                hex32(pre.description_hex),
                BigInt(FILE_SIZE_BYTES),
                ciphertextIv
            )
        );
        expect(await optimistic.hardcodedSha256Circuit()).to.equal(true);

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
        const dispute = await ethers.getContractAt("DisputeSOXAccount", disputeAddress);
        expect(await dispute.hardcodedSha256Circuit()).to.equal(true);

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
                native.final_left.gate_bytes_hex,
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

        const optimisticBeforeTrigger =
            deployReceipt.gasUsed +
            configureGas +
            paymentGas +
            keyGas +
            buyerSponsorGas;
        const optimisticPlusTrigger = optimisticBeforeTrigger + triggerGas;
        const disputeAfterTrigger = respondGas + opinionGas + submitGas + finalizeGas;
        const totalMeasured = optimisticPlusTrigger + disputeAfterTrigger;

        console.log(
            "MONOLITHIC_HARDCODED_MIRROR_52_JSON=" +
                JSON.stringify({
                    contractVariant:
                        "OptimisticSOXAccount monolithic + configureHardcodedSha256Circuit + DisputeSOXAccount",
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
                        hardcodedConfigure: configureGas.toString(),
                        payment: paymentGas.toString(),
                        key: keyGas.toString(),
                        buyerSelfSponsor: buyerSponsorGas.toString(),
                        optimisticBeforeTrigger: optimisticBeforeTrigger.toString(),
                        triggerDispute: triggerGas.toString(),
                        optimisticPlusTrigger: optimisticPlusTrigger.toString(),
                        respondChallengeTotal: respondGas.toString(),
                        giveOpinionTotal: opinionGas.toString(),
                        submitCommitmentLeftWithGateBytesNoProof1: submitGas.toString(),
                        finalize: finalizeGas.toString(),
                        disputeAfterTrigger: disputeAfterTrigger.toString(),
                        totalMeasured: totalMeasured.toString(),
                    },
                    hpreMs: native.rounds.slice(0, 5).map((round) => ({
                        round: round.round,
                        challenge: round.challenge,
                        ms: round.hpre_ms,
                    })),
                })
        );

        expect(totalMeasured).to.be.greaterThan(0n);
    });
});
