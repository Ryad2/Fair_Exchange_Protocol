#!/bin/bash

# Script de démarrage complet et synchronisé
# Ce script démarre tout dans le bon ordre pour éviter les problèmes de synchronisation

set -e  # Arrêter en cas d'erreur

echo "=========================================="
echo "🚀 DÉMARRAGE COMPLET ET SYNCHRONISÉ"
echo "=========================================="
echo ""

# Couleurs pour les messages
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

# Fonction pour afficher les messages
info() {
    echo -e "${GREEN}ℹ️  $1${NC}"
}

warn() {
    echo -e "${YELLOW}⚠️  $1${NC}"
}

error() {
    echo -e "${RED}❌ $1${NC}"
}

# Vérifier que nous sommes dans le bon répertoire
if [ ! -f "package.json" ]; then
    error "Ce script doit être exécuté depuis la racine du projet"
    exit 1
fi

# Étape 1: Vérifier que Hardhat node n'est pas déjà en cours
info "Étape 1: Vérification de l'état de la blockchain..."
if lsof -Pi :8545 -sTCP:LISTEN -t >/dev/null ; then
    warn "Un processus écoute déjà sur le port 8545"
    read -p "Voulez-vous l'arrêter et redémarrer ? (y/n) " -n 1 -r
    echo
    if [[ $REPLY =~ ^[Yy]$ ]]; then
        info "Arrêt du processus sur le port 8545..."
        lsof -ti :8545 | xargs kill -9 || true
        sleep 2
    else
        error "Abandon. Veuillez arrêter manuellement le processus sur le port 8545"
        exit 1
    fi
fi

# Étape 2: Démarrer Hardhat node en arrière-plan
info "Étape 2: Démarrage de Hardhat node..."
cd src/hardhat
npx hardhat node > /tmp/hardhat-node.log 2>&1 &
HARDHAT_PID=$!
cd ../..

# Attendre que Hardhat soit prêt
info "Attente que Hardhat node soit prêt (10 secondes)..."
sleep 10

# Vérifier que Hardhat répond
if ! curl -s http://localhost:8545 > /dev/null; then
    error "Hardhat node ne répond pas sur le port 8545"
    kill $HARDHAT_PID 2>/dev/null || true
    exit 1
fi

info "✅ Hardhat node démarré (PID: $HARDHAT_PID)"

# Étape 3: Déployer tous les contrats
info "Étape 3: Déploiement de tous les contrats..."
cd src/hardhat
npx hardhat run scripts/deployCompleteStack.ts --network localhost
DEPLOY_EXIT_CODE=$?
cd ../..

if [ $DEPLOY_EXIT_CODE -ne 0 ]; then
    error "Erreur lors du déploiement des contrats"
    kill $HARDHAT_PID 2>/dev/null || true
    exit 1
fi

info "✅ Contrats déployés avec succès"

# Étape 4: Vérifier que le bundler n'est pas déjà en cours
info "Étape 4: Vérification de l'état du bundler..."
BUNDLER_PORT=3000
if lsof -Pi :$BUNDLER_PORT -sTCP:LISTEN -t >/dev/null ; then
    warn "Un processus écoute déjà sur le port $BUNDLER_PORT (bundler)"
    read -p "Voulez-vous l'arrêter et redémarrer ? (y/n) " -n 1 -r
    echo
    if [[ $REPLY =~ ^[Yy]$ ]]; then
        info "Arrêt du bundler..."
        lsof -ti :$BUNDLER_PORT | xargs kill -9 || true
        sleep 2
    else
        warn "Le bundler ne sera pas redémarré"
    fi
fi

