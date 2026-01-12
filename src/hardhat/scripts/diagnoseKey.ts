import { ethers } from "hardhat";

const DISPUTE_ADDRESS = process.env.DISPUTE_ADDRESS || "0x103379C9fca86D81e1Cd99861302EfD623B25c62";

async function main() {
    const dispute = await ethers.getContractAt("DisputeSOXAccount", DISPUTE_ADDRESS);
    const optimisticAddr = await dispute.optimisticContract();
    console.log(`📊 OptimisticSOXAccount: ${optimisticAddr}\n`);
    
    const optimisticContract = await ethers.getContractAt("OptimisticSOXAccount", optimisticAddr);
    
    // Get key from contract
    const keyBytes = await optimisticContract.key();
    console.log(`📊 Key (bytes16): ${keyBytes}`);
    console.log(`   Type: ${typeof keyBytes}`);
    console.log(`   Length (as string): ${keyBytes.length}`);
    
    // Convert to bytes
    const keyBytesArray = ethers.getBytes(keyBytes);
    console.log(`   Length (as bytes): ${keyBytesArray.length} bytes`);
    
    if (keyBytesArray.length !== 16) {
        console.error(`\n❌ PROBLÈME: La clé a ${keyBytesArray.length} bytes au lieu de 16!`);
        console.error(`   La clé est stockée incorrectement dans le contrat.`);
        console.error(`   Elle devrait être 16 bytes pour AES-128.`);
    } else {
        console.log(`\n✅ La clé a 16 bytes - correct!`);
    }
    
    // Test getAesKey from DisputeSOXAccount
    try {
        const aesKey = await dispute.getAesKey();
        console.log(`\n📊 getAesKey() retourne: ${aesKey}`);
        const aesKeyBytes = ethers.getBytes(aesKey);
        console.log(`   Length (as bytes): ${aesKeyBytes.length} bytes`);
        
        if (aesKeyBytes.length !== 16) {
            console.error(`\n❌ PROBLÈME: getAesKey() retourne ${aesKeyBytes.length} bytes au lieu de 16!`);
        } else {
            console.log(`\n✅ getAesKey() retourne 16 bytes - correct!`);
        }
    } catch (error: any) {
        console.error(`\n❌ Erreur lors de l'appel à getAesKey(): ${error.message}`);
    }
}

main().catch(console.error);
