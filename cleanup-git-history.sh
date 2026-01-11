#!/bin/bash

# Script pour nettoyer l'historique Git des gros fichiers
# ATTENTION : Ce script réécrit l'historique Git

set -e

echo "🧹 Nettoyage de l'historique Git des gros fichiers..."
echo ""

# Sauvegarde de sécurité
echo "📦 Création d'une sauvegarde de la branche actuelle..."
CURRENT_BRANCH=$(git branch --show-current)
BACKUP_BRANCH="backup-before-cleanup-$(date +%Y%m%d-%H%M%S)"
git branch "$BACKUP_BRANCH"
echo "✅ Sauvegarde créée : $BACKUP_BRANCH"
echo ""

# Supprimer les gros fichiers de l'historique
echo "🗑️  Suppression des fichiers volumineux de l'historique..."

# Supprimer test_1gb.*
git filter-branch --force --index-filter \
  "git rm --cached --ignore-unmatch test_1gb.bin test_1gb.ct test_1gb.circuit" \
  --prune-empty --tag-name-filter cat -- --all

# Supprimer desktop/node_modules
git filter-branch --force --index-filter \
  "git rm -r --cached --ignore-unmatch desktop/node_modules" \
  --prune-empty --tag-name-filter cat -- --all

# Supprimer bundler et bundler-alto
git filter-branch --force --index-filter \
  "git rm -r --cached --ignore-unmatch bundler bundler-alto src/hardhat/bundler" \
  --prune-empty --tag-name-filter cat -- --all

# Supprimer les fichiers de test temporaires
git filter-branch --force --index-filter \
  "git rm -r --cached --ignore-unmatch 'src/hardhat/test/timing/tmp/*'" \
  --prune-empty --tag-name-filter cat -- --all

echo ""
echo "🧹 Nettoyage des références..."
git for-each-ref --format="delete %(refname)" refs/original | git update-ref --stdin
git reflog expire --expire=now --all
git gc --prune=now --aggressive

echo ""
echo "✅ Nettoyage terminé !"
echo ""
echo "📊 Vérification de la taille :"
git count-objects -vH

echo ""
echo "⚠️  IMPORTANT :"
echo "   - Une sauvegarde a été créée : $BACKUP_BRANCH"
echo "   - Vous devez faire un force push : git push --force"
echo "   - Si quelque chose ne va pas, restaurez avec : git branch -D $CURRENT_BRANCH && git checkout $BACKUP_BRANCH"

