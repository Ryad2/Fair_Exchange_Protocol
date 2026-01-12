#!/bin/bash

# Script pour déployer toute l'application SOX
# Ce script lance tous les composants nécessaires dans l'ordre

set -e

echo "🚀 Déploiement de l'application SOX"
echo "===================================="
echo ""

# Couleurs pour les messages
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

# Fonction pour vérifier si un port est utilisé
check_port() {
    if lsof -Pi :$1 -sTCP:LISTEN -t >/dev/null 2>&1 ; then
        return 0
    else
        return 1
    fi
}

# Étape 1: Vérifier que Hardhat node est lancé
echo "📡 Étape 1: Vérification du nœud Hardhat..."
if ! curl -s http://localhost:8545 > /dev/null 2>&1; then
    echo -e "${YELLOW}⚠️  Hardhat node n'est pas lancé${NC}"
    echo ""
    echo "Lancez Hardhat node dans un terminal séparé :"
    echo -e "${GREEN}  cd src/hardhat && npx hardhat node${NC}"
    echo ""
    echo "Puis relancez ce script."
    exit 1
fi
echo -e "${GREEN}✅ Hardhat node est actif${NC}"
echo ""

# Étape 2: Déployer les contrats
echo "📝 Étape 2: Déploiement des contrats..."
cd src/hardhat

# Déployer EntryPoint si nécessaire
echo "  - Déploiement de l'EntryPoint..."
npx hardhat run scripts/deployEntryPointForBundler.ts --network localhost > /dev/null 2>&1 || true

# Déployer les contrats de simulation
echo "  - Déploiement des contrats de simulation..."
npx hardhat run scripts/deployPimlicoSimulations.ts --network localhost > /dev/null 2>&1 || true
npx hardhat run scripts/deployEntryPointSimulations.ts --network localhost > /dev/null 2>&1 || true

# Déployer tous les autres contrats
echo "  - Déploiement de tous les contrats..."
npx hardhat run scripts/deployAll.ts --network localhost

cd ../..
echo -e "${GREEN}✅ Contrats déployés${NC}"
echo ""

# Étape 3: Vérifier que le bundler peut démarrer
echo "🔌 Étape 3: Vérification du bundler..."
if check_port 3002; then
    echo -e "${YELLOW}⚠️  Le port 3002 est déjà utilisé (bundler peut-être déjà lancé)${NC}"
else
    echo -e "${GREEN}✅ Le port 3002 est disponible${NC}"
fi
echo ""

# Étape 4: Vérifier que Next.js peut démarrer
echo "🌐 Étape 4: Vérification de Next.js..."
if check_port 3000; then
    echo -e "${YELLOW}⚠️  Le port 3000 est déjà utilisé (Next.js peut-être déjà lancé)${NC}"
else
    echo -e "${GREEN}✅ Le port 3000 est disponible${NC}"
fi
echo ""

echo "===================================="
echo -e "${GREEN}✅ Déploiement terminé !${NC}"
echo ""
echo "📋 Prochaines étapes :"
echo ""
echo "1. Lancez le bundler dans un terminal :"
echo -e "   ${GREEN}cd bundler-alto && ./run-local.sh${NC}"
echo ""
echo "2. Lancez Next.js dans un autre terminal :"
echo -e "   ${GREEN}npm run dev${NC}"
echo ""
echo "3. (Optionnel) Lancez Electron dans un autre terminal :"
echo -e "   ${GREEN}cd desktop && npm start${NC}"
echo ""
echo "🌐 L'application sera accessible sur :"
echo "   - Web: http://localhost:3000"
echo "   - Bundler: http://localhost:3002/rpc"
echo ""













