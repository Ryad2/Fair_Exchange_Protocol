import { expect } from "chai";
import hre from "hardhat";

const { ethers, artifacts } = hre;

const AGREED_PRICE = 100n;
const COMPLETION_TIP = 5n;
const DISPUTE_TIP = 3n;
const SPONSOR_FEES = 5n;
const DISPUTE_FEES = 10n;
const TIMEOUT_INCREMENT = 60n;
const KEY = "0x" + "11".repeat(16);
const HARDCODED_DESCRIPTION_HASH = ethers.keccak256(ethers.toUtf8Bytes("hardcoded-specialized"));
const HARDCODED_PLAINTEXT_LENGTH = 13n;
const HARDCODED_IV = "0x0102030405060708090a0b0c0d0e0f10";

type SharedContext = Awaited<ReturnType<typeof deploySharedContext>>;

async function gasOf(txPromise: Promise<any>) {
    const tx = await txPromise;
    const receipt = await tx.wait();
    if (!receipt) {
        throw new Error("Missing transaction receipt");
    }
    return receipt.gasUsed as bigint;
}

async function runtimeBytes(contractName: string) {
    const artifact = await artifacts.readArtifact(contractName);
    return (artifact.deployedBytecode.length - 2) / 2;
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

    const DisputeDeployerFactory = await ethers.getContractFactory("DisputeDeployer", {
        libraries: {
            AccumulatorVerifier: await accumulatorVerifier.getAddress(),
            CommitmentOpener: await commitmentOpener.getAddress(),
            SHA256Evaluator: await sha256Evaluator.getAddress(),
        },
    });
    const disputeDeployer = await DisputeDeployerFactory.deploy();
    await disputeDeployer.waitForDeployment();

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

    return {
        sponsor,
        buyer,
        vendor,
        buyerDisputeSponsor,
        vendorDisputeSponsor,
        entryPoint,
        disputeDeployer,
        disputeDeployerNormal,
        disputeDeployerSelfSponsored,
        disputeDeployerHardcodedSHA256,
        hardcodedSha256CircuitLib,
    };
}

async function deployOptimistic(
    contractName:
        | "OptimisticSOXAccount"
        | "OptimisticSOXAccountNormal"
        | "OptimisticSOXAccountPhase3NoHardcoded"
        | "OptimisticSOXAccountNoSDeposit"
        | "OptimisticSOXAccountSponsorIsBuyer"
        | "OptimisticSOXAccountSponsorIsVendor"
        | "OptimisticSOXAccountHardcodedSHA256",
    deployerSigner: any,
    sponsorValue: bigint,
    shared: SharedContext,
    hardcodedOptions?: {
        descriptionHash: string;
        plaintextLength: bigint;
        ciphertextIv: string;
    }
) {
    const needsSelfSponsoredDeployer =
        contractName === "OptimisticSOXAccountNoSDeposit" ||
        contractName === "OptimisticSOXAccountSponsorIsBuyer" ||
        contractName === "OptimisticSOXAccountSponsorIsVendor";

    const factory =
        contractName === "OptimisticSOXAccount"
            ? await ethers.getContractFactory(contractName, {
                  libraries: {
                      DisputeDeployer: await shared.disputeDeployer.getAddress(),
                  },
              })
            : contractName === "OptimisticSOXAccountHardcodedSHA256"
              ? await ethers.getContractFactory(contractName, {
                    libraries: {
                        DisputeDeployerHardcodedSHA256:
                            await shared.disputeDeployerHardcodedSHA256.getAddress(),
                        HardcodedSha256CircuitLib:
                            await shared.hardcodedSha256CircuitLib.getAddress(),
                    },
                })
              : await ethers.getContractFactory(contractName, {
                    libraries: needsSelfSponsoredDeployer
                        ? {
                              DisputeDeployerNormal:
                                  await shared.disputeDeployerNormal.getAddress(),
                              DisputeDeployerSelfSponsored:
                                  await shared.disputeDeployerSelfSponsored.getAddress(),
                          }
                        : {
                              DisputeDeployerNormal:
                                  await shared.disputeDeployerNormal.getAddress(),
                          },
              });

    const commonArgs = [
        await shared.entryPoint.getAddress(),
        await shared.vendor.getAddress(),
        await shared.buyer.getAddress(),
        AGREED_PRICE,
        COMPLETION_TIP,
        DISPUTE_TIP,
        TIMEOUT_INCREMENT,
        ethers.ZeroHash,
        1n,
        7n,
        await shared.vendor.getAddress(),
    ];
    const hardcodedArgs =
        contractName === "OptimisticSOXAccountHardcodedSHA256" && hardcodedOptions
            ? [
                  hardcodedOptions.descriptionHash,
                  hardcodedOptions.plaintextLength,
                  hardcodedOptions.ciphertextIv,
              ]
            : [];
    const account = await factory
        .connect(deployerSigner)
        .deploy(...commonArgs, ...hardcodedArgs, { value: sponsorValue });
    await account.waitForDeployment();

    const deploymentReceipt = await account.deploymentTransaction()?.wait();
    if (!deploymentReceipt) {
        throw new Error("Missing deployment receipt");
    }

    return {
        account,
        deployGas: deploymentReceipt.gasUsed as bigint,
    };
}

