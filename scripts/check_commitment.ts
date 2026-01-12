import { ethers } from "ethers";
import Database from "better-sqlite3";
import path from "path";

const PROVIDER_URL = "http://127.0.0.1:8545";
const DISPUTE_CONTRACT = "0xfCb4B28B8395310bb17841280EC9b0A2e7d531F0";
const DB_PATH = path.join(__dirname, "../src/app/db/sox.sqlite");

async function main() {
    const provider = new ethers.JsonRpcProvider(PROVIDER_URL);
    const disputeABI = ["function commitment() view returns (bytes32)"];
    const dispute = new ethers.Contract(DISPUTE_CONTRACT, disputeABI, provider);
    
    const db = new Database(DB_PATH);
    const contractRow = db.prepare(`
        SELECT c.opening_value, c.commitment
        FROM contracts c
        LEFT JOIN disputes d ON c.id = d.contract_id
        WHERE d.dispute_smart_contract = ?
    `).get(DISPUTE_CONTRACT);
    
    if (!contractRow) {
        console.error(`❌ Contrat non trouvé dans la base de données`);
        db.close();
        process.exit(1);
    }
    
    const contractCommitment = await dispute.commitment();
    const openingValueHex = contractRow.opening_value.startsWith('0x') 
        ? contractRow.opening_value 
        : '0x' + contractRow.opening_value;
    
    const openingValueBytes = ethers.getBytes(openingValueHex);
    const calculatedCommitment = ethers.keccak256(openingValueBytes);
    
    console.log(`📊 Vérification du commitment:`);
    console.log(`   Commitment du contrat: ${contractCommitment}`);
    console.log(`   Commitment de la DB: ${contractRow.commitment}`);
    console.log(`   Opening value (hex): ${openingValueHex.slice(0, 40)}...`);
    console.log(`   Commitment calculé (keccak256(opening_value)): ${calculatedCommitment}`);
    console.log();
    
    if (calculatedCommitment.toLowerCase() === contractCommitment.toLowerCase()) {
        console.log(`✅ L'opening value correspond au commitment du contrat`);
    } else {
        console.log(`❌ L'opening value NE correspond PAS au commitment du contrat!`);
        console.log(`   → C'est la cause de l'erreur TransactionReverted()`);
    }
    
    if (contractRow.commitment.toLowerCase() !== contractCommitment.toLowerCase()) {
        console.log(`⚠️  Le commitment de la DB ne correspond pas au commitment du contrat!`);
        console.log(`   → Cela peut être normal si le contrat a été déployé différemment`);
    }
    
    db.close();
}

main().catch(console.error);
