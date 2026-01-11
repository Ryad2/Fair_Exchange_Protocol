#!/bin/bash

set -e

echo "=================================================================================="
echo "🔍 VÉRIFICATION ET RESTAURATION DU CODE SOURCE GIT"
echo "=================================================================================="
echo ""

# Vérifier si on est dans un repo Git
if [ ! -d ".git" ]; then
    echo "❌ Erreur: Ce n'est pas un dépôt Git!"
    echo "   Le dossier .git n'existe pas."
    exit 1
fi

echo "✅ Dépôt Git détecté"
echo ""

# Aller dans bundler-alto
if [ ! -d "bundler-alto" ]; then
    echo "❌ Erreur: Le dossier bundler-alto n'existe pas!"
    exit 1
fi

cd bundler-alto

# Vérifier si bundler-alto est un sous-module Git ou un dossier normal
if [ -d ".git" ]; then
    echo "📋 bundler-alto est un sous-module Git"
    GIT_DIR="bundler-alto"
else
    echo "📋 bundler-alto est un dossier dans le repo principal"
    GIT_DIR="."
    cd ..
fi

echo ""
echo "📋 ÉTAPE 1: Vérification des modifications"
echo ""

if [ "$GIT_DIR" = "bundler-alto" ]; then
    cd bundler-alto
    MODIFIED_FILES=$(git status --porcelain 2>/dev/null | wc -l | tr -d ' ')
    cd ..
else
    MODIFIED_FILES=$(git status --porcelain bundler-alto/ 2>/dev/null | wc -l | tr -d ' ')
fi

if [ "$MODIFIED_FILES" = "0" ]; then
    echo "✅ Aucune modification détectée dans bundler-alto"
    echo "   Le code est identique au dernier commit Git"
else
    echo "⚠️  $MODIFIED_FILES fichier(s) modifié(s) détecté(s)"
    echo ""
    echo "📋 Fichiers modifiés:"
    
    if [ "$GIT_DIR" = "bundler-alto" ]; then
        cd bundler-alto
        git status --short
        cd ..
    else
        git status --short bundler-alto/
    fi
    
    echo ""
    echo "📋 Voir les différences? (y/n)"
    read -r response
    if [ "$response" = "y" ] || [ "$response" = "Y" ]; then
        echo ""
        echo "Différences:"
        echo "=================================================================================="
        if [ "$GIT_DIR" = "bundler-alto" ]; then
            cd bundler-alto
            git diff
            cd ..
        else
            git diff bundler-alto/
        fi
        echo "=================================================================================="
    fi
    
    echo ""
    echo "📋 Voulez-vous restaurer le code source original de Git? (y/n)"
    echo "   ⚠️  ATTENTION: Cela va PERDRE toutes vos modifications!"
    read -r response
    
    if [ "$response" = "y" ] || [ "$response" = "Y" ]; then
        echo ""
        echo "🔄 Restauration du code source original..."
        
        if [ "$GIT_DIR" = "bundler-alto" ]; then
            cd bundler-alto
            echo "   Restauration dans bundler-alto (sous-module)..."
            git checkout .
            git clean -fd
            cd ..
        else
            echo "   Restauration dans bundler-alto (dossier)..."
            git checkout HEAD -- bundler-alto/
            git clean -fd bundler-alto/
        fi
        
        echo "   ✅ Code source restauré!"
        echo ""
        echo "   💡 Note: Les dépendances (node_modules) et builds ne sont PAS affectés"
        echo "   💡 Pour réinstaller proprement, lance: ./reset_bundler.sh"
    else
        echo "   ❌ Restauration annulée"
    fi
fi

echo ""
echo "=================================================================================="
echo "✅ Vérification terminée"
echo "=================================================================================="
echo ""
echo "💡 Pour voir l'historique Git:"
if [ "$GIT_DIR" = "bundler-alto" ]; then
    echo "   cd bundler-alto && git log --oneline -10"
else
    echo "   git log --oneline -10 bundler-alto/"
fi
echo ""












