import { ethers } from "hardhat";

const DISPUTE_ADDRESS = "0x9B3643e64FE5765E89575c226eC5016284D472F9";

async function main() {
    console.log("🔍 DIAGNOSTIC DU CONTRAT DE DISPUTE\n");
    console.log(`Adresse: ${DISPUTE_ADDRESS}\n`);

    const [signer] = await ethers.getSigners();
    console.log(`Signataire: ${signer.address}\n`);

    // Charger le contrat (utiliser getContractAt pour les contrats déjà déployés)
    const dispute = await ethers.getContractAt("DisputeSOXAccount", DISPUTE_ADDRESS);

    // Informations générales
    console.log("📋 INFORMATIONS GÉNÉRALES:");
    console.log("─".repeat(50));
    
    try {
        const state = await dispute.currState();
        console.log(`État actuel: ${state}`);
        
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
        if (state < states.length) {
            console.log(`État lisible: ${states[state]}`);
        }
        console.log();

        const chall = await dispute.a();
        console.log(`Gate actuelle (chall): ${chall}`);
        console.log();

        // Vérifier si c'est gate 1 (WaitVendorDataLeft)
        if (state === 6) { // WaitVendorDataLeft
            console.log("✅ C'est bien gate 1 (WaitVendorDataLeft)\n");
        } else {
            console.log(`⚠️  État différent de WaitVendorDataLeft (attendu: 6, reçu: ${state})\n`);
        }

        // Informations sur les parties
        console.log("👥 PARTIES:");
        console.log("─".repeat(50));
        const vendor = await dispute.vendor();
        const buyer = await dispute.buyer();
        const vendorDisputeSponsor = await dispute.vendorDisputeSponsor();
        const buyerDisputeSponsor = await dispute.buyerDisputeSponsor();
        
        console.log(`Vendor: ${vendor}`);
        console.log(`Buyer: ${buyer}`);
        console.log(`Vendor Dispute Sponsor: ${vendorDisputeSponsor}`);
        console.log(`Buyer Dispute Sponsor: ${buyerDisputeSponsor}`);
        console.log();

        // Signers
        console.log("✍️  SIGNATAIRES:");
        console.log("─".repeat(50));
        const vendorSigner = await dispute.vendorSigner();
        const buyerSigner = await dispute.buyerSigner();
        console.log(`Vendor Signer: ${vendorSigner}`);
        console.log(`Buyer Signer: ${buyerSigner}`);
        console.log();

        // Optimistic contract
        console.log("🔗 CONTRAT OPTIMISTIC:");
        console.log("─".repeat(50));
        const optimisticContractAddr = await dispute.optimisticContract();
        console.log(`Adresse: ${optimisticContractAddr}`);
        
        // Vérifier la clé AES
        const optimisticContract = await ethers.getContractAt("OptimisticSOXAccount", optimisticContractAddr);
        const key = await optimisticContract.key();
        console.log(`Clé AES (key): ${key}`);
        console.log(`Type: ${typeof key}`);
        if (typeof key === 'string') {
            console.log(`Longueur (hex string): ${key.length} caractères`);
            const keyBytes = ethers.getBytes(key);
            console.log(`Longueur (bytes): ${keyBytes.length} bytes`);
        }
        console.log();

        // Vérifier buyerResponses[1]
        console.log("📝 BUYER RESPONSES:");
        console.log("─".repeat(50));
        try {
            const buyerResponse1 = await dispute.getBuyerResponse(1);
            console.log(`buyerResponses[1]: ${buyerResponse1}`);
        } catch (error: any) {
            console.log(`buyerResponses[1]: Non défini ou erreur: ${error.message}`);
        }
        console.log();

        // Vérifier le commitment
        console.log("🔐 COMMITMENT:");
        console.log("─".repeat(50));
        const commitment = await dispute.commitment();
        console.log(`Commitment: ${commitment}`);
        console.log();

        // Vérifier les numGates
        console.log("📊 CONFIGURATION:");
        console.log("─".repeat(50));
        const numGates = await dispute.numGates();
        const numBlocks = await dispute.numBlocks();
        console.log(`Nombre de gates: ${numGates}`);
        console.log(`Nombre de blocks: ${numBlocks}`);
        console.log();

        // Test de getAesKey()
        console.log("🔑 TEST getAesKey():");
        console.log("─".repeat(50));
        try {
            // Note: getAesKey() est internal, donc on ne peut pas l'appeler directement
            // Mais on peut vérifier la clé via optimisticContract.key()
            console.log("getAesKey() est internal, mais on peut vérifier la clé via optimisticContract.key()");
            console.log(`Clé depuis OptimisticSOXAccount: ${key}`);
        } catch (error: any) {
            console.log(`Erreur: ${error.message}`);
        }
        console.log();

    } catch (error: any) {
        console.error("❌ Erreur lors du diagnostic:", error.message);
        if (error.data) {
            console.error("Données d'erreur:", error.data);
        }
    }
}

main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error(error);
        process.exit(1);
    });

