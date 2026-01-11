import { abi } from "./contracts/DisputeSOXAccount.json";
import { PK_SK_MAP, PROVIDER, ENTRY_POINT_V8, EIP7702_DELEGATE } from "./config";
import { sendUserOperation, sendUserOperationV8, waitForUserOperationReceipt } from "./userops";
import { Contract, isAddress, hexlify, getBytes, Wallet } from "ethers";

const DISPUTE_ERROR_HINTS: Record<string, string> = {
    InvalidState: "Le contrat n'est pas dans l'état attendu pour cette action.",
    UnexpectedSender: "Le signataire n'est pas l'acteur attendu (buyer/vendor/sponsor).",
    AESKeyInvalid: "La clé AES n'est pas encore définie (le vendeur doit envoyer la clé).",
    InvalidGateBytes: "Le format des gate bytes est invalide (64 octets attendus).",
    InvalidV2SonIndex: "Indice de fils invalide dans la preuve.",
    CTIndexOutOfBounds: "Index CT en dehors des limites.",
    InvalidOptimisticState: "Le contrat optimiste n'est pas dans l'état attendu.",
    InsufficientFunds: "Fonds insuffisants pour l'action.",
    InvalidSignature: "Signature invalide pour ce rôle.",
    InvalidSignatureLength: "Signature invalide (longueur).",
    InvalidSignatureV: "Signature invalide (v).",
    InvalidSignatureS: "Signature invalide (s).",
    OnlyBuyer: "Seul le buyer peut effectuer cette action.",
    OnlyVendor: "Seul le vendor peut effectuer cette action.",
    OnlyBuyerDisputeSponsor: "Seul le sponsor buyer peut effectuer cette action.",
    OnlyVendorDisputeSponsor: "Seul le sponsor vendor peut effectuer cette action.",
};

function extractErrorName(contract: Contract, error: any): string | null {
    const data = error?.data || error?.error?.data;
    if (typeof data === "string" && data.startsWith("0x")) {
        try {
            const parsed = contract.interface.parseError(data);
            if (parsed?.name) {
                return parsed.name;
            }
        } catch {
            // ignore parse failures
        }
    }

    const message =
        error?.shortMessage || error?.reason || error?.message || "";
    const match = message.match(/reverted:?\s*([A-Za-z0-9_]+)/i);
    if (match && match[1]) {
        return match[1];
    }

    return null;
}

function formatDisputeError(contract: Contract, error: any): string {
    console.error("🔍 formatDisputeError - Erreur brute:", error);
    console.error("🔍 formatDisputeError - Type:", typeof error);
    console.error("🔍 formatDisputeError - Constructeur:", error?.constructor?.name);
    
    // Essayer d'extraire le nom de l'erreur personnalisée
    const errorName = extractErrorName(contract, error);
    if (errorName) {
        const hint = DISPUTE_ERROR_HINTS[errorName];
        return hint ? `${hint} (${errorName})` : `Erreur: ${errorName}`;
    }

    // Essayer plusieurs sources pour le message d'erreur
    let errorMessage = error?.shortMessage || error?.reason || error?.message;
    
    // Si pas de message, essayer de décoder les données
    if (!errorMessage || errorMessage === "Error") {
        const data = error?.data || error?.error?.data;
        if (data) {
            console.error("🔍 Données d'erreur:", data);
            // Si c'est un hex string, essayer de décoder
            if (typeof data === 'string' && data.startsWith('0x')) {
                // C'est probablement un selector d'erreur custom
                const selector = data.slice(0, 10).toLowerCase();
                console.error("🔍 Selector d'erreur:", selector);
                // TransactionReverted() = 0x9167c27a
                if (selector === '0x9167c27a') {
                    errorMessage = "Transaction rejetée: L'appel interne au contrat a échoué. Cela peut être dû à une vérification de preuve qui a échoué, une vérification d'état invalide, ou une erreur dans les données fournies.";
                } else {
                    errorMessage = `Erreur du contrat (selector: ${selector})`;
                }
            } else {
                errorMessage = String(data);
            }
        }
    }
    
    // Si toujours pas de message, utiliser toString ou une description générique
    if (!errorMessage || errorMessage === "Error") {
        if (typeof error?.toString === 'function') {
            const errorStr = error.toString();
            if (errorStr !== '[object Object]' && errorStr !== 'Error') {
                errorMessage = errorStr;
            }
        }
    }
    
    if (!errorMessage || errorMessage === "Error") {
        errorMessage = `Erreur inconnue lors de la pré-vérification. Type: ${typeof error}, Constructor: ${error?.constructor?.name || 'N/A'}`;
    }
    
    return errorMessage;
}

