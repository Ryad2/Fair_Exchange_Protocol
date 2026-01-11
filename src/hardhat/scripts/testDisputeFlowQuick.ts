import { ethers } from "hardhat";
import EntryPointArtifact from "@account-abstraction/contracts/artifacts/EntryPoint.json";

const DISPUTE_FEES = 10n;

function optimisticStateName(state: bigint): string {
    const names = [
        "WaitPayment",
        "WaitKey",
        "WaitSB",
        "WaitSV",
        "InDispute",
        "End",
    ];
    return names[Number(state)] || `Unknown(${state.toString()})`;
}

async function main() {
    const [sponsor, buyer, vendor, buyerDisputeSponsor, vendorDisputeSponsor] =
        await ethers.getSigners();

    console.log("=".repeat(80));
    console.log("🧪 Test rapide du flow de dispute (sans bundler)");
    console.log("=".repeat(80));
    console.log("Sponsor:", await sponsor.getAddress());
    console.log("Buyer  :", await buyer.getAddress());
    console.log("Vendor :", await vendor.getAddress());
    console.log("");

    console.log("📚 Déploiement des libraries...");
    const AccumulatorVerifierFactory =
        await ethers.getContractFactory("AccumulatorVerifier");
    const accumulatorVerifier = await AccumulatorVerifierFactory.deploy();
    await accumulatorVerifier.waitForDeployment();

    const SHA256EvaluatorFactory =
        await ethers.getContractFactory("SHA256Evaluator");
    const sha256Evaluator = await SHA256EvaluatorFactory.deploy();
    await sha256Evaluator.waitForDeployment();

    const SimpleOperationsEvaluatorFactory =
        await ethers.getContractFactory("SimpleOperationsEvaluator");
    const simpleOperationsEvaluator =
        await SimpleOperationsEvaluatorFactory.deploy();
    await simpleOperationsEvaluator.waitForDeployment();

    const AES128CtrEvaluatorFactory =
        await ethers.getContractFactory("AES128CtrEvaluator");
    const aes128CtrEvaluator = await AES128CtrEvaluatorFactory.deploy();
    await aes128CtrEvaluator.waitForDeployment();

    const CircuitEvaluatorFactory = await ethers.getContractFactory(
        "CircuitEvaluator",
        {
            libraries: {
                SHA256Evaluator: await sha256Evaluator.getAddress(),
                SimpleOperationsEvaluator:
                    await simpleOperationsEvaluator.getAddress(),
                AES128CtrEvaluator: await aes128CtrEvaluator.getAddress(),
            },
        }
    );
    const circuitEvaluator = await CircuitEvaluatorFactory.deploy();
    await circuitEvaluator.waitForDeployment();

    const CommitmentOpenerFactory =
        await ethers.getContractFactory("CommitmentOpener");
    const commitmentOpener = await CommitmentOpenerFactory.deploy();
    await commitmentOpener.waitForDeployment();

    const DisputeSOXHelpersFactory =
        await ethers.getContractFactory("DisputeSOXHelpers");
    const disputeHelpers = await DisputeSOXHelpersFactory.deploy();
    await disputeHelpers.waitForDeployment();

    const DisputeDeployerFactory =
        await ethers.getContractFactory("DisputeDeployer", {
            libraries: {
                AccumulatorVerifier: await accumulatorVerifier.getAddress(),
                CommitmentOpener: await commitmentOpener.getAddress(),
                SHA256Evaluator: await sha256Evaluator.getAddress(),
            },
        });
    const disputeDeployer = await DisputeDeployerFactory.connect(sponsor).deploy();
    await disputeDeployer.waitForDeployment();

    console.log("✅ Libraries prêtes");
    console.log("");

    console.log("🔐 Déploiement EntryPoint...");
    const EntryPointFactory = new ethers.ContractFactory(
        EntryPointArtifact.abi,
        EntryPointArtifact.bytecode,
        sponsor
    );
    const entryPoint = await EntryPointFactory.deploy();
    await entryPoint.waitForDeployment();
    const entryPointAddress = await entryPoint.getAddress();
    console.log("✅ EntryPoint:", entryPointAddress);
    console.log("");

    console.log("📦 Déploiement OptimisticSOXAccount...");
    const sponsorAmount = 5n;
    const agreedPrice = 1n;
    const completionTip = 1n;
    const disputeTip = 1n;
    const timeoutIncrement = 3600n;
    const numBlocks = 16;
    const numGates = 4 * numBlocks + 1;
    const commitment = ethers.ZeroHash;

    const OptimisticSOXAccountFactory =
        await ethers.getContractFactory("OptimisticSOXAccount", {
            libraries: {
                DisputeDeployer: await disputeDeployer.getAddress(),
            },
        });

    const optimistic = await OptimisticSOXAccountFactory.connect(sponsor).deploy(
        entryPointAddress,
        await vendor.getAddress(),
        await buyer.getAddress(),
        agreedPrice,
        completionTip,
        disputeTip,
        timeoutIncrement,
        commitment,
        numBlocks,
        numGates,
        await vendor.getAddress(),
        { value: sponsorAmount }
    );
    await optimistic.waitForDeployment();
    const optimisticAddress = await optimistic.getAddress();
    console.log("✅ OptimisticSOXAccount:", optimisticAddress);
    console.log("");

    console.log("➡️  sendPayment...");
    await optimistic
        .connect(buyer)
        .sendPayment({ value: agreedPrice + completionTip });
    console.log(
        "   State:",
        optimisticStateName(await optimistic.currState())
    );

    console.log("➡️  sendKey...");
    const key = ethers.randomBytes(16);
    await optimistic.connect(vendor).sendKey(key);
    console.log(
        "   State:",
        optimisticStateName(await optimistic.currState())
    );

    console.log("➡️  sendBuyerDisputeSponsorFee...");
    await optimistic
        .connect(buyerDisputeSponsor)
        .sendBuyerDisputeSponsorFee({ value: DISPUTE_FEES + disputeTip });
    console.log(
        "   State:",
        optimisticStateName(await optimistic.currState())
    );

    console.log("➡️  sendVendorDisputeSponsorFee...");
    await optimistic
        .connect(vendorDisputeSponsor)
        .sendVendorDisputeSponsorFee({
            value: DISPUTE_FEES + disputeTip + agreedPrice,
        });
    console.log(
        "   State:",
        optimisticStateName(await optimistic.currState())
    );

    const disputeAddress = await optimistic.disputeContract();
    console.log("");
    console.log("✅ DisputeSOXAccount déployé:", disputeAddress);

    const dispute = await ethers.getContractAt(
        "DisputeSOXAccount",
        disputeAddress
    );
    console.log("   Dispute entryPoint:", await dispute.entryPoint());
    console.log("   Dispute state:", (await dispute.currState()).toString());
    console.log(
        "   Vendor dispute sponsor:",
        await dispute.vendorDisputeSponsor()
    );
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
