#!/bin/bash

# Solution SIMPLE : Créer une nouvelle branche propre sans l'historique
# Cette méthode est plus sûre et plus rapide

set -e

echo "🧹 Création d'une nouvelle branche propre..."
echo ""

CURRENT_BRANCH=$(git branch --show-current)
NEW_BRANCH="${CURRENT_BRANCH}-clean"
BACKUP_BRANCH="backup-${CURRENT_BRANCH}-$(date +%Y%m%d)"

# Sauvegarde
echo "📦 Création d'une sauvegarde..."
git branch "$BACKUP_BRANCH"
echo "✅ Sauvegarde : $BACKUP_BRANCH"
echo ""

# Créer une nouvelle branche orpheline (sans historique)
echo "🌱 Création d'une branche orpheline..."
git checkout --orphan "$NEW_BRANCH"

# Ajouter tous les fichiers actuels (sauf ceux dans .gitignore)
echo "📝 Ajout des fichiers actuels..."
git add .

# Commit initial
echo "💾 Création du commit initial..."
git commit -m "Initial commit: clean repository without large files

- Removed test_1gb.* files (1GB+ each)
- Removed node_modules directories
- Removed bundler directories
- Removed build artifacts
- Kept only essential source files"

echo ""
echo "✅ Nouvelle branche créée : $NEW_BRANCH"
echo ""
echo "📊 Vérification de la taille :"
git count-objects -vH

echo ""
echo "⚠️  PROCHAINES ÉTAPES :"
echo "   1. Vérifiez que tout est correct : git log"
echo "   2. Si tout est bon, remplacez l'ancienne branche :"
echo "      git branch -D $CURRENT_BRANCH"
echo "      git branch -m $NEW_BRANCH $CURRENT_BRANCH"
echo "   3. Force push : git push --force origin $CURRENT_BRANCH"
echo ""
echo "   Pour revenir en arrière :"
echo "   git checkout $BACKUP_BRANCH"