describe("Specialized contract architecture", function () {
    it("shrinks the normal path compared to the monolithic phase-3 contract", async function () {
        const shared = await deploySharedContext();

        const monolith = await deployOptimistic(
            "OptimisticSOXAccount",
            shared.sponsor,
            SPONSOR_FEES,
            shared
        );
        const normal = await deployOptimistic(
            "OptimisticSOXAccountNormal",
            shared.sponsor,
            SPONSOR_FEES,
            shared
        );

        const monolithPayment = await gasOf(
            monolith.account.connect(shared.buyer).sendPayment({
                value: AGREED_PRICE + COMPLETION_TIP,
            })
        );
        const normalPayment = await gasOf(
            normal.account.connect(shared.buyer).sendPayment({
                value: AGREED_PRICE + COMPLETION_TIP,
            })
        );

        const monolithKey = await gasOf(monolith.account.connect(shared.vendor).sendKey(KEY));
        const normalKey = await gasOf(normal.account.connect(shared.vendor).sendKey(KEY));

        const monolithSb = await gasOf(
            monolith.account.connect(shared.buyer).sendBuyerDisputeSponsorFee({
                value: DISPUTE_FEES + DISPUTE_TIP,
            })
        );
        const normalSb = await gasOf(
            normal.account.connect(shared.buyer).sendBuyerDisputeSponsorFee({
                value: DISPUTE_FEES + DISPUTE_TIP,
            })
        );

        const monolithSv = await gasOf(
            monolith.account
                .connect(shared.vendorDisputeSponsor)
                .sendVendorDisputeSponsorFee({
                    value: DISPUTE_FEES + DISPUTE_TIP + AGREED_PRICE,
                })
        );
        const normalSv = await gasOf(
            normal.account
                .connect(shared.vendorDisputeSponsor)
                .sendVendorDisputeSponsorFee({
                    value: DISPUTE_FEES + DISPUTE_TIP + AGREED_PRICE,
                })
        );

        const monolithTotal =
            monolith.deployGas + monolithPayment + monolithKey + monolithSb + monolithSv;
        const normalTotal =
            normal.deployGas + normalPayment + normalKey + normalSb + normalSv;

        const monolithBytes = await runtimeBytes("OptimisticSOXAccount");
        const normalBytes = await runtimeBytes("OptimisticSOXAccountNormal");
        const monolithDisputeBytes = await runtimeBytes("DisputeSOXAccount");
        const normalDisputeBytes = await runtimeBytes("DisputeSOXAccountNormal");

        console.log("normal path bytecode", {
            optimisticMonolith: monolithBytes,
            optimisticNormal: normalBytes,
            disputeMonolith: monolithDisputeBytes,
            disputeNormal: normalDisputeBytes,
        });
        console.log("normal path gas", {
            deployMonolith: monolith.deployGas.toString(),
            deployNormal: normal.deployGas.toString(),
            totalMonolith: monolithTotal.toString(),
            totalNormal: normalTotal.toString(),
        });

        expect(normal.deployGas).to.be.lessThan(monolith.deployGas);
        expect(normalSv).to.be.lessThan(monolithSv);
        expect(normalTotal).to.be.lessThan(monolithTotal);
    });

    it("removes the hardcoded-circuit bytecode tax from non-hardcoded phase-3 variants", async function () {
        const shared = await deploySharedContext();

        const monolithNoS = await deployOptimistic(
            "OptimisticSOXAccount",
            shared.sponsor,
            0n,
            shared
        );
        const leanNoS = await deployOptimistic(
            "OptimisticSOXAccountPhase3NoHardcoded",
            shared.sponsor,
            0n,
            shared
        );

        const noSPaymentMonolith = await gasOf(
            monolithNoS.account.connect(shared.buyer).sendPayment({ value: AGREED_PRICE })
        );
        const noSPaymentLean = await gasOf(
            leanNoS.account.connect(shared.buyer).sendPayment({ value: AGREED_PRICE })
        );
        const noSKeyMonolith = await gasOf(monolithNoS.account.connect(shared.vendor).sendKey(KEY));
        const noSKeyLean = await gasOf(leanNoS.account.connect(shared.vendor).sendKey(KEY));

        const monolithSb = await gasOf(
            monolithNoS.account.connect(shared.buyer).sendBuyerSelfDisputeSponsorFee({
                value: DISPUTE_FEES + DISPUTE_TIP,
            })
        );
        const leanSb = await gasOf(
            leanNoS.account.connect(shared.buyer).sendBuyerSelfDisputeSponsorFee({
                value: DISPUTE_FEES + DISPUTE_TIP,
            })
        );

        const monolithSvs = await gasOf(
            monolithNoS.account.connect(shared.vendor).sendVendorSelfDisputeSponsorFee({
                value: DISPUTE_FEES + DISPUTE_TIP + AGREED_PRICE,
            })
        );
        const leanSvs = await gasOf(
            leanNoS.account.connect(shared.vendor).sendVendorSelfDisputeSponsorFee({
                value: DISPUTE_FEES + DISPUTE_TIP + AGREED_PRICE,
            })
        );

        const sbMonolith = await deployOptimistic(
            "OptimisticSOXAccount",
            shared.buyer,
            AGREED_PRICE + COMPLETION_TIP + SPONSOR_FEES,
            shared
        );
        const sbLean = await deployOptimistic(
            "OptimisticSOXAccountPhase3NoHardcoded",
            shared.buyer,
            AGREED_PRICE + COMPLETION_TIP + SPONSOR_FEES,
            shared
        );

        const sbKeyMonolith = await gasOf(sbMonolith.account.connect(shared.vendor).sendKey(KEY));
        const sbKeyLean = await gasOf(sbLean.account.connect(shared.vendor).sendKey(KEY));

        const phase3NoHardcodedBytes = await runtimeBytes("OptimisticSOXAccountPhase3NoHardcoded");
        const monolithBytes = await runtimeBytes("OptimisticSOXAccount");

        console.log("phase3 non-hardcoded gas", {
            runtimeMonolith: monolithBytes,
            runtimePhase3NoHardcoded: phase3NoHardcodedBytes,
            deployNoSMonolith: monolithNoS.deployGas.toString(),
            deployNoSLean: leanNoS.deployGas.toString(),
            deploySBMonolith: sbMonolith.deployGas.toString(),
            deploySBLean: sbLean.deployGas.toString(),
            triggerNoSMonolith: monolithSvs.toString(),
            triggerNoSLean: leanSvs.toString(),
        });

        expect(leanNoS.deployGas).to.be.lessThan(monolithNoS.deployGas);
        expect(leanSvs).to.be.lessThan(monolithSvs);
        expect(sbLean.deployGas).to.be.lessThan(sbMonolith.deployGas);

        // The execution delta should stay modest; the main win should come from the bytecode tax.
        expect(noSPaymentLean).to.be.at.most(noSPaymentMonolith + 5_000n);
        expect(noSKeyLean).to.be.at.most(noSKeyMonolith + 5_000n);
        expect(leanSb).to.be.at.most(monolithSb + 5_000n);
        expect(sbKeyLean).to.be.at.most(sbKeyMonolith + 5_000n);
    });

    it("splits phase-3 non-hardcoded modes into direct lean contracts", async function () {
        const shared = await deploySharedContext();

        const noSGeneric = await deployOptimistic(
            "OptimisticSOXAccountPhase3NoHardcoded",
            shared.sponsor,
            0n,
            shared
        );
        const noSLean = await deployOptimistic(
            "OptimisticSOXAccountNoSDeposit",
            shared.sponsor,
            0n,
            shared
        );

        const sbGeneric = await deployOptimistic(
            "OptimisticSOXAccountPhase3NoHardcoded",
            shared.buyer,
            AGREED_PRICE + COMPLETION_TIP + SPONSOR_FEES,
            shared
        );
        const sbLean = await deployOptimistic(
            "OptimisticSOXAccountSponsorIsBuyer",
            shared.buyer,
            AGREED_PRICE + COMPLETION_TIP + SPONSOR_FEES,
            shared
        );

        const svGeneric = await deployOptimistic(
            "OptimisticSOXAccountPhase3NoHardcoded",
            shared.vendor,
            SPONSOR_FEES,
            shared
        );
        const svLean = await deployOptimistic(
            "OptimisticSOXAccountSponsorIsVendor",
            shared.vendor,
            SPONSOR_FEES,
            shared
        );

        const noSPayment = await gasOf(
            noSLean.account.connect(shared.buyer).sendPayment({ value: AGREED_PRICE })
        );
        const noSKey = await gasOf(noSLean.account.connect(shared.vendor).sendKey(KEY));
        const noSComplete = await gasOf(
            noSLean.account.connect(shared.buyer).completeTransaction()
        );
        const sbKey = await gasOf(sbLean.account.connect(shared.vendor).sendKey(KEY));
        const sbComplete = await gasOf(
            sbLean.account.connect(shared.buyer).completeTransaction()
        );
        const svPayment = await gasOf(
            svLean.account.connect(shared.buyer).sendPayment({
                value: AGREED_PRICE + COMPLETION_TIP,
            })
        );
        const svKey = await gasOf(svLean.account.connect(shared.vendor).sendKey(KEY));
        const svComplete = await gasOf(
            svLean.account.connect(shared.buyer).completeTransaction()
        );

        const noSDispute = await deployOptimistic(
            "OptimisticSOXAccountNoSDeposit",
            shared.sponsor,
            0n,
            shared
        );
        await gasOf(noSDispute.account.connect(shared.buyer).sendPayment({ value: AGREED_PRICE }));
        await gasOf(noSDispute.account.connect(shared.vendor).sendKey(KEY));
        const authorization = await shared.buyer.signMessage(
            ethers.getBytes(
                await noSDispute.account.buyerUnhappyAuthorizationHash(
                    await shared.buyerDisputeSponsor.getAddress()
                )
            )
        );
        await gasOf(
            noSDispute.account
                .connect(shared.buyerDisputeSponsor)
                .sendBuyerDisputeSponsorFeeWithAuthorization(authorization, {
                    value: DISPUTE_FEES + DISPUTE_TIP,
                })
        );
        await gasOf(
            noSDispute.account
                .connect(shared.vendorDisputeSponsor)
                .sendVendorDisputeSponsorFee({
                    value: DISPUTE_FEES + DISPUTE_TIP + AGREED_PRICE,
                })
        );
        expect(await noSDispute.account.disputeContract()).to.not.equal(ethers.ZeroAddress);

        expect(await noSLean.account.noSponsorDeposit()).to.equal(true);
        expect(await sbLean.account.sponsorIsBuyer()).to.equal(true);
        expect(await svLean.account.sponsorIsVendor()).to.equal(true);

        console.log("phase3 direct split bytecode", {
            generic: await runtimeBytes("OptimisticSOXAccountPhase3NoHardcoded"),
            noSDeposit: await runtimeBytes("OptimisticSOXAccountNoSDeposit"),
            sponsorIsBuyer: await runtimeBytes("OptimisticSOXAccountSponsorIsBuyer"),
            sponsorIsVendor: await runtimeBytes("OptimisticSOXAccountSponsorIsVendor"),
        });
        console.log("phase3 direct split gas", {
            deployNoSGeneric: noSGeneric.deployGas.toString(),
            deployNoSLean: noSLean.deployGas.toString(),
            deploySBGeneric: sbGeneric.deployGas.toString(),
            deploySBLean: sbLean.deployGas.toString(),
            deploySVGeneric: svGeneric.deployGas.toString(),
            deploySVLean: svLean.deployGas.toString(),
            noSPayment: noSPayment.toString(),
            noSKey: noSKey.toString(),
            noSComplete: noSComplete.toString(),
            sbKey: sbKey.toString(),
            sbComplete: sbComplete.toString(),
            svPayment: svPayment.toString(),
            svKey: svKey.toString(),
            svComplete: svComplete.toString(),
        });

        expect(noSLean.deployGas).to.be.lessThan(noSGeneric.deployGas);
        expect(sbLean.deployGas).to.be.lessThan(sbGeneric.deployGas);
        expect(svLean.deployGas).to.be.lessThan(svGeneric.deployGas);
    });

    it("uses minimal clones for exact optimistic modes", async function () {
        const shared = await deploySharedContext();
        const libraries = {
            DisputeDeployerNormal: await shared.disputeDeployerNormal.getAddress(),
            DisputeDeployerSelfSponsored:
                await shared.disputeDeployerSelfSponsored.getAddress(),
        };

        const directNoS = await deployOptimistic(
            "OptimisticSOXAccountNoSDeposit",
            shared.sponsor,
            0n,
            shared
        );
        const directSB = await deployOptimistic(
            "OptimisticSOXAccountSponsorIsBuyer",
            shared.buyer,
            AGREED_PRICE + COMPLETION_TIP + SPONSOR_FEES,
            shared
        );
        const directSV = await deployOptimistic(
            "OptimisticSOXAccountSponsorIsVendor",
            shared.vendor,
            SPONSOR_FEES,
            shared
        );

        async function deployImplementation(name: string) {
            const implementationFactory = await ethers.getContractFactory(name, { libraries });
            const implementation = await implementationFactory.deploy();
            await implementation.waitForDeployment();
            return implementation;
        }

        const normalImpl = await deployImplementation("OptimisticSOXCloneNormal");
        const noSImpl = await deployImplementation("OptimisticSOXCloneNoSDeposit");
        const sbImpl = await deployImplementation("OptimisticSOXCloneSponsorIsBuyer");
        const svImpl = await deployImplementation("OptimisticSOXCloneSponsorIsVendor");

        const SOXFactoryFactory = await ethers.getContractFactory("SOXFactory");
        const soxFactory = await SOXFactoryFactory.deploy(
            await normalImpl.getAddress(),
            await noSImpl.getAddress(),
            await sbImpl.getAddress(),
            await svImpl.getAddress()
        );
        await soxFactory.waitForDeployment();

        const initArgs = {
            entryPoint: await shared.entryPoint.getAddress(),
            vendor: await shared.vendor.getAddress(),
            buyer: await shared.buyer.getAddress(),
            agreedPrice: AGREED_PRICE,
            completionTip: COMPLETION_TIP,
            disputeTip: DISPUTE_TIP,
            timeoutIncrement: TIMEOUT_INCREMENT,
            commitment: ethers.ZeroHash,
            numBlocks: 1n,
            numGates: 7n,
            vendorSigner: await shared.vendor.getAddress(),
        };

        const noSAddress = await soxFactory
            .connect(shared.sponsor)
            .createNoSDeposit.staticCall(initArgs);
        const noSCreateGas = await gasOf(
            soxFactory.connect(shared.sponsor).createNoSDeposit(initArgs)
        );
        const noSClone = await ethers.getContractAt(
            "OptimisticSOXCloneNoSDeposit",
            noSAddress
        );

        const sbAddress = await soxFactory
            .connect(shared.buyer)
            .createSponsorIsBuyer.staticCall(initArgs, {
                value: AGREED_PRICE + COMPLETION_TIP + SPONSOR_FEES,
            });
        const sbCreateGas = await gasOf(
            soxFactory.connect(shared.buyer).createSponsorIsBuyer(initArgs, {
                value: AGREED_PRICE + COMPLETION_TIP + SPONSOR_FEES,
            })
        );
        const sbClone = await ethers.getContractAt(
            "OptimisticSOXCloneSponsorIsBuyer",
            sbAddress
        );

        const svAddress = await soxFactory
            .connect(shared.vendor)
            .createSponsorIsVendor.staticCall(initArgs, { value: SPONSOR_FEES });
        const svCreateGas = await gasOf(
            soxFactory.connect(shared.vendor).createSponsorIsVendor(initArgs, {
                value: SPONSOR_FEES,
            })
        );
        const svClone = await ethers.getContractAt(
            "OptimisticSOXCloneSponsorIsVendor",
            svAddress
        );

        const noSPayment = await gasOf(
            noSClone.connect(shared.buyer).sendPayment({ value: AGREED_PRICE })
        );
        const noSKey = await gasOf(noSClone.connect(shared.vendor).sendKey(KEY));
        const noSComplete = await gasOf(noSClone.connect(shared.buyer).completeTransaction());
        const sbKey = await gasOf(sbClone.connect(shared.vendor).sendKey(KEY));
        const sbComplete = await gasOf(sbClone.connect(shared.buyer).completeTransaction());
        const svPayment = await gasOf(
            svClone.connect(shared.buyer).sendPayment({
                value: AGREED_PRICE + COMPLETION_TIP,
            })
        );
        const svKey = await gasOf(svClone.connect(shared.vendor).sendKey(KEY));
        const svComplete = await gasOf(svClone.connect(shared.buyer).completeTransaction());

        console.log("factory clone gas", {
            directNoSDeploy: directNoS.deployGas.toString(),
            cloneNoSCreate: noSCreateGas.toString(),
            directSBDeploy: directSB.deployGas.toString(),
            cloneSBCreate: sbCreateGas.toString(),
            directSVDeploy: directSV.deployGas.toString(),
            cloneSVCreate: svCreateGas.toString(),
            noSPayment: noSPayment.toString(),
            noSKey: noSKey.toString(),
            noSComplete: noSComplete.toString(),
            sbKey: sbKey.toString(),
            sbComplete: sbComplete.toString(),
            svPayment: svPayment.toString(),
            svKey: svKey.toString(),
            svComplete: svComplete.toString(),
        });

        expect(noSCreateGas).to.be.lessThan(directNoS.deployGas / 4n);
        expect(sbCreateGas).to.be.lessThan(directSB.deployGas / 4n);
        expect(svCreateGas).to.be.lessThan(directSV.deployGas / 4n);
        expect(await noSClone.noSponsorDeposit()).to.equal(true);
        expect(await sbClone.sponsorIsBuyer()).to.equal(true);
        expect(await svClone.sponsorIsVendor()).to.equal(true);
    });

    it("deploys the self-sponsored dispute game when SB=B and SV=V", async function () {
        const shared = await deploySharedContext();
        const account = await deployOptimistic(
            "OptimisticSOXAccountNoSDeposit",
            shared.sponsor,
            0n,
            shared
        );

        await gasOf(account.account.connect(shared.buyer).sendPayment({ value: AGREED_PRICE }));
        await gasOf(account.account.connect(shared.vendor).sendKey(KEY));
        await gasOf(
            account.account.connect(shared.buyer).sendBuyerSelfDisputeSponsorFee({
                value: DISPUTE_FEES + DISPUTE_TIP,
            })
        );
        const triggerGas = await gasOf(
            account.account.connect(shared.vendor).sendVendorSelfDisputeSponsorFee({
                value: DISPUTE_FEES + DISPUTE_TIP + AGREED_PRICE,
            })
        );

        const disputeAddress = await account.account.disputeContract();
        const dispute = await ethers.getContractAt(
            "DisputeSOXAccountSelfSponsored",
            disputeAddress
        );

        console.log("self-sponsored dispute trigger gas", {
            triggerGas: triggerGas.toString(),
            disputeAddress,
        });

        expect(await dispute.step9IsSpecialized()).to.equal(true);
    });

    it("specializes the hardcoded SHA256 path and removes the setup transaction", async function () {
        const shared = await deploySharedContext();

        const monolith = await deployOptimistic(
            "OptimisticSOXAccount",
            shared.sponsor,
            SPONSOR_FEES,
            shared
        );
        const specialized = await deployOptimistic(
            "OptimisticSOXAccountHardcodedSHA256",
            shared.sponsor,
            SPONSOR_FEES,
            shared,
            {
                descriptionHash: HARDCODED_DESCRIPTION_HASH,
                plaintextLength: HARDCODED_PLAINTEXT_LENGTH,
                ciphertextIv: HARDCODED_IV,
            }
        );

        const configureGas = await gasOf(
            monolith.account
                .connect(shared.vendor)
                .configureHardcodedSha256Circuit(
                    HARDCODED_DESCRIPTION_HASH,
                    HARDCODED_PLAINTEXT_LENGTH,
                    HARDCODED_IV
                )
        );

        const monolithPayment = await gasOf(
            monolith.account.connect(shared.buyer).sendPayment({
                value: AGREED_PRICE + COMPLETION_TIP,
            })
        );
        const specializedPayment = await gasOf(
            specialized.account.connect(shared.buyer).sendPayment({
                value: AGREED_PRICE + COMPLETION_TIP,
            })
        );

        const monolithKey = await gasOf(monolith.account.connect(shared.vendor).sendKey(KEY));
        const specializedKey = await gasOf(
            specialized.account.connect(shared.vendor).sendKey(KEY)
        );

        const authorization = await shared.buyer.signMessage(
            ethers.getBytes(
                await monolith.account.buyerUnhappyAuthorizationHash(
                    await shared.buyerDisputeSponsor.getAddress()
                )
            )
        );
        const specializedAuthorization = await shared.buyer.signMessage(
            ethers.getBytes(
                await specialized.account.buyerUnhappyAuthorizationHash(
                    await shared.buyerDisputeSponsor.getAddress()
                )
            )
        );

        const monolithSb = await gasOf(
            monolith.account
                .connect(shared.buyerDisputeSponsor)
                .sendBuyerDisputeSponsorFeeWithAuthorization(authorization, {
                    value: DISPUTE_FEES + DISPUTE_TIP,
                })
        );
        const specializedSb = await gasOf(
            specialized.account
                .connect(shared.buyerDisputeSponsor)
                .sendBuyerDisputeSponsorFeeWithAuthorization(specializedAuthorization, {
                    value: DISPUTE_FEES + DISPUTE_TIP,
                })
        );

        const monolithSv = await gasOf(
            monolith.account
                .connect(shared.vendorDisputeSponsor)
                .sendVendorDisputeSponsorFee({
                    value: DISPUTE_FEES + DISPUTE_TIP + AGREED_PRICE,
                })
        );
        const specializedSv = await gasOf(
            specialized.account
                .connect(shared.vendorDisputeSponsor)
                .sendVendorDisputeSponsorFee({
                    value: DISPUTE_FEES + DISPUTE_TIP + AGREED_PRICE,
                })
        );

        const specializedDispute = await ethers.getContractAt(
            "DisputeSOXAccountHardcodedSHA256",
            await specialized.account.disputeContract()
        );
        expect(await specialized.account.hardcodedSha256Circuit()).to.equal(true);
        expect(await specialized.account.hardcodedDescriptionHash()).to.equal(
            HARDCODED_DESCRIPTION_HASH
        );
        expect(await specializedDispute.optimisticContract()).to.equal(
            await specialized.account.getAddress()
        );

        const monolithTotal =
            monolith.deployGas +
            configureGas +
            monolithPayment +
            monolithKey +
            monolithSb +
            monolithSv;
        const specializedTotal =
            specialized.deployGas +
            specializedPayment +
            specializedKey +
            specializedSb +
            specializedSv;

        console.log("hardcoded specialized bytecode", {
            optimisticMonolith: await runtimeBytes("OptimisticSOXAccount"),
            optimisticHardcodedSpecialized: await runtimeBytes(
                "OptimisticSOXAccountHardcodedSHA256"
            ),
            disputeMonolith: await runtimeBytes("DisputeSOXAccount"),
            disputeHardcodedSpecialized: await runtimeBytes(
                "DisputeSOXAccountHardcodedSHA256"
            ),
        });
        console.log("hardcoded specialized gas", {
            deployMonolith: monolith.deployGas.toString(),
            configureMonolith: configureGas.toString(),
            deploySpecialized: specialized.deployGas.toString(),
            triggerMonolith: monolithSv.toString(),
            triggerSpecialized: specializedSv.toString(),
            totalMonolith: monolithTotal.toString(),
            totalSpecialized: specializedTotal.toString(),
        });

        expect(specialized.deployGas).to.be.lessThan(monolith.deployGas + configureGas);
        expect(specializedSv).to.be.lessThan(monolithSv);
        expect(specializedTotal).to.be.lessThan(monolithTotal);
    });
});
