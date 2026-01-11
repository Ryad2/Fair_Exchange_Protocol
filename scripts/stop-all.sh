#!/bin/bash

# Script pour arrêter tous les services

set -e

echo "=========================================="
echo "🛑 ARRÊT DE TOUS LES SERVICES"
echo "=========================================="
echo ""

# Couleurs
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

info() {
    echo -e "${GREEN}ℹ️  $1${NC}"
}

warn() {
    echo -e "${YELLOW}⚠️  $1${NC}"
}

# Arrêter Hardhat node
if [ -f /tmp/sox-hardhat.pid ]; then
    HARDHAT_PID=$(cat /tmp/sox-hardhat.pid)
    if ps -p $HARDHAT_PID > /dev/null 2>&1; then
        info "Arrêt de Hardhat node (PID: $HARDHAT_PID)..."
        kill $HARDHAT_PID
        rm /tmp/sox-hardhat.pid
    fi
fi

# Arrêter le bundler
if [ -f /tmp/sox-bundler.pid ]; then
    BUNDLER_PID=$(cat /tmp/sox-bundler.pid)
    if ps -p $BUNDLER_PID > /dev/null 2>&1; then
        info "Arrêt du bundler (PID: $BUNDLER_PID)..."
        kill $BUNDLER_PID
        rm /tmp/sox-bundler.pid
    fi
fi

# Arrêter les processus sur les ports connus
info "Arrêt des processus sur les ports connus..."

# Port 8545 (Hardhat)
if lsof -Pi :8545 -sTCP:LISTEN -t >/dev/null 2>&1; then
    warn "Arrêt du processus sur le port 8545..."
    lsof -ti :8545 | xargs kill -9 2>/dev/null || true
fi

# Port 3000 (Bundler ou Next.js)
if lsof -Pi :3000 -sTCP:LISTEN -t >/dev/null 2>&1; then
    warn "Arrêt du processus sur le port 3000..."
    lsof -ti :3000 | xargs kill -9 2>/dev/null || true
fi

echo ""
echo "✅ Tous les services ont été arrêtés"









