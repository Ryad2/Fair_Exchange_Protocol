import hre from "hardhat";
import { ethers, Contract } from "ethers";
import axios from "axios";

const BUNDLER_URL = "http://localhost:3002/rpc";
const ENTRY_POINT = "0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512";

async function main() {
    const contractAddress = process.env.CONTRACT_ADDRESS;
    if (!contractAddress) {
        console.error("❌ Erreur: CONTRACT_ADDRESS non défini");
        console.error("   Utilisez: CONTRACT_ADDRESS=0x... npx hardhat run scripts/debugBundlerIssue.ts --network localhost");
        process.exit(1);
    }
    
    console.log("=".repeat(80));
    console.log("🔍 DIAGNOSTIC APPROFONDI DU PROBLÈME BUNDLER");
    console.log("=".repeat(80));
    console.log("");
    console.log("Adresse du contrat:", contractAddress);
    console.log("EntryPoint:", ENTRY_POINT);
    console.log("");

    const provider = hre.ethers.provider;
    
    // 1. Vérifier le contrat sur Hardhat
    console.log("📋 ÉTAPE 1: Vérification du contrat sur Hardhat");
    const code = await provider.getCode(contractAddress);
    if (!code || code === "0x") {
        console.error("   ❌ Le contrat n'existe PAS sur Hardhat!");
        process.exit(1);
    }
    console.log("   ✅ Contrat trouvé (code:", code.length, "bytes)");
    
    // Vérifier les propriétés
    try {
        const accountAbi = [
            "function nonce() view returns (uint256)",
            "function entryPoint() view returns (address)",
            "function vendorSigner() view returns (address)"
        ];
        const contract = new Contract(contractAddress, accountAbi, provider);
        const nonce = await contract.nonce();
        const entryPoint = await contract.entryPoint();
        const vendorSigner = await contract.vendorSigner();
        
        console.log("   Nonce:", nonce.toString());
        console.log("   EntryPoint du contrat:", entryPoint);
        console.log("   VendorSigner:", vendorSigner);
        
        if (entryPoint.toLowerCase() !== ENTRY_POINT.toLowerCase()) {
            console.error("");
            console.error("   ⚠️  PROBLÈME DÉTECTÉ!");
            console.error("   Le contrat utilise un EntryPoint différent de celui configuré dans le bundler!");
            console.error("   EntryPoint du contrat:", entryPoint);
            console.error("   EntryPoint du bundler:", ENTRY_POINT);
            console.error("");
            console.error("   SOLUTION: Redéploie le contrat avec le bon EntryPoint");
        }
    } catch (e: any) {
        console.warn("   ⚠️  Erreur lors de la lecture:", e.message);
    }
    console.log("");

    // 2. Vérifier que le bundler peut voir le contrat via simulateValidation
    console.log("📋 ÉTAPE 2: Test de simulation directe avec le bundler");
    
    // Vider le cache d'abord
    try {
        await axios.post(BUNDLER_URL, {
            jsonrpc: "2.0",
            id: 999,
            method: "debug_bundler_clearState",
            params: []
        });
        console.log("   ✅ Cache vidé");
    } catch (e) {
        console.warn("   ⚠️  Impossible de vider le cache");
    }
    
    // Créer une UserOperation minimale
    const accountAbi = [
        "function nonce() view returns (uint256)",
        "function sendKey(bytes) external",
        "function execute(address,uint256,bytes) external"
    ];
    const contract = new Contract(contractAddress, accountAbi, provider);
    const nonce = await contract.nonce();
    
    const sendKeyData = contract.interface.encodeFunctionData("sendKey", ["0x1234"]);
    const executeData = contract.interface.encodeFunctionData("execute", [
        contractAddress,
        0,
        sendKeyData
    ]);
    
    const userOp = {
        sender: contractAddress.toLowerCase(),
        nonce: "0x" + nonce.toString(16),
        initCode: "0x",
        callData: executeData,
        callGasLimit: "0x186a0",
        verificationGasLimit: "0x186a0",
        preVerificationGas: "0x186a0",
        maxFeePerGas: "0x3b9aca00",
        maxPriorityFeePerGas: "0x3b9aca00",
        paymasterAndData: "0x",
        signature: "0x" + "00".repeat(65)
    };
    
    console.log("   Envoi d'une UserOperation au bundler pour simulation...");
    console.log("   sender:", userOp.sender);
    console.log("   nonce:", userOp.nonce);
    console.log("   callData:", executeData.substring(0, 50) + "...");
    console.log("");
    
    try {
        const response = await axios.post(BUNDLER_URL, {
            jsonrpc: "2.0",
            id: 1,
            method: "eth_estimateUserOperationGas",
            params: [userOp, ENTRY_POINT]
        });
        
        if (response.data.error) {
            const error = response.data.error;
            console.error("   ❌ Erreur lors de la simulation:");
            console.error("      Code:", error.code);
            console.error("      Message:", error.message);
            console.error("");
            
            if (error.message?.includes("Sender has no code")) {
                console.error("   🔍 ANALYSE:");
                console.error("      Le bundler ne voit PAS le contrat lors de la simulation!");
                console.error("");
                console.error("   💡 CAUSES POSSIBLES:");
                console.error("      1. Le bundler utilise un cache qui n'est pas vidé");
                console.error("      2. Le bundler simule sur un bloc antérieur au déploiement");
                console.error("      3. Le bundler utilise un RPC différent");
                console.error("      4. Le contrat a été déployé après le démarrage du bundler");
                console.error("");
                console.error("   🔧 SOLUTIONS À ESSAYER:");
                console.error("      1. Vérifie les logs du bundler pour voir le bloc utilisé");
                console.error("      2. Force Hardhat à miner un bloc: curl -X POST http://127.0.0.1:8545 -H 'Content-Type: application/json' --data '{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"evm_mine\",\"params\":[]}'");
                console.error("      3. Vérifie que le bundler utilise bien http://127.0.0.1:8545");
                console.error("      4. REDÉMARRE le bundler APRÈS avoir déployé le contrat");
            }
        } else {
            console.log("   ✅ Simulation réussie!");
            console.log("      Le bundler peut voir le contrat et simuler la UserOperation");
        }
    } catch (error: any) {
        console.error("   ❌ Erreur:", error.message);
        if (error.response) {
            console.error("      Réponse:", JSON.stringify(error.response.data, null, 2));
        }
    }
    console.log("");

    // 3. Vérifier le bloc actuel
    console.log("📋 ÉTAPE 3: Vérification de la synchronisation");
    try {
        const blockNumber = await provider.getBlockNumber();
        console.log("   Bloc actuel sur Hardhat:", blockNumber);
        
        // Forcer un nouveau bloc
        try {
            await provider.send("evm_mine", []);
            const newBlockNumber = await provider.getBlockNumber();
            console.log("   Nouveau bloc après evm_mine:", newBlockNumber);
        } catch (e) {
            console.warn("   ⚠️  evm_mine non disponible");
        }
    } catch (error: any) {
        console.warn("   ⚠️  Erreur:", error.message);
    }
    console.log("");

    console.log("=".repeat(80));
    console.log("✅ Diagnostic terminé");
    console.log("=".repeat(80));
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});













