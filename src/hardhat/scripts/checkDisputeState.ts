import { ethers } from "ethers";
import DisputeSOXAccountABI from "../artifacts/contracts/DisputeSOXAccount.sol/DisputeSOXAccount.json";

const RPC_URL = process.env.RPC_URL || "http://127.0.0.1:8545";
const PROVIDER = new ethers.JsonRpcProvider(RPC_URL);

const STATE_NAMES = [
    "ChallengeBuyer",      // 0
    "WaitVendorOpinion",   // 1
    "WaitVendorData",      // 2
    "WaitVendorDataLeft",  // 3
    "WaitVendorDataRight", // 4
    "Complete",            // 5
    "Cancel",              // 6
    "End"                  // 7
];

async function checkDisputeState(contractAddr: string) {
    const contract = new ethers.Contract(
        contractAddr,
        DisputeSOXAccountABI.abi,
        PROVIDER
    );

    console.log(`\n📋 État du contrat DisputeSOXAccount: ${contractAddr}\n`);
    console.log("=" .repeat(60));

    try {
        // État actuel
        const state = await contract.currState();
        const stateNum = Number(state);
        console.log(`\n🔹 État actuel: ${stateNum} (${STATE_NAMES[stateNum] || "UNKNOWN"})`);

        // Challenge actuel
        const chall = await contract.chall();
        console.log(`🔹 Challenge actuel: ${chall}`);

        // Num blocks et gates
        const numBlocks = await contract.numBlocks();
        const numGates = await contract.numGates();
        console.log(`🔹 Nombre de blocs: ${numBlocks}`);
        console.log(`🔹 Nombre de gates: ${numGates}`);

        // Buyers et vendors
        const buyer = await contract.buyer();
        const vendor = await contract.vendor();
        console.log(`🔹 Buyer: ${buyer}`);
        console.log(`🔹 Vendor: ${vendor}`);

        // Signers
        const buyerSigner = await contract.buyerSigner();
        const vendorSigner = await contract.vendorSigner();
        console.log(`🔹 BuyerSigner: ${buyerSigner}`);
        console.log(`🔹 VendorSigner: ${vendorSigner}`);

        // Réponse du buyer pour le challenge actuel
        const buyerResponse = await contract.getBuyerResponse(chall);
        console.log(`🔹 Réponse du buyer (challenge ${chall}): ${buyerResponse}`);

        // Vérifier les réponses du buyer pour quelques challenges
        console.log(`\n📊 Réponses du buyer pour les premiers challenges:`);
        for (let i = 1; i <= Math.min(Number(chall), 5); i++) {
            try {
                const response = await contract.getBuyerResponse(i);
                if (response !== ethers.ZeroHash) {
                    console.log(`   Challenge ${i}: ${response.slice(0, 20)}...`);
                }
            } catch (e) {
                // Ignore errors
            }
        }

        // Timeout
        const nextTimeoutTime = await contract.nextTimeoutTime();
        const timeoutHasPassed = await contract.timeoutHasPassed();
        console.log(`\n🔹 Prochain timeout: ${new Date(Number(nextTimeoutTime) * 1000).toLocaleString()}`);
        console.log(`🔹 Timeout passé: ${timeoutHasPassed}`);

        // Interprétation de l'état
        console.log(`\n📝 Interprétation:`);
        if (stateNum === 0) {
            console.log("   ⏳ Le buyer doit répondre au challenge");
        } else if (stateNum === 1) {
            console.log("   ⏳ En attente de l'opinion du vendor");
        } else if (stateNum === 2) {
            console.log("   ✅ Le contrat est en attente des preuves du vendor (WaitVendorData)");
            console.log("   📤 Les preuves peuvent être envoyées maintenant");
        } else if (stateNum === 3) {
            console.log("   ✅ Le contrat attend les preuves left du vendor (WaitVendorDataLeft)");
        } else if (stateNum === 4) {
            console.log("   ✅ Le contrat attend les preuves right du vendor (WaitVendorDataRight)");
        } else if (stateNum === 5) {
            console.log("   ✅ Le dispute est complété (Complete)");
        } else if (stateNum === 6) {
            console.log("   ❌ Le dispute est annulé (Cancel)");
        } else if (stateNum === 7) {
            console.log("   🏁 Le dispute est terminé (End)");
        }

    } catch (error: any) {
        console.error(`❌ Erreur lors de la lecture du contrat:`, error.message);
        if (error.data) {
            console.error(`   Données d'erreur:`, error.data);
        }
    }

    console.log("\n" + "=".repeat(60) + "\n");
}

async function main() {
    // Hardhat passe les arguments via hre
    const hre = await import("hardhat");
    const args = process.argv.slice(2);
    const contractAddr = args[0] || "0x8FcA62a1955c73360C11aDEd96F07aDC10C3754E";
    
    if (!ethers.isAddress(contractAddr)) {
        console.error("❌ Adresse invalide:", contractAddr);
        process.exit(1);
    }

    await checkDisputeState(contractAddr);
}

main().catch(console.error);

