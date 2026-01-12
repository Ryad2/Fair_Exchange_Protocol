#!/bin/bash

set -e

echo "=================================================================================="
echo "🔍 VÉRIFICATION ET RESTAURATION DU BUNDLER ALTO DEPUIS GIT"
echo "=================================================================================="
echo ""

# Vérifier si bundler-alto existe
if [ ! -d "bundler-alto" ]; then
    echo "❌ Erreur: Le dossier bundler-alto n'existe pas!"
    exit 1
fi

cd bundler-alto

# Vérifier si c'est un repo Git ou un sous-module
if [ -d ".git" ]; then
    echo "✅ bundler-alto est un dépôt Git (sous-module)"
    IS_GIT_REPO=true
else
    echo "⚠️  bundler-alto n'est pas un dépôt Git séparé"
    echo "   Vérification dans le repo parent..."
    cd ..
    if [ ! -d ".git" ]; then
        echo "❌ Erreur: Aucun dépôt Git trouvé!"
        exit 1
    fi
    IS_GIT_REPO=false
fi

echo ""
echo "📋 ÉTAPE 1: Vérification des modifications"
echo ""

if [ "$IS_GIT_REPO" = true ]; then
    # bundler-alto est un repo Git séparé
    MODIFIED_FILES=$(git status --porcelain 2>/dev/null | wc -l | tr -d ' ')
    
    if [ "$MODIFIED_FILES" = "0" ]; then
        echo "✅ Aucune modification détectée"
        echo "   Le code est identique au dernier commit Git"
    else
        echo "⚠️  $MODIFIED_FILES fichier(s) modifié(s) détecté(s)"
        echo ""
        echo "📋 Fichiers modifiés:"
        git status --short
        
        echo ""
        echo "📋 Voir les différences? (y/n)"
        read -r response
        if [ "$response" = "y" ] || [ "$response" = "Y" ]; then
            echo ""
            echo "Différences:"
            echo "=================================================================================="
            git diff
            echo "=================================================================================="
        fi
        
        echo ""
        echo "📋 Voulez-vous restaurer le code source original de Git? (y/n)"
        echo "   ⚠️  ATTENTION: Cela va PERDRE toutes vos modifications dans bundler-alto!"
        read -r response
        
        if [ "$response" = "y" ] || [ "$response" = "Y" ]; then
            echo ""
            echo "🔄 Restauration du code source original..."
            git checkout .
            git clean -fd
            echo "   ✅ Code source restauré!"
        else
            echo "   ❌ Restauration annulée"
        fi
    fi
    
    echo ""
    echo "📋 Derniers commits:"
    git log --oneline -5
    
else
    # bundler-alto est dans le repo parent
    cd ..
    MODIFIED_FILES=$(git status --porcelain bundler-alto/ 2>/dev/null | wc -l | tr -d ' ')
    
    if [ "$MODIFIED_FILES" = "0" ]; then
        echo "✅ Aucune modification détectée dans bundler-alto"
        echo "   Le code est identique au dernier commit Git"
    else
        echo "⚠️  $MODIFIED_FILES fichier(s) modifié(s) détecté(s) dans bundler-alto"
        echo ""
        echo "📋 Fichiers modifiés:"
        git status --short bundler-alto/
        
        echo ""
        echo "📋 Voir les différences? (y/n)"
        read -r response
        if [ "$response" = "y" ] || [ "$response" = "Y" ]; then
            echo ""
            echo "Différences:"
            echo "=================================================================================="
            git diff bundler-alto/
            echo "=================================================================================="
        fi
        
        echo ""
        echo "📋 Voulez-vous restaurer le code source original de Git? (y/n)"
        echo "   ⚠️  ATTENTION: Cela va PERDRE toutes vos modifications dans bundler-alto!"
        read -r response
        
        if [ "$response" = "y" ] || [ "$response" = "Y" ]; then
            echo ""
            echo "🔄 Restauration du code source original..."
            git checkout HEAD -- bundler-alto/
            git clean -fd bundler-alto/
            echo "   ✅ Code source restauré!"
        else
            echo "   ❌ Restauration annulée"
        fi
    fi
fi

echo ""
echo "=================================================================================="
echo "✅ Vérification terminée"
echo "=================================================================================="
echo ""
echo "💡 Note: Les dépendances (node_modules) et builds ne sont PAS affectés"
echo "💡 Pour réinstaller proprement après restauration: ./reset_bundler.sh"
echo ""













