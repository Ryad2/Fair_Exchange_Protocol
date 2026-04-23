import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";
import { expect } from "chai";
import hre from "hardhat";
import "@nomicfoundation/hardhat-chai-matchers";

const { ethers } = hre;

const DISPUTE_FEES = 10n;
const SPONSOR_FEES = 5n;

function encodeSon(value: bigint): Uint8Array {
    const limit = 1n << 48n;
    let encoded = value;
    if (encoded < 0n) {
        encoded = limit + encoded;
    }
    const out = new Uint8Array(6);
    for (let i = 5; i >= 0; i--) {
        out[i] = Number(encoded & 0xffn);
        encoded >>= 8n;
    }
    return out;
}

function writeSon(gate: Uint8Array, offset: number, value: bigint) {
    gate.set(encodeSon(value), offset);
}

function writeUint64(target: Uint8Array, offset: number, value: bigint) {
    for (let i = 7; i >= 0; i--) {
        target[offset + i] = Number(value & 0xffn);
        value >>= 8n;
    }
}

function toBytes32Word(bytes: Uint8Array, offset: number): Uint8Array {
    return bytes.slice(offset, offset + 32);
}

function expectedGateCount(plaintextLength: bigint): bigint {
    const numBlocks = (plaintextLength + 63n) / 64n;
    return plaintextLength % 64n > 55n ? numBlocks * 2n + 8n : numBlocks * 2n + 5n;
}

function aesGate(gateNum: bigint, plaintextLength: bigint, ivHex: string): Uint8Array {
    const gate = new Uint8Array(64);
    gate[0] = 0x01;
    writeSon(gate, 1, -gateNum);

    const iv = BigInt(ivHex);
    const counter = iv + (gateNum - 1n) * 4n;
    const counterBytes = ethers.getBytes(ethers.toBeHex(counter, 16));
    gate.set(counterBytes, 7);

    const consumed = (gateNum - 1n) * 64n;
    const remaining = plaintextLength - consumed;
    const blockBytes = remaining > 64n ? 64n : remaining;
    const lenBits = blockBytes * 8n;
    gate[23] = Number((lenBits >> 8n) & 0xffn);
    gate[24] = Number(lenBits & 0xffn);
    return gate;
}

function constGate0(word: Uint8Array): Uint8Array {
    const gate = new Uint8Array(64);
    gate[0] = 0x03;
    gate.set(word, 1);
    return gate;
}

function constGate1(son: bigint, word: Uint8Array): Uint8Array {
    const gate = new Uint8Array(64);
    gate[0] = 0x03;
    writeSon(gate, 1, son);
    gate.set(word, 7);
    return gate;
}

function binaryGate(opcode: number, son1: bigint, son2: bigint): Uint8Array {
    const gate = new Uint8Array(64);
    gate[0] = opcode;
    writeSon(gate, 1, son1);
    writeSon(gate, 7, son2);
    return gate;
}

function unaryGate(opcode: number, son: bigint): Uint8Array {
    const gate = new Uint8Array(64);
    gate[0] = opcode;
    writeSon(gate, 1, son);
    return gate;
}

function paddingMaskWords(plaintextLength: bigint): [Uint8Array, Uint8Array] {
    const block = new Uint8Array(64);
    const rem = Number(plaintextLength % 64n);
    block[rem] = 0x80;
    if (rem <= 55) {
        writeUint64(block, 56, plaintextLength * 8n);
    }
    return [toBytes32Word(block, 0), toBytes32Word(block, 32)];
}

