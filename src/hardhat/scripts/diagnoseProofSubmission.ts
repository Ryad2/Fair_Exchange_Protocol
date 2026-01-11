import { ethers } from "hardhat";
import DisputeSOXAccountABI from "../artifacts/contracts/DisputeSOXAccount.sol/DisputeSOXAccount.json";

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

async function main() {
    // Hardhat passe les arguments via hre
    const hre = await import("hardhat");
    const args = process.argv.slice(2);
    const contractAddr = args[0] || process.env.DISPUTE_ADDR;
    
    if (!contractAddr || !ethers.isAddress(contractAddr)) {
        console.error("❌ Usage: npx hardhat run scripts/diagnoseProofSubmission.ts 0x...");
        console.error("   Or set DISPUTE_ADDR environment variable");
        process.exit(1);
    }

    const provider = ethers.provider;
    const contract = new ethers.Contract(contractAddr, DisputeSOXAccountABI.abi, provider);

    console.log("\n" + "=".repeat(80));
    console.log("🔍 DIAGNOSTIC DE L'ENVOI DES PREUVES");
    console.log("=".repeat(80));
    console.log(`\n📋 Contrat: ${contractAddr}\n`);

    try {
        // État actuel
        const state = await contract.currState();
        const stateNum = Number(state);
        console.log(`🔹 État actuel: ${stateNum} (${STATE_NAMES[stateNum] || "UNKNOWN"})`);

        // Challenge actuel
        const chall = await contract.chall();
        console.log(`🔹 Challenge actuel: ${chall}`);

        // Num blocks et gates
        const numBlocks = await contract.numBlocks();
        const numGates = await contract.numGates();
        console.log(`🔹 Nombre de blocs: ${numBlocks}`);
        console.log(`🔹 Nombre de gates: ${numGates}`);

        // A (gate number)
        const a = await contract.a();
        console.log(`🔹 A (gate number): ${a}`);

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

        // Vérifier les réponses du buyer
        console.log(`\n📊 Réponses du buyer:`);
        for (let i = 1; i <= Math.min(Number(chall), Number(numGates) + 1); i++) {
            try {
                const response = await contract.getBuyerResponse(i);
                if (response !== ethers.ZeroHash) {
                    console.log(`   Challenge ${i}: ${response.slice(0, 20)}...`);
                } else {
                    console.log(`   Challenge ${i}: NON DÉFINI ❌`);
                }
            } catch (e) {
                console.log(`   Challenge ${i}: ERREUR ❌`);
            }
        }

        // Diagnostic selon l'état
        console.log(`\n🔍 Diagnostic:`);
        if (stateNum === 2) {
            // WaitVendorData
            console.log(`   📤 État: WaitVendorData (submitCommitment)`);
            console.log(`   📋 Gate number attendu: ${a}`);
            console.log(`   ⚠️  Conditions nécessaires:`);
            console.log(`      1. Le vendor doit être le signer autorisé`);
            console.log(`      2. Le buyer doit avoir répondu pour le challenge ${chall}`);
            console.log(`      3. Le buyer doit avoir répondu pour le challenge ${Number(chall) - 1} (si chall > 1)`);
            
            const buyerResponseChall = await contract.getBuyerResponse(chall);
            if (buyerResponseChall === ethers.ZeroHash) {
                console.log(`      ❌ Le buyer n'a PAS répondu pour le challenge ${chall}`);
            } else {
                console.log(`      ✅ Le buyer a répondu pour le challenge ${chall}`);
            }
            
            if (Number(chall) > 1) {
                const buyerResponseChallMinus1 = await contract.getBuyerResponse(Number(chall) - 1);
                if (buyerResponseChallMinus1 === ethers.ZeroHash) {
                    console.log(`      ❌ Le buyer n'a PAS répondu pour le challenge ${Number(chall) - 1}`);
                } else {
                    console.log(`      ✅ Le buyer a répondu pour le challenge ${Number(chall) - 1}`);
                }
            }
            
        } else if (stateNum === 3) {
            // WaitVendorDataLeft
            console.log(`   📤 État: WaitVendorDataLeft (submitCommitmentLeft)`);
            console.log(`   📋 Gate number attendu: ${a} (devrait être 1)`);
            console.log(`   ⚠️  Conditions nécessaires:`);
            console.log(`      1. Le vendor doit être le signer autorisé`);
            console.log(`      2. Le buyer doit avoir répondu pour le challenge 1`);
            
            const buyerResponse1 = await contract.getBuyerResponse(1);
            if (buyerResponse1 === ethers.ZeroHash) {
                console.log(`      ❌ Le buyer n'a PAS répondu pour le challenge 1`);
            } else {
                console.log(`      ✅ Le buyer a répondu pour le challenge 1`);
            }
            
        } else if (stateNum === 4) {
            // WaitVendorDataRight
            console.log(`   📤 État: WaitVendorDataRight (submitCommitmentRight)`);
            console.log(`   📋 Challenge attendu: ${chall} (devrait être ${Number(numGates) + 1})`);
            console.log(`   ⚠️  Conditions nécessaires:`);
            console.log(`      1. Le vendor doit être le signer autorisé`);
            console.log(`      2. Le buyer doit avoir répondu pour le challenge ${numGates}`);
            
            const buyerResponseNumGates = await contract.getBuyerResponse(numGates);
            if (buyerResponseNumGates === ethers.ZeroHash) {
                console.log(`      ❌ Le buyer n'a PAS répondu pour le challenge ${numGates}`);
                console.log(`      💡 Le buyer doit répondre avec hpre(${numGates}) avant que le vendor puisse envoyer les preuves`);
            } else {
                console.log(`      ✅ Le buyer a répondu pour le challenge ${numGates}`);
            }
            
        } else {
            console.log(`   ⚠️  État: ${STATE_NAMES[stateNum] || "UNKNOWN"}`);
            console.log(`   ❌ L'état actuel n'est PAS un état d'envoi de preuves`);
            console.log(`   💡 Les preuves ne peuvent être envoyées que dans les états:`);
            console.log(`      - WaitVendorData (2)`);
            console.log(`      - WaitVendorDataLeft (3)`);
            console.log(`      - WaitVendorDataRight (4)`);
        }

        // Timeout
        const nextTimeoutTime = await contract.nextTimeoutTime();
        const timeoutHasPassed = await contract.timeoutHasPassed();
        console.log(`\n⏰ Timeout:`);
        console.log(`   Prochain timeout: ${new Date(Number(nextTimeoutTime) * 1000).toLocaleString()}`);
        console.log(`   Timeout passé: ${timeoutHasPassed ? "OUI ✅" : "NON ❌"}`);

    } catch (error: any) {
        console.error(`\n❌ Erreur lors de la lecture du contrat:`, error.message);
        if (error.data) {
            console.error(`   Données d'erreur:`, error.data);
        }
        console.error(error);
    }

    console.log("\n" + "=".repeat(80) + "\n");
}

main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error(error);
        process.exit(1);
    });
