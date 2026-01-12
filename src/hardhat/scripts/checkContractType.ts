import { ethers } from "hardhat";

const DISPUTE_ADDRESS = "0x03EBDA66EB1A84E21eAA71A42759a2E5d03ca35c";
const OPTIMISTIC_ADDRESS = "0xa138575a030a2F4977D19Cc900781E7BE3fD2bc0";

async function main() {
    console.log("🔍 Vérification du type de contrat\n");
    
    // Check DisputeSOXAccount
    console.log(`1. DisputeSOXAccount: ${DISPUTE_ADDRESS}`);
    try {
        const dispute = await ethers.getContractAt("DisputeSOXAccount", DISPUTE_ADDRESS);
        const state = await dispute.currState();
        console.log(`   ✅ C'est un DisputeSOXAccount (état: ${state})`);
    } catch (error: any) {
        console.log(`   ❌ Ce n'est pas un DisputeSOXAccount: ${error.message}`);
    }
    
    // Check OptimisticSOXAccount
    console.log(`\n2. OptimisticSOXAccount: ${OPTIMISTIC_ADDRESS}`);
    try {
        const optimistic = await ethers.getContractAt("OptimisticSOXAccount", OPTIMISTIC_ADDRESS);
        const key = await optimistic.key();
        console.log(`   ✅ C'est un OptimisticSOXAccount (key: ${key})`);
    } catch (error: any) {
        console.log(`   ❌ Ce n'est pas un OptimisticSOXAccount: ${error.message}`);
    }
    
    // Check if addresses are swapped
    console.log(`\n3. Vérification si les adresses sont inversées...`);
    try {
        const test1 = await ethers.getContractAt("DisputeSOXAccount", OPTIMISTIC_ADDRESS);
        const state1 = await test1.currState();
        console.log(`   ⚠️  ${OPTIMISTIC_ADDRESS} est un DisputeSOXAccount (état: ${state1})`);
    } catch (e) {
        // Not a DisputeSOXAccount
    }
    
    try {
        const test2 = await ethers.getContractAt("OptimisticSOXAccount", DISPUTE_ADDRESS);
        const key2 = await test2.key();
        console.log(`   ⚠️  ${DISPUTE_ADDRESS} est un OptimisticSOXAccount (key: ${key2})`);
    } catch (e) {
        // Not an OptimisticSOXAccount
    }
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
