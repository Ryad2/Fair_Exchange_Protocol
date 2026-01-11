import hre from "hardhat";
import { ethers, Wallet, Contract } from "ethers";
import { PK_SK_MAP, PROVIDER } from "../../src/app/lib/blockchain/config";
import { abi as accountAbi } from "../../src/app/lib/blockchain/contracts/OptimisticSOXAccount.json";

async function main() {
    const contractAddress = process.env.CONTRACT_ADDRESS;
    const vendorAddress = process.env.VENDOR_ADDRESS;
    
    if (!contractAddress || !vendorAddress) {
        console.error("❌ Erreur: Utilisez CONTRACT_ADDRESS=0x... VENDOR_ADDRESS=0x... npx hardhat run scripts/diagnoseSignature.ts");
        process.exit(1);
    }

    console.log(`🔍 Diagnostic de la signature pour le contrat: ${contractAddress}`);
    console.log(`   Vendor address: ${vendorAddress}`);

    try {
        const contract = new Contract(contractAddress, accountAbi, PROVIDER);
        
        // 1. Vérifier le vendorSigner
        const vendorSigner = await contract.vendorSigner();
        console.log("\n1️⃣ VendorSigner du contrat:", vendorSigner);
        
        // 2. Vérifier le vendor
        const contractVendor = await contract.vendor();
        console.log("2️⃣ Vendor du contrat:", contractVendor);
        console.log("   Correspond au vendorAddress?", contractVendor.toLowerCase() === vendorAddress.toLowerCase());
        
        // 3. Vérifier les session keys
        const vendorPrivateKey = PK_SK_MAP.get(vendorAddress);
        if (!vendorPrivateKey) {
            console.error("❌ Clé privée non trouvée pour le vendor");
            process.exit(1);
        }
        
        const vendorWallet = new Wallet(vendorPrivateKey, PROVIDER);
        const walletAddress = await vendorWallet.getAddress();
        console.log("\n3️⃣ Wallet address (depuis clé privée):", walletAddress);
        console.log("   Correspond au vendorSigner?", walletAddress.toLowerCase() === vendorSigner.toLowerCase());
        
        // 4. Vérifier si c'est une session key
        const isSessionKey = await contract.sessionKeys(walletAddress);
        console.log("4️⃣ Wallet est une session key autorisée?", isSessionKey);
        
        // 5. Vérifier le nonce
        const nonce = await contract.nonce();
        console.log("\n5️⃣ Nonce actuel du contrat:", nonce.toString());
        
        // 6. Créer un hash de test et vérifier la signature
        const testMessage = "test message";
        const testHash = ethers.keccak256(ethers.toUtf8Bytes(testMessage));
        const testSignature = await vendorWallet.signMessage(ethers.getBytes(testHash));
        const recovered = ethers.verifyMessage(ethers.getBytes(testHash), testSignature);
        console.log("\n6️⃣ Test de signature:");
        console.log("   Message:", testMessage);
        console.log("   Hash:", testHash);
        console.log("   Signature:", testSignature.substring(0, 20) + "...");
        console.log("   Adresse récupérée:", recovered);
        console.log("   Correspond au wallet?", recovered.toLowerCase() === walletAddress.toLowerCase());
        
        // 7. Résumé
        console.log("\n📊 RÉSUMÉ:");
        const vendorSignerMatch = walletAddress.toLowerCase() === vendorSigner.toLowerCase();
        const sessionKeyAuthorized = isSessionKey;
        const canSign = vendorSignerMatch || sessionKeyAuthorized;
        
        console.log("   ✅ Wallet correspond au vendorSigner:", vendorSignerMatch);
        console.log("   ✅ Wallet est une session key autorisée:", sessionKeyAuthorized);
        console.log("   ✅ Peut signer des UserOps:", canSign);
        
        if (!canSign) {
            console.error("\n❌ PROBLÈME: Le wallet ne peut pas signer des UserOps!");
            console.error("   Solutions:");
            if (!vendorSignerMatch) {
                console.error("   1. Mettre à jour le vendorSigner avec setVendorSigner()");
            }
            if (!sessionKeyAuthorized) {
                console.error("   2. Ajouter le wallet comme session key avec addSessionKey()");
            }
        } else {
            console.log("\n✅ Le wallet peut signer des UserOps!");
        }
        
    } catch (error: any) {
        console.error("❌ Erreur lors du diagnostic:", error.message || error.toString());
        process.exit(1);
    }
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});












