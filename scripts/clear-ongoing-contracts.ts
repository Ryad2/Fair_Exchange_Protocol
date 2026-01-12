import Database from "better-sqlite3";
import path from "path";
import fs from "fs";

const dbPath = path.resolve(process.cwd(), "src/app/db/sox.sqlite");

async function main() {
    console.log("🗑️  Suppression de tous les contrats en cours...");
    console.log("");

    // Vérifier si la base de données existe
    if (!fs.existsSync(dbPath)) {
        console.error("❌ Base de données non trouvée:", dbPath);
        process.exit(1);
    }

    const db = new Database(dbPath);

    try {
        // D'abord, compter les contrats en cours
        const countStmt = db.prepare(`
            SELECT COUNT(*) as count 
            FROM contracts 
            WHERE accepted <> 0 AND sponsor IS NOT NULL
        `);
        const countResult = countStmt.get() as { count: number };
        const count = countResult.count;

        console.log(`📊 Nombre de contrats en cours trouvés: ${count}`);
        console.log("");

        if (count === 0) {
            console.log("✅ Aucun contrat en cours à supprimer");
            db.close();
            return;
        }

        // Lister les IDs des contrats avant suppression (pour info)
        const listStmt = db.prepare(`
            SELECT 
                c.id, 
                c.pk_buyer, 
                c.pk_vendor, 
                c.optimistic_smart_contract,
                d.dispute_smart_contract
            FROM contracts c
            LEFT JOIN disputes d ON c.id = d.contract_id
            WHERE c.accepted <> 0 AND c.sponsor IS NOT NULL
        `);
        const contracts = listStmt.all() as any[];
        
        console.log("📋 Contrats qui seront supprimés:");
        contracts.forEach((contract) => {
            console.log(`  - ID: ${contract.id}, Buyer: ${contract.pk_buyer?.slice(0, 10)}..., Vendor: ${contract.pk_vendor?.slice(0, 10)}...`);
            if (contract.optimistic_smart_contract) {
                console.log(`    Optimistic Contract: ${contract.optimistic_smart_contract}`);
            }
            if (contract.dispute_smart_contract) {
                console.log(`    Dispute Contract: ${contract.dispute_smart_contract}`);
            }
        });
        console.log("");

        // Demander confirmation
        const readline = require("readline");
        const rl = readline.createInterface({
            input: process.stdin,
            output: process.stdout,
        });

        const answer = await new Promise<string>((resolve) => {
            rl.question(`⚠️  Êtes-vous sûr de vouloir supprimer ${count} contrat(s) en cours? (oui/non): `, resolve);
        });
        rl.close();

        if (answer.toLowerCase() !== "oui" && answer.toLowerCase() !== "yes" && answer.toLowerCase() !== "o") {
            console.log("❌ Suppression annulée");
            db.close();
            return;
        }

        console.log("");
        console.log("🗑️  Suppression en cours...");

        // Supprimer les contrats en cours
        // Note: Les disputes seront supprimées automatiquement grâce à ON DELETE CASCADE
        const deleteStmt = db.prepare(`
            DELETE FROM contracts 
            WHERE accepted <> 0 AND sponsor IS NOT NULL
        `);
        const result = deleteStmt.run();

        console.log(`✅ ${result.changes} contrat(s) supprimé(s)`);
        console.log("");

        // Vérifier qu'il ne reste plus de contrats en cours
        const remainingCount = countStmt.get() as { count: number };
        if (remainingCount.count === 0) {
            console.log("✅ Tous les contrats en cours ont été supprimés avec succès");
        } else {
            console.log(`⚠️  Il reste ${remainingCount.count} contrat(s) en cours`);
        }

        db.close();
    } catch (error: any) {
        console.error("❌ Erreur lors de la suppression:", error.message);
        db.close();
        process.exit(1);
    }
}

main().catch(console.error);

