import { expect } from "chai";
import hre from "hardhat";
import "@nomicfoundation/hardhat-chai-matchers";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import {
    bytes_to_hex,
    compute_precontract_values_v2,
    compute_proofs_v2,
    evaluate_circuit_v2_wasm,
    initSync,
} from "../../app/lib/crypto_lib/crypto_lib";

const { ethers } = hre;

const AGREED_PRICE = 100n;
const COMPLETION_TIP = 5n;
const DISPUTE_TIP = 3n;
const SPONSOR_FEES = 5n;
const DISPUTE_FEES = 10n;
const TIMEOUT_INCREMENT = 60n;
const KEY = "0x" + "11".repeat(16);

type PreVariant = "normal" | "S=V" | "S=B";

type MatrixCase = {
    pre: PreVariant;
    sbSelf: boolean;
    svSelf: boolean;
};

type GasBreakdown = {
    label: string;
    deploy: bigint;
    configure?: bigint;
    payment?: bigint;
    key: bigint;
    sb: bigint;
    sv: bigint;
    total: bigint;
};

type OptimisticSuccessGasBreakdown = {
    label: string;
    deploy: bigint;
    configure?: bigint;
    payment?: bigint;
    key: bigint;
    complete: bigint;
    total: bigint;
};

type DisputeGasBreakdown = {
    label: string;
    configure: bigint;
    sb: bigint;
    triggerDispute: bigint;
    submitCommitment: bigint;
    totalMeasured: bigint;
    proof1Levels: number;
    proof1Items: number;
};

type FullDisputeGasBreakdown = {
    label: string;
    configure: bigint;
    sb: bigint;
    triggerDispute: bigint;
    respondChallenge: bigint;
    giveOpinion: bigint;
    submitCommitment: bigint;
    finalize: bigint;
    totalMeasured: bigint;
    challengeRestarts: number;
    step8Submissions: number;
    finalDecision: string;
};

type RealDisputeMeasurementOptions = {
    hardcoded: boolean;
    fileLength: number;
    sbSelf?: boolean;
    svSelf?: boolean;
    label?: string;
};

type RealDisputeContext = {
    hardcoded: boolean;
    fileLength: number;
    precontract: any;
    evaluatedBytes: Uint8Array;
    account: any;
    dispute: any;
    buyer: any;
    vendor: any;
    buyerDisputeSponsor: any;
    vendorDisputeSponsor: any;
    configureGas: bigint;
    sbGas: bigint;
    triggerDisputeGas: bigint;
};

type LargeCircuitGasBreakdown = {
    label: string;
    plaintextLengthBytes: bigint;
    numBlocks: bigint;
    numGates: bigint;
    proofDepth: number;
    configure: bigint;
    triggerDispute: bigint;
    normalHCircuitProofGas: bigint;
    hardcodedAesGateGas: bigint;
    hardcodedShaGateGas: bigint;
    hardcodedFinalGateGas: bigint;
    bestHardcodedSaving: bigint;
    worstHardcodedSaving: bigint;
};

let wasmInitialized = false;

async function initWasmOnce() {
    if (wasmInitialized) {
        return;
    }
    const wasmPath = join(__dirname, "../../app/lib/crypto_lib/crypto_lib_bg.wasm");
    const wasmBytes = await readFile(wasmPath);
    initSync({ module: wasmBytes });
    wasmInitialized = true;
}

async function gasOf(txPromise: Promise<any>): Promise<bigint> {
    const tx = await txPromise;
    const receipt = await tx.wait();
    if (!receipt) {
        throw new Error("Missing transaction receipt");
    }
    return receipt.gasUsed;
}

