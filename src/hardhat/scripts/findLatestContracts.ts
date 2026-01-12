import { ethers } from "hardhat";

async function main() {
    console.log("🔍 RECHERCHE DES DERNIERS CONTRATS DÉPLOYÉS");
    console.log("=".repeat(80));
    console.log("Réseau: Hardhat local\n");

    const [deployer] = await ethers.getSigners();
    console.log(`Signer: ${deployer.address}\n`);

    // Get latest block
    const latestBlock = await ethers.provider.getBlockNumber();
    console.log(`📦 Dernier bloc: ${latestBlock}\n`);

    if (latestBlock === 0) {
        console.log("⚠️  Aucun bloc trouvé. Hardhat node n'est peut-être pas en cours d'exécution.");
        console.log("   Essayez de lancer: npx hardhat node\n");
        return;
    }

    // Search recent blocks for contract deployments
    const searchBlocks = Math.min(500, latestBlock); // Search last 500 blocks
    const startBlock = Math.max(0, latestBlock - searchBlocks);
    
    console.log(`🔍 Recherche dans les blocs ${startBlock} à ${latestBlock}...\n`);

    const contracts: Array<{ address: string; block: number; txHash: string; type?: string }> = [];

    // Search from latest to oldest
    for (let blockNum = latestBlock; blockNum >= startBlock; blockNum--) {
        try {
            const block = await ethers.provider.getBlock(blockNum, true);
            if (!block || !block.transactions) continue;

            for (const txHash of block.transactions) {
                try {
                    const receipt = await ethers.provider.getTransactionReceipt(txHash);
                    if (!receipt) continue;

                    // Check if this is a contract creation (contractAddress is set)
                    if (receipt.contractAddress) {
                        const code = await ethers.provider.getCode(receipt.contractAddress);
                        if (code && code.length > 2) {
                            contracts.push({
                                address: receipt.contractAddress,
                                block: blockNum,
                                txHash: txHash,
                            });
                        }
                    }
                } catch (e) {
                    // Skip errors
                }
            }
        } catch (e) {
            // Skip block errors
        }
    }

    console.log(`✅ ${contracts.length} contrat(s) trouvé(s):\n`);

    let latestDispute: typeof contracts[0] | null = null;
    let latestOptimistic: typeof contracts[0] | null = null;

    // Try to identify contract types
    for (const contract of contracts) {
        console.log(`📍 ${contract.address}`);
        console.log(`   Bloc: ${contract.block}`);
        console.log(`   TX: ${contract.txHash}`);

        // Try to identify as DisputeSOXAccount
        try {
            const disputeAbi = ["function currState() view returns (uint8)"];
            const dispute = new ethers.Contract(contract.address, disputeAbi, deployer);
            const state = await dispute.currState();
            contract.type = "DisputeSOXAccount";
            console.log(`   ✅ Type: DisputeSOXAccount (état: ${state})`);
            if (!latestDispute || contract.block > latestDispute.block) {
                latestDispute = contract;
            }
        } catch (e) {
            // Not a DisputeSOXAccount
        }

        // Try to identify as OptimisticSOXAccount
        try {
            const optimisticAbi = ["function key() view returns (bytes16)"];
            const optimistic = new ethers.Contract(contract.address, optimisticAbi, deployer);
            const key = await optimistic.key();
            contract.type = "OptimisticSOXAccount";
            console.log(`   ✅ Type: OptimisticSOXAccount (key: ${key})`);
            if (!latestOptimistic || contract.block > latestOptimistic.block) {
                latestOptimistic = contract;
            }
        } catch (e) {
            // Not an OptimisticSOXAccount
        }

        // Try to identify as DisputeDeployer
        try {
            const deployerAbi = ["function deployDispute(address,uint32,uint32,bytes32,uint32,address,address,address,address,address) returns (address)"];
            const disputeDeployer = new ethers.Contract(contract.address, deployerAbi, deployer);
            contract.type = "DisputeDeployer";
            console.log(`   ✅ Type: DisputeDeployer`);
        } catch (e) {
            // Not a DisputeDeployer
        }

        if (!contract.type) {
            console.log(`   ⚠️  Type inconnu`);
        }

        console.log();
    }

    // Show the most recent ones
    console.log("=".repeat(80));
    if (latestDispute) {
        console.log(`🎯 DERNIER DisputeSOXAccount DÉPLOYÉ:`);
        console.log(`   Adresse: ${latestDispute.address}`);
        console.log(`   Bloc: ${latestDispute.block}`);
        console.log(`   TX: ${latestDispute.txHash}`);
        console.log();
    }
    if (latestOptimistic) {
        console.log(`🎯 DERNIER OptimisticSOXAccount DÉPLOYÉ:`);
        console.log(`   Adresse: ${latestOptimistic.address}`);
        console.log(`   Bloc: ${latestOptimistic.block}`);
        console.log(`   TX: ${latestOptimistic.txHash}`);
        console.log();
    }
    if (contracts.length > 0 && !latestDispute && !latestOptimistic) {
        const latest = contracts[0];
        console.log(`🎯 DERNIER CONTRAT DÉPLOYÉ:`);
        console.log(`   Adresse: ${latest.address}`);
        console.log(`   Bloc: ${latest.block}`);
        console.log(`   TX: ${latest.txHash}`);
    }
    console.log("=".repeat(80));
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});

