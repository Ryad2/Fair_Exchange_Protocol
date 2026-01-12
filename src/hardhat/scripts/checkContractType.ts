import { ethers } from "hardhat";

const CONTRACT_ADDRESS = process.argv[2] || "0x9B3643e64FE5765E89575c226eC5016284D472F9";

async function main() {
    console.log("🔍 Vérification du type de contrat\n");
    console.log(`Adresse: ${CONTRACT_ADDRESS}\n`);

    const provider = ethers.provider;
    const code = await provider.getCode(CONTRACT_ADDRESS);
    
    if (!code || code === "0x") {
        console.log("❌ Aucun code trouvé à cette adresse");
        return;
    }
    
    console.log(`✅ Code trouvé (longueur: ${code.length} caractères)\n`);
    
    // Essayer DisputeSOXAccount
    try {
        const dispute = await ethers.getContractAt("DisputeSOXAccount", CONTRACT_ADDRESS);
        const state = await dispute.currState();
        console.log(`✅ Type: DisputeSOXAccount`);
        console.log(`   État: ${state}`);
        
        const states = [
            "Complete",
            "Cancel",
            "WaitVendorOpinion",
            "ChallengeBuyer",
            "WaitSB",
            "WaitVendorData",
            "WaitVendorDataLeft",
            "WaitVendorDataRight"
        ];
        if (Number(state) < states.length) {
            console.log(`   État lisible: ${states[Number(state)]}`);
        }
        
        const chall = await dispute.a();
        console.log(`   Gate actuelle (a): ${chall}`);
        return;
    } catch (e: any) {
        console.log(`❌ Pas un DisputeSOXAccount: ${e.message.slice(0, 100)}...\n`);
    }
    
    // Essayer OptimisticSOXAccount
    try {
        const optimistic = await ethers.getContractAt("OptimisticSOXAccount", CONTRACT_ADDRESS);
        const state = await optimistic.currState();
        console.log(`✅ Type: OptimisticSOXAccount`);
        console.log(`   État: ${state}`);
        
        const states = [
            "WaitPayment",
            "WaitKey",
            "WaitSB",
            "WaitSV",
            "InDispute",
            "End"
        ];
        if (Number(state) < states.length) {
            console.log(`   État lisible: ${states[Number(state)]}`);
        }
        
        const disputeAddr = await optimistic.disputeContract();
        if (disputeAddr !== ethers.ZeroAddress) {
            console.log(`   Contrat dispute: ${disputeAddr}`);
        } else {
            console.log(`   Pas encore de contrat dispute`);
        }
    } catch (e: any) {
        console.log(`❌ Pas un OptimisticSOXAccount: ${e.message.slice(0, 100)}...`);
    }
}

main().catch(console.error);

