#!/bin/bash

set -e

ROOT_DIR="/Applications/sox_implementation"
cd "$ROOT_DIR"

echo "=== Test de performance du precontract V2 ==="
echo ""

# Créer un fichier de test de 1GB si il n'existe pas
TEST_FILE="$ROOT_DIR/test_1gb.bin"
if [ ! -f "$TEST_FILE" ]; then
    echo "Création d'un fichier de test de 1GB..."
    dd if=/dev/urandom of="$TEST_FILE" bs=1M count=1024 2>/dev/null
    echo "✓ Fichier créé: $TEST_FILE ($(du -h "$TEST_FILE" | cut -f1))"
else
    echo "✓ Fichier de test existant: $TEST_FILE ($(du -h "$TEST_FILE" | cut -f1))"
fi

# Compiler le binaire si nécessaire
echo ""
echo "Vérification de la compilation..."
cd "$ROOT_DIR/src/wasm"
cargo build --release --bin precontract_cli 2>&1 | tail -3

# Chemin absolu du binaire
BINARY="$ROOT_DIR/src/wasm/target/release/precontract_cli"

if [ ! -f "$BINARY" ]; then
    echo "❌ Erreur: binaire non trouvé: $BINARY"
    exit 1
fi

echo "✓ Binaire compilé: $BINARY"
echo ""

# Lancer le test avec mesure du temps
echo "=== Lancement du precontract sur fichier de 1GB ==="
echo "Date/heure de début: $(date)"
echo ""

# Mesurer le temps total
START_TIME=$(date +%s.%N)
"$BINARY" "$TEST_FILE" > /tmp/precontract_output.json 2>&1
EXIT_CODE=$?
END_TIME=$(date +%s.%N)

echo "Date/heure de fin: $(date)"
echo ""

if [ $EXIT_CODE -eq 0 ]; then
    ELAPSED=$(echo "$END_TIME - $START_TIME" | bc)
    MINUTES=$(echo "scale=0; $ELAPSED / 60" | bc)
    SECONDS=$(echo "scale=2; $ELAPSED - ($MINUTES * 60)" | bc)
    
    echo "✅ Precontract réussi!"
    echo ""
    echo "=== Résultats de performance ==="
    printf "Temps total: %.2f secondes\n" "$ELAPSED"
    if [ "$MINUTES" -gt 0 ]; then
        printf "Temps formaté: %dm %.2fs\n" "$MINUTES" "$SECONDS"
    else
        printf "Temps formaté: %.2fs\n" "$SECONDS"
    fi
    
    # Calculer le débit
    FILE_SIZE_GB=1.0
    THROUGHPUT=$(echo "scale=3; $FILE_SIZE_GB / $ELAPSED" | bc)
    printf "Débit: %.3f GB/s\n" "$THROUGHPUT"
    
    # Lire les détails
    NUM_BLOCKS=$(cat /tmp/precontract_output.json | python3 -c "import sys, json; print(json.load(sys.stdin)['num_blocks'])" 2>/dev/null || echo "N/A")
    NUM_GATES=$(cat /tmp/precontract_output.json | python3 -c "import sys, json; print(json.load(sys.stdin)['num_gates'])" 2>/dev/null || echo "N/A")
    
    if [ "$NUM_BLOCKS" != "N/A" ] && [ "$NUM_GATES" != "N/A" ]; then
        echo ""
        echo "=== Statistiques ==="
        echo "Nombre de blocs: $NUM_BLOCKS"
        echo "Nombre de gates: $NUM_GATES"
        GATES_PER_SEC=$(echo "scale=0; $NUM_GATES / $ELAPSED" | bc)
        echo "Gates par seconde: $GATES_PER_SEC"
    fi
    
    echo ""
    echo "=== Détails du precontract ==="
    cat /tmp/precontract_output.json | python3 -m json.tool 2>/dev/null || cat /tmp/precontract_output.json
else
    echo "❌ Erreur lors du precontract (code: $EXIT_CODE)"
    echo ""
    cat /tmp/precontract_output.json
    exit 1
fi
