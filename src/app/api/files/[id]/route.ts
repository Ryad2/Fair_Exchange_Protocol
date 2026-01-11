import { NextResponse } from "next/server";
import fs from "node:fs";
import path from "node:path";

export const UPLOADS_PATH = "src/app/uploads/";
export const WASM_PATH = "src/app/lib/crypto_lib/";

export async function GET(
    req: Request,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const { id } = await params;
        const fileName = `file_${id}.enc`;
        const fullPath = path.join(UPLOADS_PATH, fileName);

        if (!fs.existsSync(fullPath)) {
            return NextResponse.json(
                { error: `Fichier chiffré introuvable pour le contrat ${id}` },
                { status: 404 }
            );
        }

        const file = fs.readFileSync(fullPath);
        const hex = Buffer.from(file).toString("hex");

        return NextResponse.json({ file: hex });
    } catch (error: any) {
        console.error("Erreur dans GET /api/files/[id]:", error);
        return NextResponse.json(
            { error: `Erreur serveur: ${error.message || error}` },
            { status: 500 }
        );
    }
}
