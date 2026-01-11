import { ethers } from "hardhat";
import { Contract, formatEther, parseEther } from "ethers";
import fs from "fs";
import path from "path";

const BUYER_PRIVATE_KEY =
    process.env.BUYER_PRIVATE_KEY ||
    "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d";

function loadEnvFile(envPath: string) {
    if (!fs.existsSync(envPath)) return;
    const raw = fs.readFileSync(envPath, "utf-8");
    for (const line of raw.split("\n")) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) {
            continue;
        }
        const [key, ...rest] = trimmed.split("=");
        if (!process.env[key]) {
            process.env[key] = rest.join("=");
        }
    }
}

async function waitForState(
    contract: Contract,
    expectedState: bigint,
    label: string,
    retries = 20,
    delayMs = 1000
) {
    for (let i = 0; i < retries; i++) {
        const state = await contract.currState();
        if (state === expectedState) {
            console.log(`✅ ${label}: état=${state.toString()}`);
            return;
        }
        await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
    throw new Error(
        `${label}: état attendu=${expectedState.toString()} non atteint`
    );
}

async function requestBundler(
    bundlerUrl: string,
    method: string,
    params: unknown[]
) {
    const response = await fetch(bundlerUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            jsonrpc: "2.0",
            id: 1,
            method,
            params,
        }),
    });

    if (!response.ok) {
        const text = await response.text();
        throw new Error(`Bundler HTTP error (${response.status}): ${text}`);
    }

    const payload = await response.json();
    if (payload.error) {
        const errorMsg = payload.error.message || "Bundler RPC error";
        const errorData = payload.error.data
            ? ` (data: ${JSON.stringify(payload.error.data)})`
            : "";
        throw new Error(`${errorMsg}${errorData}`);
    }
    return payload.result;
}

