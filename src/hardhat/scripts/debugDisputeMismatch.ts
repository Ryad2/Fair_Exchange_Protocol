import { ethers } from "hardhat";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import {
    bytes_to_hex,
    compute_precontract_values_v2,
    compile_circuit_v2_wasm,
    compute_proofs_left_v2,
    compute_proofs_v2,
    compute_proof_right_v2,
    evaluate_circuit_v2_wasm,
    hpre_v2,
    initSync,
} from "../../app/lib/crypto_lib/crypto_lib";

const STATE_NAMES = [
    "ChallengeBuyer",
    "WaitVendorOpinion",
    "WaitVendorData",
    "WaitVendorDataLeft",
    "WaitVendorDataRight",
    "Complete",
    "Cancel",
    "End",
];

type Inputs = {
    disputeAddr: string;
    ctHex?: string;
    fileId?: string;
    filePath?: string;
    apiBase: string;
    openingValue?: string;
    description?: string;
    keyHex?: string;
};

function stateName(state: number): string {
    return STATE_NAMES[state] || `Unknown(${state})`;
}

function normalizeHex(value?: string): string | undefined {
    if (!value) return undefined;
    return value.startsWith("0x") ? value : `0x${value}`;
}

function toHexBytes(value: Uint8Array): string {
    return ethers.hexlify(value);
}

async function loadCt(inputs: Inputs): Promise<Uint8Array> {
    if (inputs.ctHex) {
        return ethers.getBytes(normalizeHex(inputs.ctHex) as string);
    }

    if (!inputs.fileId) {
        throw new Error("CT_HEX ou FILE_ID requis pour charger le ciphertext.");
    }

    const url = `${inputs.apiBase.replace(/\/$/, "")}/api/files/${inputs.fileId}`;
    const response = await fetch(url);
    if (!response.ok) {
        throw new Error(`Erreur HTTP ${response.status} en récupérant ${url}`);
    }
    const payload = await response.json();
    if (!payload?.file) {
        throw new Error("Réponse API invalide: champ 'file' manquant.");
    }
    return ethers.getBytes(payload.file);
}

function decodeError(contract: ethers.Contract, error: any): string {
    const data = error?.data || error?.error?.data;
    if (typeof data === "string" && data.startsWith("0x")) {
        try {
            const parsed = contract.interface.parseError(data);
            if (parsed?.name) return parsed.name;
        } catch {
            // ignore
        }
    }
    return error?.reason || error?.shortMessage || error?.message || "Unknown error";
}