async function preflightDisputeCall(
    contract: Contract,
    signerAddr: string,
    method: string,
    args: any[]
) {
    const privateKey = PK_SK_MAP.get(signerAddr);
    if (!privateKey) {
        return;
    }
    const wallet = new Wallet(privateKey, PROVIDER);
    try {
        console.log(`🔍 Pré-vérification: ${method} avec ${args.length} arguments`);
        const connected = contract.connect(wallet) as any;
        await connected[method].staticCall(...args);
        console.log(`✅ Pré-vérification réussie pour ${method}`);
    } catch (error: any) {
        console.error(`❌ Pré-vérification échouée pour ${method}:`, error);
        
        // Essayer plusieurs façons d'extraire le message d'erreur
        // Avec ethers.js v6, les erreurs peuvent avoir une structure différente
        let errorMessage: string | undefined;
        
        // 1. Essayer les propriétés standard
        errorMessage = error?.message || error?.reason || error?.shortMessage;
        
        // 2. Essayer error.error (erreurs imbriquées)
        if (!errorMessage && error?.error) {
            errorMessage = error.error.message || error.error.reason || error.error.shortMessage || error.error.data;
        }
        
        // 3. Essayer error.cause (erreurs en chaîne)
        if (!errorMessage && error?.cause) {
            errorMessage = error.cause.message || error.cause.reason || String(error.cause);
        }
        
        // 4. Essayer de décoder error.data (données hex)
        if (!errorMessage) {
            const data = error?.data || error?.error?.data || error?.cause?.data;
            if (data) {
                if (typeof data === 'string' && data.startsWith('0x')) {
                    const selector = data.slice(0, 10).toLowerCase();
                    if (selector === '0x9167c27a') {
                        errorMessage = "Transaction rejetée: L'appel interne au contrat a échoué (TransactionReverted). Cela peut être dû à une vérification de preuve qui a échoué, une vérification d'état invalide, ou une erreur dans les données fournies.";
                    } else if (selector === '0x08c379a0') {
                        // Error(string) - essayer de décoder
                        try {
                            const decoded = contract.interface.decodeErrorResult("Error(string)", data);
                            errorMessage = decoded[0] || `Erreur du contrat (Error string)`;
                        } catch {
                            errorMessage = `Erreur du contrat (selector: ${selector})`;
                        }
                    } else {
                        errorMessage = `Erreur du contrat (selector: ${selector})`;
                    }
                } else if (typeof data === 'string') {
                    errorMessage = data;
                } else {
                    errorMessage = String(data);
                }
            }
        }
        
        // 5. Essayer toString()
        if (!errorMessage) {
            try {
                const errorStr = String(error);
                if (errorStr && errorStr !== '[object Object]' && errorStr !== 'Error' && errorStr.trim() !== '') {
                    errorMessage = errorStr;
                }
            } catch (e) {
                // Ignore
            }
        }
        
        // 6. Message par défaut
        if (!errorMessage || errorMessage.trim() === '') {
            errorMessage = `Erreur lors de la pré-vérification de ${method}. Le contrat a rejeté la transaction. Vérifiez que le contrat est dans le bon état et que les données sont correctes.`;
        }
        
        throw new Error(errorMessage);
    }
}

export async function getDisputeState(contractAddr: string) {
    if (!isAddress(contractAddr)) return;

    const contract = new Contract(contractAddr, abi, PROVIDER);
    return await contract.currState().catch(() => {});
}

export async function getChallenge(contractAddr: string) {
    if (!isAddress(contractAddr)) return;

    const contract = new Contract(contractAddr, abi, PROVIDER);
    return await contract.chall();
}

