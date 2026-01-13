#!/bin/bash

# Script d'installation de Pimlico Alto bundler pour tests locaux

set -e

echo "🚀 Installation de Pimlico Alto bundler..."

# Vérifier que pnpm est installé
if ! command -v pnpm &> /dev/null; then
    echo "❌ pnpm n'est pas installé. Installation en cours..."
    npm install -g pnpm
fi

# Vérifier que Foundry (forge) est installé
# S'assurer que forge est dans le PATH
if [ -d "$HOME/.foundry/bin" ] && [[ ":$PATH:" != *":$HOME/.foundry/bin:"* ]]; then
    export PATH="$HOME/.foundry/bin:$PATH"
fi

if ! command -v forge &> /dev/null; then
    echo "❌ Foundry (forge) n'est pas installé. Installation en cours..."
    echo "   Installation de Foundry via foundryup..."
    
    # Installer foundryup si nécessaire
    if ! command -v foundryup &> /dev/null && [ ! -f "$HOME/.foundry/bin/foundryup" ]; then
        curl -L https://foundry.paradigm.xyz | bash
        # Ajouter foundryup au PATH pour cette session
        export PATH="$HOME/.foundry/bin:$PATH"
    fi
    
    # Exécuter foundryup pour installer Foundry
    if command -v foundryup &> /dev/null; then
        foundryup || {
            echo "⚠️  foundryup a échoué. Vérification si forge est déjà installé..."
            # Vérifier si forge existe dans le répertoire foundry
            if [ -f "$HOME/.foundry/bin/forge" ]; then
                export PATH="$HOME/.foundry/bin:$PATH"
                echo "✅ forge trouvé dans $HOME/.foundry/bin"
            else
                echo "❌ Installation de Foundry échouée"
                echo "   Si forge est en cours d'exécution, arrêtez-le et réessayez"
                echo "   Ou installez Foundry manuellement: foundryup"
                exit 1
            fi
        }
    elif [ -f "$HOME/.foundry/bin/foundryup" ]; then
        "$HOME/.foundry/bin/foundryup" || {
            echo "⚠️  foundryup a échoué. Vérification si forge est déjà installé..."
            if [ -f "$HOME/.foundry/bin/forge" ]; then
                export PATH="$HOME/.foundry/bin:$PATH"
                echo "✅ forge trouvé dans $HOME/.foundry/bin"
            else
                echo "❌ Installation de Foundry échouée"
                exit 1
            fi
        }
    fi
    
    # Vérifier à nouveau après installation
    if [ -d "$HOME/.foundry/bin" ] && [[ ":$PATH:" != *":$HOME/.foundry/bin:"* ]]; then
        export PATH="$HOME/.foundry/bin:$PATH"
    fi
    
    if ! command -v forge &> /dev/null; then
        echo "⚠️  Foundry installé mais forge non trouvé dans PATH"
        echo "   Veuillez redémarrer votre terminal ou exécuter:"
        echo "   export PATH=\"\$HOME/.foundry/bin:\$PATH\""
        echo "   Puis relancez ce script."
        exit 1
    fi
    echo "✅ Foundry installé"
else
    echo "✅ Foundry déjà installé: $(forge --version | head -n1)"
fi

# Cloner Alto si ce n'est pas déjà fait
if [ ! -d "bundler-alto" ] || [ -z "$(ls -A bundler-alto 2>/dev/null)" ]; then
    if [ -d "bundler-alto" ] && [ -z "$(ls -A bundler-alto 2>/dev/null)" ]; then
        echo "📦 Le répertoire bundler-alto est vide, clonage de Pimlico Alto..."
        rm -rf bundler-alto
    else
        echo "📦 Clonage de Pimlico Alto..."
    fi
    git clone https://github.com/pimlicolabs/alto.git bundler-alto
else
    echo "✅ Alto déjà cloné"
fi

# Installer les dépendances
echo "📦 Installation des dépendances..."
cd bundler-alto
if [ ! -d "node_modules" ] || [ ! -f "node_modules/.pnpm-lock.yaml" ]; then
    echo "   Installing dependencies (this may take a few minutes)..."
    pnpm install
    echo "   ✅ Dependencies installed"
else
    echo "   ✅ Dependencies already installed"
    echo "   ${YELLOW}   (Run 'pnpm install' manually if you need to update dependencies)${NC}"
fi

# Builder
echo "🔨 Build en cours..."
# S'assurer que forge est dans le PATH
if [ -d "$HOME/.foundry/bin" ] && [[ ":$PATH:" != *":$HOME/.foundry/bin:"* ]]; then
    export PATH="$HOME/.foundry/bin:$PATH"
fi

# Vérifier si Alto est déjà construit
if [ -f "alto" ] || [ -f "src/esm/cli/alto.js" ]; then
    echo "   ✅ Alto already built"
    echo "   ${YELLOW}   (Skipping build. Delete 'alto' or 'src/esm' to force rebuild)${NC}"
else
    echo "   Building Alto (this may take several minutes)..."
    pnpm build:all
    echo "   ✅ Build completed"
fi

echo "✅ Installation terminée!"
echo ""
echo "Pour lancer Alto, utilisez le script run-alto.sh"
cd ..





















