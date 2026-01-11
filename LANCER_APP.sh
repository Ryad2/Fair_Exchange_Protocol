#!/bin/bash

# Script pour lancer l'application

set -e

echo "🚀 Démarrage de l'application..."
echo ""

# Vérifier si le port 3000 est libre
if lsof -Pi :3000 -sTCP:LISTEN -t >/dev/null ; then
    echo "⚠️  Le port 3000 est déjà utilisé. Arrêt du processus..."
    lsof -ti:3000 | xargs kill 2>/dev/null || true
    sleep 2
fi

# Vérifier si les dépendances sont installées
if [ ! -d "node_modules" ]; then
    echo "📦 Installation des dépendances..."
    npm install
fi

# Vérifier si le WASM est compilé
if [ ! -f "src/app/lib/crypto_lib/crypto_lib_bg.wasm" ]; then
    echo "⚠️  WASM non trouvé. Compilation..."
    if [ -d "src/wasm" ]; then
        cd src/wasm && ./deploy.sh && cd ../..
    else
        echo "❌ Dossier src/wasm non trouvé"
        exit 1
    fi
fi

echo "🌐 Lancement du serveur Next.js..."
echo ""
echo "L'application sera disponible sur: http://localhost:3000"
echo ""
echo "Pour arrêter le serveur, appuyez sur Ctrl+C"
echo ""

npm run dev




















