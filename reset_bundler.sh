#!/bin/bash

set -e

echo "=================================================================================="
echo "🔄 RÉINITIALISATION COMPLÈTE DU BUNDLER ALTO"
echo "=================================================================================="
echo ""

# 1. Arrêter tous les processus
echo "📋 ÉTAPE 1: Arrêt de tous les processus"
echo "   Arrête manuellement:"
echo "   - Bundler (Ctrl+C dans son terminal)"
echo "   - Next.js (Ctrl+C dans son terminal)"
echo "   - Hardhat node (Ctrl+C dans son terminal)"
echo ""
read -p "Appuyez sur Entrée quand tout est arrêté..."

# 2. Nettoyer le bundler
echo ""
echo "📋 ÉTAPE 2: Nettoyage du bundler"
cd bundler-alto

if [ -d "node_modules" ]; then
    echo "   Suppression de node_modules..."
    rm -rf node_modules
fi

if [ -d ".pnpm-store" ]; then
    echo "   Suppression de .pnpm-store..."
    rm -rf .pnpm-store
fi

if [ -f "pnpm-lock.yaml" ]; then
    echo "   Suppression de pnpm-lock.yaml..."
    rm -f pnpm-lock.yaml
fi

# Nettoyer les builds
if [ -d "src/esm" ]; then
    echo "   Suppression des builds..."
    rm -rf src/esm
fi

if [ -d "dist" ]; then
    echo "   Suppression de dist..."
    rm -rf dist
fi

echo "   ✅ Nettoyage terminé"
cd ..

# 3. Réinstaller le bundler
echo ""
echo "📋 ÉTAPE 3: Réinstallation du bundler"
cd bundler-alto

echo "   Installation des dépendances avec pnpm..."
pnpm install

echo "   Build du bundler..."
pnpm run build:all

echo "   ✅ Réinstallation terminée"
cd ..

# 4. Vérifier la configuration
echo ""
echo "📋 ÉTAPE 4: Vérification de la configuration"
CONFIG_FILE="bundler-alto/scripts/config.local.json"

if [ ! -f "$CONFIG_FILE" ]; then
    echo "   ❌ Fichier de configuration non trouvé: $CONFIG_FILE"
    echo "   💡 Crée-le manuellement ou utilise le script de déploiement"
else
    echo "   ✅ Fichier de configuration trouvé"
    echo "   Vérifie que 'rpc-url' est 'http://127.0.0.1:8545'"
    grep -q "127.0.0.1:8545" "$CONFIG_FILE" && echo "   ✅ RPC URL correcte" || echo "   ⚠️  RPC URL à vérifier"
fi

# 5. Instructions finales
echo ""
echo "=================================================================================="
echo "✅ RÉINITIALISATION TERMINÉE"
echo "=================================================================================="
echo ""
echo "📋 PROCHAINES ÉTAPES:"
echo ""
echo "1. Lance Hardhat node:"
echo "   cd src/hardhat"
echo "   npx hardhat node"
echo ""
echo "2. Dans un autre terminal, déploie l'EntryPoint (si nécessaire):"
echo "   cd src/hardhat"
echo "   npm run deploy:entrypoint:bundler"
echo ""
echo "3. Dans un autre terminal, lance le bundler:"
echo "   cd bundler-alto"
echo "   ./run-local.sh"
echo ""
echo "4. Dans un autre terminal, lance Next.js:"
echo "   cd src"
echo "   npm run dev"
echo ""
echo "5. Déploie un NOUVEAU contrat via l'interface web"
echo ""
echo "6. Essaie d'envoyer la UserOperation"
echo ""
echo "💡 Si le problème persiste, lance le diagnostic:"
echo "   cd src/hardhat"
echo "   CONTRACT_ADDRESS=0x... npx hardhat run scripts/debugBundlerIssue.ts --network localhost"
echo ""

