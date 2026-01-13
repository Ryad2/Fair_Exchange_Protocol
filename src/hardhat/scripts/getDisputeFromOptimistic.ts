import { ethers } from "hardhat";
import OptimisticSOXAccountABI from "../artifacts/contracts/OptimisticSOXAccount.sol/OptimisticSOXAccount.json";

async function main() {
    const args = process.argv.slice(2);
    const optimisticAddr = args[0] || process.env.OPTIMISTIC_ADDR;
    
    if (!optimisticAddr || !ethers.isAddress(optimisticAddr)) {
        console.error("❌ Usage: npx hardhat run scripts/getDisputeFromOptimistic.ts <OPTIMISTIC_CONTRACT_ADDRESS>");
        console.error("   Or set OPTIMISTIC_ADDR environment variable");
        process.exit(1);
    }

    const provider = ethers.provider;
    const contract = new ethers.Contract(optimisticAddr, OptimisticSOXAccountABI.abi, provider);

    console.log("\n" + "=".repeat(80));
    console.log("🔍 retrieval DU CONTRAT DE DISPUTE");
    console.log("=".repeat(80));
    console.log(`\n📋 Contrat OptimisticSOXAccount: ${optimisticAddr}\n`);

    try {
        // verify si le contrat existe
        const code = await provider.getCode(optimisticAddr);
        if (!code || code === "0x") {
            console.error("❌ Aucun contrat found à cette adresse!");
            process.exit(1);
        }
        console.log("✅ Contrat found (code:", code.length, "bytes)\n");

        // Récupérer l'adresse du contrat de dispute
        const disputeAddr = await contract.disputeContract();
        console.log(`🔹 Adresse du contrat de dispute: ${disputeAddr}`);
        
        if (disputeAddr === ethers.ZeroAddress) {
            console.log("❌ Aucun contrat de dispute deployed!");
            process.exit(1);
        }

        // verify l'état du contrat OptimisticSOXAccount
        const state = await contract.currState();
        const stateNames = [
            "WaitPayment",      // 0
            "WaitKey",          // 1
            "WaitSB",           // 2
            "WaitSV",           // 3
            "WaitDisputeStart", // 4
            "InDispute",        // 5
            "End"               // 6
        ];
        const stateNum = Number(state);
        console.log(`🔹 État du contrat OptimisticSOXAccount: ${stateNum} (${stateNames[stateNum] || "UNKNOWN"})`);

        if (stateNum !== 5) {
            console.log("⚠️  Le contrat n'est pas en état InDispute (5)");
        } else {
            console.log("✅ Le contrat est en dispute\n");
            console.log(`\n💡 Pour diagnostiquer le contrat de dispute, exécutez:`);
            console.log(`   DISPUTE_ADDR=${disputeAddr} npx hardhat run scripts/diagnoseProofSubmission.ts`);
        }

    } catch (error: any) {
        console.error(`\n❌ error:`, error.message);
        if (error.data) {
            console.error(`   Données d'error:`, error.data);
        }
    }

    console.log("\n" + "=".repeat(80) + "\n");
}

main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error(error);
        process.exit(1);
    });