describe("Phase 3 variants", () => {
    async function deployOptimisticWithMockDeployer(options?: {
        sponsorValue?: bigint;
        numBlocks?: bigint;
        numGates?: bigint;
        sponsorSigner?: any;
    }) {
        const [sponsor, buyer, vendor, other] = await ethers.getSigners();
        const sponsorSigner = options?.sponsorSigner ?? sponsor;
        const sponsorValue = options?.sponsorValue ?? ethers.parseEther("1");
        const numBlocks = options?.numBlocks ?? 1n;
        const numGates = options?.numGates ?? 7n;

        const mockDeployerFactory = await ethers.getContractFactory("MockDisputeDeployer");
        const mockDeployer = await mockDeployerFactory.connect(sponsorSigner).deploy();
        await mockDeployer.waitForDeployment();

        const entryPointFactory = await ethers.getContractFactory("MockEntryPoint");
        const entryPoint = await entryPointFactory.connect(other).deploy();
        await entryPoint.waitForDeployment();

        const accountFactory = await ethers.getContractFactory("OptimisticSOXAccount", {
            libraries: {
                DisputeDeployer: await mockDeployer.getAddress(),
            },
        });

        const agreedPrice = 100n;
        const completionTip = 5n;
        const disputeTip = 3n;
        const timeoutIncrement = 60n;

        const account = await accountFactory.connect(sponsorSigner).deploy(
            await entryPoint.getAddress(),
            await vendor.getAddress(),
            await buyer.getAddress(),
            agreedPrice,
            completionTip,
            disputeTip,
            timeoutIncrement,
            ethers.ZeroHash,
            numBlocks,
            numGates,
            await vendor.getAddress(),
            { value: sponsorValue }
        );
        await account.waitForDeployment();

        return {
            account,
            entryPoint,
            sponsor: sponsorSigner,
            buyer,
            vendor,
            other,
            agreedPrice,
            completionTip,
            disputeTip,
            timeoutIncrement,
        };
    }

    it("supports the no_S_deposit optimistic variant", async () => {
        const { account, sponsor } = await deployOptimisticWithMockDeployer({ sponsorValue: 0n });

        expect(await account.noSponsorDeposit()).to.equal(true);
        expect(await account.preContractVariant()).to.equal(1n);
        expect(await account.sponsorDeposit()).to.equal(0n);
        expect(await ethers.provider.getBalance(await account.getAddress())).to.equal(0n);
        await expect(
            account.connect(sponsor).depositToEntryPoint({ value: 1n })
        ).to.be.revertedWith("Sponsoring disabled");
    });

    it("fuses Step 1 and Step 2 when S=B", async () => {
        const [, buyer] = await ethers.getSigners();
        const { account, vendor, agreedPrice, completionTip } =
            await deployOptimisticWithMockDeployer({
                sponsorSigner: buyer,
                sponsorValue: SPONSOR_FEES + 100n + 5n,
            });

        expect(await account.sponsor()).to.equal(await buyer.getAddress());
        expect(await account.sponsorIsBuyer()).to.equal(true);
        expect(await account.preContractVariant()).to.equal(2n);
        expect(await account.currState()).to.equal(1n);
        expect(await account.buyerDeposit()).to.equal(agreedPrice + completionTip);
        expect(await account.sponsorDeposit()).to.equal(SPONSOR_FEES);

        const descriptionHash = ethers.sha256(ethers.toUtf8Bytes("phase3-sb"));
        const iv = "0x0102030405060708090a0b0c0d0e0f10";
        await account
            .connect(buyer)
            .configureHardcodedSha256Circuit(descriptionHash, 13n, iv);
        expect(await account.hardcodedSha256Circuit()).to.equal(true);

        await account.connect(vendor).sendKey("0x" + "11".repeat(16));
        expect(await account.currState()).to.equal(2n);
    });

    it("identifies the pre-contract S=V variant", async () => {
        const [, , vendor] = await ethers.getSigners();
        const { account, buyer, agreedPrice, completionTip } =
            await deployOptimisticWithMockDeployer({
                sponsorSigner: vendor,
                sponsorValue: SPONSOR_FEES,
            });

        expect(await account.sponsor()).to.equal(await vendor.getAddress());
        expect(await account.sponsorIsVendor()).to.equal(true);
        expect(await account.preContractVariant()).to.equal(3n);
        expect(await account.currState()).to.equal(0n);

        await account.connect(buyer).sendPayment({ value: agreedPrice + completionTip });
        expect(await account.currState()).to.equal(1n);
    });

    it("keeps the normal sponsor deposit guard for non-zero underfunded deployments", async () => {
        await expect(
            deployOptimisticWithMockDeployer({ sponsorValue: 4n })
        ).to.be.revertedWith("Not enough money to cover fees");
    });

    it("combines no_S_deposit with SB=B", async () => {
        const { account, buyer, vendor, agreedPrice, completionTip, disputeTip } =
            await deployOptimisticWithMockDeployer({ sponsorValue: 0n });

        await account.connect(buyer).sendPayment({ value: agreedPrice });
        await account.connect(vendor).sendKey("0x" + "11".repeat(16));
        await account
            .connect(buyer)
            .sendBuyerSelfDisputeSponsorFee({ value: DISPUTE_FEES + disputeTip });

        expect(await account.noSponsorDeposit()).to.equal(true);
        expect(await account.buyerDisputeSponsor()).to.equal(await buyer.getAddress());
        expect(await account.currState()).to.equal(3n);
    });

    it("requires a buyer authorization when an external SB fuses Step 4 and Step 5", async () => {
        const { account, buyer, vendor, other, agreedPrice, completionTip, disputeTip } =
            await loadFixture(deployOptimisticWithMockDeployer);

        await account.connect(buyer).sendPayment({ value: agreedPrice + completionTip });
        await account.connect(vendor).sendKey("0x" + "11".repeat(16));

        await expect(
            account.connect(other).sendBuyerDisputeSponsorFee({
                value: DISPUTE_FEES + disputeTip,
            })
        ).to.be.revertedWith("Unexpected sender");

        const authHash = await account.buyerUnhappyAuthorizationHash(await other.getAddress());
        const authorization = await buyer.signMessage(ethers.getBytes(authHash));

        await expect(
            account
                .connect(other)
                .sendBuyerDisputeSponsorFeeWithAuthorization(authorization, {
                    value: DISPUTE_FEES + disputeTip,
                })
        )
            .to.emit(account, "BuyerDisputeSponsoredWithAuthorization")
            .withArgs(await buyer.getAddress(), await other.getAddress(), DISPUTE_FEES + disputeTip);

        expect(await account.buyerDisputeSponsor()).to.equal(await other.getAddress());
        expect(await account.currState()).to.equal(3n);
    });

    it("models SB=B and SV=V with explicit self-sponsor entry points", async () => {
        const { account, buyer, vendor, agreedPrice, completionTip, disputeTip } =
            await loadFixture(deployOptimisticWithMockDeployer);

        await account.connect(buyer).sendPayment({ value: agreedPrice + completionTip });
        await account.connect(vendor).sendKey("0x" + "11".repeat(16));

        await account
            .connect(buyer)
            .sendBuyerSelfDisputeSponsorFee({ value: DISPUTE_FEES + disputeTip });
        expect(await account.buyerDisputeSponsor()).to.equal(await buyer.getAddress());
        expect(await account.currState()).to.equal(3n);

        await account
            .connect(vendor)
            .sendVendorSelfDisputeSponsorFee({
                value: DISPUTE_FEES + disputeTip + agreedPrice,
            });
        expect(await account.vendorDisputeSponsor()).to.equal(await vendor.getAddress());
        expect(await account.currState()).to.equal(4n);
    });

    it("validates hard-coded SHA256 circuit metadata before payment", async () => {
        const plaintextLength = 13n;
        const numBlocks = 1n;
        const numGates = expectedGateCount(plaintextLength);
        const { account, vendor } = await deployOptimisticWithMockDeployer({
            numBlocks,
            numGates,
        });

        const descriptionHash = ethers.sha256(ethers.toUtf8Bytes("phase3"));
        const iv = "0x0102030405060708090a0b0c0d0e0f10";

        await expect(
            account
                .connect(vendor)
                .configureHardcodedSha256Circuit(descriptionHash, plaintextLength, iv)
        )
            .to.emit(account, "HardcodedSha256CircuitConfigured")
            .withArgs(descriptionHash, plaintextLength, iv, numGates);

        expect(await account.hardcodedSha256Circuit()).to.equal(true);
        expect(await account.hardcodedDescriptionHash()).to.equal(descriptionHash);
        expect(await account.hardcodedPlaintextLength()).to.equal(plaintextLength);
        expect(await account.hardcodedCiphertextIv()).to.equal(iv);
    });

    it("propagates hard-coded SHA256 metadata to the dispute account", async () => {
        const [sponsor, buyer, vendor] = await ethers.getSigners();
        const plaintextLength = 13n;
        const numBlocks = 1n;
        const numGates = expectedGateCount(plaintextLength);
        const descriptionHash = ethers.sha256(ethers.toUtf8Bytes("phase3"));
        const iv = "0x0102030405060708090a0b0c0d0e0f10";

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

        const agreedPrice = 100n;
        const completionTip = 5n;
        const disputeTip = 3n;

        const account = await accountFactory.connect(sponsor).deploy(
            await entryPoint.getAddress(),
            await vendor.getAddress(),
            await buyer.getAddress(),
            agreedPrice,
            completionTip,
            disputeTip,
            60n,
            ethers.ZeroHash,
            numBlocks,
            numGates,
            await vendor.getAddress(),
            { value: 5n }
        );
        await account.waitForDeployment();

        await account
            .connect(vendor)
            .configureHardcodedSha256Circuit(descriptionHash, plaintextLength, iv);
        await account.connect(buyer).sendPayment({ value: agreedPrice + completionTip });
        await account.connect(vendor).sendKey("0x" + "11".repeat(16));
        await account
            .connect(buyer)
            .sendBuyerSelfDisputeSponsorFee({ value: DISPUTE_FEES + disputeTip });
        await account
            .connect(vendor)
            .sendVendorSelfDisputeSponsorFee({
                value: DISPUTE_FEES + disputeTip + agreedPrice,
            });

        const disputeAddress = await account.disputeContract();
        const dispute = await ethers.getContractAt("DisputeSOXAccount", disputeAddress);

        expect(await dispute.hardcodedSha256Circuit()).to.equal(true);
        expect(await dispute.hardcodedDescriptionHash()).to.equal(descriptionHash);
        expect(await dispute.hardcodedPlaintextLength()).to.equal(plaintextLength);
        expect(await dispute.hardcodedCiphertextIv()).to.equal(iv);

        const [, maskTail] = paddingMaskWords(plaintextLength);
        expect(await dispute.expectedHardcodedGateHash(1)).to.equal(
            ethers.keccak256(aesGate(1n, plaintextLength, iv))
        );
        expect(await dispute.expectedHardcodedGateHash(3)).to.equal(
            ethers.keccak256(constGate1(2n, maskTail))
        );
        expect(await dispute.expectedHardcodedGateHash(4)).to.equal(
            ethers.keccak256(binaryGate(0x04, 1n, 3n))
        );
        expect(await dispute.expectedHardcodedGateHash(5)).to.equal(
            ethers.keccak256(unaryGate(0x02, 4n))
        );
        expect(await dispute.expectedHardcodedGateHash(7)).to.equal(
            ethers.keccak256(binaryGate(0x05, 5n, 6n))
        );
    });
});
