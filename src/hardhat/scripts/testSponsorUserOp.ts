import hre from "hardhat";
import { Contract, ContractFactory, Wallet, keccak256, parseEther, toUtf8Bytes } from "ethers";
import fs from "fs";
import path from "path";
import { PK_SK_MAP } from "../../src/app/lib/blockchain/config";
import AccountArtifact from "../../src/app/lib/blockchain/contracts/OptimisticSOXAccount.json";

type BundlerConfig = {
    entrypoints?: string | string[];
    "entrypoint-simulation-contract-v7"?: string;
    port?: number;
    "rpc-url"?: string;
};

function readBundlerConfig(): BundlerConfig {
    const configPath = path.join(
        __dirname,
        "../../../bundler-alto/scripts/config.local.json"
    );
    const raw = fs.readFileSync(configPath, "utf-8");
    return JSON.parse(raw) as BundlerConfig;
}

function getEntryPoint(config: BundlerConfig): string {
    const entrypoints = config.entrypoints;
    if (Array.isArray(entrypoints)) return entrypoints[0];
    if (typeof entrypoints === "string") return entrypoints;
    throw new Error("EntryPoint introuvable dans config.local.json");
}

async function main() {
    const config = readBundlerConfig();
    const entryPoint = getEntryPoint(config);
    const entryPointSim = config["entrypoint-simulation-contract-v7"];
    const bundlerPort = config.port || 3002;
    const bundlerUrl = `http://localhost:${bundlerPort}/rpc`;

    process.env.NEXT_PUBLIC_ENTRY_POINT = entryPoint;
    if (entryPointSim) process.env.NEXT_PUBLIC_ENTRY_POINT_SIM = entryPointSim;
    process.env.NEXT_PUBLIC_BUNDLER_URL = bundlerUrl;

    const sponsorAddr =
        process.env.SPONSOR_ADDR || "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266";
    const vendorAddr =
        process.env.VENDOR_ADDR || "0x70997970C51812dc3A010C7d01b50e0d17dc79C8";
    const buyerAddr =
        process.env.BUYER_ADDR || "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC";
    const keyToSend = process.env.KEY_TO_SEND || "0x1234";

    const sponsorPk = PK_SK_MAP.get(sponsorAddr);
    const vendorPk = PK_SK_MAP.get(vendorAddr);
    if (!sponsorPk) throw new Error(`Private key not found for sponsor: ${sponsorAddr}`);
    if (!vendorPk) throw new Error(`Private key not found for vendor: ${vendorAddr}`);

    const provider = hre.ethers.provider;
    const sponsor = new Wallet(sponsorPk, provider);

    console.log("=".repeat(80));
    console.log("🧪 TEST SPONSOR -> DEPLOY -> USEROP");
    console.log("=".repeat(80));
    console.log("EntryPoint:", entryPoint);
    console.log("EntryPointSim:", entryPointSim || "(not set)");
    console.log("Bundler:", bundlerUrl);
    console.log("Sponsor:", sponsorAddr);
    console.log("Vendor:", vendorAddr);
    console.log("Buyer :", buyerAddr);
    console.log("Key   :", keyToSend);
    console.log("");

    const factory = new ContractFactory(
        AccountArtifact.abi,
        AccountArtifact.bytecode,
        sponsor
    );

    const commitment = keccak256(toUtf8Bytes("test-commitment"));
    const contract = await factory.deploy(
        entryPoint,
        vendorAddr,
        buyerAddr,
        1000, // agreedPrice
        100, // completionTip
        100, // disputeTip
        60, // timeoutIncrement
        commitment,
        1, // numBlocks
        1, // numGates
        vendorAddr, // vendorSigner
        { value: parseEther("1") }
    );
    await contract.waitForDeployment();

    const accountAddr = await contract.getAddress();
    console.log("✅ Contract deployed:", accountAddr);

    if (entryPointSim) {
        const tx = await contract.connect(sponsor).setEntryPointSim(entryPointSim);
        await tx.wait();
        console.log("✅ EntryPointSim set:", entryPointSim);
    }

    const depositTx = await contract.connect(sponsor).depositToEntryPoint({
        value: parseEther("0.5"),
    });
    await depositTx.wait();
    console.log("✅ EntryPoint deposit done");

    try {
        await fetch(bundlerUrl, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                jsonrpc: "2.0",
                id: 999,
                method: "debug_bundler_clearState",
                params: [],
            }),
        });
        console.log("✅ Bundler cache cleared");
    } catch (error: any) {
        console.warn("⚠️ Bundler cache not cleared:", error.message);
    }

    const { sendKeyViaUserOp } = await import("../../src/app/lib/blockchain/userop");
    const userOpHash = await sendKeyViaUserOp(vendorAddr, accountAddr, keyToSend);
    console.log("✅ UserOp sent:", userOpHash);
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
