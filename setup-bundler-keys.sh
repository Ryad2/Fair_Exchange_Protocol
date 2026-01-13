#!/bin/bash

# Script pour configurer automatiquement le bundler et mettre à jour les clés publiques
# après téléchargement/clonage du bundler

set -e

echo "=================================================================================="
echo "🔧 CONFIGURATION AUTOMATIQUE DU BUNDLER ET DES CLÉS PUBLIQUES"
echo "=================================================================================="
echo ""

# Couleurs
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

# Vérifier que Node.js est installé
if ! command -v node &> /dev/null; then
    echo "❌ Node.js n'est pas installé. Veuillez l'installer d'abord."
    exit 1
fi

# Vérifier que le bundler existe
if [ ! -d "bundler-alto" ]; then
    echo "❌ Le répertoire bundler-alto n'existe pas."
    echo "💡 Exécutez d'abord: ./install-alto.sh"
    exit 1
fi

# Extraire les clés privées de hardhat.config.ts
echo "📋 ÉTAPE 1: Extraction des clés privées depuis hardhat.config.ts..."
HARDHAT_CONFIG="src/hardhat/hardhat.config.ts"

if [ ! -f "$HARDHAT_CONFIG" ]; then
    echo "❌ Fichier hardhat.config.ts non trouvé: $HARDHAT_CONFIG"
    exit 1
fi

# Extraire les clés privées (les 4 premières comptes Hardhat)
PRIVATE_KEYS=(
    "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80"  # sponsor
    "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d"  # buyer
    "0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a"  # vendor
    "0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6"  # buyer dispute sponsor
)

EXECUTOR_KEYS="${PRIVATE_KEYS[0]},${PRIVATE_KEYS[1]},${PRIVATE_KEYS[2]},${PRIVATE_KEYS[3]}"
UTILITY_KEY="${PRIVATE_KEYS[0]}"

echo "   ✅ Clés privées extraites"
echo "   Executor keys: ${EXECUTOR_KEYS:0:50}..."
echo "   Utility key: ${UTILITY_KEY:0:50}..."

# Extraire l'adresse EntryPoint depuis deployed-contracts.json ou .env.local
echo ""
echo "📋 ÉTAPE 1b: Extraction de l'adresse EntryPoint..."

ENTRY_POINT_ADDRESS=""

# Essayer depuis deployed-contracts.json
if [ -f "deployed-contracts.json" ]; then
    if command -v jq &> /dev/null; then
        ENTRY_POINT_ADDRESS=$(jq -r '.entryPoint // empty' deployed-contracts.json 2>/dev/null)
    else
        ENTRY_POINT_ADDRESS=$(grep -o '"entryPoint":\s*"[^"]*"' deployed-contracts.json | cut -d'"' -f4)
    fi
fi

# Si pas trouvé, essayer depuis .env.local
if [ -z "$ENTRY_POINT_ADDRESS" ] && [ -f ".env.local" ]; then
    ENTRY_POINT_ADDRESS=$(grep "NEXT_PUBLIC_ENTRY_POINT=" .env.local | cut -d'=' -f2 | tr -d ' \n')
fi

# Si toujours pas trouvé, utiliser l'adresse canonique par défaut
if [ -z "$ENTRY_POINT_ADDRESS" ]; then
    ENTRY_POINT_ADDRESS="0x4337084D9E255Ff0702461CF8895CE9E3b5Ff108"
    echo "   ⚠️  Adresse EntryPoint non trouvée, utilisation de l'adresse canonique par défaut"
else
    echo "   ✅ Adresse EntryPoint trouvée"
fi

echo "   EntryPoint: ${ENTRY_POINT_ADDRESS}"

# Calculer les clés publiques correspondantes
echo ""
echo "📋 ÉTAPE 2: Calcul des clés publiques correspondantes..."

# Utiliser ethers depuis src/hardhat/node_modules
HARDHAT_NODE_MODULES="src/hardhat/node_modules"

if [ ! -d "$HARDHAT_NODE_MODULES" ]; then
    echo "   ⚠️  node_modules Hardhat non trouvé, installation en cours..."
    cd src/hardhat
    npm install
    cd ../..