async function waitForUserOpReceipt(
    bundlerUrl: string,
    userOpHash: string,
    retries = 30,
    delayMs = 1000
) {
    for (let i = 0; i < retries; i++) {
        const receipt = await requestBundler(bundlerUrl, "eth_getUserOperationReceipt", [
            userOpHash,
        ]);
        if (receipt) {
            return receipt;
        }
        await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
    throw new Error("UserOperation receipt not found (bundler did not include it yet).");
}

type GasOverrides = Partial<{
    callGasLimit: bigint;
    verificationGasLimit: bigint;
    preVerificationGas: bigint;
    maxFeePerGas: bigint;
    maxPriorityFeePerGas: bigint;
    paymasterVerificationGasLimit: bigint;
    paymasterPostOpGasLimit: bigint;
}>;

function bumpFee(value: bigint | undefined, percent: bigint): bigint | undefined {
    if (typeof value !== "bigint") return value;
    return (value * (100n + percent)) / 100n;
}

function bumpGasOverrides(gas: GasOverrides, percent: bigint): GasOverrides {
    return {
        ...gas,
        maxFeePerGas: bumpFee(gas.maxFeePerGas, percent),
        maxPriorityFeePerGas: bumpFee(gas.maxPriorityFeePerGas, percent),
    };
}

async function main() {
    const envPath = path.join(__dirname, "../../../.env.local");
    loadEnvFile(envPath);

    const entryPoint =
        process.env.NEXT_PUBLIC_ENTRY_POINT_V8 ||
        process.env.NEXT_PUBLIC_ENTRY_POINT ||
        "0x4337084D9E255Ff0702461CF8895CE9E3b5Ff108";
    const bundlerUrl =
        process.env.BUNDLER_URL ||
        process.env.NEXT_PUBLIC_BUNDLER_URL ||
        "http://localhost:4337/rpc";
    const delegate = process.env.NEXT_PUBLIC_EIP7702_DELEGATE;
    if (!delegate) {
        throw new Error(
            "NEXT_PUBLIC_EIP7702_DELEGATE manquant. Lance ./deploy-contracts.sh"
        );
    }

    const { sendUserOperationV8 } = await import(
        "../../app/lib/blockchain/userops"
    );

    console.log("=".repeat(80));
    console.log("🧪 TEST: Paiement buyer via EIP-7702 UserOperation");
    console.log("=".repeat(80));

    const [sponsor, buyer, vendor] = await ethers.getSigners();
    const sponsorAddr = await sponsor.getAddress();
    const buyerAddr = await buyer.getAddress();
    const vendorAddr = await vendor.getAddress();

    console.log("Sponsor:", sponsorAddr);
    console.log("Buyer:", buyerAddr);
    console.log("Vendor:", vendorAddr);
    console.log("EntryPoint:", entryPoint);
    console.log("Delegate:", delegate);
    console.log("Bundler:", bundlerUrl);

    console.log("\n📦 Déploiement des libraries...");
    const SHA256EvaluatorFactory = await ethers.getContractFactory("SHA256Evaluator");
    const sha256Evaluator = await SHA256EvaluatorFactory.deploy();
    await sha256Evaluator.waitForDeployment();
    const sha256EvaluatorAddr = await sha256Evaluator.getAddress();

    const AccumulatorVerifierFactory = await ethers.getContractFactory(
        "AccumulatorVerifier"
    );
    const accumulatorVerifier = await AccumulatorVerifierFactory.deploy();
    await accumulatorVerifier.waitForDeployment();
    const accumulatorVerifierAddr = await accumulatorVerifier.getAddress();

    const CommitmentOpenerFactory = await ethers.getContractFactory("CommitmentOpener");
    const commitmentOpener = await CommitmentOpenerFactory.deploy();
    await commitmentOpener.waitForDeployment();
    const commitmentOpenerAddr = await commitmentOpener.getAddress();

    const DisputeDeployerFactory = await ethers.getContractFactory("DisputeDeployer", {
        libraries: {
            AccumulatorVerifier: accumulatorVerifierAddr,
            CommitmentOpener: commitmentOpenerAddr,
            SHA256Evaluator: sha256EvaluatorAddr,
        },
    });
    const disputeDeployer = await DisputeDeployerFactory.deploy();
    await disputeDeployer.waitForDeployment();
    const disputeDeployerAddr = await disputeDeployer.getAddress();

    console.log("✅ DisputeDeployer:", disputeDeployerAddr);

    console.log("\n📦 Déploiement OptimisticSOXAccount...");
    const OptimisticSOXAccountFactory = await ethers.getContractFactory(
        "OptimisticSOXAccount",
        {
            libraries: {
                DisputeDeployer: disputeDeployerAddr,
            },
        }
    );

    const agreedPrice = parseEther("1.0");
    const completionTip = parseEther("0.1");
    const disputeTip = parseEther("0.1");
    const timeoutIncrement = 3600;
    const commitment = "0x" + "0".repeat(64);
    const numBlocks = 100;
    const numGates = 50;
    const vendorSigner = vendorAddr;

    const optimisticAccount = await OptimisticSOXAccountFactory.connect(sponsor).deploy(
        entryPoint,
        vendorAddr,
        buyerAddr,
        agreedPrice,
        completionTip,
        disputeTip,
        timeoutIncrement,
        commitment,
        numBlocks,
        numGates,
        vendorSigner,
        { value: parseEther("0.5") }
    );
    await optimisticAccount.waitForDeployment();
    const contractAddress = await optimisticAccount.getAddress();
    console.log("✅ OptimisticSOXAccount:", contractAddress);

    console.log("\n💰 Dépôt EntryPoint pour le buyer (sponsorisé)...");
    const entryPointContract = new Contract(
        entryPoint,
        ["function depositTo(address) payable", "function balanceOf(address) view returns (uint256)"],
        sponsor
    );
    const depositAmount = parseEther("0.05");
    const depositTx = await entryPointContract.depositTo(buyerAddr, {
        value: depositAmount,
    });
    await depositTx.wait();
    const buyerDeposit = await entryPointContract.balanceOf(buyerAddr);
    console.log("Deposit buyer:", formatEther(buyerDeposit), "ETH");

    console.log("\n🧾 Préparation callData EIP-7702...");
    const paymentAmount = agreedPrice + completionTip;
    const sendPaymentData = optimisticAccount.interface.encodeFunctionData(
        "sendPayment"
    );
    const delegateInterface = new Contract(
        delegate,
        ["function execute(address target,uint256 value,bytes data)"],
        sponsor
    ).interface;
    const executeData = delegateInterface.encodeFunctionData("execute", [
        contractAddress,
        paymentAmount,
        sendPaymentData,
    ]);

    console.log("Montant paiement:", formatEther(paymentAmount), "ETH");
    console.log("Envoi UserOperation EIP-7702...");

    let userOpHash = "";
    let gasOverrides: GasOverrides = {
        maxFeePerGas: parseEther("0.00000002"),
        maxPriorityFeePerGas: parseEther("0.000000001"),
    };
    const maxAttempts = 3;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        try {
            userOpHash = await sendUserOperationV8({
                sender: buyerAddr,
                callData: executeData,
                signerPrivateKey: BUYER_PRIVATE_KEY,
                entryPoint,
                delegate,
                gas: gasOverrides,
            });
            break;
        } catch (error: any) {
            const message = error?.message || "";
            if (message.includes("Already known")) {
                console.warn("⚠️  UserOp déjà connue du bundler, on continue...");
                break;
            }
            if (
                message.includes("AA25") ||
                message.includes("bump the gas price")
            ) {
                console.warn(
                    `⚠️  Bundler demande un bump des fees (tentative ${attempt}/${maxAttempts}).`
                );
                gasOverrides = bumpGasOverrides(gasOverrides, 12n);
                continue;
            }
            throw error;
        }
    }

    if (userOpHash) {
        console.log("✅ UserOp hash:", userOpHash);
        const receipt = await waitForUserOpReceipt(bundlerUrl, userOpHash);
        console.log("✅ UserOp receipt:", receipt);
    }

    await waitForState(optimisticAccount, 1n, "Attente état WaitKey");
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
