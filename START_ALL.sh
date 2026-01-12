#!/bin/bash

# Script pour lancer tous les services nécessaires pour tester l'interface web

set -e

echo "🚀 Démarrage de tous les services pour l'interface web"
echo ""

# Couleurs pour les messages
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

# Fonction pour vérifier si un port est libre
check_port() {
    local port=$1
    if lsof -ti:$port > /dev/null 2>&1; then
        return 1  # Port occupé
    else
        return 0  # Port libre
    fi
}

# Fonction pour tuer un processus sur un port
kill_port() {
    local port=$1
    local pid=$(lsof -ti:$port 2>/dev/null)
    if [ ! -z "$pid" ]; then
        echo -e "${YELLOW}⚠️  Port $port occupé, arrêt du processus $pid${NC}"
        kill $pid 2>/dev/null || true
        sleep 1
    fi
}

# 1. Vérifier et lancer Hardhat node (ou Anvil)
echo -e "${GREEN}1. Vérification du nœud blockchain...${NC}"
if check_port 8545; then
    echo -e "${YELLOW}   Hardhat node non lancé${NC}"
    echo -e "${YELLOW}   Lancez dans un terminal séparé:${NC}"
    echo -e "   ${GREEN}cd src/hardhat && npx hardhat node${NC}"
    echo ""
    echo -e "   ${YELLOW}OU utilisez Anvil (recommandé):${NC}"
    echo -e "   ${GREEN}./run-anvil.sh${NC}"
    echo ""
    read -p "Appuyez sur Entrée une fois le nœud lancé... "
else
    echo -e "${GREEN}   ✅ Nœud blockchain déjà lancé${NC}"
fi

# 2. Vérifier et lancer le bundler
echo -e "${GREEN}2. Vérification du bundler...${NC}"
if check_port 3002; then
    echo -e "${YELLOW}   Bundler non lancé${NC}"
    echo -e "${YELLOW}   Lancez dans un terminal séparé:${NC}"
    echo -e "   ${GREEN}./run-alto.sh${NC}"
    echo ""
    read -p "Appuyez sur Entrée une fois le bundler lancé... "
else
    echo -e "${GREEN}   ✅ Bundler déjà lancé${NC}"
fi

# 3. Initialiser la base de données si nécessaire
echo -e "${GREEN}3. Vérification de la base de données...${NC}"
if [ ! -f "src/app/db/sox.sqlite" ]; then
    echo -e "${YELLOW}   Initialisation de la base de données...${NC}"
    cd src/app/db
    touch sox.sqlite
    cat init.sql | sqlite3 sox.sqlite
    cd ../../..
    echo -e "${GREEN}   ✅ Base de données initialisée${NC}"
else
    echo -e "${GREEN}   ✅ Base de données existe${NC}"
fi

# 4. Vérifier les dépendances
echo -e "${GREEN}4. Vérification des dépendances...${NC}"
if [ ! -d "node_modules/next" ]; then
    echo -e "${YELLOW}   Installation des dépendances...${NC}"
    npm install
    echo -e "${GREEN}   ✅ Dépendances installées${NC}"
else
    echo -e "${GREEN}   ✅ Dépendances installées${NC}"
fi

# 5. Lancer l'interface web
echo -e "${GREEN}5. Lancement de l'interface web...${NC}"
if check_port 3000; then
    echo -e "${GREEN}   🚀 Démarrage de Next.js...${NC}"
    echo ""
    echo -e "${GREEN}   📍 L'interface sera accessible sur: http://localhost:3000${NC}"
    echo ""
    cd src
    npm run dev
else
    echo -e "${RED}   ❌ Port 3000 déjà occupé${NC}"
    echo -e "${YELLOW}   Arrêt du processus existant...${NC}"
    kill_port 3000
    sleep 2
    echo -e "${GREEN}   🚀 Redémarrage de Next.js...${NC}"
    cd src
    npm run dev
fi





