fi

# Créer un script Node.js temporaire pour calculer les adresses
TEMP_SCRIPT=$(mktemp)
cat > "$TEMP_SCRIPT" << EOF
const path = require('path');
const { ethers } = require(path.join(process.cwd(), 'src/hardhat/node_modules/ethers'));

const privateKeys = process.argv.slice(2);
const publicKeys = privateKeys.map(pk => {
    const wallet = new ethers.Wallet(pk);
    return wallet.address;
});

console.log(JSON.stringify(publicKeys));
EOF

cd /Applications/sox_implementation
PUBLIC_KEYS_JSON=$(node "$TEMP_SCRIPT" ${PRIVATE_KEYS[@]})
rm "$TEMP_SCRIPT"

# Parser le JSON (simple extraction)
PUBLIC_KEYS=($(echo "$PUBLIC_KEYS_JSON" | node -e "const d=require('fs').readFileSync(0,'utf8'); JSON.parse(d).forEach(k=>console.log(k))"))

echo "   ✅ Clés publiques calculées:"
for i in "${!PUBLIC_KEYS[@]}"; do
    echo "      ${PUBLIC_KEYS[$i]}"
done

# Mettre à jour config.localhost.json
echo ""
echo "📋 ÉTAPE 3: Mise à jour de bundler-alto/config.localhost.json..."

CONFIG_FILE="bundler-alto/config.localhost.json"

if [ ! -f "$CONFIG_FILE" ]; then
    echo "   ⚠️  Fichier non trouvé, création..."
    mkdir -p bundler-alto
    cat > "$CONFIG_FILE" << EOF
{
  "network-name": "local",
  "rpc-url": "http://127.0.0.1:8545",
  "min-entity-stake": 1,
  "min-executor-balance": "1000000000000000000",
  "min-entity-unstake-delay": 1,
  "max-bundle-wait": 3,
  "max-bundle-size": 10,
  "max-block-range": 500,
  "port": 3000,
  "executor-private-keys": "${EXECUTOR_KEYS}",
  "utility-private-key": "${UTILITY_KEY}",
  "entrypoints": "${ENTRY_POINT_ADDRESS}",
  "deploy-simulations-contract": true,
  "enable-debug-endpoints": true,
  "safe-mode": false,
  "mempool-max-parallel-ops": 5,
  "mempool-max-queued-ops": 5,
  "enforce-unique-senders-per-bundle": false
}
EOF
else
    # Mettre à jour avec jq si disponible, sinon avec sed
    if command -v jq &> /dev/null; then
        jq ".executor-private-keys = \"${EXECUTOR_KEYS}\" | .utility-private-key = \"${UTILITY_KEY}\" | .entrypoints = \"${ENTRY_POINT_ADDRESS}\"" "$CONFIG_FILE" > "${CONFIG_FILE}.tmp" && mv "${CONFIG_FILE}.tmp" "$CONFIG_FILE"
    else
        # Utiliser sed comme fallback
        sed -i.bak "s|\"executor-private-keys\": \".*\"|\"executor-private-keys\": \"${EXECUTOR_KEYS}\"|" "$CONFIG_FILE"
        sed -i.bak "s|\"utility-private-key\": \".*\"|\"utility-private-key\": \"${UTILITY_KEY}\"|" "$CONFIG_FILE"
        sed -i.bak "s|\"entrypoints\": \".*\"|\"entrypoints\": \"${ENTRY_POINT_ADDRESS}\"|" "$CONFIG_FILE"
        rm -f "${CONFIG_FILE}.bak"
    fi
fi

echo "   ✅ ${CONFIG_FILE} mis à jour"

# Mettre à jour scripts/config.local.json
echo ""
echo "📋 ÉTAPE 4: Mise à jour de bundler-alto/scripts/config.local.json..."

SCRIPTS_CONFIG_FILE="bundler-alto/scripts/config.local.json"