async function sendDisputeUserOp(
    signerAddr: string,
    contractAddr: string,
    callData: string
): Promise<string> {
    const privateKey = PK_SK_MAP.get(signerAddr);
    if (!privateKey) {
        throw new Error(`Private key not found for address: ${signerAddr}`);
    }

    const contract = new Contract(contractAddr, abi, PROVIDER);
    // Encoder l'appel à execute() sur le contrat dispute, comme dans sendKey
    // Le contrat dispute est un compte abstrait ERC-4337, donc on appelle execute(self, 0, callData)
    const executeData = contract.interface.encodeFunctionData("execute", [
        contractAddr, // target: le contrat dispute lui-même
        0,            // value: 0 (pas d'ETH envoyé)
        callData,     // data: les données de la fonction à appeler (respondChallenge, giveOpinion, submitCommitment, etc.)
    ]);

    // Utiliser ERC-4337 classique (comme sendKey), pas EIP-7702
    // Le contrat dispute utilise buyerSigner/vendorSigner pour valider les signatures
    // Le sender est le contrat dispute (compte abstrait ERC-4337)
    return sendUserOperation({
        sender: contractAddr, // Le contrat dispute est le compte abstrait ERC-4337
        callData: executeData,
        signerPrivateKey: privateKey, // La clé privée correspondant à buyerSigner ou vendorSigner
    });
}

export async function respondChallenge(
    buyerAddr: string,
    contractAddr: string,
    response: string
) {
    const contract = new Contract(contractAddr, abi, PROVIDER);
    await preflightDisputeCall(contract, buyerAddr, "respondChallenge", [
        response,
    ]);
    const callData = contract.interface.encodeFunctionData("respondChallenge", [
        response,
    ]);
    await sendDisputeUserOp(buyerAddr, contractAddr, callData);
}

export async function getLatestChallengeResponse(contractAddr: string) {
    if (!isAddress(contractAddr)) return;

    let contract = new Contract(contractAddr, abi, PROVIDER);
    return await contract.getLatestBuyerResponse();
}

export async function getNextDisputeTimeout(contractAddr: string) {
    if (!isAddress(contractAddr)) return;

    const contract = new Contract(contractAddr, abi, PROVIDER);
    return await contract.nextTimeoutTime().catch(() => {});
}

export async function giveOpinion(
    vendorAddr: string,
    contractAddr: string,
    opinion: boolean
) {
    const contract = new Contract(contractAddr, abi, PROVIDER);
    await preflightDisputeCall(contract, vendorAddr, "giveOpinion", [opinion]);
    const callData = contract.interface.encodeFunctionData("giveOpinion", [
        opinion,
    ]);
    
    // Use the private key of the person sending the transaction (vendorAddr)
    // Note: For ERC-4337 user operations, the signature must match vendorSigner in the contract.
    // If the contract doesn't have the handleStep9 fix, vendorSigner won't be updated when
    // the sponsor takes over, and the transaction will fail. The contract must be redeployed
    // with the fix for this to work properly.
    await sendDisputeUserOp(vendorAddr, contractAddr, callData);
}

export async function submitCommitment(
    openingValue: string,
    gateNum: number,
    gateBytes: number[] | Uint8Array, // V2 format: 64-byte gate bytes
    values: Uint8Array[],
    currAcc: Uint8Array,
    proof1: Uint8Array[][],
    proof2: Uint8Array[][],
    proof3: Uint8Array[][],
    proofExt: Uint8Array[][],
    vendorAddr: string,
    contractAddr: string
): Promise<string> {
    // Convert gateBytes to Uint8Array for ethers.js bytes format
    const gateBytesUint8 = gateBytes instanceof Uint8Array 
        ? gateBytes 
        : new Uint8Array(gateBytes);

    // Convert openingValue to bytes format (ensure it has 0x prefix if it's a hex string)
    let openingValueBytes: string;
    if (openingValue.startsWith("0x")) {
        openingValueBytes = openingValue;
    } else {
        openingValueBytes = "0x" + openingValue;
    }

    const contract = new Contract(contractAddr, abi, PROVIDER);
    await preflightDisputeCall(contract, vendorAddr, "submitCommitment", [
        openingValueBytes,
        gateNum,
        gateBytesUint8,
        values,
        currAcc,
        proof1,
        proof2,
        proof3,
        proofExt,
    ]);
    const callData = contract.interface.encodeFunctionData("submitCommitment", [
        openingValueBytes,
        gateNum,
        gateBytesUint8,
        values,
        currAcc,
        proof1,
        proof2,
        proof3,
        proofExt,
    ]);
    const userOpHash = await sendDisputeUserOp(vendorAddr, contractAddr, callData);
    
    // Attendre la confirmation de la UserOperation
    console.log("⏳ En attente de la confirmation de la UserOperation...");
    const receipt = await waitForUserOperationReceipt(userOpHash);
    if (!receipt.success) {
        // Log le receipt complet pour debug
        console.error("❌ UserOperation échouée. Receipt complet:", JSON.stringify(receipt, null, 2));
        const receiptInfo = receipt as any;
        const reason = receiptInfo.reason || "Raison inconnue";
        
        // Décoder le selector d'erreur si c'est un hex string
        let errorMessage = "Transaction rejetée par le contrat";
        if (reason && typeof reason === 'string' && reason.startsWith('0x')) {
            const selector = reason.slice(0, 10).toLowerCase();
            // TransactionReverted() = 0x9167c27a
            if (selector === '0x9167c27a') {
                errorMessage = "Transaction rejetée: L'appel interne au contrat a échoué. Cela peut être dû à:\n- Une vérification de preuve qui a échoué\n- Une vérification d'état invalide\n- Une erreur dans les données fournies";
            }
        }
        
        throw new Error(`${errorMessage}\nHash: ${userOpHash.slice(0, 20)}...\nRaison (selector): ${reason}`);
    }
    console.log("✅ UserOperation confirmée:", receipt);
    
    return userOpHash;
}

