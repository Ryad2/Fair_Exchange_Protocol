# SOX Implementation

Implémentation complète du protocole SOX (Secure Optimistic Exchange) avec support ERC-4337.

## 🚀 Démarrage rapide

### Installation automatique

```bash
# 1. Installer toutes les dépendances
./install.sh

# 2. Dans Terminal 1: Lancer Hardhat node
cd src/hardhat && npx hardhat node

# 3. Dans Terminal 2: Déployer les contrats
./deploy-all.sh

# 4. Dans Terminal 3: Lancer le bundler
./run-alto.sh

# 5. Dans Terminal 4: Lancer Next.js
npm run dev
```

### Accès

- **Application Web**: http://localhost:3000
- **Bundler RPC**: http://localhost:4337/rpc
- **Hardhat RPC**: http://localhost:8545

## 📚 Documentation

### Guide d'installation complet

Pour un guide détaillé avec toutes les étapes, configurations et résolution de problèmes, consultez :

**[📖 GUIDE_INSTALLATION_COMPLET.md](./GUIDE_INSTALLATION_COMPLET.md)**

Ce guide couvre :
- ✅ Installation complète depuis zéro
- ✅ Configuration de tous les composants
- ✅ Déploiement des contrats
- ✅ Résolution de tous les problèmes courants
- ✅ Compatibilité macOS, Linux et Windows (WSL)

### Guide rapide

Pour un démarrage rapide, consultez :

**[⚡ QUICK_START.md](./QUICK_START.md)**

## 🔧 Prérequis

- **Node.js** >= 22.13.1
- **Rust/Cargo** (pour compiler le binaire WASM)
- **sqlite3** (pour la base de données)
- **pnpm** (installé automatiquement par `install.sh`)
- **Foundry (forge)** (installé automatiquement pour Alto bundler)

## 📦 Architecture

Le projet est composé de plusieurs composants :

- **Frontend Next.js** : Interface web (`src/app/`)
- **Hardhat** : Déploiement et tests des contrats (`src/hardhat/`)
- **Alto Bundler** : Bundler ERC-4337 (`bundler-alto/`)
- **Rust Binary** : Précomputation native (`src/wasm/`)
- **Electron Desktop** : Application desktop (optionnelle, `desktop/`)

## 🛠️ Scripts disponibles

### Installation

```bash
./install.sh              # Installation complète automatique
./install-alto.sh          # Installation du bundler Alto uniquement
```

### Déploiement

```bash
./deploy-all.sh           # Déploiement complet des contrats
./deploy-contracts.sh     # Alternative de déploiement
```

### Lancement

```bash
./run-alto.sh             # Lancer le bundler Alto
npm run dev               # Lancer Next.js
cd desktop && npm start   # Lancer Electron (optionnel)
```

## 🔍 Résolution de problèmes

### Problèmes courants

- **"Module not found: deployed-contracts.json"** → Voir [Guide Complet - Problème 3a](./GUIDE_INSTALLATION_COMPLET.md#problème-3a-module-not-found-cant-resolve-deployed-contractsjson)
- **"Failed to fetch"** → Vérifiez que `enable-cors: true` est dans `bundler-alto/scripts/config.local.json`
- **"No deployed library addresses found"** → Relancez `./deploy-all.sh`
- **"spawn precontract_cli ENOENT"** → Compilez le binaire Rust : `cd src/wasm && cargo build --release --bin precontract_cli`

Pour la liste complète des problèmes et solutions, consultez le [Guide d'Installation Complet](./GUIDE_INSTALLATION_COMPLET.md#-résolution-des-problèmes).

## 📝 Structure du projet

```
sox_implementation/
├── src/
│   ├── app/              # Application Next.js
│   ├── hardhat/          # Contrats Solidity et scripts de déploiement
│   └── wasm/             # Binaire Rust pour précomputation
├── bundler-alto/         # Bundler ERC-4337 (Pimlico Alto)
├── desktop/              # Application Electron (optionnelle)
├── install.sh            # Script d'installation automatique
├── deploy-all.sh         # Script de déploiement des contrats
├── run-alto.sh           # Script pour lancer le bundler
└── GUIDE_INSTALLATION_COMPLET.md  # Guide d'installation détaillé
```

## 🔗 Liens utiles

- [Guide d'Installation Complet](./GUIDE_INSTALLATION_COMPLET.md)
- [Quick Start](./QUICK_START.md)
- [Documentation ERC-4337](https://eips.ethereum.org/EIPS/eip-4337)
- [Pimlico Alto Bundler](https://docs.pimlico.io/infra/bundler)

## 📄 Licence

[À compléter selon la licence du projet]

## 👥 Contributeurs

[À compléter]

---

**Pour toute question ou problème, consultez le [Guide d'Installation Complet](./GUIDE_INSTALLATION_COMPLET.md).**

