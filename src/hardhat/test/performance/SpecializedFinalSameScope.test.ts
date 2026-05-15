import { expect } from "chai";
import hre from "hardhat";
import { parseEther } from "ethers";

const { ethers } = hre;

const FILE_SIZE_4_MIB = 4 * 1024 * 1024;
const FILE_SIZE_16_KIB = 16 * 1024;
const AGREED_PRICE = parseEther("1.0");
const COMPLETION_TIP = parseEther("0.1");
const DISPUTE_TIP = parseEther("0.12");
const SPONSOR_FEES = 5n;
const DISPUTE_FEES = 10n;
const TIMEOUT_INCREMENT = 3600n;
const KEY_BYTES = new Uint8Array([
    0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08,
    0x09, 0x0a, 0x0b, 0x0c, 0x0d, 0x0e, 0x0f, 0x10,
]);
const KEY_HEX = ethers.hexlify(KEY_BYTES);

type SharedContext = Awaited<ReturnType<typeof deploySharedContext>>;
type PreparedInput = ReturnType<typeof prepareInput>;

let wasmInitialized = false;
let bytes_to_hex: any;
let compute_precontract_values_v2: any;
let compute_proofs_v2: any;
let evaluate_circuit_v2_wasm: any;
let hpre_v2: any;
let initSync: any;

async function initWasmOnce() {
    if (wasmInitialized) {
        return;
    }
    const { join } = await import("node:path");
    const { pathToFileURL } = await import("node:url");
    const dynamicImport = new Function("specifier", "return import(specifier)");
    const cryptoLib = await dynamicImport(
        pathToFileURL(join(__dirname, "../../../app/lib/crypto_lib/crypto_lib.js")).href
    );
    bytes_to_hex = cryptoLib.bytes_to_hex;
    compute_precontract_values_v2 = cryptoLib.compute_precontract_values_v2;
    compute_proofs_v2 = cryptoLib.compute_proofs_v2;
    evaluate_circuit_v2_wasm = cryptoLib.evaluate_circuit_v2_wasm;
    hpre_v2 = cryptoLib.hpre_v2;
    initSync = cryptoLib.initSync;

    const { readFile } = await import("node:fs/promises");
    const wasmPath = join(__dirname, "../../../app/lib/crypto_lib/crypto_lib_bg.wasm");
    const wasmBytes = await readFile(wasmPath);
    initSync({ module: wasmBytes });
    wasmInitialized = true;
}

function makeFile(length: number) {
    const file = new Uint8Array(length);
    for (let i = 0; i < file.length; i++) {
        file[i] = (i + 1) % 256;
    }
    return file;
}