export async function submitCommitmentLeft(
    openingValue: string,
    gateNum: number,
    gateBytes: number[] | Uint8Array, // V2 format: 64-byte gate bytes
    values: Uint8Array[],
    currAcc: Uint8Array,
    proof1: Uint8Array[][],
    proof2: Uint8Array[][],
    proofExt: Uint8Array[][],
    vendorAddr: string,
    contractAddr: string
): Promise<string> {
    // Convert gateBytes to Uint8Array for ethers.js bytes format
    const gateBytesUint8 = gateBytes instanceof Uint8Array 
        ? gateBytes 
        : new Uint8Array(gateBytes);

    // Convert openingValue to bytes format (ensure it has 0x prefix if it's a hex string)
    let openingValueBytes: string;
    if (openingValue.startsWith("0x")) {
        openingValueBytes = openingValue;
    } else {
        openingValueBytes = "0x" + openingValue;
    }

    const contract = new Contract(contractAddr, abi, PROVIDER);
    await preflightDisputeCall(contract, vendorAddr, "submitCommitmentLeft", [
        openingValueBytes,
        gateNum,
        gateBytesUint8,
        values,
        currAcc,
        proof1,
        proof2,
        proofExt,
    ]);
    const callData = contract.interface.encodeFunctionData(
        "submitCommitmentLeft",
        [
            openingValueBytes,
            gateNum,
            gateBytesUint8,
            values,
            currAcc,
            proof1,
            proof2,
            proofExt,
        ]
    );
    const userOpHash = await sendDisputeUserOp(vendorAddr, contractAddr, callData);
    
    // Attendre la confirmation de la UserOperation
    console.log("⏳ En attente de la confirmation de la UserOperation...");
    const receipt = await waitForUserOperationReceipt(userOpHash);
    if (!receipt.success) {
        // Log le receipt complet pour debug
        console.error("❌ UserOperation échouée. Receipt complet:", JSON.stringify(receipt, null, 2));
        const receiptInfo = receipt as any;
        const reason = receiptInfo.reason || "Raison inconnue";
        
        // Décoder le selector d'erreur si c'est un hex string
        let errorMessage = "Transaction rejetée par le contrat";
        if (reason && typeof reason === 'string' && reason.startsWith('0x')) {
            const selector = reason.slice(0, 10).toLowerCase();
            // TransactionReverted() = 0x9167c27a
            if (selector === '0x9167c27a') {
                errorMessage = "Transaction rejetée: L'appel interne au contrat a échoué. Cela peut être dû à:\n- Une vérification de preuve qui a échoué\n- Une vérification d'état invalide\n- Une erreur dans les données fournies";
            }
        }
        
        throw new Error(`${errorMessage}\nHash: ${userOpHash.slice(0, 20)}...\nRaison (selector): ${reason}`);
    }
    console.log("✅ UserOperation confirmée:", receipt);
    
    return userOpHash;
}

