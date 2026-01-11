#!/bin/bash

# Script pour tester le flux complet : déploiement + envoi UserOperation

echo "🧪 Test complet : Déploiement + Envoi UserOperation"
echo ""
echo "⚠️  Assure-toi que :"
echo "   1. Hardhat node est lancé : npx hardhat node"
echo "   2. Bundler est lancé : cd bundler-alto && ./run-local.sh"
echo ""
read -p "Appuyez sur Entrée pour continuer..."

cd src/hardhat

echo ""
echo "🚀 Lancement du test..."
echo ""

npx hardhat run scripts/testFullFlow.ts --network localhost












