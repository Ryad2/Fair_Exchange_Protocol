import { ethers } from "hardhat";

const DISPUTE_ADDRESS = "0x03EBDA66EB1A84E21eAA71A42759a2E5d03ca35c";

async function main() {
    console.log("🔍 Vérification de l'existence du contrat");
    console.log(`Adresse: ${DISPUTE_ADDRESS}\n`);

    const [deployer] = await ethers.getSigners();
    console.log(`Signer: ${deployer.address}\n`);

    // Check if contract exists
    const code = await deployer.provider!.getCode(DISPUTE_ADDRESS);
    console.log(`Code length: ${code.length} bytes`);
    
    if (code === "0x") {
        console.log("❌ Contrat non trouvé à cette adresse");
    } else {
        console.log("✅ Contrat trouvé!");
        
        // Try to read contract state
        try {
            const disputeAbi = ["function currState() view returns (uint8)"];
            const dispute = new ethers.Contract(DISPUTE_ADDRESS, disputeAbi, deployer);
            const state = await dispute.currState();
            console.log(`État: ${state}`);
        } catch (error: any) {
            console.log(`⚠️  Erreur lors de la lecture: ${error.message}`);
        }
    }
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});


