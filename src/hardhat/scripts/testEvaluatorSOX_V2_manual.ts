import hre from "hardhat";
import { ethers } from "hardhat";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import {
    bytes_to_hex,
    initSync,
    sha256_compress_js,
} from "../../app/lib/crypto_lib";
import { createCipheriv } from "crypto";

/**
 * Test manuel simple : Je calcule ce que je suis censé obtenir,
 * je donne les valeurs à l'évaluateur, et je vérifie si c'est la même chose
 */

// Helper function to encode i64 to 6 bytes (big-endian)
function encodeI64To6Bytes(value: number): Uint8Array {
    const limit = 1n << 48n;
    let v = BigInt(value);
    if (v < 0) {
        v = limit + v;
    }
    const bytes = new Uint8Array(6);
    for (let i = 5; i >= 0; i--) {
        bytes[i] = Number(v & 0xffn);
        v >>= 8n;
    }
    return bytes;
}

// Helper function to encode a V2 gate (64 bytes)
function encodeGateV2(opcode: number, sons: number[], params: Uint8Array): Uint8Array {
    const gate = new Uint8Array(64);
    gate.fill(0);
    
    gate[0] = opcode;
    
    for (let i = 0; i < sons.length; i++) {
        const offset = 1 + i * 6;
        const sonBytes = encodeI64To6Bytes(sons[i]);
        gate.set(sonBytes, offset);
    }
    
    const paramsStart = 1 + sons.length * 6;
    for (let i = 0; i < params.length && i < (64 - paramsStart); i++) {
        gate[paramsStart + i] = params[i];
    }
    
    return gate;
}

