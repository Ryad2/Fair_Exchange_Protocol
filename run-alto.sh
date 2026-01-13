#!/bin/bash

# Script pour lancer le bundler Alto

set -e

# Couleurs pour les messages
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

echo -e "${GREEN}🚀 Démarrage du bundler Alto...${NC}"
echo ""

# Vérifier que nous sommes dans le bon répertoire
if [ ! -d "bundler-alto" ]; then
    echo -e "${RED}❌ Le répertoire bundler-alto n'existe pas${NC}"
    echo "   Exécutez d'abord: ./install-alto.sh"
    exit 1
fi

cd bundler-alto

# Vérifier que Alto est construit
if [ ! -f "alto" ] && [ ! -f "src/esm/cli/alto.js" ]; then
    echo -e "${YELLOW}⚠️  Alto n'est pas construit. Build en cours...${NC}"
    export PATH="$HOME/.foundry/bin:$PATH"
    pnpm run build:all
fi

# Vérifier que la configuration existe
CONFIG_FILE="scripts/config.local.json"
if [ ! -f "$CONFIG_FILE" ]; then
    echo -e "${YELLOW}⚠️  Fichier de configuration non trouvé: $CONFIG_FILE${NC}"
    echo "   Création d'une configuration par défaut..."
    mkdir -p scripts
    cat > "$CONFIG_FILE" << 'EOF'
{
    "network-name": "local",
    "rpc-url": "http://127.0.0.1:8545",
    "entrypoints": "",
    "port": 3002
}
EOF
    echo -e "${YELLOW}   ⚠️  Veuillez mettre à jour $CONFIG_FILE avec l'adresse EntryPoint déployée${NC}"
    echo ""
fi

# Vérifier que Hardhat node est lancé
if ! curl -s http://localhost:8545 > /dev/null 2>&1; then
    echo -e "${YELLOW}⚠️  Hardhat node ne semble pas être lancé${NC}"
    echo "   Lancez Hardhat node dans un terminal séparé :"
    echo -e "   ${GREEN}cd src/hardhat && npx hardhat node${NC}"
    echo ""
    read -p "Appuyez sur Entrée pour continuer quand Hardhat node est lancé... "
fi

# S'assurer que forge est dans le PATH
if [ -d "$HOME/.foundry/bin" ] && [[ ":$PATH:" != *":$HOME/.foundry/bin:"* ]]; then
    export PATH="$HOME/.foundry/bin:$PATH"
fi

# Lire le port depuis la config si disponible
PORT=$(grep -o '"port"[[:space:]]*:[[:space:]]*[0-9]*' "$CONFIG_FILE" | grep -o '[0-9]*' | head -n1)
if [ -z "$PORT" ]; then
    PORT=3002
fi

# Lancer Alto
echo -e "${GREEN}📍 Lancement du bundler Alto...${NC}"
echo -e "${GREEN}   Le bundler sera accessible sur: http://localhost:${PORT}/rpc${NC}"
echo ""
echo -e "${YELLOW}   Pour arrêter le bundler, appuyez sur Ctrl+C${NC}"
echo ""

# Utiliser le binaire alto (qui appelle pnpm start) ou directement node
if [ -f "alto" ]; then
    ./alto --config scripts/config.local.json
elif [ -f "src/esm/cli/alto.js" ]; then
    node src/esm/cli/alto.js run --config scripts/config.local.json
else
    echo -e "${RED}❌ Impossible de trouver le binaire Alto${NC}"
    echo "   Essayez de builder: pnpm run build:all"
    exit 1
fi
