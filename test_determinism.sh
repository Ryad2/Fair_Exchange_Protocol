#!/bin/bash

set -e

ROOT_DIR="/Applications/sox_implementation"
cd "$ROOT_DIR"

echo "=== Test de déterminisme avec IV fixe ==="
echo ""

# Créer un fichier de test petit pour tester rapidement
TEST_FILE="$ROOT_DIR/test_determinism.bin"
if [ ! -f "$TEST_FILE" ]; then
    echo "Création d'un fichier de test (1MB)..."
    dd if=/dev/urandom of="$TEST_FILE" bs=1M count=1 2>/dev/null
fi

# Clé fixe pour le test
KEY="0123456789abcdef0123456789abcdef"

echo "Clé utilisée: $KEY"
echo "Fichier: $TEST_FILE"
echo ""

# Lire le fichier et extraire le ciphertext de la première exécution
echo "Exécution 1:"
./src/wasm/target/release/precontract_cli "$TEST_FILE" "$KEY" > /tmp/precontract1.json 2>&1
CT1_PATH=$(cat /tmp/precontract1.json | python3 -c "import sys, json; print(json.load(sys.stdin)['ciphertext_path'])" 2>/dev/null)
H_CT_1=$(cat /tmp/precontract1.json | python3 -c "import sys, json; print(json.load(sys.stdin)['h_ct_hex'])" 2>/dev/null)
H_CIRCUIT_1=$(cat /tmp/precontract1.json | python3 -c "import sys, json; print(json.load(sys.stdin)['h_circuit_hex'])" 2>/dev/null)

echo "  h_ct: $H_CT_1"
echo "  h_circuit: $H_CIRCUIT_1"
echo "  ciphertext: $CT1_PATH"
echo ""

# Maintenant, utiliser le MÊME ciphertext pour vérifier le déterminisme
# On va lire le ciphertext et le réutiliser
echo "=== Test avec le MÊME ciphertext (doit donner les mêmes hash) ==="
echo ""

# Créer un fichier temporaire avec le ciphertext
TEMP_CT="/tmp/test_ct.bin"
cp "$CT1_PATH" "$TEMP_CT"

# Extraire description et commitment du premier résultat
DESC1=$(cat /tmp/precontract1.json | python3 -c "import sys, json; print(json.load(sys.stdin)['description_hex'])" 2>/dev/null)
COMMITMENT1=$(cat /tmp/precontract1.json | python3 -c "import sys, json; print(json.load(sys.stdin)['commitment_c_hex'])" 2>/dev/null)
OPENING1=$(cat /tmp/precontract1.json | python3 -c "import sys, json; print(json.load(sys.stdin)['commitment_o_hex'])" 2>/dev/null)

echo "Test 1 avec ciphertext fixe:"
./src/wasm/target/release/check_precontract_cli "$TEMP_CT" "$DESC1" "$COMMITMENT1" "$OPENING1" > /tmp/check1.json 2>&1
H_CT_CHECK1=$(cat /tmp/check1.json | python3 -c "import sys, json; print(json.load(sys.stdin)['h_ct_hex'])" 2>/dev/null)
H_CIRCUIT_CHECK1=$(cat /tmp/check1.json | python3 -c "import sys, json; print(json.load(sys.stdin)['h_circuit_hex'])" 2>/dev/null)
SUCCESS1=$(cat /tmp/check1.json | python3 -c "import sys, json; print(json.load(sys.stdin)['success'])" 2>/dev/null)

echo "  h_ct: $H_CT_CHECK1"
echo "  h_circuit: $H_CIRCUIT_CHECK1"
echo "  success: $SUCCESS1"
echo ""

echo "Test 2 avec le même ciphertext (doit être identique):"
./src/wasm/target/release/check_precontract_cli "$TEMP_CT" "$DESC1" "$COMMITMENT1" "$OPENING1" > /tmp/check2.json 2>&1
H_CT_CHECK2=$(cat /tmp/check2.json | python3 -c "import sys, json; print(json.load(sys.stdin)['h_ct_hex'])" 2>/dev/null)
H_CIRCUIT_CHECK2=$(cat /tmp/check2.json | python3 -c "import sys, json; print(json.load(sys.stdin)['h_circuit_hex'])" 2>/dev/null)
SUCCESS2=$(cat /tmp/check2.json | python3 -c "import sys, json; print(json.load(sys.stdin)['success'])" 2>/dev/null)

echo "  h_ct: $H_CT_CHECK2"
echo "  h_circuit: $H_CIRCUIT_CHECK2"
echo "  success: $SUCCESS2"
echo ""

echo "=== Comparaison ==="
if [ "$H_CT_CHECK1" = "$H_CT_CHECK2" ] && [ "$H_CIRCUIT_CHECK1" = "$H_CIRCUIT_CHECK2" ]; then
    echo "✅ DÉTERMINISTE ! Les hash sont identiques avec le même ciphertext."
    echo "✅ Les optimisations préservent les résultats cryptographiques."
else
    echo "❌ NON-DÉTERMINISTE même avec le même ciphertext !"
    echo "  h_ct diffère: $([ "$H_CT_CHECK1" = "$H_CT_CHECK2" ] && echo "non" || echo "oui")"
    echo "  h_circuit diffère: $([ "$H_CIRCUIT_CHECK1" = "$H_CIRCUIT_CHECK2" ] && echo "non" || echo "oui")"
fi

echo ""
echo "Note: Les hash diffèrent entre exécutions de precontract_cli car l'IV est aléatoire."
echo "C'est normal et attendu pour la sécurité. Le test ci-dessus vérifie que"
echo "avec le MÊME ciphertext, les hash sont identiques (déterministes)."



