export async function submitCommitmentRight(
    proof: Uint8Array[][],
    vendorAddr: string,
    contractAddr: string
): Promise<string> {
    try {
        // Vérifier que la preuve est valide
        if (!proof || !Array.isArray(proof) || proof.length === 0) {
            throw new Error("Preuve invalide: doit être un tableau non vide");
        }
        
        console.log(`📊 Conversion de la preuve: ${proof.length} couches`);
        
        // Convertir les preuves Uint8Array[][] en bytes32[][] (chaînes hex)
        // Chaque élément doit être exactement 32 bytes pour être un bytes32 valide
        const proofBytes32: string[][] = [];
        for (let layer = 0; layer < proof.length; layer++) {
            if (!Array.isArray(proof[layer])) {
                throw new Error(`Preuve invalide: la couche ${layer} n'est pas un tableau`);
            }
            
            const layerArray: string[] = [];
            for (let item = 0; item < proof[layer].length; item++) {
                let itemBytes: Uint8Array;
                
                // Gérer différents formats possibles
                if (proof[layer][item] instanceof Uint8Array) {
                    itemBytes = proof[layer][item];
                } else if (Array.isArray(proof[layer][item])) {
                    itemBytes = new Uint8Array(proof[layer][item]);
                } else {
                    throw new Error(`Preuve invalide: l'élément à la couche ${layer}, index ${item} n'est pas un Uint8Array`);
                }
                
                // S'assurer que l'élément fait exactement 32 bytes
                if (itemBytes.length !== 32) {
                    throw new Error(`Preuve invalide: l'élément à la couche ${layer}, index ${item} a une longueur de ${itemBytes.length} bytes, attendu 32 bytes`);
                }
                layerArray.push(hexlify(itemBytes));
            }
            proofBytes32.push(layerArray);
        }
        
        console.log(`📊 Preuve convertie: ${proofBytes32.length} couches`);
        if (proofBytes32.length > 0) {
            console.log(`   Première couche: ${proofBytes32[0].length} éléments`);
            if (proofBytes32[0].length > 0) {
                console.log(`   Premier élément: ${proofBytes32[0][0].slice(0, 20)}...`);
            }
        }
        
        const contract = new Contract(contractAddr, abi, PROVIDER);
        console.log("🔍 Pré-vérification de l'appel (preflight)...");
        try {
            await preflightDisputeCall(contract, vendorAddr, "submitCommitmentRight", [
                proofBytes32,
            ]);
            console.log("✅ Pré-vérification réussie");
        } catch (preflightError: any) {
            console.error("❌ Pré-vérification échouée:", preflightError);
            console.error("⚠️  La pré-vérification a échoué, mais on continue quand même pour voir l'erreur réelle du contrat");
            // Ne pas throw ici, continuer pour voir l'erreur réelle
            // throw preflightError;
        }
        
        console.log("📝 Encodage des données de la fonction...");
        const callData = contract.interface.encodeFunctionData("submitCommitmentRight", [
            proofBytes32,
        ]);
        
        console.log("📤 Envoi de la UserOperation...");
        const userOpHash = await sendDisputeUserOp(vendorAddr, contractAddr, callData);
        console.log(`✅ UserOperation envoyée: ${userOpHash}`);
        
        // Attendre la confirmation de la UserOperation
        console.log("⏳ En attente de la confirmation de la UserOperation...");
        const receipt = await waitForUserOperationReceipt(userOpHash);
        if (!receipt.success) {
            // Log le receipt complet pour debug
            console.error("❌ UserOperation échouée. Receipt complet:", JSON.stringify(receipt, null, 2));
            const receiptInfo = receipt as any;
            const reason = receiptInfo.reason || "Raison inconnue";
            
            // Décoder le selector d'erreur si c'est un hex string
            let errorMessage = "Transaction rejetée par le contrat";
            if (reason && typeof reason === 'string' && reason.startsWith('0x')) {
                const selector = reason.slice(0, 10).toLowerCase();
                // TransactionReverted() = 0x9167c27a
                if (selector === '0x9167c27a' || selector.startsWith('0x9167')) {
                    errorMessage = "Transaction rejetée: L'appel interne au contrat a échoué.\n\nCauses possibles:\n- La vérification de la preuve a échoué (buyerResponses[numGates] n'est peut-être pas défini)\n- Le format de la preuve est incorrect\n- L'état du contrat n'est pas celui attendu\n\nNote: Pour submitCommitmentRight, le buyer doit avoir répondu pour le challenge numGates avant que le vendor puisse envoyer les preuves.";
                }
            }
            
            throw new Error(`${errorMessage}\n\nHash: ${userOpHash.slice(0, 20)}...\nRaison (selector): ${reason}`);
        }
        console.log("✅ UserOperation confirmée:", receipt);
        
        return userOpHash;
    } catch (error: any) {
        console.error("❌ Erreur dans submitCommitmentRight:", error);
        console.error("Type d'erreur:", typeof error);
        console.error("Constructeur:", error?.constructor?.name);
        console.error("Détails de l'erreur:", {
            message: error?.message,
            reason: error?.reason,
            code: error?.code,
            data: error?.data,
            shortMessage: error?.shortMessage,
            stack: error?.stack,
        });
        
        // Essayer de sérialiser l'erreur complète
        let errorString = "";
        try {
            errorString = JSON.stringify(error, Object.getOwnPropertyNames(error));
        } catch (e) {
            errorString = String(error);
        }
        console.error("Erreur complète (JSON):", errorString);
        
        // Si c'est déjà une Error avec un message informatif, la relancer
        if (error instanceof Error && error.message && error.message !== "Error" && error.message.trim() !== "") {
            throw error;
        }
        
        // Extraire le message le plus informatif possible
        let errorMessage = error?.message || error?.reason || error?.shortMessage;
        if (!errorMessage || errorMessage === "Error" || errorMessage.trim() === "") {
            // Essayer toString si disponible
            if (typeof error?.toString === 'function') {
                const errorStr = error.toString();
                if (errorStr !== '[object Object]' && errorStr !== 'Error' && errorStr.trim() !== "") {
                    errorMessage = errorStr;
                }
            }
        }
        
        // Si toujours pas de message, utiliser la sérialisation
        if (!errorMessage || errorMessage === "Error") {
            errorMessage = errorString.length > 200 ? errorString.substring(0, 200) + "..." : errorString;
        }
        
        if (!errorMessage || errorMessage.trim() === "") {
            errorMessage = "Erreur inconnue lors de l'envoi des preuves";
        }
        
        throw new Error(errorMessage);
    }
}