# Étape 5: Démarrer le bundler (si le répertoire existe)
if [ -d "bundler-alto" ]; then
    info "Étape 5: Démarrage du bundler..."
    cd bundler-alto
    
    # Vérifier que la config existe
    if [ ! -f "config.localhost.json" ]; then
        warn "Fichier config.localhost.json non trouvé, création d'une config par défaut..."
        cat > config.localhost.json << EOF
{
    "network-name": "local",
    "rpc-url": "http://127.0.0.1:8545",
    "min-entity-stake": 1,
    "min-executor-balance": "1000000000000000000",
    "min-entity-unstake-delay": 1,
    "max-bundle-wait": 3,
    "max-bundle-size": 3,
    "max-block-range": 500,
    "port": 3000,
    "executor-private-keys": "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80,0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d,0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a,0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6",
    "utility-private-key": "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80",
    "entrypoints": "PLACEHOLDER_ENTRYPOINT",
    "deploy-simulations-contract": true,
    "enable-debug-endpoints": true,
    "safe-mode": false,
    "mempool-max-parallel-ops": 5,
    "mempool-max-queued-ops": 5,
    "enforce-unique-senders-per-bundle": false
}
EOF
        warn "⚠️  Veuillez mettre à jour config.localhost.json avec l'adresse EntryPoint déployée"
    fi
    
    # Lire l'EntryPoint depuis .env.local si disponible
    if [ -f "../.env.local" ]; then
        ENTRY_POINT=$(grep "NEXT_PUBLIC_ENTRY_POINT=" ../.env.local | cut -d '=' -f2)
        if [ ! -z "$ENTRY_POINT" ]; then
            info "Mise à jour de la config bundler avec EntryPoint: $ENTRY_POINT"
            # Utiliser sed pour remplacer PLACEHOLDER_ENTRYPOINT ou mettre à jour entrypoints
            if command -v jq > /dev/null; then
                jq --arg ep "$ENTRY_POINT" '.entrypoints = $ep' config.localhost.json > config.localhost.json.tmp && mv config.localhost.json.tmp config.localhost.json
            else
                warn "jq n'est pas installé, veuillez mettre à jour manuellement entrypoints dans config.localhost.json"
            fi
        fi
    fi
    
    # Démarrer le bundler (ajuster selon votre méthode de démarrage)
    if [ -f "package.json" ]; then
        npm run start:localhost > /tmp/bundler.log 2>&1 &
        BUNDLER_PID=$!
        sleep 5
        
        # Vérifier que le bundler répond
        if curl -s http://localhost:$BUNDLER_PORT > /dev/null 2>&1; then
            info "✅ Bundler démarré (PID: $BUNDLER_PID)"
        else
            warn "⚠️  Le bundler ne semble pas répondre, vérifiez /tmp/bundler.log"
        fi
    else
        warn "⚠️  package.json non trouvé dans bundler-alto, bundler non démarré"
    fi
    
    cd ..
else
    warn "⚠️  Répertoire bundler-alto non trouvé, bundler non démarré"
fi

# Étape 6: Vérifier que Next.js n'est pas déjà en cours
info "Étape 6: Vérification de l'état de l'application web..."
NEXTJS_PORT=3000
if lsof -Pi :$NEXTJS_PORT -sTCP:LISTEN -t >/dev/null ; then
    warn "Un processus écoute déjà sur le port $NEXTJS_PORT"
    warn "Si c'est le bundler, c'est normal. Sinon, veuillez arrêter Next.js manuellement"
else
    info "L'application web Next.js peut être démarrée avec: npm run dev"
fi

# Résumé
echo ""
echo "=========================================="
echo "✅ DÉMARRAGE TERMINÉ"
echo "=========================================="
echo ""
echo "📋 Services démarrés :"
echo "  ✅ Hardhat node (PID: $HARDHAT_PID) sur http://localhost:8545"
if [ ! -z "$BUNDLER_PID" ]; then
    echo "  ✅ Bundler (PID: $BUNDLER_PID) sur http://localhost:3000"
fi
echo ""
echo "📝 Logs :"
echo "  Hardhat node: /tmp/hardhat-node.log"
if [ ! -z "$BUNDLER_PID" ]; then
    echo "  Bundler: /tmp/bundler.log"
fi
echo ""
echo "🚀 Prochaines étapes :"
echo "  1. Vérifier que .env.local contient NEXT_PUBLIC_ENTRY_POINT"
echo "  2. Démarrer l'application web: npm run dev"
echo "  3. Ouvrir http://localhost:3000 dans votre navigateur"
echo ""
echo "🛑 Pour arrêter tous les services :"
echo "  kill $HARDHAT_PID"
if [ ! -z "$BUNDLER_PID" ]; then
    echo "  kill $BUNDLER_PID"
fi
echo ""

# Sauvegarder les PIDs dans un fichier pour faciliter l'arrêt
echo "$HARDHAT_PID" > /tmp/sox-hardhat.pid
if [ ! -z "$BUNDLER_PID" ]; then
    echo "$BUNDLER_PID" > /tmp/sox-bundler.pid
fi

info "Les PIDs ont été sauvegardés dans /tmp/sox-*.pid"