async function main() {
    console.log("=".repeat(80));
    console.log("🧪 TEST MANUEL - Calcul manuel vs EvaluatorSOX_V2");
    console.log("=".repeat(80));
    console.log("");

    // Initialize WASM module for SHA2 comparison
    const modulePath = join(__dirname, "../../app/lib/crypto_lib/crypto_lib_bg.wasm");
    const module = await readFile(modulePath);
    initSync({ module: module });
    console.log("✅ WASM module initialisé\n");

    // Deploy libraries
    console.log("📦 Déploiement des libraries...");
    const SHA256EvaluatorFactory = await ethers.getContractFactory("SHA256Evaluator");
    const sha256Evaluator = await SHA256EvaluatorFactory.deploy();
    await sha256Evaluator.waitForDeployment();

    const AES128CtrEvaluatorFactory = await ethers.getContractFactory("AES128CtrEvaluator");
    const aes128CtrEvaluator = await AES128CtrEvaluatorFactory.deploy();
    await aes128CtrEvaluator.waitForDeployment();

    const TestEvaluatorFactory = await ethers.getContractFactory("TestEvaluatorSOX_V2", {
        libraries: {
            SHA256Evaluator: await sha256Evaluator.getAddress(),
        },
    });
    const testEvaluator = await TestEvaluatorFactory.deploy();
    await testEvaluator.waitForDeployment();
    console.log("✅ Contrats déployés\n");

    // ========================================================================
    // TEST 1: XOR gate - Calcul manuel
    // ========================================================================
    console.log("=".repeat(80));
    console.log("TEST 1: XOR gate (opcode 0x04)");
    console.log("=".repeat(80));
    
    // Je choisis deux valeurs simples pour XOR
    const valeur1 = new Uint8Array(64);
    valeur1.fill(0xAA); // 10101010 en binaire
    
    const valeur2 = new Uint8Array(64);
    valeur2.fill(0x55); // 01010101 en binaire
    
    // Calcul manuel : XOR de 0xAA et 0x55
    // 0xAA = 10101010
    // 0x55 = 01010101
    // XOR  = 11111111 = 0xFF
    const resultatAttendu = new Uint8Array(64);
    resultatAttendu.fill(0xFF);
    
    console.log("Valeurs d'entrée :");
    console.log("  Valeur 1 (son[0]):", ethers.hexlify(valeur1.slice(0, 16)) + "... (tous 0xAA)");
    console.log("  Valeur 2 (son[1]):", ethers.hexlify(valeur2.slice(0, 16)) + "... (tous 0x55)");
    console.log("");
    console.log("📐 CALCUL MANUEL :");
    console.log("  0xAA XOR 0x55 = 0xFF");
    console.log("  Résultat attendu:", ethers.hexlify(resultatAttendu.slice(0, 16)) + "... (tous 0xFF)");
    console.log("");
    
    // Encoder le gate XOR avec 2 sons (index 1 et 2, pas 0 car 0 encode à tous zéros)
    const gateBytes = encodeGateV2(0x04, [1, 2], new Uint8Array(0));
    const sonValues: string[] = [
        ethers.hexlify(valeur1),
        ethers.hexlify(valeur2),
    ];
    const aesKey = ethers.hexlify(new Uint8Array(16)) as `0x${string}`;
    
    console.log("🔧 Appel à EvaluatorSOX_V2.evaluateGateFromSons...");
    const result = await testEvaluator.evaluateGateFromSons(gateBytes, sonValues, aesKey);
    const resultBytes = ethers.getBytes(result);
    
    console.log("");
    console.log("📊 RÉSULTAT Solidity :");
    console.log("  Hex:", ethers.hexlify(resultBytes.slice(0, 32)) + "...");
    console.log("");
    
    // Comparaison
    const match = ethers.hexlify(resultBytes) === ethers.hexlify(resultatAttendu);
    console.log("✅ Comparaison:", match ? "✅ CORRECT - Les résultats MATCHENT !" : "❌ DIFFÉRENT");
    if (match) {
        console.log("   🎉 L'évaluateur Solidity donne le même résultat que mon calcul manuel !");
    } else {
        console.log("   ⚠️  Les résultats ne correspondent pas.");
        console.log("   Attendu:", ethers.hexlify(resultatAttendu.slice(0, 32)));
        console.log("   Obtenu: ", ethers.hexlify(resultBytes.slice(0, 32)));
    }
    console.log("");

    // ========================================================================
    // TEST 2: COMP gate - Calcul manuel
    // ========================================================================
    console.log("=".repeat(80));
    console.log("TEST 2: COMP gate (opcode 0x05) - Comparaison");
    console.log("=".repeat(80));
    
    const valeurA = new Uint8Array(64);
    valeurA.fill(0x42);
    
    const valeurB = new Uint8Array(64);
    valeurB.fill(0x42); // Identique à valeurA
    
    // Calcul manuel : COMP compare les 32 premiers bytes
    // Si égaux -> retourne 1 (0x01 au premier byte, reste 0)
    // Si différents -> retourne 0 (tous bytes à 0)
    const resultatAttenduCOMP = new Uint8Array(64);
    resultatAttenduCOMP[0] = 0x01; // 1 car les valeurs sont égales
    
    console.log("Valeurs d'entrée :");
    console.log("  Valeur A (son[1]):", ethers.hexlify(valeurA.slice(0, 16)) + "... (tous 0x42)");
    console.log("  Valeur B (son[2]):", ethers.hexlify(valeurB.slice(0, 16)) + "... (tous 0x42 - identique)");
    console.log("");
    console.log("📐 CALCUL MANUEL :");
    console.log("  Les 32 premiers bytes de A et B sont identiques");
    console.log("  COMP devrait retourner 1 (0x01 au premier byte)");
    console.log("  Résultat attendu: 0x01 suivi de zéros");
    console.log("");
    
    const gateBytesCOMP = encodeGateV2(0x05, [1, 2], new Uint8Array(0));
    const sonValuesCOMP: string[] = [
        ethers.hexlify(valeurA),
        ethers.hexlify(valeurB),
    ];
    
    console.log("🔧 Appel à EvaluatorSOX_V2.evaluateGateFromSons...");
    const resultCOMP = await testEvaluator.evaluateGateFromSons(gateBytesCOMP, sonValuesCOMP, aesKey);
    const resultBytesCOMP = ethers.getBytes(resultCOMP);
    
    console.log("");
    console.log("📊 RÉSULTAT Solidity :");
    console.log("  Premier byte:", "0x" + resultBytesCOMP[0].toString(16).padStart(2, '0'));
    console.log("  Hex complet:", ethers.hexlify(resultBytesCOMP.slice(0, 16)));
    console.log("");
    
    const matchCOMP = resultBytesCOMP[0] === 0x01 && resultBytesCOMP.slice(1).every(b => b === 0);
    console.log("✅ Comparaison:", matchCOMP ? "✅ CORRECT - Retourne 1 comme attendu !" : "❌ DIFFÉRENT");
    if (matchCOMP) {
        console.log("   🎉 L'évaluateur Solidity compare correctement et retourne 1 !");
    } else {
        console.log("   ⚠️  Le résultat ne correspond pas.");
        console.log("   Attendu: 0x01 suivi de zéros");
        console.log("   Obtenu: ", ethers.hexlify(resultBytesCOMP.slice(0, 16)));
    }
    console.log("");

    // ========================================================================
    // TEST 3: SHA2 gate - Calcul avec WASM
    // ========================================================================
    console.log("=".repeat(80));
    console.log("TEST 3: SHA2 gate (opcode 0x02) - Compression SHA256");
    console.log("=".repeat(80));
    
    const blockSHA2 = new Uint8Array(64);
    blockSHA2.fill(0x41); // Rempli avec 0x41
    
    console.log("Valeur d'entrée :");
    console.log("  Block (son[1]):", ethers.hexlify(blockSHA2.slice(0, 16)) + "... (64 bytes remplis avec 0x41)");
    console.log("");
    console.log("📐 CALCUL avec WASM (Rust) :");
    console.log("  J'utilise sha256_compress_js pour calculer le résultat attendu");
    
    // Calculer le résultat attendu avec WASM
    const resultatAttenduSHA2 = sha256_compress_js([blockSHA2]);
    console.log("  Résultat attendu (SHA256 compression):", bytes_to_hex(resultatAttenduSHA2));
    console.log("");
    
    const gateBytesSHA2 = encodeGateV2(0x02, [1], new Uint8Array(0));
    const sonValuesSHA2: string[] = [
        ethers.hexlify(blockSHA2),
    ];
    
    console.log("🔧 Appel à EvaluatorSOX_V2.evaluateGateFromSons...");
    const resultSHA2 = await testEvaluator.evaluateGateFromSons(gateBytesSHA2, sonValuesSHA2, aesKey);
    const resultBytesSHA2 = ethers.getBytes(resultSHA2);
    
    console.log("");
    console.log("📊 RÉSULTAT Solidity :");
    console.log("  Hex:", ethers.hexlify(resultBytesSHA2));
    console.log("");
    
    const matchSHA2 = ethers.hexlify(resultBytesSHA2) === bytes_to_hex(resultatAttenduSHA2);
    console.log("✅ Comparaison:", matchSHA2 ? "✅ CORRECT - Match avec WASM !" : "❌ DIFFÉRENT");
    if (matchSHA2) {
        console.log("   🎉 L'évaluateur Solidity donne le même résultat que WASM (Rust) !");
    } else {
        console.log("   ⚠️  Les résultats ne correspondent pas.");
        console.log("   Attendu (WASM):", bytes_to_hex(resultatAttenduSHA2));
        console.log("   Obtenu (Solidity):", ethers.hexlify(resultBytesSHA2));
    }
    console.log("");

    // ========================================================================
    // TEST 4: AES-CTR gate - Calcul avec Node crypto
    // ========================================================================
    console.log("=".repeat(80));
    console.log("TEST 4: AES-CTR gate (opcode 0x01) - Décryptage");
    console.log("=".repeat(80));
    
    const key = new Uint8Array(16);
    key.fill(0x00);
    key[15] = 0x01; // Key: 0x000...0001
    
    const counter = new Uint8Array(16);
    counter.fill(0x00); // Counter: tous zéros
    
    const plaintext = new Uint8Array(64);
    plaintext.fill(0x42); // Plaintext: tous 0x42
    
    console.log("Valeurs d'entrée :");
    console.log("  Key:", ethers.hexlify(key));
    console.log("  Counter:", ethers.hexlify(counter));
    console.log("  Plaintext (attendu après décryptage):", ethers.hexlify(plaintext.slice(0, 16)) + "...");
    console.log("");
    console.log("📐 CALCUL avec Node crypto :");
    console.log("  J'utilise createCipheriv pour chiffrer, puis je décrypte avec l'évaluateur");
    
    // Chiffrer avec Node crypto pour créer le ciphertext
    const cipher = createCipheriv("aes-128-ctr", key, counter);
    const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()]);
    const ciphertext = new Uint8Array(encrypted);
    
    console.log("  Ciphertext (chiffré):", ethers.hexlify(ciphertext.slice(0, 16)) + "...");
    console.log("  Résultat attendu (après décryptage):", ethers.hexlify(plaintext.slice(0, 16)) + "...");
    console.log("");
    
    // Préparer les params: counter (16 bytes) + length in bits (2 bytes, big-endian)
    const paramsAES = new Uint8Array(18);
    paramsAES.set(counter, 0);
    paramsAES[16] = 0x02; // length in bits: 512 = 0x0200
    paramsAES[17] = 0x00;
    
    const gateBytesAES = encodeGateV2(0x01, [1], paramsAES);
    const sonValuesAES: string[] = [ethers.hexlify(ciphertext)];
    const aesKeyBytes = ethers.hexlify(key) as `0x${string}`;
    
    console.log("🔧 Appel à EvaluatorSOX_V2.evaluateGateFromSons...");
    const resultAES = await testEvaluator.evaluateGateFromSons(gateBytesAES, sonValuesAES, aesKeyBytes);
    const resultBytesAES = ethers.getBytes(resultAES);
    
    console.log("");
    console.log("📊 RÉSULTAT Solidity (décrypté) :");
    console.log("  Hex:", ethers.hexlify(resultBytesAES.slice(0, 32)) + "...");
    console.log("");
    
    const matchAES = ethers.hexlify(resultBytesAES.slice(0, 64)) === ethers.hexlify(plaintext);
    console.log("✅ Comparaison:", matchAES ? "✅ CORRECT - Décryptage réussi !" : "❌ DIFFÉRENT");
    if (matchAES) {
        console.log("   🎉 L'évaluateur Solidity décrypte correctement (match avec plaintext attendu) !");
    } else {
        console.log("   ⚠️  Les résultats ne correspondent pas.");
        console.log("   Attendu (plaintext):", ethers.hexlify(plaintext.slice(0, 32)));
        console.log("   Obtenu (décrypté):", ethers.hexlify(resultBytesAES.slice(0, 32)));
    }
    console.log("");

    console.log("=".repeat(80));
    console.log("✅ Tous les tests terminés !");
    console.log("=".repeat(80));
}

main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error(error);
        process.exit(1);
    });

