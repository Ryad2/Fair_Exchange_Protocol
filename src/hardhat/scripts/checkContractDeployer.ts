import { ethers } from "hardhat";
import { readFileSync } from "fs";
import { join } from "path";

const DISPUTE_ADDRESS = process.env.DISPUTE_ADDRESS || "0xD771FF474DF584DA30A87f1522F067aB69A64771";

async function main() {
    console.log("🔍 VÉRIFICATION DU CONTRAT ET DE SON DÉPLOYEUR\n");
    console.log(`Contrat Dispute: ${DISPUTE_ADDRESS}\n`);
    
    // Check deployed-contracts.json
    const deployedContractsPath = join(__dirname, "../../../deployed-contracts.json");
    const deployedContracts = JSON.parse(readFileSync(deployedContractsPath, "utf-8"));
    
    console.log("📋 DEPLOYED-CONTRACTS.JSON:");
    console.log(`  DisputeDeployer: ${deployedContracts.addresses?.DisputeDeployer || "N/A"}`);
    console.log(`  Network: ${deployedContracts.network || "N/A"}`);
    console.log(`  ChainId: ${deployedContracts.chainId || "N/A"}\n`);
    
    // Get contract state
    const dispute = await ethers.getContractAt("DisputeSOXAccount", DISPUTE_ADDRESS);
    const state = await dispute.currState();
    const chall = await dispute.chall();
    
    console.log("📊 ÉTAT DU CONTRAT:");
    console.log(`  State: ${state}`);
    console.log(`  chall: ${chall}\n`);
    
    // Check if this is for chall=1
    if (Number(chall) === 1) {
        console.log("✅ Le contrat est dans un état où chall=1");
        console.log("   Ce contrat devrait utiliser le nouveau AccumulatorVerifier\n");
    }
    
    // We cannot directly check which AccumulatorVerifier is used,
    // but we can verify the contract was created recently
    const code = await ethers.provider.getCode(DISPUTE_ADDRESS);
    console.log(`📦 Code du contrat: ${code.slice(0, 20)}... (${code.length} chars)\n`);
    
    console.log("💡 Pour vérifier si le contrat utilise le nouveau AccumulatorVerifier,");
    console.log("   il faut tester avec submitCommitmentLeft pour chall=1.");
    console.log("   Si cela échoue, le contrat n'utilise peut-être pas le nouveau DisputeDeployer.");
}

main().catch(console.error);