function hexlifyBytes(bytes: Uint8Array): string {
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

function countProofItems(proof: any): number {
    return proof.reduce((acc: number, level: Uint8Array[]) => acc + level.length, 0);
}

function serializeGas(row: GasBreakdown) {
    return {
        label: row.label,
        deploy: row.deploy.toString(),
        configure: row.configure?.toString() ?? "0",
        payment: row.payment?.toString() ?? "0",
        key: row.key.toString(),
        sb: row.sb.toString(),
        sv: row.sv.toString(),
        total: row.total.toString(),
    };
}

function serializeOptimisticSuccessGas(row: OptimisticSuccessGasBreakdown) {
    return {
        label: row.label,
        deploy: row.deploy.toString(),
        configure: row.configure?.toString() ?? "0",
        payment: row.payment?.toString() ?? "0",
        key: row.key.toString(),
        complete: row.complete.toString(),
        total: row.total.toString(),
    };
}

function serializeDisputeGas(row: DisputeGasBreakdown) {
    return {
        label: row.label,
        configure: row.configure.toString(),
        sb: row.sb.toString(),
        triggerDispute: row.triggerDispute.toString(),
        submitCommitment: row.submitCommitment.toString(),
        totalMeasured: row.totalMeasured.toString(),
        proof1Levels: row.proof1Levels.toString(),
        proof1Items: row.proof1Items.toString(),
    };
}

function serializeFullDisputeGas(row: FullDisputeGasBreakdown) {
    return {
        label: row.label,
        configure: row.configure.toString(),
        sb: row.sb.toString(),
        triggerDispute: row.triggerDispute.toString(),
        respondChallenge: row.respondChallenge.toString(),
        giveOpinion: row.giveOpinion.toString(),
        submitCommitment: row.submitCommitment.toString(),
        finalize: row.finalize.toString(),
        totalMeasured: row.totalMeasured.toString(),
        challengeRestarts: row.challengeRestarts.toString(),
        step8Submissions: row.step8Submissions.toString(),
        finalDecision: row.finalDecision,
    };
}

function serializeLargeCircuitGas(row: LargeCircuitGasBreakdown) {
    return {
        label: row.label,
        plaintextLengthBytes: row.plaintextLengthBytes.toString(),
        numBlocks: row.numBlocks.toString(),
        numGates: row.numGates.toString(),
        proofDepth: row.proofDepth.toString(),
        configure: row.configure.toString(),
        triggerDispute: row.triggerDispute.toString(),
        normalHCircuitProofGas: row.normalHCircuitProofGas.toString(),
        hardcodedAesGateGas: row.hardcodedAesGateGas.toString(),
        hardcodedShaGateGas: row.hardcodedShaGateGas.toString(),
        hardcodedFinalGateGas: row.hardcodedFinalGateGas.toString(),
        bestHardcodedSaving: row.bestHardcodedSaving.toString(),
        worstHardcodedSaving: row.worstHardcodedSaving.toString(),
    };
}

function labelOf(pre: PreVariant, sbSelf: boolean, svSelf: boolean, noS = false) {
    const s = noS ? "no_S_deposit" : pre;
    const sb = sbSelf ? "SB=B" : "SB=external";
    const sv = svSelf ? "SV=V" : "SV=external";
    return `${s} | ${sb} | ${sv}`;
}

function labelSuccessOf(pre: PreVariant, noS = false) {
    return `${noS ? "no_S_deposit" : pre} | optimistic success`;
}

function hardcodedBlockCount(plaintextLength: bigint) {
    return (plaintextLength + 63n) / 64n;
}

function hardcodedSha256GateCount(plaintextLength: bigint) {
    const blocks = hardcodedBlockCount(plaintextLength);
    const rem = plaintextLength % 64n;
    return rem > 55n ? blocks * 2n + 8n : blocks * 2n + 5n;
}

function ceilLog2(value: bigint) {
    let depth = 0;
    let size = 1n;
    while (size < value) {
        size <<= 1n;
        depth++;
    }
    return depth;
}

function minBigInt(values: bigint[]) {
    return values.reduce((best, value) => (value < best ? value : best));
}

function maxBigInt(values: bigint[]) {
    return values.reduce((best, value) => (value > best ? value : best));
}

function makeAccumulatorProof(depth: number, index: number) {
    const proof: string[][] = [];
    const leaf = ethers.keccak256(ethers.toUtf8Bytes(`sox-large-leaf:${index}`));
    let value = leaf;
    let currentIndex = BigInt(index);

    for (let level = 0; level < depth; level++) {
        const sibling = ethers.keccak256(
            ethers.toUtf8Bytes(`sox-large-sibling:${index}:${level}`)
        );
        proof.push([sibling]);

        value =
            currentIndex % 2n === 0n
                ? ethers.keccak256(ethers.concat([value, sibling]))
                : ethers.keccak256(ethers.concat([sibling, value]));
        currentIndex >>= 1n;
    }

    return {
        root: value,
        index,
        leaf,
        proof,
    };
}

describe("Phase 3 exhaustive matrix and gas measurements", () => {
    async function deployMockOptimistic(pre: PreVariant, noS = false) {
        const [
            sponsor,
            buyer,
            vendor,
            buyerDisputeSponsor,
            vendorDisputeSponsor,
            attacker,
        ] = await ethers.getSigners();

        const sponsorSigner =
            pre === "S=B" ? buyer : pre === "S=V" ? vendor : sponsor;
        const sponsorValue = noS
            ? 0n
            : pre === "S=B"
              ? AGREED_PRICE + COMPLETION_TIP + SPONSOR_FEES
              : SPONSOR_FEES;

        const mockDeployerFactory = await ethers.getContractFactory("MockDisputeDeployer");
        const mockDeployer = await mockDeployerFactory.connect(sponsorSigner).deploy();
        await mockDeployer.waitForDeployment();

        const entryPointFactory = await ethers.getContractFactory("MockEntryPoint");
        const entryPoint = await entryPointFactory.connect(attacker).deploy();
        await entryPoint.waitForDeployment();

        const accountFactory = await ethers.getContractFactory("OptimisticSOXAccount", {
            libraries: {
                DisputeDeployer: await mockDeployer.getAddress(),
            },
        });

        const account = await accountFactory.connect(sponsorSigner).deploy(
            await entryPoint.getAddress(),
            await vendor.getAddress(),
            await buyer.getAddress(),
            AGREED_PRICE,
            COMPLETION_TIP,
            DISPUTE_TIP,
            TIMEOUT_INCREMENT,
            ethers.ZeroHash,
            1n,
            7n,
            await vendor.getAddress(),
            { value: sponsorValue }
        );
        await account.waitForDeployment();

        const deployReceipt = await account.deploymentTransaction()?.wait();
        if (!deployReceipt) {
            throw new Error("Missing deployment receipt");
        }

        return {
            account,
            entryPoint,
            sponsor,
            buyer,
            vendor,
            buyerDisputeSponsor,
            vendorDisputeSponsor,
            attacker,
            sponsorSigner,
            deployGas: deployReceipt.gasUsed,
        };
    }

    async function buyerAuthorization(account: any, buyer: any, sponsorAddress: string) {
        const authHash = await account.buyerUnhappyAuthorizationHash(sponsorAddress);
        return buyer.signMessage(ethers.getBytes(authHash));
    }

    async function runOptimisticFlow(
        testCase: MatrixCase,
        options?: { noS?: boolean; configureHardcoded?: boolean }
    ): Promise<GasBreakdown> {
        const {
            account,
            buyer,
            vendor,
            buyerDisputeSponsor,
            vendorDisputeSponsor,
            deployGas,
        } = await deployMockOptimistic(testCase.pre, options?.noS ?? false);

        let configureGas = 0n;
        if (options?.configureHardcoded) {
            const descriptionHash = ethers.sha256(ethers.toUtf8Bytes("phase3-gas"));
            const iv = "0x0102030405060708090a0b0c0d0e0f10";
            configureGas = await gasOf(
                account
                    .connect(testCase.pre === "S=B" ? buyer : vendor)
                    .configureHardcodedSha256Circuit(descriptionHash, 13n, iv)
            );
        }

        expect(await account.preContractVariant()).to.equal(
            options?.noS ? 1n : testCase.pre === "S=B" ? 2n : testCase.pre === "S=V" ? 3n : 0n
        );
        expect(await account.noSponsorDeposit()).to.equal(options?.noS ?? false);
        expect(await account.sponsorIsBuyer()).to.equal(!options?.noS && testCase.pre === "S=B");
        expect(await account.sponsorIsVendor()).to.equal(!options?.noS && testCase.pre === "S=V");

        let paymentGas: bigint | undefined;
        if (testCase.pre !== "S=B" || options?.noS) {
            paymentGas = await gasOf(
                account.connect(buyer).sendPayment({
                    value: options?.noS ? AGREED_PRICE : AGREED_PRICE + COMPLETION_TIP,
                })
            );
        } else {
            expect(await account.currState()).to.equal(1n);
            expect(await account.buyerDeposit()).to.equal(AGREED_PRICE + COMPLETION_TIP);
            expect(await account.sponsorDeposit()).to.equal(SPONSOR_FEES);
        }

        const keyGas = await gasOf(account.connect(vendor).sendKey(KEY));

        let sbGas: bigint;
        if (testCase.sbSelf) {
            sbGas = await gasOf(
                account
                    .connect(buyer)
                    .sendBuyerSelfDisputeSponsorFee({ value: DISPUTE_FEES + DISPUTE_TIP })
            );
            expect(await account.buyerDisputeSponsor()).to.equal(await buyer.getAddress());
        } else {
            const authorization = await buyerAuthorization(
                account,
                buyer,
                await buyerDisputeSponsor.getAddress()
            );
            sbGas = await gasOf(
                account
                    .connect(buyerDisputeSponsor)
                    .sendBuyerDisputeSponsorFeeWithAuthorization(authorization, {
                        value: DISPUTE_FEES + DISPUTE_TIP,
                    })
            );
            expect(await account.buyerDisputeSponsor()).to.equal(
                await buyerDisputeSponsor.getAddress()
            );
        }

        let svGas: bigint;
        if (testCase.svSelf) {
            svGas = await gasOf(
                account.connect(vendor).sendVendorSelfDisputeSponsorFee({
                    value: DISPUTE_FEES + DISPUTE_TIP + AGREED_PRICE,
                })
            );
            expect(await account.vendorDisputeSponsor()).to.equal(await vendor.getAddress());
        } else {
            svGas = await gasOf(
                account.connect(vendorDisputeSponsor).sendVendorDisputeSponsorFee({
                    value: DISPUTE_FEES + DISPUTE_TIP + AGREED_PRICE,
                })
            );
            expect(await account.vendorDisputeSponsor()).to.equal(
                await vendorDisputeSponsor.getAddress()
            );
        }

        expect(await account.currState()).to.equal(4n);

        const total =
            deployGas + configureGas + (paymentGas ?? 0n) + keyGas + sbGas + svGas;

        return {
            label: `${labelOf(testCase.pre, testCase.sbSelf, testCase.svSelf, options?.noS)}${
                options?.configureHardcoded ? " | hardcoded SHA256" : ""
            }`,
            deploy: deployGas,
            configure: configureGas === 0n ? undefined : configureGas,
            payment: paymentGas,
            key: keyGas,
            sb: sbGas,
            sv: svGas,
            total,
        };
    }

    async function runOptimisticSuccessFlow(
        pre: PreVariant,
        options?: { noS?: boolean; configureHardcoded?: boolean }
    ): Promise<OptimisticSuccessGasBreakdown> {
        const { account, buyer, vendor, deployGas } = await deployMockOptimistic(
            pre,
            options?.noS ?? false
        );

        let configureGas = 0n;
        if (options?.configureHardcoded) {
            const descriptionHash = ethers.sha256(ethers.toUtf8Bytes("phase3-gas"));
            const iv = "0x0102030405060708090a0b0c0d0e0f10";
            configureGas = await gasOf(
                account
                    .connect(pre === "S=B" ? buyer : vendor)
                    .configureHardcodedSha256Circuit(descriptionHash, 13n, iv)
            );
        }

        let paymentGas: bigint | undefined;
        if (pre !== "S=B" || options?.noS) {
            paymentGas = await gasOf(
                account.connect(buyer).sendPayment({
                    value: options?.noS ? AGREED_PRICE : AGREED_PRICE + COMPLETION_TIP,
                })
            );
        } else {
            expect(await account.currState()).to.equal(1n);
        }

        const keyGas = await gasOf(account.connect(vendor).sendKey(KEY));
        const completeGas = await gasOf(account.connect(buyer).completeTransaction());

        expect(await account.currState()).to.equal(5n);

        const total = deployGas + configureGas + (paymentGas ?? 0n) + keyGas + completeGas;

        return {
            label: `${labelSuccessOf(pre, options?.noS)}${
                options?.configureHardcoded ? " | hardcoded SHA256" : ""
            }`,
            deploy: deployGas,
            configure: configureGas === 0n ? undefined : configureGas,
            payment: paymentGas,
            key: keyGas,
            complete: completeGas,
            total,
        };
    }

    const matrix12: MatrixCase[] = (["normal", "S=V", "S=B"] as PreVariant[]).flatMap(
        (pre) => [
            { pre, sbSelf: false, svSelf: false },
            { pre, sbSelf: true, svSelf: false },
            { pre, sbSelf: false, svSelf: true },
            { pre, sbSelf: true, svSelf: true },
        ]
    );

    it("executes all 12 Phase 2 S/SB/SV matrix cases", async () => {
        const labels: string[] = [];

        for (const testCase of matrix12) {
            const result = await runOptimisticFlow(testCase);
            labels.push(result.label);
        }

        expect(labels).to.have.length(12);
        expect(new Set(labels).size).to.equal(12);
    });

    it("executes no_S_deposit with every SB/SV self-sponsor combination", async () => {
        const noSCases: MatrixCase[] = [
            { pre: "normal", sbSelf: false, svSelf: false },
            { pre: "normal", sbSelf: true, svSelf: false },
            { pre: "normal", sbSelf: false, svSelf: true },
            { pre: "normal", sbSelf: true, svSelf: true },
        ];

        for (const testCase of noSCases) {
            await runOptimisticFlow(testCase, { noS: true });
        }
    });

    it("rejects unsafe or inconsistent Phase 3 paths", async () => {
        const { account, buyer, vendor, buyerDisputeSponsor, attacker } =
            await deployMockOptimistic("normal");

        await account.connect(buyer).sendPayment({ value: AGREED_PRICE + COMPLETION_TIP });
        await account.connect(vendor).sendKey(KEY);

        await expect(
            account.connect(buyerDisputeSponsor).sendBuyerDisputeSponsorFee({
                value: DISPUTE_FEES + DISPUTE_TIP,
            })
        ).to.be.revertedWith("Unexpected sender");

        const badHash = await account.buyerUnhappyAuthorizationHash(
            await buyerDisputeSponsor.getAddress()
        );
        const badAuthorization = await attacker.signMessage(ethers.getBytes(badHash));
        await expect(
            account
                .connect(buyerDisputeSponsor)
                .sendBuyerDisputeSponsorFeeWithAuthorization(badAuthorization, {
                    value: DISPUTE_FEES + DISPUTE_TIP,
                })
        ).to.be.revertedWith("Invalid buyer unhappy authorization");

        const [, buyerSigner] = await ethers.getSigners();
        await expect(
            deployMockOptimistic("S=B", false).then(({ account: _account }) => _account)
        ).not.to.be.reverted;

        const mockDeployerFactory = await ethers.getContractFactory("MockDisputeDeployer");
        const mockDeployer = await mockDeployerFactory.connect(buyerSigner).deploy();
        await mockDeployer.waitForDeployment();
        const entryPointFactory = await ethers.getContractFactory("MockEntryPoint");
        const entryPoint = await entryPointFactory.connect(attacker).deploy();
        await entryPoint.waitForDeployment();
        const accountFactory = await ethers.getContractFactory("OptimisticSOXAccount", {
            libraries: { DisputeDeployer: await mockDeployer.getAddress() },
        });
        await expect(
            accountFactory.connect(buyerSigner).deploy(
                await entryPoint.getAddress(),
                await vendor.getAddress(),
                await buyerSigner.getAddress(),
                AGREED_PRICE,
                COMPLETION_TIP,
                DISPUTE_TIP,
                TIMEOUT_INCREMENT,
                ethers.ZeroHash,
                1n,
                7n,
                await vendor.getAddress(),
                { value: AGREED_PRICE + COMPLETION_TIP + SPONSOR_FEES - 1n }
            )
        ).to.be.revertedWith("Not enough money for fused S=B deposits");
    });

    it("rejects invalid hardcoded SHA256 metadata and late configuration", async () => {
        const { account, buyer, vendor } = await deployMockOptimistic("normal");
        const descriptionHash = ethers.sha256(ethers.toUtf8Bytes("phase3"));
        const iv = "0x0102030405060708090a0b0c0d0e0f10";

        await expect(
            account.connect(vendor).configureHardcodedSha256Circuit(descriptionHash, 56n, iv)
        ).to.be.revertedWith("Hardcoded gate count mismatch");

        await account.connect(buyer).sendPayment({ value: AGREED_PRICE + COMPLETION_TIP });
        await account.connect(vendor).sendKey(KEY);

        await expect(
            account.connect(vendor).configureHardcodedSha256Circuit(descriptionHash, 13n, iv)
        ).to.be.revertedWith("Configure before payment or key");
    });

    it("measures optimistic success path separately from dispute-trigger paths", async () => {
        const rows: OptimisticSuccessGasBreakdown[] = [];
        for (const scenario of [
            { pre: "normal" as PreVariant },
            { pre: "S=B" as PreVariant },
            { pre: "S=V" as PreVariant },
            { pre: "normal" as PreVariant, noS: true },
        ]) {
            rows.push(await runOptimisticSuccessFlow(scenario.pre, { noS: scenario.noS }));
        }

        const serialized = rows.map(serializeOptimisticSuccessGas);
        console.table(serialized);
        console.log(`PHASE3_OPTIMISTIC_SUCCESS_GAS_JSON=${JSON.stringify(serialized)}`);

        const normal = rows.find((row) => row.label === "normal | optimistic success");
        expect(normal?.complete ?? 0n).to.be.greaterThan(0n);
    });

    it("prints Phase 3 pre-dispute gas comparison for retained and matrix cases", async () => {
        const measuredCases: Array<{ scenario: MatrixCase; noS?: boolean; hardcoded?: boolean }> = [
            { scenario: { pre: "normal", sbSelf: false, svSelf: false } },
            { scenario: { pre: "S=B", sbSelf: false, svSelf: false } },
            { scenario: { pre: "S=V", sbSelf: false, svSelf: false } },
            { scenario: { pre: "normal", sbSelf: true, svSelf: false } },
            { scenario: { pre: "normal", sbSelf: false, svSelf: true } },
            { scenario: { pre: "normal", sbSelf: true, svSelf: true } },
            { scenario: { pre: "normal", sbSelf: false, svSelf: false }, noS: true },
            { scenario: { pre: "normal", sbSelf: true, svSelf: false }, noS: true },
            { scenario: { pre: "S=B", sbSelf: false, svSelf: false }, hardcoded: true },
        ];

        const rows: GasBreakdown[] = [];
        for (const item of measuredCases) {
            rows.push(
                await runOptimisticFlow(item.scenario, {
                    noS: item.noS,
                    configureHardcoded: item.hardcoded,
                })
            );
        }

        const serialized = rows.map(serializeGas);
        console.table(serialized);
        console.log(`PHASE3_PRE_DISPUTE_GAS_JSON=${JSON.stringify(serialized)}`);

        const normal = rows.find((row) => row.label === "normal | SB=external | SV=external");
        const fused = rows.find((row) => row.label === "S=B | SB=external | SV=external");
        expect(normal?.payment ?? 0n).to.be.greaterThan(0n);
        expect(fused?.payment ?? 0n).to.equal(0n);
    });

    async function prepareRealDisputeMeasurementContext(
        options: RealDisputeMeasurementOptions
    ): Promise<RealDisputeContext> {
        await initWasmOnce();
        const { hardcoded, fileLength, sbSelf = false, svSelf = false } = options;

        const [sponsor, buyer, vendor, buyerDisputeSponsor, vendorDisputeSponsor] =
            await ethers.getSigners();

        const file = new Uint8Array(fileLength);
        for (let i = 0; i < file.length; i++) {
            file[i] = (i + 1) % 256;
        }
        const key = new Uint8Array([
            0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08,
            0x09, 0x0a, 0x0b, 0x0c, 0x0d, 0x0e, 0x0f, 0x10,
        ]);

        const precontract = compute_precontract_values_v2(file, key);
        const evaluatedBytes = evaluate_circuit_v2_wasm(
            precontract.circuit_bytes,
            precontract.ct,
            bytes_to_hex(key)
        ).to_bytes();

        const entryPointFactory = await ethers.getContractFactory("MockEntryPoint");
        const entryPoint = await entryPointFactory.connect(sponsor).deploy();
        await entryPoint.waitForDeployment();

        const accumulatorFactory = await ethers.getContractFactory("AccumulatorVerifier");
        const accumulator = await accumulatorFactory.deploy();
        await accumulator.waitForDeployment();

        const commitmentFactory = await ethers.getContractFactory("CommitmentOpener");
        const commitment = await commitmentFactory.deploy();
        await commitment.waitForDeployment();

        const shaFactory = await ethers.getContractFactory("SHA256Evaluator");
        const sha = await shaFactory.deploy();
        await sha.waitForDeployment();

        const disputeDeployerFactory = await ethers.getContractFactory("DisputeDeployer", {
            libraries: {
                AccumulatorVerifier: await accumulator.getAddress(),
                CommitmentOpener: await commitment.getAddress(),
                SHA256Evaluator: await sha.getAddress(),
            },
        });
        const disputeDeployer = await disputeDeployerFactory.connect(sponsor).deploy();
        await disputeDeployer.waitForDeployment();

        const accountFactory = await ethers.getContractFactory("OptimisticSOXAccount", {
            libraries: {
                DisputeDeployer: await disputeDeployer.getAddress(),
            },
        });
        const account = await accountFactory.connect(sponsor).deploy(
            await entryPoint.getAddress(),
            await vendor.getAddress(),
            await buyer.getAddress(),
            AGREED_PRICE,
            COMPLETION_TIP,
            DISPUTE_TIP,
            TIMEOUT_INCREMENT,
            hexlifyBytes(precontract.commitment.c),
            BigInt(precontract.num_blocks),
            BigInt(precontract.num_gates),
            await vendor.getAddress(),
            { value: SPONSOR_FEES }
        );
        await account.waitForDeployment();

        let configureGas = 0n;
        if (hardcoded) {
            configureGas = await gasOf(
                account.connect(vendor).configureHardcodedSha256Circuit(
                    hexlifyBytes(precontract.description),
                    BigInt(file.length),
                    hexlifyBytes(precontract.ct.slice(0, 16))
                )
            );
        }

        await account.connect(buyer).sendPayment({ value: AGREED_PRICE + COMPLETION_TIP });
        await account.connect(vendor).sendKey(hexlifyBytes(key));

        let sbGas: bigint;
        if (sbSelf) {
            sbGas = await gasOf(
                account.connect(buyer).sendBuyerSelfDisputeSponsorFee({
                    value: DISPUTE_FEES + DISPUTE_TIP,
                })
            );
        } else {
            const authorization = await buyerAuthorization(
                account,
                buyer,
                await buyerDisputeSponsor.getAddress()
            );
            sbGas = await gasOf(
                account
                    .connect(buyerDisputeSponsor)
                    .sendBuyerDisputeSponsorFeeWithAuthorization(authorization, {
                        value: DISPUTE_FEES + DISPUTE_TIP,
                    })
            );
        }

        const triggerDisputeGas = await gasOf(
            svSelf
                ? account.connect(vendor).sendVendorSelfDisputeSponsorFee({
                    value: DISPUTE_FEES + DISPUTE_TIP + AGREED_PRICE,
                })
                : account.connect(vendorDisputeSponsor).sendVendorDisputeSponsorFee({
                    value: DISPUTE_FEES + DISPUTE_TIP + AGREED_PRICE,
                })
        );

        if (sbSelf) {
            expect(await account.buyerDisputeSponsor()).to.equal(await buyer.getAddress());
        } else {
            expect(await account.buyerDisputeSponsor()).to.equal(
                await buyerDisputeSponsor.getAddress()
            );
        }
        if (svSelf) {
            expect(await account.vendorDisputeSponsor()).to.equal(await vendor.getAddress());
        } else {
            expect(await account.vendorDisputeSponsor()).to.equal(
                await vendorDisputeSponsor.getAddress()
            );
        }

        const disputeAddress = await account.disputeContract();
        const dispute = await ethers.getContractAt("DisputeSOXAccount", disputeAddress);

        return {
            hardcoded,
            fileLength,
            precontract,
            evaluatedBytes,
            account,
            dispute,
            buyer,
            vendor,
            buyerDisputeSponsor,
            vendorDisputeSponsor,
            configureGas,
            sbGas,
            triggerDisputeGas,
        };
    }

    async function signerForDisputeAddress(context: RealDisputeContext, address: string) {
        const actors = [
            context.buyer,
            context.vendor,
            context.buyerDisputeSponsor,
            context.vendorDisputeSponsor,
        ];
        const normalized = address.toLowerCase();
        for (const actor of actors) {
            if ((await actor.getAddress()).toLowerCase() === normalized) {
                return actor;
            }
        }
        throw new Error(`No signer available for dispute address ${address}`);
    }

    async function advanceDisputeToWaitVendorData(context: RealDisputeContext) {
        let respondGas = 0n;
        let opinionGas = 0n;
        let rounds = 0;
        let state = Number(await context.dispute.currState());

        while (state === 0 && rounds < 16) {
            const currentBuyer = await context.dispute.buyer();
            const currentVendor = await context.dispute.vendor();
            const buyerActor = await signerForDisputeAddress(context, currentBuyer);
            const vendorActor = await signerForDisputeAddress(context, currentVendor);

            respondGas += await gasOf(
                context.dispute.connect(buyerActor).respondChallenge(ethers.ZeroHash)
            );
            opinionGas += await gasOf(
                context.dispute.connect(vendorActor).giveOpinion(rounds !== 0)
            );

            state = Number(await context.dispute.currState());
            rounds++;
        }

        expect(state).to.equal(2);
        return { respondGas, opinionGas, rounds };
    }

    async function submitMiddleGateCommitment(context: RealDisputeContext) {
        const gateNum = Number(await context.dispute.a());
        const proofs = compute_proofs_v2(
            context.precontract.circuit_bytes,
            context.evaluatedBytes,
            context.precontract.ct,
            gateNum
        );

        const proof1 = context.hardcoded ? [] : proofToHex(proofs.proof1);
        const currentVendor = await context.dispute.vendor();
        const vendorActor = await signerForDisputeAddress(context, currentVendor);
        const submitCommitmentGas = await gasOf(
            context.dispute.connect(vendorActor).submitCommitment(
                hexlifyBytes(context.precontract.commitment.o),
                gateNum,
                hexlifyBytes(proofs.gate_bytes),
                bytesArrayToHex(proofs.values),
                hexlifyBytes(proofs.curr_acc),
                proof1,
                proofToHex(proofs.proof2),
                proofToHex(proofs.proof3),
                proofToHex(proofs.proof_ext)
            )
        );

        return {
            submitCommitmentGas,
            proof1Levels: proof1.length,
            proof1Items: context.hardcoded ? 0 : countProofItems(proofs.proof1),
        };
    }

    async function deployRealDisputeForHardcodedMeasurement(
        options: RealDisputeMeasurementOptions
    ): Promise<DisputeGasBreakdown> {
        const context = await prepareRealDisputeMeasurementContext(options);
        await advanceDisputeToWaitVendorData(context);
        const submission = await submitMiddleGateCommitment(context);

        return {
            label:
                options.label ??
                `${context.hardcoded ? "dispute hardcoded SHA256" : "dispute normal hCircuit proof"}${
                    options.sbSelf || options.svSelf ? " self-sponsors" : ""
                } (${context.fileLength} bytes)`,
            configure: context.configureGas,
            sb: context.sbGas,
            triggerDispute: context.triggerDisputeGas,
            submitCommitment: submission.submitCommitmentGas,
            totalMeasured:
                context.configureGas +
                context.sbGas +
                context.triggerDisputeGas +
                submission.submitCommitmentGas,
            proof1Levels: submission.proof1Levels,
            proof1Items: submission.proof1Items,
        };
    }

    async function measureFullDisputeToEnd(
        options: RealDisputeMeasurementOptions
    ): Promise<FullDisputeGasBreakdown> {
        const context = await prepareRealDisputeMeasurementContext(options);
        let respondChallengeGas = 0n;
        let giveOpinionGas = 0n;
        let submitCommitmentGas = 0n;
        let finalizeGas = 0n;
        let challengeRestarts = 0;
        let step8Submissions = 0;
        let finalDecision = "unknown";

        for (let cycle = 0; cycle < 4; cycle++) {
            const state = Number(await context.dispute.currState());
            if (state === 0) {
                challengeRestarts++;
                const advanced = await advanceDisputeToWaitVendorData(context);
                respondChallengeGas += advanced.respondGas;
                giveOpinionGas += advanced.opinionGas;

                const submission = await submitMiddleGateCommitment(context);
                submitCommitmentGas += submission.submitCommitmentGas;
                step8Submissions++;
                continue;
            }

            if (state === 5) {
                finalDecision = "Complete";
                const currentBuyer = await context.dispute.buyer();
                const buyerActor = await signerForDisputeAddress(context, currentBuyer);
                finalizeGas = await gasOf(context.dispute.connect(buyerActor).completeDispute());
                break;
            }

            if (state === 6) {
                finalDecision = "Cancel";
                const currentVendor = await context.dispute.vendor();
                const vendorActor = await signerForDisputeAddress(context, currentVendor);
                finalizeGas = await gasOf(context.dispute.connect(vendorActor).cancelDispute());
                break;
            }

            if (state === 7) {
                finalDecision = "End";
                break;
            }

            throw new Error(`Unexpected dispute state during full measurement: ${state}`);
        }

        expect(await context.dispute.currState()).to.equal(7n);

        return {
            label:
                options.label ??
                `full dispute ${context.hardcoded ? "hardcoded SHA256" : "normal"}${
                    options.sbSelf || options.svSelf ? " self-sponsors" : ""
                } (${context.fileLength} bytes)`,
            configure: context.configureGas,
            sb: context.sbGas,
            triggerDispute: context.triggerDisputeGas,
            respondChallenge: respondChallengeGas,
            giveOpinion: giveOpinionGas,
            submitCommitment: submitCommitmentGas,
            finalize: finalizeGas,
            totalMeasured:
                context.configureGas +
                context.sbGas +
                context.triggerDisputeGas +
                respondChallengeGas +
                giveOpinionGas +
                submitCommitmentGas +
                finalizeGas,
            challengeRestarts,
            step8Submissions,
            finalDecision,
        };
    }

    async function deploySyntheticHardcodedDispute(plaintextLength: bigint) {
        const [sponsor, buyer, vendor, buyerDisputeSponsor, vendorDisputeSponsor] =
            await ethers.getSigners();
        const numBlocks = hardcodedBlockCount(plaintextLength);
        const numGates = hardcodedSha256GateCount(plaintextLength);

        const entryPointFactory = await ethers.getContractFactory("MockEntryPoint");
        const entryPoint = await entryPointFactory.connect(sponsor).deploy();
        await entryPoint.waitForDeployment();

        const accumulatorFactory = await ethers.getContractFactory("AccumulatorVerifier");
        const accumulator = await accumulatorFactory.deploy();
        await accumulator.waitForDeployment();

        const commitmentFactory = await ethers.getContractFactory("CommitmentOpener");
        const commitment = await commitmentFactory.deploy();
        await commitment.waitForDeployment();

        const shaFactory = await ethers.getContractFactory("SHA256Evaluator");
        const sha = await shaFactory.deploy();
        await sha.waitForDeployment();

        const disputeDeployerFactory = await ethers.getContractFactory("DisputeDeployer", {
            libraries: {
                AccumulatorVerifier: await accumulator.getAddress(),
                CommitmentOpener: await commitment.getAddress(),
                SHA256Evaluator: await sha.getAddress(),
            },
        });
        const disputeDeployer = await disputeDeployerFactory.connect(sponsor).deploy();
        await disputeDeployer.waitForDeployment();

        const accountFactory = await ethers.getContractFactory("OptimisticSOXAccount", {
            libraries: {
                DisputeDeployer: await disputeDeployer.getAddress(),
            },
        });
        const account = await accountFactory.connect(sponsor).deploy(
            await entryPoint.getAddress(),
            await vendor.getAddress(),
            await buyer.getAddress(),
            AGREED_PRICE,
            COMPLETION_TIP,
            DISPUTE_TIP,
            TIMEOUT_INCREMENT,
            ethers.keccak256(ethers.toUtf8Bytes("phase3-900MiB-synthetic-commitment")),
            numBlocks,
            numGates,
            await vendor.getAddress(),
            { value: SPONSOR_FEES }
        );
        await account.waitForDeployment();

        const configureGas = await gasOf(
            account.connect(vendor).configureHardcodedSha256Circuit(
                ethers.sha256(ethers.toUtf8Bytes("phase3-900MiB-equivalent")),
                plaintextLength,
                "0x0102030405060708090a0b0c0d0e0f10"
            )
        );

        await account.connect(buyer).sendPayment({ value: AGREED_PRICE + COMPLETION_TIP });
        await account.connect(vendor).sendKey(KEY);

        const authorization = await buyerAuthorization(
            account,
            buyer,
            await buyerDisputeSponsor.getAddress()
        );
        await account
            .connect(buyerDisputeSponsor)
            .sendBuyerDisputeSponsorFeeWithAuthorization(authorization, {
                value: DISPUTE_FEES + DISPUTE_TIP,
            });

        const triggerDisputeGas = await gasOf(
            account.connect(vendorDisputeSponsor).sendVendorDisputeSponsorFee({
                value: DISPUTE_FEES + DISPUTE_TIP + AGREED_PRICE,
            })
        );

        const disputeAddress = await account.disputeContract();
        const dispute = await ethers.getContractAt("DisputeSOXAccount", disputeAddress);

        return {
            dispute,
            configureGas,
            triggerDisputeGas,
            numBlocks,
            numGates,
        };
    }

    it("measures normal dispute proof vs hardcoded SHA256 dispute proof", async () => {
        const measured: DisputeGasBreakdown[] = [];
        for (const fileLength of [13, 16 * 1024]) {
            const normal = await deployRealDisputeForHardcodedMeasurement({
                hardcoded: false,
                fileLength,
            });
            const hardcoded = await deployRealDisputeForHardcodedMeasurement({
                hardcoded: true,
                fileLength,
            });
            measured.push(normal, hardcoded);

            expect(hardcoded.proof1Items).to.equal(0);
            expect(normal.proof1Items).to.be.greaterThan(0);
            expect(hardcoded.submitCommitment).to.be.lessThan(normal.submitCommitment);
        }

        const rows = measured.map(serializeDisputeGas);
        console.table(rows);
        console.log(`PHASE3_DISPUTE_GAS_JSON=${JSON.stringify(rows)}`);
    });

    it("measures retained dispute scenarios requested for the professor comparison", async () => {
        const fileLength = 16 * 1024;
        const scenarios: RealDisputeMeasurementOptions[] = [
            {
                hardcoded: false,
                fileLength,
                label: "dispute retained normal external sponsors (16 KB)",
            },
            {
                hardcoded: false,
                fileLength,
                sbSelf: true,
                svSelf: true,
                label: "dispute retained self-sponsors SB=B/SV=V (16 KB)",
            },
            {
                hardcoded: true,
                fileLength,
                label: "dispute retained hardcoded SHA256 external sponsors (16 KB)",
            },
            {
                hardcoded: true,
                fileLength,
                sbSelf: true,
                svSelf: true,
                label: "dispute retained self-sponsors + hardcoded SHA256 (16 KB)",
            },
        ];

        const rows: DisputeGasBreakdown[] = [];
        for (const scenario of scenarios) {
            rows.push(await deployRealDisputeForHardcodedMeasurement(scenario));
        }

        const serialized = rows.map(serializeDisputeGas);
        console.table(serialized);
        console.log(`PHASE3_DISPUTE_RETAINED_GAS_JSON=${JSON.stringify(serialized)}`);

        const normal = rows[0];
        const selfSponsored = rows[1];
        const hardcoded = rows[2];
        const selfSponsoredHardcoded = rows[3];

        expect(selfSponsored.sb).to.be.lessThan(normal.sb);
        expect(hardcoded.proof1Items).to.equal(0);
        expect(selfSponsoredHardcoded.proof1Items).to.equal(0);
        expect(hardcoded.submitCommitment).to.be.lessThan(normal.submitCommitment);
    });

    it("measures full dispute cost until End for external sponsors vs self-sponsors", async () => {
        const fileLength = 16 * 1024;
        const rows = [
            await measureFullDisputeToEnd({
                hardcoded: false,
                fileLength,
                label: "full dispute normal external sponsors until End (16 KB)",
            }),
            await measureFullDisputeToEnd({
                hardcoded: false,
                fileLength,
                sbSelf: true,
                svSelf: true,
                label: "full dispute self-sponsors SB=B/SV=V until End (16 KB)",
            }),
            await measureFullDisputeToEnd({
                hardcoded: true,
                fileLength,
                label: "full dispute hardcoded SHA256 external sponsors until End (16 KB)",
            }),
            await measureFullDisputeToEnd({
                hardcoded: true,
                fileLength,
                sbSelf: true,
                svSelf: true,
                label: "full dispute self-sponsors + hardcoded SHA256 until End (16 KB)",
            }),
        ];

        const serialized = rows.map(serializeFullDisputeGas);
        console.table(serialized);
        console.log(`PHASE3_FULL_DISPUTE_GAS_JSON=${JSON.stringify(serialized)}`);

        expect(rows[1].step8Submissions).to.be.lessThan(rows[0].step8Submissions);
        expect(rows[1].totalMeasured).to.be.lessThan(rows[0].totalMeasured);
        expect(rows[3].step8Submissions).to.be.lessThan(rows[2].step8Submissions);
    });

    it("measures large-file equivalent hCircuit proof before/after hardcoded SHA256", async () => {
        const accumulatorFactory = await ethers.getContractFactory("AccumulatorVerifier");
        const accumulator = await accumulatorFactory.deploy();
        await accumulator.waitForDeployment();
        const verifierFactory = await ethers.getContractFactory("TestAccumulatorVerifier", {
            libraries: {
                AccumulatorVerifier: await accumulator.getAddress(),
            },
        });
        const verifier = await verifierFactory.deploy();
        await verifier.waitForDeployment();

        const rows: LargeCircuitGasBreakdown[] = [];
        for (const item of [
            { label: "900 MiB", plaintextLength: 900n * 1024n * 1024n },
            { label: "1 GiB", plaintextLength: 1024n * 1024n * 1024n },
        ]) {
            const numBlocks = hardcodedBlockCount(item.plaintextLength);
            const numGates = hardcodedSha256GateCount(item.plaintextLength);
            const proofDepth = ceilLog2(numGates);
            const proof = makeAccumulatorProof(proofDepth, Number(numGates - 1n));

            expect(
                await verifier.verify(proof.root, [proof.index], [proof.leaf], proof.proof)
            ).to.equal(true);

            const normalHCircuitProofGas = await verifier.verify.estimateGas(
                proof.root,
                [proof.index],
                [proof.leaf],
                proof.proof
            );

            const synthetic = await deploySyntheticHardcodedDispute(item.plaintextLength);
            expect(synthetic.numBlocks).to.equal(numBlocks);
            expect(synthetic.numGates).to.equal(numGates);

            const shaStart = numBlocks + 3n;
            const hardcodedAesGateGas =
                await synthetic.dispute.expectedHardcodedGateHash.estimateGas(Number(numBlocks));
            const hardcodedShaGateGas =
                await synthetic.dispute.expectedHardcodedGateHash.estimateGas(Number(shaStart));
            const hardcodedFinalGateGas =
                await synthetic.dispute.expectedHardcodedGateHash.estimateGas(Number(numGates));
            const hardcodedGateGases = [
                hardcodedAesGateGas,
                hardcodedShaGateGas,
                hardcodedFinalGateGas,
            ];

            rows.push({
                label: `${item.label} equivalent hardcoded SHA256 hCircuit membership`,
                plaintextLengthBytes: item.plaintextLength,
                numBlocks,
                numGates,
                proofDepth,
                configure: synthetic.configureGas,
                triggerDispute: synthetic.triggerDisputeGas,
                normalHCircuitProofGas,
                hardcodedAesGateGas,
                hardcodedShaGateGas,
                hardcodedFinalGateGas,
                bestHardcodedSaving: normalHCircuitProofGas - minBigInt(hardcodedGateGases),
                worstHardcodedSaving: normalHCircuitProofGas - maxBigInt(hardcodedGateGases),
            });
        }

        const serialized = rows.map(serializeLargeCircuitGas);
        console.table(serialized);
        console.log(`PHASE3_LARGE_FILE_EQUIV_GAS_JSON=${JSON.stringify(serialized)}`);

        expect(rows[0].proofDepth).to.equal(25);
        expect(rows[1].proofDepth).to.equal(26);
        expect(rows[1].worstHardcodedSaving).to.be.greaterThan(0n);
    });
});
