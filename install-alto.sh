#!/bin/bash

# Script d'installation de Pimlico Alto bundler pour tests locaux

set -e

echo "🚀 Installation de Pimlico Alto bundler..."

# Vérifier que pnpm est installé
if ! command -v pnpm &> /dev/null; then
    echo "❌ pnpm n'est pas installé. Installation en cours..."
    npm install -g pnpm
fi

# Cloner Alto si ce n'est pas déjà fait
if [ ! -d "bundler-alto" ]; then
    echo "📦 Clonage de Pimlico Alto..."
    git clone https://github.com/pimlicolabs/alto.git bundler-alto
else
    echo "✅ Alto déjà cloné"
fi

# Installer les dépendances
echo "📦 Installation des dépendances..."
cd bundler-alto
pnpm install

# Builder
echo "🔨 Build en cours..."
pnpm build:all

echo "✅ Installation terminée!"
echo ""
echo "Pour lancer Alto, utilisez le script run-alto.sh"
cd ..




















