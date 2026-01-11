import { NextResponse } from "next/server";
import fs from "node:fs";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { UPLOADS_PATH } from "../../files/[id]/route";

const execFileAsync = promisify(execFile);

const COMPUTE_PROOFS_CLI_PATH = path.join(
    process.cwd(),
    "src",
    "wasm",
    "target",
    "release",
    "compute_proofs_cli"
);

export async function POST(req: Request) {
    try {
        const { state, contractId, num_blocks, num_gates } = await req.json();

        if (!state || contractId === undefined || !num_blocks || !num_gates) {
            return NextResponse.json(
                { error: "Les champs 'state', 'contractId', 'num_blocks' et 'num_gates' sont requis" },
                { status: 400 }
            );
        }

        // Pour l'instant, on ne supporte que l'état 4 (WaitVendorDataRight)
        if (state !== 4) {
            return NextResponse.json(
                { error: `État ${state} non supporté. Seul l'état 4 (WaitVendorDataRight) est supporté pour l'instant.` },
                { status: 400 }
            );
        }

        // Récupérer le circuit évalué depuis le serveur
        // Le circuit évalué devrait être généré côté client et envoyé, ou stocké sur le serveur
        // Pour l'instant, on va demander au client de l'envoyer
        const { evaluated_circuit_hex } = await req.json();
        
        if (!evaluated_circuit_hex) {
            return NextResponse.json(
                { error: "Le champ 'evaluated_circuit_hex' est requis" },
                { status: 400 }
            );
        }

        // Créer un fichier temporaire pour le circuit évalué
        const tempDir = path.join(process.cwd(), "tmp");
        if (!fs.existsSync(tempDir)) {
            fs.mkdirSync(tempDir, { recursive: true });
        }
        
        const tempEvaluatedCircuitPath = path.join(tempDir, `evaluated_circuit_${contractId}.bin`);
        const evaluated_circuit_bytes = Buffer.from(evaluated_circuit_hex, "hex");
        fs.writeFileSync(tempEvaluatedCircuitPath, evaluated_circuit_bytes);

        // Appeler le binaire CLI
        const { stdout } = await execFileAsync(COMPUTE_PROOFS_CLI_PATH, [
            state.toString(),
            tempEvaluatedCircuitPath,
            num_blocks.toString(),
            num_gates.toString(),
        ]);

        // Nettoyer le fichier temporaire
        fs.unlinkSync(tempEvaluatedCircuitPath);

        let parsed: any;
        try {
            parsed = JSON.parse(stdout.toString());
        } catch (e: any) {
            console.error(
                "Erreur de parsing JSON depuis compute_proofs_cli:",
                e,
                stdout.toString()
            );
            return NextResponse.json(
                {
                    error:
                        "Erreur serveur: sortie invalide du binaire de calcul de preuves",
                },
                { status: 500 }
            );
        }

        return NextResponse.json(parsed);
    } catch (error: any) {
        console.error("Erreur dans POST /api/proofs/compute:", error);
        return NextResponse.json(
            { error: `Erreur serveur: ${error.message || error}` },
            { status: 500 }
        );
    }
}

