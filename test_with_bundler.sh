#!/bin/bash

# Script pour tester avec le bundler Alto
# Ce script déploie le contrat, attend, puis envoie la UserOperation

set -e

echo "🧪 Test avec bundler Alto"
echo ""
echo "⚠️  IMPORTANT: Assure-toi que :"
echo "   1. Hardhat node est lancé : cd src/hardhat && npx hardhat node"
echo "   2. Bundler est lancé : cd bundler-alto && ./run-local.sh"
echo ""

read -p "Appuyez sur Entrée pour continuer..."

echo ""
echo "🚀 Lancement du test..."
echo ""

cd src/hardhat
npx hardhat run scripts/testFullFlow.ts --network localhost

echo ""
echo "📋 Si tu vois l'erreur 'Sender has no code' :"
echo "   1. Arrête le bundler (Ctrl+C dans son terminal)"
echo "   2. Redémarre le bundler : cd bundler-alto && ./run-local.sh"
echo "   3. Relance ce script : ./test_with_bundler.sh"
echo ""












