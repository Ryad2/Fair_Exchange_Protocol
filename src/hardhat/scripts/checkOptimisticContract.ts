import { ethers } from "hardhat";

const OPTIMISTIC_ADDRESS = process.env.OPTIMISTIC_ADDRESS || "0x1F2C6E90F3DF741E0191eAbB1170f0B9673F12b3";

async function main() {
    console.log("🔍 VÉRIFICATION DU CONTRAT OptimisticSOXAccount");
    console.log("=".repeat(80));
    console.log(`Adresse: ${OPTIMISTIC_ADDRESS}\n`);

    const [deployer] = await ethers.getSigners();
    console.log(`Signer: ${deployer.address}\n`);

    try {
        const optimistic = await ethers.getContractAt("OptimisticSOXAccount", OPTIMISTIC_ADDRESS);
        
        console.log("✅ Contrat OptimisticSOXAccount trouvé!\n");

        // Get contract state
        const state = Number(await optimistic.currState());
        const stateNames: { [key: number]: string } = {
            0: "WaitBuyerPayment",
            1: "Dispute",
            2: "WaitSB",
            3: "Complete",
            4: "Cancel",
        };
        console.log(`📊 État: ${state} (${stateNames[state] || "UNKNOWN"})`);

        // Get key
        const key = await optimistic.key();
        console.log(`🔑 Clé AES: ${key}`);
        console.log(`   Longueur (hex): ${key.length} caractères`);
        const keyBytes = ethers.getBytes(key);
        console.log(`   Longueur (bytes): ${keyBytes.length} bytes`);
        if (keyBytes.length === 16) {
            console.log(`   ✅ Clé correcte (16 bytes)`);
        } else {
            console.log(`   ⚠️  Clé incorrecte (devrait être 16 bytes)`);
        }

        // Get commitment
        const commitment = await optimistic.commitment();
        console.log(`📦 Commitment: ${commitment}`);

        // Get parties
        const vendor = await optimistic.vendor();
        const buyer = await optimistic.buyer();
        console.log(`👥 Vendor: ${vendor}`);
        console.log(`👥 Buyer: ${buyer}`);

        // Get prices
        const agreedPrice = await optimistic.agreedPrice();
        const completionTip = await optimistic.completionTip();
        const disputeTip = await optimistic.disputeTip();
        console.log(`💰 Agreed Price: ${ethers.formatEther(agreedPrice)} ETH`);
        console.log(`💰 Completion Tip: ${ethers.formatEther(completionTip)} ETH`);
        console.log(`💰 Dispute Tip: ${ethers.formatEther(disputeTip)} ETH`);

        // Get circuit parameters
        const numBlocks = Number(await optimistic.numBlocks());
        const numGates = Number(await optimistic.numGates());
        console.log(`📐 numBlocks: ${numBlocks}, numGates: ${numGates}`);

        // Get signers
        const vendorSigner = await optimistic.vendorSigner();
        const buyerSigner = await optimistic.buyerSigner();
        console.log(`🔐 Vendor Signer: ${vendorSigner}`);
        console.log(`🔐 Buyer Signer: ${buyerSigner}`);

        // Check if dispute is triggered
        if (state === 1) {
            console.log(`\n⚠️  Le contrat est en état Dispute`);
            console.log(`   Un DisputeSOXAccount devrait être créé pour ce contrat.`);
        }

        console.log("\n" + "=".repeat(80));

    } catch (error: any) {
        console.log(`❌ Erreur: ${error.message}`);
        if (error.message.includes("could not decode")) {
            console.log(`   Le contrat à cette adresse n'est peut-être pas un OptimisticSOXAccount`);
            console.log(`   ou n'est pas déployé sur ce réseau.`);
        }
    }
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});