export async function finishDispute(
    state: number,
    requesterAddr: string,
    contractAddr: string
) {
    if (state == 5) {
        const contract = new Contract(contractAddr, abi, PROVIDER);
        const callData = contract.interface.encodeFunctionData("completeDispute");
        await sendDisputeUserOp(requesterAddr, contractAddr, callData);
    } else if (state == 6) {
        const contract = new Contract(contractAddr, abi, PROVIDER);
        const callData = contract.interface.encodeFunctionData("cancelDispute");
        await sendDisputeUserOp(requesterAddr, contractAddr, callData);
    }
}

export async function endDisputeTimeout(
    contractAddr: string,
    requesterAddr: string
) {
    if (!isAddress(contractAddr)) return;

    const contract = new Contract(contractAddr, abi, PROVIDER);
    const state = await contract.currState();

    if ([0, 5].includes(Number(state))) {
        const callData = contract.interface.encodeFunctionData("completeDispute");
        await sendDisputeUserOp(requesterAddr, contractAddr, callData);
        return true;
    } else if (state != 7) {
        const callData = contract.interface.encodeFunctionData("cancelDispute");
        await sendDisputeUserOp(requesterAddr, contractAddr, callData);
        return false;
    } else {
        throw Error("Cannot end dispute when it is already over");
    }
}

export async function getStep9Info(contractAddr: string) {
    if (!isAddress(contractAddr)) return null;

    const contract = new Contract(contractAddr, abi, PROVIDER);
    try {
        const step9Count = await contract.step9Count();
        const lastLosingPartyWasVendor = await contract.lastLosingPartyWasVendor();
        return {
            step9Count: Number(step9Count),
            lastLosingPartyWasVendor: lastLosingPartyWasVendor,
        };
    } catch (error) {
        console.error("Error fetching Step 9 info:", error);
        return null;
    }
}

export async function getDisputeDetails(contractAddr: string) {
    if (!isAddress(contractAddr)) return null;

    const contract = new Contract(contractAddr, abi, PROVIDER);
    try {
        const [step9Count, lastLosingPartyWasVendor, buyer, vendor, buyerDisputeSponsor, vendorDisputeSponsor] = await Promise.all([
            contract.step9Count(),
            contract.lastLosingPartyWasVendor(),
            contract.buyer(),
            contract.vendor(),
            contract.buyerDisputeSponsor(),
            contract.vendorDisputeSponsor(),
        ]);
        
        return {
            step9Count: Number(step9Count),
            lastLosingPartyWasVendor: lastLosingPartyWasVendor,
            buyer: buyer,
            vendor: vendor,
            buyerDisputeSponsor: buyerDisputeSponsor,
            vendorDisputeSponsor: vendorDisputeSponsor,
        };
    } catch (error) {
        console.error("Error fetching dispute details:", error);
        return null;
    }
}