if [ ! -f "$SCRIPTS_CONFIG_FILE" ]; then
    echo "   ⚠️  Fichier non trouvé, création..."
    mkdir -p bundler-alto/scripts
    cat > "$SCRIPTS_CONFIG_FILE" << EOF
{
  "network-name": "local",
  "rpc-url": "http://127.0.0.1:8545",
  "min-entity-stake": 1,
  "min-executor-balance": "1000000000000000000",
  "min-entity-unstake-delay": 1,
  "max-bundle-wait": 3,
  "max-bundle-size": 10,
  "max-block-range": 500,
  "port": 3000,
  "executor-private-keys": "${EXECUTOR_KEYS}",
  "utility-private-key": "${UTILITY_KEY}",
  "entrypoints": "${ENTRY_POINT_ADDRESS}",
  "deploy-simulations-contract": true,
  "enable-debug-endpoints": true,
  "safe-mode": false,
  "mempool-max-parallel-ops": 5,
  "mempool-max-queued-ops": 5,
  "enforce-unique-senders-per-bundle": false
}
EOF
else
    if command -v jq &> /dev/null; then
        jq ".executor-private-keys = \"${EXECUTOR_KEYS}\" | .utility-private-key = \"${UTILITY_KEY}\" | .entrypoints = \"${ENTRY_POINT_ADDRESS}\"" "$SCRIPTS_CONFIG_FILE" > "${SCRIPTS_CONFIG_FILE}.tmp" && mv "${SCRIPTS_CONFIG_FILE}.tmp" "$SCRIPTS_CONFIG_FILE"
    else
        sed -i.bak "s|\"executor-private-keys\": \".*\"|\"executor-private-keys\": \"${EXECUTOR_KEYS}\"|" "$SCRIPTS_CONFIG_FILE"
        sed -i.bak "s|\"utility-private-key\": \".*\"|\"utility-private-key\": \"${UTILITY_KEY}\"|" "$SCRIPTS_CONFIG_FILE"
        sed -i.bak "s|\"entrypoints\": \".*\"|\"entrypoints\": \"${ENTRY_POINT_ADDRESS}\"|" "$SCRIPTS_CONFIG_FILE"
        rm -f "${SCRIPTS_CONFIG_FILE}.bak"
    fi
fi

echo "   ✅ ${SCRIPTS_CONFIG_FILE} mis à jour"

# Vérifier que les dépendances sont installées
echo ""
echo "📋 ÉTAPE 5: Vérification des dépendances du bundler..."

if [ ! -d "bundler-alto/node_modules" ]; then
    echo "   ⚠️  node_modules non trouvé, installation en cours..."
    cd bundler-alto
    if command -v pnpm &> /dev/null; then
        pnpm install
    else
        echo "   ❌ pnpm n'est pas installé. Installation en cours..."
        npm install -g pnpm
        pnpm install
    fi
    cd ..
else
    echo "   ✅ Dépendances déjà installées"
fi

# Résumé
echo ""
echo "=================================================================================="
echo -e "${GREEN}✅ CONFIGURATION TERMINÉE AVEC SUCCÈS !${NC}"
echo "=================================================================================="
echo ""
echo "📋 RÉSUMÉ:"
echo ""
echo "   Clés privées configurées:"
echo "      Executor keys: ${EXECUTOR_KEYS:0:50}..."
echo "      Utility key: ${UTILITY_KEY:0:50}..."
echo ""
echo "   Clés publiques correspondantes:"
for i in "${!PUBLIC_KEYS[@]}"; do
    echo "      ${PUBLIC_KEYS[$i]}"
done
echo ""
echo "   EntryPoint configuré:"
echo "      ${ENTRY_POINT_ADDRESS}"
echo ""
echo "   Fichiers mis à jour:"
echo "      ✅ bundler-alto/config.localhost.json"
echo "      ✅ bundler-alto/scripts/config.local.json"
echo ""
echo "📋 PROCHAINES ÉTAPES:"
echo ""
echo "1. Vérifier que Hardhat node est lancé:"
echo "   cd src/hardhat && npx hardhat node"
echo ""
echo "2. Lancer le bundler:"
echo "   cd bundler-alto && ./run-local.sh"
echo ""
echo "3. (Optionnel) Builder le bundler si nécessaire:"
echo "   cd bundler-alto && pnpm run build:all"
echo ""

