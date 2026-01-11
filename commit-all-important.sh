#!/bin/bash

# Script pour commit tous les fichiers importants du projet

set -e

echo "📦 Préparation du commit avec tous les fichiers importants..."
echo ""

# Ajouter tous les fichiers modifiés et nouveaux (respectant .gitignore)
git add -A

echo "📋 Fichiers à committer :"
echo ""
git status --short | head -30
echo ""

# Compter les fichiers
SOL_FILES=$(git diff --cached --name-only | grep "\.sol$" | wc -l | tr -d ' ')
TS_FILES=$(git diff --cached --name-only | grep "\.ts$\|\.tsx$" | wc -l | tr -d ' ')
RS_FILES=$(git diff --cached --name-only | grep "\.rs$" | wc -l | tr -d ' ')

echo "📊 Statistiques :"
echo "   - Contrats Solidity: $SOL_FILES fichiers"
echo "   - Code TypeScript/React: $TS_FILES fichiers"
echo "   - Code Rust: $RS_FILES fichiers"
echo ""

# Créer le commit
COMMIT_MSG="feat: commit all essential project files

- Smart contracts (.sol): All core contracts including DisputeSOXAccount, OptimisticSOXAccount, EvaluatorSOX_V2, etc.
- TypeScript scripts: Deployment and test scripts
- Next.js application: API routes, components, and utilities
- Rust/WASM source: Cryptographic libraries and circuit evaluators
- Configuration files: package.json, tsconfig.json, hardhat.config.ts, etc.
- Database schema: init.sql
- Deployment scripts: Shell scripts for deployment and startup
- Documentation: Installation guides and file lists

Removed large directories:
- bundler-alto/ (excluded from git)
- src/hardhat/bundler/ (excluded from git)
- node_modules/ (excluded from git)
- Build artifacts and test files"

echo "💾 Création du commit..."
git commit -m "$COMMIT_MSG"

echo ""
echo "✅ Commit créé avec succès !"
echo ""
echo "📊 Vérification :"
git log -1 --stat --oneline | head -20

