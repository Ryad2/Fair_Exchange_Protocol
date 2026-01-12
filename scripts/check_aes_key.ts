import { ethers } from "ethers";
import Database from "better-sqlite3";
import path from "path";

const PROVIDER_URL = "http://127.0.0.1:8545";
const DISPUTE_CONTRACT = "0xfCb4B28B8395310bb17841280EC9b0A2e7d531F0";
const DB_PATH = path.join(__dirname, "../src/app/db/sox.sqlite");

async function main() {
    const provider = new ethers.JsonRpcProvider(PROVIDER_URL);
    
    // Load dispute contract
    const disputeABI = ["function optimisticContract() view returns (address)"];
    const dispute = new ethers.Contract(DISPUTE_CONTRACT, disputeABI, provider);
    
    const optimisticAddr = await dispute.optimisticContract();
    console.log(`📊 OptimisticSOXAccount: ${optimisticAddr}`);
    
    // Load optimistic contract
    const optimisticABI = ["function key() view returns (bytes)"];
    const optimistic = new ethers.Contract(optimisticAddr, optimisticABI, provider);
    
    try {
        const keyBytes = await optimistic.key();
        console.log(`📊 Key length: ${keyBytes.length} bytes`);
        console.log(`📊 Key (hex): ${ethers.hexlify(keyBytes)}`);
        
        if (keyBytes.length === 0) {
            console.error(`❌ La clé AES n'est PAS définie dans le contrat OptimisticSOXAccount!`);
            console.error(`   Cela causera AESKeyInvalid() lors de verifyCommitmentLeft`);
        } else if (keyBytes.length !== 16) {
            console.error(`❌ La clé AES a une longueur invalide: ${keyBytes.length} bytes (attendu: 16 bytes)`);
            console.error(`   Cela causera AESKeyInvalid() lors de verifyCommitmentLeft`);
        } else {
            console.log(`✅ La clé AES est définie et a la bonne longueur (16 bytes)`);
        }
    } catch (error: any) {
        console.error(`❌ Erreur lors de la récupération de la clé:`, error.message);
    }
}

main().catch(console.error);