function prepareInput(fileLength: number) {
    const file = makeFile(fileLength);
    const precontract = compute_precontract_values_v2(file, KEY_BYTES);
    const evaluatedBytes = evaluate_circuit_v2_wasm(
        precontract.circuit_bytes,
        precontract.ct,
        bytes_to_hex(KEY_BYTES)
    ).to_bytes();

    return {
        fileLength,
        precontract,
        evaluatedBytes,
        descriptionHash: hexlifyBytes(precontract.description),
        commitment: hexlifyBytes(precontract.commitment.c),
        opening: hexlifyBytes(precontract.commitment.o),
        ciphertextIv: hexlifyBytes(precontract.ct.slice(0, 16)),
    };
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

async function gasOf(txPromise: Promise<any>) {
    const tx = await txPromise;
    const receipt = await tx.wait();
    if (!receipt) {
        throw new Error("Missing transaction receipt");
    }
    return receipt.gasUsed as bigint;
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

    const DisputeDeployerNormalFactory = await ethers.getContractFactory(
        "DisputeDeployerNormal",
        {
            libraries: {
                AccumulatorVerifier: await accumulatorVerifier.getAddress(),
                CommitmentOpener: await commitmentOpener.getAddress(),
                SHA256Evaluator: await sha256Evaluator.getAddress(),
            },
        }
    );
    const disputeDeployerNormal = await DisputeDeployerNormalFactory.deploy();
    await disputeDeployerNormal.waitForDeployment();

    const DisputeDeployerSelfSponsoredFactory = await ethers.getContractFactory(
        "DisputeDeployerSelfSponsored",
        {
            libraries: {
                AccumulatorVerifier: await accumulatorVerifier.getAddress(),
                CommitmentOpener: await commitmentOpener.getAddress(),
                SHA256Evaluator: await sha256Evaluator.getAddress(),
            },
        }
    );
    const disputeDeployerSelfSponsored = await DisputeDeployerSelfSponsoredFactory.deploy();
    await disputeDeployerSelfSponsored.waitForDeployment();

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

    const cloneLibraries = {
        DisputeDeployerNormal: await disputeDeployerNormal.getAddress(),
        DisputeDeployerSelfSponsored: await disputeDeployerSelfSponsored.getAddress(),
    };

    async function deployCloneImplementation(name: string) {
        const implementationFactory = await ethers.getContractFactory(name, {
            libraries: cloneLibraries,
        });
        const implementation = await implementationFactory.deploy();
        await implementation.waitForDeployment();
        return implementation;
    }

    const normalImpl = await deployCloneImplementation("OptimisticSOXCloneNormal");
    const noSImpl = await deployCloneImplementation("OptimisticSOXCloneNoSDeposit");
    const sbImpl = await deployCloneImplementation("OptimisticSOXCloneSponsorIsBuyer");
    const svImpl = await deployCloneImplementation("OptimisticSOXCloneSponsorIsVendor");

    const SOXFactoryFactory = await ethers.getContractFactory("SOXFactory");
    const soxFactory = await SOXFactoryFactory.deploy(
        await normalImpl.getAddress(),
        await noSImpl.getAddress(),
        await sbImpl.getAddress(),
        await svImpl.getAddress()
    );
    await soxFactory.waitForDeployment();

    return {
        sponsor,
        buyer,
        vendor,
        buyerDisputeSponsor,
        vendorDisputeSponsor,
        entryPoint,
        soxFactory,
        hardcodedSha256CircuitLib,
        disputeDeployerHardcodedSHA256,
    };
}

function initArgs(shared: SharedContext, input: PreparedInput) {
    return {
        entryPoint: shared.entryPoint.target,
        vendor: shared.vendor.address,
        buyer: shared.buyer.address,
        agreedPrice: AGREED_PRICE,
        completionTip: COMPLETION_TIP,
        disputeTip: DISPUTE_TIP,
        timeoutIncrement: TIMEOUT_INCREMENT,
        commitment: input.commitment,
        numBlocks: BigInt(input.precontract.num_blocks),
        numGates: BigInt(input.precontract.num_gates),
        vendorSigner: shared.vendor.address,
    };
}

async function createNormalClone(shared: SharedContext, input: PreparedInput) {
    const args = initArgs(shared, input);
    const cloneAddress = await shared.soxFactory
        .connect(shared.sponsor)
        .createNormal.staticCall(args, { value: SPONSOR_FEES });
    const createGas = await gasOf(
        shared.soxFactory.connect(shared.sponsor).createNormal(args, {
            value: SPONSOR_FEES,
        })
    );
    const account = await ethers.getContractAt("OptimisticSOXCloneNormal", cloneAddress);
    return { account, createGas };
}

async function deployHardcodedDirect(shared: SharedContext, input: PreparedInput) {
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
    const account = await OptimisticFactory.connect(shared.sponsor).deploy(
        await shared.entryPoint.getAddress(),
        await shared.vendor.getAddress(),
        await shared.buyer.getAddress(),
        AGREED_PRICE,
        COMPLETION_TIP,
        DISPUTE_TIP,
        TIMEOUT_INCREMENT,
        input.commitment,
        BigInt(input.precontract.num_blocks),
        BigInt(input.precontract.num_gates),
        await shared.vendor.getAddress(),
        input.descriptionHash,
        BigInt(input.fileLength),
        input.ciphertextIv,
        { value: SPONSOR_FEES }
    );
    await account.waitForDeployment();

    const receipt = await account.deploymentTransaction()?.wait();
    if (!receipt) {
        throw new Error("Missing hardcoded deployment receipt");
    }

    return { account, createGas: receipt.gasUsed as bigint };
}

async function startDispute(
    account: any,
    shared: SharedContext,
    selfSponsored: boolean
) {
    const paymentGas = await gasOf(
        account.connect(shared.buyer).sendPayment({
            value: AGREED_PRICE + COMPLETION_TIP,
        })
    );
    const keyGas = await gasOf(account.connect(shared.vendor).sendKey(KEY_HEX));

    let buyerSponsorGas: bigint;
    if (selfSponsored) {
        buyerSponsorGas = await gasOf(
            account.connect(shared.buyer).sendBuyerSelfDisputeSponsorFee({
                value: DISPUTE_FEES + DISPUTE_TIP,
            })
        );
    } else {
        const authHash = await account.buyerUnhappyAuthorizationHash(
            await shared.buyerDisputeSponsor.getAddress()
        );
        const authSignature = await shared.buyer.signMessage(ethers.getBytes(authHash));
        buyerSponsorGas = await gasOf(
            account
                .connect(shared.buyerDisputeSponsor)
                .sendBuyerDisputeSponsorFeeWithAuthorization(authSignature, {
                    value: DISPUTE_FEES + DISPUTE_TIP,
                })
        );
    }

    const triggerDisputeGas = await gasOf(
        selfSponsored
            ? account.connect(shared.vendor).sendVendorSelfDisputeSponsorFee({
                  value: DISPUTE_FEES + DISPUTE_TIP + AGREED_PRICE,
              })
            : account.connect(shared.vendorDisputeSponsor).sendVendorDisputeSponsorFee({
                  value: DISPUTE_FEES + DISPUTE_TIP + AGREED_PRICE,
              })
    );

    return {
        paymentGas,
        keyGas,
        buyerSponsorGas,
        triggerDisputeGas,
    };
}

async function signerForDisputeAddress(shared: SharedContext, address: string) {
    const actors = [
        shared.buyer,
        shared.vendor,
        shared.buyerDisputeSponsor,
        shared.vendorDisputeSponsor,
    ];
    const normalized = address.toLowerCase();
    for (const actor of actors) {
        if ((await actor.getAddress()).toLowerCase() === normalized) {
            return actor;
        }
    }
    throw new Error(`No signer available for dispute address ${address}`);
}

async function advanceWithSyntheticHpre(dispute: any, shared: SharedContext) {
    let respondGas = 0n;
    let opinionGas = 0n;
    let rounds = 0;
    let state = Number(await dispute.currState());

    while (state === 0 && rounds < 32) {
        const buyerActor = await signerForDisputeAddress(shared, await dispute.buyer());
        const vendorActor = await signerForDisputeAddress(shared, await dispute.vendor());
        respondGas += await gasOf(
            dispute.connect(buyerActor).respondChallenge(ethers.ZeroHash)
        );
        opinionGas += await gasOf(dispute.connect(vendorActor).giveOpinion(rounds !== 0));
        rounds++;
        state = Number(await dispute.currState());
    }

    expect(state).to.equal(2);
    return { respondGas, opinionGas, rounds };
}

async function advanceWithRealHpre(dispute: any, shared: SharedContext, input: PreparedInput) {
    let totalGas = 0n;
    let firstRoundGas = 0n;
    let rounds = 0;
    let state = Number(await dispute.currState());

    while (state === 0 && rounds < 64) {
        const challenge = Number(await dispute.chall());
        const hpre = hpre_v2(input.evaluatedBytes, input.precontract.num_blocks, challenge);
        const respondGas = await gasOf(
            dispute.connect(shared.buyer).respondChallenge(hexlifyBytes(hpre))
        );
        const opinionGas = await gasOf(
            dispute.connect(shared.vendor).giveOpinion(rounds !== 0)
        );
        const roundGas = respondGas + opinionGas;
        if (rounds === 0) {
            firstRoundGas = roundGas;
        }
        totalGas += roundGas;
        rounds++;
        state = Number(await dispute.currState());
    }

    expect(state).to.equal(2);
    return {
        challengeRoundFirst: firstRoundGas,
        challengeRoundAverage: totalGas / BigInt(Math.max(rounds, 1)),
        challengeRoundsToState2: rounds,
    };
}

async function submitMiddleGate(
    dispute: any,
    shared: SharedContext,
    input: PreparedInput,
    hardcoded: boolean
) {
    const gateNum = Number(await dispute.a());
    const proofs = compute_proofs_v2(
        input.precontract.circuit_bytes,
        input.evaluatedBytes,
        input.precontract.ct,
        gateNum
    );
    const vendorActor = await signerForDisputeAddress(shared, await dispute.vendor());
    const submitGas = await gasOf(
        dispute.connect(vendorActor).submitCommitment(
            input.opening,
            gateNum,
            hardcoded ? "0x" : hexlifyBytes(proofs.gate_bytes),
            bytesArrayToHex(proofs.values),
            hexlifyBytes(proofs.curr_acc),
            hardcoded ? [] : proofToHex(proofs.proof1),
            proofToHex(proofs.proof2),
            proofToHex(proofs.proof3),
            proofToHex(proofs.proof_ext)
        )
    );

    return {
        submitGas,
        gateType: opcodeName(proofs.gate_bytes[0]),
        proof1Items: hardcoded
            ? 0
            : proofToHex(proofs.proof1).reduce((sum, level) => sum + level.length, 0),
    };
}

async function measureFullDispute16KiB(
    scenario: {
        label: string;
        hardcoded: boolean;
        selfSponsored: boolean;
    }
) {
    const shared = await deploySharedContext();
    const input = prepareInput(FILE_SIZE_16_KIB);
    const deployed = scenario.hardcoded
        ? await deployHardcodedDirect(shared, input)
        : await createNormalClone(shared, input);
    const start = await startDispute(deployed.account, shared, scenario.selfSponsored);

    const disputeAddress = await deployed.account.disputeContract();
    const dispute = await ethers.getContractAt(
        scenario.hardcoded
            ? "DisputeSOXAccountHardcodedSHA256"
            : scenario.selfSponsored
              ? "DisputeSOXAccountSelfSponsored"
              : "DisputeSOXAccountNormal",
        disputeAddress
    );

    let respondChallenge = 0n;
    let giveOpinion = 0n;
    let submitCommitment = 0n;
    let finalize = 0n;
    let step8Submissions = 0;
    let challengeRestarts = 0;

    for (let cycle = 0; cycle < 4; cycle++) {
        const state = Number(await dispute.currState());
        if (state === 0) {
            challengeRestarts++;
            const advanced = await advanceWithSyntheticHpre(dispute, shared);
            respondChallenge += advanced.respondGas;
            giveOpinion += advanced.opinionGas;
            const submitted = await submitMiddleGate(
                dispute,
                shared,
                input,
                scenario.hardcoded
            );
            submitCommitment += submitted.submitGas;
            step8Submissions++;
            continue;
        }

        if (state === 5) {
            const buyerActor = await signerForDisputeAddress(shared, await dispute.buyer());
            finalize = await gasOf(dispute.connect(buyerActor).completeDispute());
            break;
        }

        if (state === 6) {
            const vendorActor = await signerForDisputeAddress(shared, await dispute.vendor());
            finalize = await gasOf(dispute.connect(vendorActor).cancelDispute());
            break;
        }

        if (state === 7) {
            break;
        }

        throw new Error(`Unexpected dispute state: ${state}`);
    }

    expect(await dispute.currState()).to.equal(7n);

    const total =
        deployed.createGas +
        start.paymentGas +
        start.keyGas +
        start.buyerSponsorGas +
        start.triggerDisputeGas +
        respondChallenge +
        giveOpinion +
        submitCommitment +
        finalize;

    return {
        label: scenario.label,
        fileSizeBytes: FILE_SIZE_16_KIB,
        accountCreation: deployed.createGas.toString(),
        payment: start.paymentGas.toString(),
        key: start.keyGas.toString(),
        sbStep: start.buyerSponsorGas.toString(),
        triggerDispute: start.triggerDisputeGas.toString(),
        respondChallenge: respondChallenge.toString(),
        giveOpinion: giveOpinion.toString(),
        submitCommitment: submitCommitment.toString(),
        finalize: finalize.toString(),
        totalMeasured: total.toString(),
        challengeRestarts,
        step8Submissions,
    };
}

describe("Specialized final architecture measured in the same scopes", function () {
    this.timeout(20 * 60 * 1000);

    before(async function () {
        await initWasmOnce();
    });

    it("measures the 4 MiB Hana dispute scope with the optimized normal clone", async function () {
        const shared = await deploySharedContext();
        const input = prepareInput(FILE_SIZE_4_MIB);
        const deployed = await createNormalClone(shared, input);
        const start = await startDispute(deployed.account, shared, false);

        const disputeAddress = await deployed.account.disputeContract();
        const dispute = await ethers.getContractAt("DisputeSOXAccountNormal", disputeAddress);

        const challenge = await advanceWithRealHpre(dispute, shared, input);
        const submitted = await submitMiddleGate(dispute, shared, input, false);

        const exchangeAndDisputeTriggering =
            start.paymentGas + start.keyGas + start.buyerSponsorGas + start.triggerDisputeGas;
        const optimisticWithDisputeInitTotal = deployed.createGas + exchangeAndDisputeTriggering;

        const result = {
            fileSizeBytes: FILE_SIZE_4_MIB,
            numBlocks: input.precontract.num_blocks,
            numGates: input.precontract.num_gates,
            accountCreation: deployed.createGas.toString(),
            disputeDeployment: start.triggerDisputeGas.toString(),
            exchangeAndDisputeTriggering: exchangeAndDisputeTriggering.toString(),
            optimisticWithDisputeInitTotal: optimisticWithDisputeInitTotal.toString(),
            challengeRoundFirst: challenge.challengeRoundFirst.toString(),
            challengeRoundAverage: challenge.challengeRoundAverage.toString(),
            challengeRoundsToState2: challenge.challengeRoundsToState2,
            submitCommitment: submitted.submitGas.toString(),
            submitCommitmentGateType: submitted.gateType,
            proof1Items: submitted.proof1Items,
        };

        console.log(`SPECIALIZED_FINAL_4MIB_SAME_SCOPE_JSON=${JSON.stringify(result)}`);

        expect(start.triggerDisputeGas).to.be.greaterThan(0n);
        expect(submitted.submitGas).to.be.greaterThan(0n);
    });

    it("measures the 16 KiB four-variant dispute scope with the specialized final contracts", async function () {
        const scenarios = [
            {
                label: "specialized final normal external sponsors (16 KiB)",
                hardcoded: false,
                selfSponsored: false,
            },
            {
                label: "specialized final self-sponsored SB=B/SV=V (16 KiB)",
                hardcoded: false,
                selfSponsored: true,
            },
            {
                label: "specialized final hardcoded SHA256 external sponsors (16 KiB)",
                hardcoded: true,
                selfSponsored: false,
            },
            {
                label: "specialized final self-sponsored + hardcoded SHA256 (16 KiB)",
                hardcoded: true,
                selfSponsored: true,
            },
        ];

        const rows = [];
        for (const scenario of scenarios) {
            rows.push(await measureFullDispute16KiB(scenario));
        }

        console.table(rows);
        console.log(`SPECIALIZED_FINAL_16KIB_DISPUTE_JSON=${JSON.stringify(rows)}`);

        expect(BigInt(rows[1].totalMeasured)).to.be.lessThan(BigInt(rows[0].totalMeasured));
        expect(BigInt(rows[3].submitCommitment)).to.be.lessThan(
            BigInt(rows[2].submitCommitment)
        );
    });
});