async function main() {
    const inputs: Inputs = {
        disputeAddr: process.env.DISPUTE_ADDR || process.argv[2] || "",
        ctHex: process.env.CT_HEX,
        fileId: process.env.FILE_ID,
        filePath: process.env.FILE_PATH,
        apiBase: process.env.API_BASE || "http://localhost:3000",
        openingValue: normalizeHex(process.env.OPENING_VALUE),
        description: process.env.DESCRIPTION_HEX,
        keyHex: normalizeHex(process.env.KEY_HEX),
    };

    if (!inputs.disputeAddr) {
        throw new Error("DISPUTE_ADDR requis (env ou argument).");
    }

    const modulePath = join(
        __dirname,
        "../../app/lib/crypto_lib/crypto_lib_bg.wasm"
    );
    const module = await readFile(modulePath);
    initSync({ module });

    const dispute = await ethers.getContractAt(
        "DisputeSOXAccount",
        inputs.disputeAddr
    );
    const optimisticAddr = await dispute.optimisticContract();
    const optimistic = new ethers.Contract(
        optimisticAddr,
        [
            "function key() view returns (bytes)",
            "function commitment() view returns (bytes32)",
        ],
        ethers.provider
    );

    const numBlocks = Number(await dispute.numBlocks());
    const numGates = Number(await dispute.numGates());
    const state = Number(await dispute.currState());
    const chall = Number(await dispute.chall());
    const commitment = await dispute.commitment();
    const keyBytes = inputs.keyHex
        ? ethers.getBytes(inputs.keyHex)
        : await optimistic.key();
    const keyHex = toHexBytes(keyBytes);

    console.log("=".repeat(80));
    console.log("🔎 Diagnostic mismatch dispute");
    console.log("Dispute:", inputs.disputeAddr);
    console.log("Optimistic:", optimisticAddr);
    console.log("State:", stateName(state), `(${state})`);
    console.log("Challenge:", chall);
    console.log("numBlocks:", numBlocks, "numGates:", numGates);
    console.log("key length:", keyBytes.length, "key:", keyHex);
    if (keyBytes.length !== 16) {
        console.warn("⚠️ Clé AES invalide (longueur != 16).");
    }

    let ct: Uint8Array;
    let descriptionHex = inputs.description;
    let openingValue = inputs.openingValue;

    if (inputs.filePath) {
        const fileBytes = new Uint8Array(await readFile(inputs.filePath));
        const precontract = compute_precontract_values_v2(fileBytes, keyBytes);
        ct = precontract.ct;
        descriptionHex = bytes_to_hex(precontract.description);
        openingValue = openingValue || bytes_to_hex(precontract.commitment.o);
        const computedCommitment = bytes_to_hex(precontract.commitment.c);
        console.log("FILE_PATH:", inputs.filePath);
        console.log("file length:", fileBytes.length);
        console.log("commitment (computed):", computedCommitment);
        console.log("commitment (on-chain):", commitment);
        if (computedCommitment !== commitment) {
            console.warn("❌ Commitment calculé != commitment on-chain.");
        } else {
            console.log("✅ Commitment OK avec le fichier fourni");
        }
    } else {
        if (!descriptionHex) {
            throw new Error("DESCRIPTION_HEX requis (env) sans FILE_PATH.");
        }
        ct = await loadCt(inputs);
    }

    console.log("ct length:", ct.length);
    const expectedBlocks = Math.floor((ct.length - 16) / 64);
    if (expectedBlocks !== numBlocks) {
        console.warn(
            `⚠️ numBlocks mismatch: on-chain=${numBlocks}, ct implies=${expectedBlocks}`
        );
    }

    if (openingValue) {
        const openingHash = ethers.keccak256(openingValue);
        console.log("openingValue hash:", openingHash);
        console.log("commitment on-chain:", commitment);
        if (openingHash !== commitment) {
            console.warn("❌ Opening value ne correspond pas au commitment.");
        } else {
            console.log("✅ Opening value OK");
        }
    } else {
        console.warn("⚠️ OPENING_VALUE non fourni (pas de check commitment).");
    }

    if (!descriptionHex) {
        throw new Error("DESCRIPTION_HEX manquant après chargement des inputs.");
    }
    const circuit = compile_circuit_v2_wasm(ct, descriptionHex);
    const evaluated = evaluate_circuit_v2_wasm(circuit, ct, keyHex).to_bytes();

    const hpreChallenge = hpre_v2(evaluated, numBlocks, chall);
    const onChainResponse = await dispute.getBuyerResponse(chall);
    console.log("hpre(challenge):", toHexBytes(hpreChallenge));
    console.log("buyerResponse:", onChainResponse);
    if (toHexBytes(hpreChallenge) !== onChainResponse) {
        console.warn("❌ Réponse buyer ne correspond pas au calcul local.");
    } else {
        console.log("✅ Réponse buyer OK pour challenge actuel");
    }

    const hpreFinal = hpre_v2(evaluated, numBlocks, numGates);
    const onChainFinal = await dispute.getBuyerResponse(numGates);
    console.log("hpre(numGates):", toHexBytes(hpreFinal));
    console.log("buyerResponse[numGates]:", onChainFinal);
    if (toHexBytes(hpreFinal) !== onChainFinal) {
        console.warn("❌ Réponse buyer numGates ne correspond pas (Step 8c).");
    } else {
        console.log("✅ Réponse buyer OK pour numGates");
    }

    if (!openingValue) {
        console.warn("⚠️ Skip proofs: OPENING_VALUE requis pour submitCommitment*");
        return;
    }

    if (state === 4) {
        const proof = compute_proof_right_v2(evaluated, numBlocks, numGates);
        const proofBytes32: string[][] = proof.map((layer: Uint8Array[]) =>
            layer.map((item: Uint8Array) => ethers.hexlify(new Uint8Array(item)))
        );
        try {
            await dispute.submitCommitmentRight.staticCall(proofBytes32);
            console.log("✅ submitCommitmentRight staticCall OK");
        } catch (error: any) {
            console.error(
                "❌ submitCommitmentRight staticCall KO:",
                decodeError(dispute, error)
            );
        }
        return;
    }

    const gateNum = Number(await dispute.a());

    if (state === 3) {
        const proofs = compute_proofs_left_v2(circuit, evaluated, ct, gateNum);
        const gateBytesArray = new Uint8Array(proofs.gate_bytes);
        const valuesArray = proofs.values.map(
            (v: Uint8Array) => new Uint8Array(v)
        );
        const currAccArray = new Uint8Array(proofs.curr_acc);
        const proof1Array = proofs.proof1.map((level: Uint8Array[]) =>
            level.map((v: Uint8Array) => ethers.hexlify(new Uint8Array(v)))
        );
        const proof2Array = proofs.proof2.map((level: Uint8Array[]) =>
            level.map((v: Uint8Array) => ethers.hexlify(new Uint8Array(v)))
        );
        const proofExtArray = proofs.proof_ext.map((level: Uint8Array[]) =>
            level.map((v: Uint8Array) => ethers.hexlify(new Uint8Array(v)))
        );
        try {
            await dispute.submitCommitmentLeft.staticCall(
                openingValue,
                gateNum,
                gateBytesArray,
                valuesArray,
                currAccArray,
                proof1Array,
                proof2Array,
                proofExtArray
            );
            console.log("✅ submitCommitmentLeft staticCall OK");
        } catch (error: any) {
            console.error(
                "❌ submitCommitmentLeft staticCall KO:",
                decodeError(dispute, error)
            );
        }
        return;
    }

    if (state === 2) {
        const proofs = compute_proofs_v2(circuit, evaluated, ct, gateNum);
        const gateBytesArray = new Uint8Array(proofs.gate_bytes);
        const valuesArray = proofs.values.map(
            (v: Uint8Array) => new Uint8Array(v)
        );
        const currAccArray = new Uint8Array(proofs.curr_acc);
        const proof1Array = proofs.proof1.map((level: Uint8Array[]) =>
            level.map((v: Uint8Array) => ethers.hexlify(new Uint8Array(v)))
        );
        const proof2Array = proofs.proof2.map((level: Uint8Array[]) =>
            level.map((v: Uint8Array) => ethers.hexlify(new Uint8Array(v)))
        );
        const proof3Array = proofs.proof3.map((level: Uint8Array[]) =>
            level.map((v: Uint8Array) => ethers.hexlify(new Uint8Array(v)))
        );
        const proofExtArray = proofs.proof_ext.map((level: Uint8Array[]) =>
            level.map((v: Uint8Array) => ethers.hexlify(new Uint8Array(v)))
        );
        try {
            await dispute.submitCommitment.staticCall(
                openingValue,
                gateNum,
                gateBytesArray,
                valuesArray,
                currAccArray,
                proof1Array,
                proof2Array,
                proof3Array,
                proofExtArray
            );
            console.log("✅ submitCommitment staticCall OK");
        } catch (error: any) {
            console.error(
                "❌ submitCommitment staticCall KO:",
                decodeError(dispute, error)
            );
        }
        return;
    }

    console.log(
        "Etat actuel ne permet pas de tester les preuves (attendu: 2/3/4)."
    );
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
