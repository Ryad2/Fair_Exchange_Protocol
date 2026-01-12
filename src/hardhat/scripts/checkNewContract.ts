import { ethers } from "hardhat";

const CONTRACT_ADDRESS = process.env.CONTRACT_ADDRESS || "0xfddfD5d6Cc2B770c83D86b798Ab389BBC85d1475";

async function main() {
    console.log("🔍 VÉRIFICATION DU NOUVEAU CONTRAT");
    console.log("=".repeat(80));
    console.log(`Adresse: ${CONTRACT_ADDRESS}\n`);

    const [deployer] = await ethers.getSigners();
    console.log(`Signer: ${deployer.address}\n`);

    // Check if contract has code
    const code = await ethers.provider.getCode(CONTRACT_ADDRESS);
    if (code === "0x") {
        console.log("❌ Aucun code trouvé à cette adresse");
        console.log("   Le contrat n'est peut-être pas encore déployé");
        console.log("   ou Hardhat node n'est pas en cours d'exécution.\n");
        console.log("💡 Pour démarrer Hardhat node:");
        console.log("   cd src/hardhat && npx hardhat node");
        return;
    }

    console.log(`✅ Code trouvé (${code.length} caractères)\n`);

    // Try DisputeSOXAccount
    try {
        const dispute = await ethers.getContractAt("DisputeSOXAccount", CONTRACT_ADDRESS);
        const state = Number(await dispute.currState());
        const a = Number(await dispute.a());
        const b = Number(await dispute.b());
        const chall = Number(await dispute.chall());
        const numBlocks = Number(await dispute.numBlocks());
        const numGates = Number(await dispute.numGates());
        const commitment = await dispute.commitment();
        const optimisticAddr = await dispute.optimisticContract();

        const stateNames: { [key: number]: string } = {
            0: "ChallengeBuyer",
            1: "WaitSB",
            2: "WaitVendorData",
            3: "WaitVendorDataLeft",
            4: "WaitVendorDataRight",
            5: "Complete",
            6: "Cancel",
            7: "End",
        };

        console.log("✅ CONTRAT: DisputeSOXAccount\n");
        console.log(`📊 ÉTAT:`);
        console.log(`   État: ${state} (${stateNames[state] || "UNKNOWN"})`);
        console.log(`   a: ${a}, b: ${b}, chall: ${chall}`);
        console.log(`   numBlocks: ${numBlocks}, numGates: ${numGates}`);
        console.log(`   Commitment: ${commitment}`);
        console.log(`   OptimisticContract: ${optimisticAddr}\n`);

        // Get key from optimistic contract
        try {
            const optimistic = await ethers.getContractAt("OptimisticSOXAccount", optimisticAddr);
            const key = await optimistic.key();
            const keyBytes = ethers.getBytes(key);
            console.log(`🔑 Clé AES: ${key}`);
            console.log(`   Longueur: ${keyBytes.length} bytes`);
            if (keyBytes.length === 16) {
                console.log(`   ✅ Clé correcte (16 bytes)`);
            } else {
                console.log(`   ⚠️  Clé incorrecte (devrait être 16 bytes)`);
            }
        } catch (e: any) {
            console.log(`⚠️  Impossible de récupérer la clé: ${e.message}`);
        }

        // Check buyer responses
        console.log("\n📋 Buyer Responses:");
        const maxCheck = Math.min(chall + 2, numGates + 1);
        for (let i = 1; i <= maxCheck; i++) {
            try {
                const response = await dispute.buyerResponses(i);
                if (response !== ethers.ZeroHash) {
                    console.log(`   buyerResponses[${i}]: ${response}`);
                }
            } catch (e) {
                // Ignore
            }
        }

        // Check if contract is ready for gate 1 submission
        if (state === 3 && chall === 1) {
            console.log("\n✅ CONTRAT PRÊT POUR GATE 1:");
            console.log("   État: WaitVendorDataLeft (3)");
            console.log("   Challenge: 1 (gate 1)");
            console.log("   Le vendeur peut maintenant soumettre submitCommitmentLeft");
        }

    } catch (error: any) {
        console.log(`❌ Erreur lors de l'accès au contrat: ${error.message}`);
        if (error.message.includes("could not decode")) {
            console.log(`   Le contrat à cette adresse n'est peut-être pas un DisputeSOXAccount`);
        }
    }

    console.log("\n" + "=".repeat(80));
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});


