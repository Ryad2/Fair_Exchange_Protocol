import { ethers } from "hardhat";

const DISPUTE_ADDRESS = "0x103379C9fca86D81e1Cd99861302EfD623B25c62";

async function main() {
    const dispute = await ethers.getContractAt("DisputeSOXAccount", DISPUTE_ADDRESS);
    
    // Get contract state
    const state = await dispute.currState();
    const chall = await dispute.chall();
    const vendor = await dispute.vendor();
    const vendorSigner = await dispute.vendorSigner();
    const buyer = await dispute.buyer();
    const buyerSigner = await dispute.buyerSigner();
    
    console.log("📊 ÉTAT DU CONTRAT:");
    console.log(`  State: ${state}`);
    console.log(`  chall: ${chall}`);
    console.log(`  Vendor: ${vendor}`);
    console.log(`  VendorSigner: ${vendorSigner}`);
    console.log(`  Buyer: ${buyer}`);
    console.log(`  BuyerSigner: ${buyerSigner}\n`);
    
    // Check if we can call submitCommitmentLeft directly
    console.log("🧪 Test: Peut-on appeler submitCommitmentLeft directement?");
    
    const [deployer, buyerAccount, vendorAccount] = await ethers.getSigners();
    
    // Test with vendor signer
    try {
        const result = await dispute.connect(vendorAccount).submitCommitmentLeft.staticCall(
            "0x0000000000000000000000000000000000000000000000000000000000000000", // dummy openingValue
            1,
            new Uint8Array(64),
            [],
            new Uint8Array(32),
            [],
            [],
            []
        );
        console.log("  ✅ staticCall avec vendorAccount: SUCCESS (mais avec des données invalides)");
    } catch (error: any) {
        console.log(`  ❌ staticCall avec vendorAccount: ${error.message?.slice(0, 100)}`);
    }
    
    // Check if execute() is available
    console.log("\n🔍 Test: Peut-on appeler execute()?");
    try {
        const executeInterface = dispute.interface.getFunction("execute");
        console.log("  ✅ execute() existe dans l'interface");
        console.log(`     Signature: ${executeInterface.format()}`);
    } catch (error: any) {
        console.log(`  ❌ execute() non trouvé: ${error.message}`);
    }
}

main().catch(console.error);
