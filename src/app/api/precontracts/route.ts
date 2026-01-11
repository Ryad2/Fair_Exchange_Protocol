import db from "../../lib/sqlite";
import { NextRequest, NextResponse } from "next/server";
import fs, { readFileSync } from "node:fs";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { UPLOADS_PATH, WASM_PATH } from "../files/[id]/route";

// Imports WASM conditionnels pour éviter les erreurs si le module n'est pas disponible
let hex_to_bytes: any;
let initSync: any;
let bytes_to_hex: any;

try {
    const cryptoLib = require("@/app/lib/crypto_lib");
    hex_to_bytes = cryptoLib.hex_to_bytes;
    initSync = cryptoLib.initSync;
    bytes_to_hex = cryptoLib.bytes_to_hex;
} catch (wasmImportError: any) {
    console.warn("⚠️ Impossible d'importer le module crypto_lib:", wasmImportError.message);
    // Les fonctions seront undefined, on gérera ça dans le code
}

const execFileAsync = promisify(execFile);

const PRECONTRACT_CLI_PATH = path.join(
    process.cwd(),
    "src",
    "wasm",
    "target",
    "release",
    "precontract_cli"
);

export async function GET(req: NextRequest) {
    try {
        const pk = await req.nextUrl.searchParams.get("pk");
        const stmt = db.prepare(`SELECT * FROM contracts 
            WHERE pk_buyer = ? AND accepted = 0`);

        const contracts = stmt.all(pk);

        return NextResponse.json(contracts);
    } catch (error: any) {
        console.error("❌ Erreur dans GET /api/precontracts:", error);
        return NextResponse.json(
            { 
                error: error instanceof Error ? error.message : String(error),
                ...(process.env.NODE_ENV === "development" && { stack: error?.stack })
            },
            { 
                status: 500,
                headers: {
                    "Content-Type": "application/json; charset=utf-8"
                }
            }
        );
    }
}

