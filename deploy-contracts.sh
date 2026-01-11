#!/bin/bash

# Script pour déployer tous les contrats SOX
# Ce script déploie tous les contrats nécessaires dans le bon ordre

set -e

echo "🚀 Déploiement de tous les contrats SOX"
echo "========================================"
echo ""

# Couleurs
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

# Vérifier que Hardhat node est lancé
echo "📡 Vérification du nœud Hardhat..."
if ! curl -s http://localhost:8545 > /dev/null 2>&1; then
    echo -e "${RED}❌ Hardhat node n'est pas lancé${NC}"
    echo ""
    echo "Lancez Hardhat node dans un terminal séparé :"
    echo -e "${GREEN}  cd /Applications/sox_implementation/src/hardhat && npx hardhat node${NC}"
    echo ""
    exit 1
fi
echo -e "${GREEN}✅ Hardhat node est actif${NC}"
echo ""

ROOT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$ROOT_DIR/src/hardhat"

# Étape 1: Déployer l'EntryPoint v0.8 (canonique)
echo "📝 Étape 1: Déploiement de l'EntryPoint v0.8..."
npx hardhat run scripts/deployEntryPointV8.ts --network localhost
echo ""

# Étape 2: Déployer les contrats de simulation pour le bundler
echo "📝 Étape 2: Déploiement des contrats de simulation..."
npx hardhat run scripts/deployPimlicoSimulations.ts --network localhost
echo ""
echo "📝 Étape 2b: Déploiement du contrat de simulation v0.8..."
npx hardhat run scripts/deployEntryPointSimulationsV8.ts --network localhost
echo ""

# Étape 3: Déployer toutes les bibliothèques et contrats principaux
echo "📝 Étape 3: Déploiement de tous les contrats SOX..."
npx hardhat run scripts/deployAll.ts --network localhost
echo ""

# Étape 4: Déployer le delegate EIP-7702
echo "📝 Étape 4: Déploiement du delegate EIP-7702..."
npx hardhat run scripts/deployEip7702Delegate.ts --network localhost
echo ""

cd "$ROOT_DIR"

echo "========================================"
echo -e "${GREEN}✅ Tous les contrats ont été déployés avec succès !${NC}"
echo ""
echo "📋 Prochaines étapes :"
echo "  1. Lancez le bundler : cd bundler-alto && ./run-local.sh"
echo "  2. Lancez Next.js : npm run dev"
echo ""







