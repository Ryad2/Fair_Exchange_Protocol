import hre from "hardhat";
import { ethers } from "hardhat";

async function main() {
    const contractAddress = "0x124dDf9BdD2DdaD012ef1D5bBd77c00F05C610DA";
    const provider = ethers.provider;
    
    console.log("🔍 Vérification du contrat:", contractAddress);
    
    const code = await provider.getCode(contractAddress);
    if (!code || code === "0x") {
        console.log("❌ Contrat non trouvé");
        return;
    }
    
    console.log("✅ Contrat trouvé\n");
    
    try {
        const contract = await ethers.getContractAt("DisputeSOXAccount", contractAddress);
        const state = await contract.currState();
        const step9Count = await contract.step9Count();
        const lastLosingPartyWasVendor = await contract.lastLosingPartyWasVendor();
        const numGates = await contract.numGates();
        const chall = await contract.chall();
        
        console.log("📊 État du contrat:");
        console.log("  State:", state.toString());
        console.log("  Num Gates:", numGates.toString());
        console.log("  Challenge:", chall.toString());
        console.log("  Step 9 Count:", step9Count.toString());
        console.log("  Last Losing Party Was Vendor:", lastLosingPartyWasVendor);
        
        if (lastLosingPartyWasVendor) {
            console.log("\n❌ Vendor est marqué comme perdant");
        } else {
            console.log("\n✅ Buyer est marqué comme perdant (vendor devrait gagner)");
        }
    } catch (error: any) {
        console.log("❌ Erreur:", error.message);
    }
}

main().catch(console.error);