export async function PUT(req: Request) {
    try {
        console.log("📥 PUT /api/precontracts appelé");
        
        // Vérifier que la base de données est accessible
        try {
            db.prepare("SELECT 1").get();
        } catch (dbTestError: any) {
            console.error("❌ La base de données n'est pas accessible:", dbTestError);
            throw new Error(`Base de données inaccessible: ${dbTestError.message || dbTestError}`);
        }
        
        // Détecter si c'est FormData ou JSON
        const contentType = req.headers.get("content-type") || "";
        console.log("📋 Content-Type:", contentType);
        
        let data: any;
        let filePath: string | null = null;
        let preOut: any = null;

        if (contentType.includes("multipart/form-data")) {
            // Mode web: FormData avec fichier
            const formData = await req.formData();
            
            // Extraire les champs du formulaire
            data = {
                pk_buyer: formData.get("pk_buyer") as string,
                pk_vendor: formData.get("pk_vendor") as string,
                price: formData.get("price") as string,
                tip_completion: formData.get("tip_completion") as string,
                tip_dispute: formData.get("tip_dispute") as string,
                protocol_version: formData.get("protocol_version") as string,
                timeout_delay: formData.get("timeout_delay") as string,
                algorithm_suite: formData.get("algorithm_suite") as string,
            };

            // Sauvegarder le fichier temporairement
            const file = formData.get("file") as File;
            if (!file) {
                return NextResponse.json(
                    { error: "Fichier manquant" },
                    { status: 400 }
                );
            }

            // Créer un répertoire temporaire si nécessaire
            const tempDir = path.join(process.cwd(), "tmp");
            if (!fs.existsSync(tempDir)) {
                fs.mkdirSync(tempDir, { recursive: true });
            }

            // Sauvegarder le fichier temporairement
            const tempFilePath = path.join(tempDir, `temp_${Date.now()}_${file.name}`);
            const arrayBuffer = await file.arrayBuffer();
            fs.writeFileSync(tempFilePath, Buffer.from(arrayBuffer));

            // Appeler le binaire Rust precontract_cli
            try {
                const { stdout } = await execFileAsync(PRECONTRACT_CLI_PATH, [tempFilePath]);
                preOut = JSON.parse(stdout.toString());
                
                // Ajouter la clé en hex si elle n'est pas déjà présente
                if (preOut && !preOut.key_hex) {
                    // La clé devrait être générée par le binaire, mais si elle n'est pas dans la sortie,
                    // on doit la récupérer d'une autre manière
                    // Pour l'instant, on suppose que le binaire retourne key_hex
                }
            } catch (error: any) {
                // Nettoyer le fichier temporaire en cas d'erreur
                if (fs.existsSync(tempFilePath)) {
                    fs.unlinkSync(tempFilePath);
                }
                console.error("Erreur lors de l'exécution de precontract_cli:", error);
                return NextResponse.json(
                    { error: `Erreur lors du calcul du precontract: ${error.message || error.toString()}` },
                    { status: 500 }
                );
            }

            // Déplacer le fichier chiffré vers le répertoire d'uploads
            if (preOut.ciphertext_path && fs.existsSync(preOut.ciphertext_path)) {
                filePath = preOut.ciphertext_path;
            }

            // Nettoyer le fichier temporaire original
            if (fs.existsSync(tempFilePath)) {
                fs.unlinkSync(tempFilePath);
            }
        } else {
            // Mode Electron: JSON avec preOut
            try {
                data = await req.json();
                preOut = data.preOut;
            } catch (error: any) {
                console.error("Erreur lors du parsing JSON de la requête:", error);
                return NextResponse.json(
                    { error: `Erreur lors du parsing de la requête JSON: ${error.message || error.toString()}` },
                    { status: 400 }
                );
            }
        }

        // Si les données viennent avec preOut (format Electron ou calculé côté serveur), les extraire
        let contractData: any;
        if (preOut) {
            // Format Electron ou calculé côté serveur: preOut contient les résultats du calcul
            console.log("🔍 Debug preOut:", JSON.stringify(preOut, null, 2));
            console.log("🔍 PreOut keys:", Object.keys(preOut || {}));
            let commitment = preOut.commitment_c_hex || preOut.commitment || "";
            console.log("🔍 Commitment trouvé:", commitment ? `${commitment.substring(0, 20)}...` : "VIDE");
            
            // Si le commitment n'a pas le préfixe 0x, l'ajouter
            if (commitment && !commitment.startsWith("0x")) {
                commitment = "0x" + commitment;
            }
            
            // Vérifier que le commitment n'est pas vide et a la bonne longueur (32 bytes = 64 hex chars)
            if (!commitment || commitment === "0x") {
                console.error("❌ Commitment manquant dans preOut:", JSON.stringify(preOut, null, 2));
                return NextResponse.json(
                    { error: `Commitment manquant dans les données preOut. Champs disponibles: ${Object.keys(preOut).join(", ")}. Vérifiez que commitment_c_hex est présent dans la sortie du binaire.` },
                    { status: 400 }
                );
            }
            
            // Vérifier la longueur (32 bytes = 64 hex chars après 0x)
            if (commitment.length !== 66) { // 0x + 64 hex chars
                console.error("❌ Commitment de longueur invalide:", commitment, "longueur:", commitment.length);
                return NextResponse.json(
                    { error: `Commitment de longueur invalide: ${commitment.length} caractères (attendu 66 avec 0x). Vérifiez que commitment_c_hex contient 32 bytes encodés en hex.` },
                    { status: 400 }
                );
            }
            
            contractData = {
                item_description: preOut.description_hex || data.item_description || "",
                opening_value: preOut.commitment_o_hex || preOut.opening_value || "",
                pk_buyer: data.pk_buyer,
                pk_vendor: data.pk_vendor,
                price: data.price,
                num_blocks: preOut.num_blocks || 0,
                num_gates: preOut.num_gates || 0,
                commitment: commitment,
                tip_completion: data.tip_completion || 0,
                tip_dispute: data.tip_dispute || 0,
                protocol_version: data.protocol_version || "1",
                timeout_delay: data.timeout_delay || 3600,
                algorithm_suite: data.algorithm_suite || "AES-128-CTR",
                file: preOut.file || preOut.ciphertext || "",
                file_path: filePath || preOut.ciphertext_path || ""
            };
        } else {
            // Format standard (ne devrait plus être utilisé)
            contractData = data;
        }
        
        console.log("🔍 Données du contrat à insérer:", JSON.stringify(contractData, null, 2));
        
        let stmt;
        let result;
        try {
            stmt = db.prepare(`INSERT INTO contracts (
                item_description, opening_value,
                pk_buyer, pk_vendor, price, num_blocks, 
                num_gates, commitment, tip_completion, tip_dispute,
                protocol_version, timeout_delay, algorithm_suite,
                accepted
            ) VALUES (
                ?, ?,
                ?, ?, ?, ?,
                ?, ?, ?, ?,
                ?, ?, ?,
                0
            );`);
            result = stmt.run(
                contractData.item_description,
                contractData.opening_value,
                contractData.pk_buyer,
                contractData.pk_vendor,
                contractData.price,
                contractData.num_blocks,
                contractData.num_gates,
                contractData.commitment,
                contractData.tip_completion,
                contractData.tip_dispute,
                contractData.protocol_version,
                contractData.timeout_delay,
                contractData.algorithm_suite
            );
        } catch (dbError: any) {
            console.error("❌ Erreur lors de l'insertion dans la base de données:", dbError);
            console.error("❌ Stack:", dbError?.stack);
            console.error("❌ Données qui ont causé l'erreur:", JSON.stringify(contractData, null, 2));
            throw new Error(`Erreur base de données: ${dbError.message || dbError}`);
        }
        const id = result.lastInsertRowid;
        console.log("✅ Contrat inséré avec ID:", id);

        // Si un fichier est fourni, l'enregistrer
        if (contractData.file_path) {
            if (!fs.existsSync(contractData.file_path)) {
                return NextResponse.json(
                    { error: `Fichier chiffré introuvable: ${contractData.file_path}` },
                    { status: 400 }
                );
            }
            const fileName = `file_${id}.enc`;
            const destPath = path.join(UPLOADS_PATH, fileName);
            fs.copyFileSync(contractData.file_path, destPath);
            
            // Nettoyer le fichier temporaire après copie
            if (contractData.file_path.startsWith(path.join(process.cwd(), "tmp"))) {
                try {
                    fs.unlinkSync(contractData.file_path);
                } catch (e) {
                    console.warn("Impossible de supprimer le fichier temporaire:", contractData.file_path);
                }
            }
        } else if (contractData.file) {
            try {
                if (!hex_to_bytes || !initSync) {
                    throw new Error("Module crypto_lib non disponible. Impossible de traiter le fichier.");
                }
                const module = readFileSync(`${WASM_PATH}crypto_lib_bg.wasm`);
                initSync({ module: module });

                const fileName = `file_${id}.enc`;
                fs.writeFileSync(path.join(UPLOADS_PATH, fileName), hex_to_bytes(contractData.file));
            } catch (wasmError: any) {
                console.error("❌ Erreur lors de l'initialisation WASM ou sauvegarde du fichier:", wasmError);
                throw new Error(`Erreur lors du traitement du fichier: ${wasmError.message || wasmError}`);
            }
        }
        
        // Extraire la clé depuis preOut
        // Le binaire Rust devrait retourner key_hex dans la sortie JSON
        let key: string | null = null;
        if (preOut) {
            // Essayer différentes variantes du nom de champ
            const rawKey = preOut.key_hex || preOut.key || null;
            
            if (rawKey) {
                // Formater la clé avec le préfixe 0x si nécessaire
                if (typeof rawKey === "string") {
                    key = rawKey.startsWith("0x") ? rawKey : "0x" + rawKey;
                } else if (Array.isArray(rawKey)) {
                    // Si key est un tableau d'octets, le convertir en hex
                    key = "0x" + Buffer.from(rawKey).toString("hex");
                }
            }
        }
        
        // Retourner les données nécessaires au frontend
        return NextResponse.json({ 
            id,
            key: key || null,
            h_circuit: preOut?.h_circuit_hex || preOut?.h_circuit || contractData.commitment || null,
            h_ct: preOut?.h_ct_hex || preOut?.h_ct || null
        });
    } catch (error: any) {
        console.error("❌ ERREUR dans PUT /api/precontracts:");
        console.error("   Message:", error?.message);
        console.error("   Name:", error?.name);
        console.error("   Code:", error?.code);
        console.error("   Stack:", error?.stack);
        
        // S'assurer qu'on retourne toujours du JSON, même en cas d'erreur
        const errorMessage = error instanceof Error ? error.message : String(error);
        const isDev = process.env.NODE_ENV === "development";
        
        const responseBody: any = { 
            error: errorMessage || "Erreur lors de la création du precontract"
        };
        
        if (isDev) {
            responseBody.details = {
                message: errorMessage,
                stack: error?.stack,
                name: error?.name,
                code: error?.code,
                toString: error?.toString()
            };
        }
        
        console.log("📤 Retour de l'erreur JSON:", JSON.stringify(responseBody, null, 2));
        
        return NextResponse.json(
            responseBody,
            { 
                status: 500,
                headers: {
                    "Content-Type": "application/json; charset=utf-8"
                }
            }
        );
    }
}
