# Guide d'Installation Complet - SOX Implementation

Ce guide vous permettra d'installer et de faire fonctionner le projet SOX depuis zéro sur une nouvelle machine.

## 📋 Table des matières

1. [Prérequis](#prérequis)
2. [Installation](#installation)
3. [Installation du Bundler Alto (détaillée)](#-installation-du-bundler-alto-détaillée)
4. [Configuration](#configuration)
5. [Déploiement des contrats](#déploiement-des-contrats)
6. [Lancement des services](#lancement-des-services)
7. [Vérifications](#vérifications)
8. [Résolution des problèmes](#résolution-des-problèmes)
9. [Modifications importantes](#modifications-importantes)

---

## 🔧 Prérequis

### Logiciels requis

1. **Node.js** >= 22.13.1
   ```bash
   # Vérifier la version
   node -v
   
   # Installer Node.js si nécessaire
   # macOS: brew install node@22
   # Linux: https://nodejs.org/
   ```

2. **npm** (inclus avec Node.js)
   ```bash
   npm -v
   ```

3. **Rust/Cargo** (pour compiler le binaire WASM)
   ```bash
   # Vérifier si installé
   cargo --version
   
   # Installer Rust si nécessaire
   curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
   source $HOME/.cargo/env
   ```

4. **sqlite3** (pour la base de données)
   ```bash
   # Vérifier si installé
   sqlite3 --version
   
   # Installer si nécessaire
   # macOS: brew install sqlite3
   # Linux: sudo apt-get install sqlite3
   ```

5. **pnpm** (sera installé automatiquement si absent)
   ```bash
   npm install -g pnpm
   ```

6. **Foundry (forge)** (sera installé automatiquement pour Alto)
   ```bash
   # Sera installé via foundryup dans install-alto.sh
   ```

---

## 🚀 Installation

### Étape 1: Cloner le projet

```bash
git clone <URL_DU_REPO>
cd sox_implementation
```

### Étape 2: Exécuter le script d'installation

Le script `install.sh` installe automatiquement toutes les dépendances :

```bash
chmod +x install.sh
./install.sh
```

**Ce script fait :**
- ✅ Vérifie les prérequis (Node.js, Rust, sqlite3, pnpm)
- ✅ Installe les dépendances racine (npm install)
- ✅ Installe les outils supplémentaires (tsx, typescript)
- ✅ Installe les dépendances desktop (cd desktop && npm install)
- ✅ Installe les dépendances Hardhat (cd src/hardhat && npm install)
- ✅ Compile le binaire Rust `precontract_cli` (src/wasm/target/release/precontract_cli)
- ✅ Initialise la base de données SQLite
- ✅ Installe pnpm globalement si nécessaire
- ✅ **Installe et configure le bundler Alto** (voir détails ci-dessous)

### Installation du bundler Alto

Le script `install.sh` appelle automatiquement `install-alto.sh` qui :

1. **Vérifie et installe Foundry (forge)** si nécessaire
   - Foundry est requis pour compiler les contrats Alto
   - Installation via `foundryup` (curl -L https://foundry.paradigm.xyz | bash)

2. **Clone le repository Alto** si le répertoire `bundler-alto` est vide ou absent
   - Clone depuis: https://github.com/pimlicolabs/alto.git

3. **Installe les dépendances pnpm** du bundler
   - Exécute `pnpm install` dans `bundler-alto/`

4. **Build le bundler Alto**
   - Compile les contrats Solidity avec Foundry
   - Build le code TypeScript
   - Crée le binaire `alto` ou les fichiers dans `src/esm/`

**Vérification de l'installation du bundler :**

Après l'installation, vous pouvez vérifier que tout est en place :

```bash
# Vérifier que le répertoire existe
ls -la bundler-alto/

# Vérifier que les dépendances sont installées
ls -la bundler-alto/node_modules/

# Vérifier que le bundler est construit
ls -la bundler-alto/alto
# ou
ls -la bundler-alto/src/esm/cli/alto.js

# Vérifier que Foundry est installé
forge --version
```

**Note importante :** Si l'installation du bundler échoue, vous pouvez l'installer manuellement :

```bash
./install-alto.sh
```

**Note:** Si vous rencontrez des erreurs de permissions avec npm, vous pouvez exécuter :
```bash
sudo ./install.sh
```

---

## 📦 Installation du Bundler Alto (détaillée)

Si le script `install.sh` a bien fonctionné, le bundler Alto est déjà installé. Cette section explique ce qui se passe pendant l'installation.

### Ce que fait `install-alto.sh`

Le script `install-alto.sh` (appelé automatiquement par `install.sh`) effectue les étapes suivantes :

1. **Installation de Foundry (forge)**
   ```bash
   # Si forge n'est pas installé, le script :
   curl -L https://foundry.paradigm.xyz | bash
   foundryup
   ```
   - Foundry est nécessaire pour compiler les contrats Solidity d'Alto
   - Installation dans `$HOME/.foundry/bin/`

2. **Clonage du repository Alto**
   ```bash
   # Si bundler-alto est vide ou absent :
   git clone https://github.com/pimlicolabs/alto.git bundler-alto
   ```

3. **Installation des dépendances**
   ```bash
   cd bundler-alto
   pnpm install
   ```
   - Installe toutes les dépendances Node.js/pnpm nécessaires

4. **Build du bundler**
   ```bash
   pnpm build:all
   ```
   - Compile les contrats Solidity avec Foundry
   - Build le code TypeScript
   - Génère le binaire exécutable

### Vérifier l'installation du bundler

Après l'installation, vérifiez que tout est en place :

```bash
# 1. Vérifier que le répertoire existe
ls -la bundler-alto/

# 2. Vérifier que les dépendances sont installées
ls -la bundler-alto/node_modules/ | head -5

# 3. Vérifier que le bundler est construit
# Option 1: Binaire alto
ls -lh bundler-alto/alto

# Option 2: Fichiers compilés
ls -la bundler-alto/src/esm/cli/alto.js

# 4. Vérifier que Foundry est installé
forge --version
# Devrait afficher: forge 0.x.x
```

### Installation manuelle (si nécessaire)

Si l'installation automatique a échoué, vous pouvez installer le bundler manuellement :

```bash
# 1. Installer Foundry
curl -L https://foundry.paradigm.xyz | bash
source $HOME/.foundry/bin/foundryup

# 2. Installer le bundler
./install-alto.sh

# Ou manuellement :
cd bundler-alto
pnpm install
export PATH="$HOME/.foundry/bin:$PATH"
pnpm build:all
cd ..
```

---

## ⚙️ Configuration

### Étape 1: Créer les fichiers de configuration manquants

#### 1.1 Fichier `deployed-contracts.json` à la racine

```bash
echo '{}' > deployed-contracts.json
```

#### 1.2 Fichier `deployed-contracts.json` dans `src/`

```bash
echo '{}' > src/deployed-contracts.json
```

Ces fichiers seront remplis automatiquement lors du déploiement des contrats.

#### 1.3 Configuration du bundler Alto

Le fichier `bundler-alto/scripts/config.local.json` doit être configuré avec :

```json
{
    "network-name": "local",
    "rpc-url": "http://127.0.0.1:8545",
    "min-entity-stake": 1,
    "min-executor-balance": "1000000000000000000",
    "min-entity-unstake-delay": 1,
    "max-bundle-wait": 3,
    "max-bundle-size": 3,
    "port": 4337,
    "executor-private-keys": "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80",
    "utility-private-key": "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80",
    "entrypoints": "0x4337084D9E255Ff0702461CF8895CE9E3b5Ff108",
    "pimlico-simulation-contract": "0x998abeb3E57409262aE5b751f60747921B33613E",
    "deploy-simulations-contract": false,
    "enable-debug-endpoints": true,
    "enable-cors": true,
    "expiration-check": false,
    "safe-mode": false,
    "api-version": "v1,v2",
    "public-client-log-level": "info",
    "entrypoint-simulation-contract-v8": "0x70e0bA845a1A0F2DA3359C97E0285013525FFC49"
}
```

**Points importants :**
- `entrypoints`: Adresse canonique de l'EntryPoint v0.8 (`0x4337084D9E255Ff0702461CF8895CE9E3b5Ff108`)
- `enable-cors`: **DOIT être `true`** pour permettre les requêtes depuis Next.js
- `deploy-simulations-contract`: **DOIT être `false`** (les contrats sont déployés via Hardhat)
- `port`: Port sur lequel le bundler écoute (4337 par défaut)

---

## 📦 Déploiement des contrats

### Étape 1: Lancer Hardhat node

Dans un **premier terminal**, lancez le nœud blockchain local :

```bash
cd src/hardhat
npx hardhat node
```

Laissez ce terminal ouvert. Hardhat node écoute sur `http://localhost:8545`.

### Étape 2: Déployer les contrats

Dans un **deuxième terminal**, déployez tous les contrats :

```bash
cd /Applications/sox_implementation  # ou votre chemin
./deploy-all.sh
```

**Ce script fait :**
1. ✅ Vérifie que Hardhat node est lancé
2. ✅ Crée la structure du bundler si nécessaire
3. ✅ Déploie l'EntryPoint v0.8 (canonique) via `deployEntryPointV8.ts`
4. ✅ Déploie les contrats de simulation Pimlico
5. ✅ Déploie les contrats de simulation EntryPoint v0.8
6. ✅ Déploie tous les contrats SOX via `deployCompleteStack.ts`
   - Génère automatiquement `deployed-contracts.json` avec toutes les adresses

**Alternative:** Vous pouvez aussi utiliser :
```bash
./deploy-contracts.sh
```

### Étape 3: Vérifier le déploiement

Vérifiez que le fichier `deployed-contracts.json` a été créé et rempli :

```bash
cat deployed-contracts.json
```

Vous devriez voir les adresses des bibliothèques et contrats déployés.

---

## 🚀 Lancement des services

**⚠️ IMPORTANT : Ordre d'exécution**

L'ordre est crucial pour éviter les erreurs. Suivez cet ordre exact :

### Étape 0: Déployer les contrats AVANT de lancer Next.js

**⚠️ CRITIQUE :** Les fichiers JSON des contrats (`OptimisticSOXAccount.json`, etc.) sont générés lors du déploiement. Si Next.js est lancé avant le déploiement, Turbopack ne détectera pas ces fichiers et vous aurez des erreurs.

```bash
# 1. D'abord, lancer Hardhat node
cd src/hardhat
npx hardhat node

# 2. Dans un autre terminal, déployer les contrats
cd /Applications/sox_implementation
./deploy-all.sh

# 3. MAINTENANT vous pouvez lancer Next.js
npm run dev
```

### Terminal 1: Hardhat node
```bash
cd src/hardhat
npx hardhat node
```

### Terminal 2: Déployer les contrats
```bash
cd /Applications/sox_implementation  # ou votre chemin
./deploy-all.sh
```

**Ce script génère automatiquement :**
- ✅ `deployed-contracts.json` (adresses des contrats déployés)
- ✅ `src/app/lib/blockchain/contracts/OptimisticSOXAccount.json` (ABI + bytecode)
- ✅ `src/app/lib/blockchain/contracts/DisputeSOXAccount.json` (ABI + bytecode)
- ✅ Tous les autres fichiers JSON des bibliothèques

### Terminal 3: Bundler Alto
```bash
cd /Applications/sox_implementation  # ou votre chemin
./run-alto.sh
```

Le bundler sera accessible sur `http://localhost:4337/rpc`

### Terminal 4: Application Next.js
```bash
cd /Applications/sox_implementation  # ou votre chemin
npm run dev
```

**⚠️ Lancer Next.js APRÈS le déploiement des contrats** pour que Turbopack détecte les fichiers JSON générés.

L'application sera accessible sur `http://localhost:3000`

### Terminal 5 (Optionnel): Application Electron Desktop
```bash
cd desktop
npm start
```

---

## ✅ Vérifications

### Vérifier que tout fonctionne

1. **Hardhat node** : Vérifiez les logs dans le terminal 1
   - Devrait afficher "Started HTTP and WebSocket JSON-RPC server"

2. **Bundler Alto** : Testez l'endpoint RPC
   ```bash
   curl -X POST http://localhost:4337/rpc \
     -H "Content-Type: application/json" \
     -d '{"jsonrpc":"2.0","method":"eth_chainId","params":[],"id":1}'
   ```
   Devrait retourner : `{"jsonrpc":"2.0","id":1,"result":"0x7a69"}`

3. **Next.js** : Ouvrez `http://localhost:3000` dans votre navigateur
   - L'application devrait se charger sans erreurs

4. **Binaire Rust** : Vérifiez qu'il existe
   ```bash
   ls -lh src/wasm/target/release/precontract_cli
   ```
   Devrait afficher un fichier exécutable (~773KB)

---

## 🔧 Résolution des problèmes

### Problème 1: "Hardhat node not responding"

**Solution:**
- Vérifiez que Hardhat node est bien lancé sur le port 8545
- Vérifiez qu'aucun autre processus n'utilise le port 8545
- Relancez Hardhat node

### Problème 2: "Failed to fetch" lors de l'envoi de UserOperation

**Solution:**
- Vérifiez que `enable-cors: true` est dans `bundler-alto/scripts/config.local.json`
- Redémarrez le bundler après avoir modifié la config
- Vérifiez que le bundler écoute sur le bon port (4337)

### Problème 3: "No deployed library addresses found"

**Solution:**
- Vérifiez que `deployed-contracts.json` existe et contient des adresses
- Relancez `./deploy-all.sh` pour déployer les contrats
- Vérifiez que Hardhat node est lancé avant de déployer

### Problème 3a: "Module not found: Can't resolve deployed-contracts.json"

**Symptômes:**
```
Module not found: Can't resolve '../../../../deployed-contracts.json'
Module not found: Can't resolve '../../../deployed-contracts.json'
```

**Cause:**
Turbopack peut avoir des difficultés à résoudre les fichiers JSON en dehors du répertoire `src/` avec les chemins relatifs qui remontent au-delà de `src/`.

**Comment cette erreur a été résolue :**

Le script `deployCompleteStack.ts` a été modifié pour écrire automatiquement dans **deux emplacements** :
1. `deployed-contracts.json` à la racine (pour compatibilité)
2. `src/deployed-contracts.json` (pour que Next.js/Turbopack puisse le trouver)

**Solution immédiate :**

1. **Vérifiez que les fichiers existent et sont synchronisés :**
   ```bash
   ls -la deployed-contracts.json src/deployed-contracts.json
   ```

2. **Si `src/deployed-contracts.json` est vide ou absent, copiez depuis la racine :**
   ```bash
   cp deployed-contracts.json src/deployed-contracts.json
   ```

3. **Ou mieux, redéployez les contrats pour générer les deux fichiers automatiquement :**
   ```bash
   ./deploy-all.sh
   ```

4. **Nettoyez le cache de Next.js :**
   ```bash
   rm -rf .next
   ```

5. **Redémarrez Next.js :**
   ```bash
   npm run dev
   ```

**Note:** 
- Le script `deployCompleteStack.ts` génère maintenant automatiquement les deux fichiers (`deployed-contracts.json` à la racine ET `src/deployed-contracts.json`)
- Si vous déployez les contrats avec `./deploy-all.sh`, les deux fichiers seront créés automatiquement
- Si vous voyez encore l'erreur après le déploiement, nettoyez le cache Next.js et redémarrez

### Problème 3b: Erreur Turbopack "Expected module to match pattern: OptimisticSOXAccount.json"

**Solution:**
Cette erreur se produit lorsque Turbopack ne détecte pas correctement les fichiers JSON générés après le déploiement des contrats.

1. **Vérifiez que le fichier existe :**
   ```bash
   ls -lh src/app/lib/blockchain/contracts/OptimisticSOXAccount.json
   ```

2. **Régénérez les fichiers JSON des contrats :**
   ```bash
   cd src/hardhat
   npx hardhat run scripts/deployCompleteStack.ts --network localhost
   ```

3. **Redémarrez Next.js** (arrêtez avec Ctrl+C et relancez) :
   ```bash
   npm run dev
   ```

4. **Si le problème persiste, nettoyez le cache de Next.js :**
   ```bash
   rm -rf .next
   npm run dev
   ```

**Note:** Les fichiers JSON des contrats (`OptimisticSOXAccount.json`, `DisputeSOXAccount.json`) sont générés automatiquement par `deployCompleteStack.ts`. Assurez-vous que ce script a été exécuté avec succès.

### Problème 4: Erreurs lors du déploiement des contrats

#### Erreur 4a: "EntryPoint address not found" ou "EntryPoint not deployed"

**Symptômes:**
```
Error: EntryPoint address not found. Run deployEntryPointForBundler.ts first.
ou
Error: EntryPoint not deployed at 0x...
```

**Causes possibles:**
- Hardhat node n'est pas lancé
- L'EntryPoint n'a pas été déployé avant `deployCompleteStack.ts`
- Le script `deployEntryPointV8.ts` a échoué silencieusement

**Solution:**
1. **Vérifiez que Hardhat node est bien lancé :**
   ```bash
   curl http://localhost:8545
   # Devrait retourner une réponse JSON
   ```

2. **Déployez l'EntryPoint manuellement :**
   ```bash
   cd src/hardhat
   npx hardhat run scripts/deployEntryPointV8.ts --network localhost
   ```

3. **Vérifiez que l'EntryPoint est déployé :**
   ```bash
   # Dans Hardhat console ou via curl
   # L'adresse devrait être: 0x4337084D9E255Ff0702461CF8895CE9E3b5Ff108
   ```

4. **Relancez le déploiement complet :**
   ```bash
   ./deploy-all.sh
   ```

#### Erreur 4b: "Failed to read EntryPoint runtime code"

**Symptômes:**
```
Error: Failed to read EntryPoint runtime code
```

**Cause:**
Le script `deployCompleteStack.ts` essaie de déployer l'EntryPoint v0.8 à l'adresse canonique mais ne peut pas lire le code runtime.

**Solution:**
1. **Vérifiez que les contrats Alto sont compilés :**
   ```bash
   cd bundler-alto
   ls -la src/contracts/EntryPointFilterOpsOverride.sol/EntryPointFilterOpsOverride08.json
   ```

2. **Si le fichier n'existe pas, compilez les contrats Alto :**
   ```bash
   cd bundler-alto
   export PATH="$HOME/.foundry/bin:$PATH"
   pnpm build:all
   ```

3. **Relancez le déploiement :**
   ```bash
   ./deploy-all.sh
   ```

#### Erreur 4c: "hardhat_setCode" ou "anvil_setCode" failed

**Symptômes:**
```
Error lors de l'appel hardhat_setCode ou anvil_setCode
```

**Cause:**
Le script essaie de déployer l'EntryPoint à l'adresse canonique mais Hardhat/Anvil refuse.

**Solution:**
1. **Vérifiez que vous utilisez Hardhat node (pas Anvil) :**
   ```bash
   # Arrêtez Anvil si lancé
   # Lancez Hardhat node :
   cd src/hardhat
   npx hardhat node
   ```

2. **Si le problème persiste, vérifiez les permissions :**
   - Assurez-vous que Hardhat node a les permissions nécessaires
   - Vérifiez que le compte deployer a assez de fonds

#### Erreur 4d: "Cannot find module" ou erreurs de compilation TypeScript

**Symptômes:**
```
Error: Cannot find module '@account-abstraction/contracts'
Error HHE22: Trying to use a non-local installation of Hardhat
ou erreurs de compilation TypeScript
```

**Cause:**
Les dépendances Hardhat ne sont pas installées localement dans `src/hardhat/`. Hardhat nécessite une installation locale pour fonctionner correctement.

**Comment cette erreur a été résolue :**

Le script `install.sh` installe automatiquement les dépendances Hardhat dans `src/hardhat/` :

```bash
# Dans install.sh (lignes 121-140)
cd src/hardhat
if [ ! -d "node_modules" ] || [ ! -f "node_modules/.bin/hardhat" ]; then
    npm install  # Installe Hardhat localement
fi
```

**Solution manuelle si l'erreur persiste :**

1. **Vérifiez que les dépendances sont installées :**
   ```bash
   cd src/hardhat
   ls -la node_modules/.bin/hardhat
   # Devrait afficher le binaire Hardhat
   ```

2. **Si absent, réinstallez les dépendances Hardhat :**
   ```bash
   cd src/hardhat
   rm -rf node_modules package-lock.json
   npm install
   ```

3. **Vérifiez que Hardhat fonctionne :**
   ```bash
   npx hardhat --version
   # Devrait afficher: Hardhat 2.24.0 (ou similaire)
   ```

4. **Compilez les contrats pour vérifier :**
   ```bash
   npx hardhat compile
   ```

5. **Relancez le déploiement :**
   ```bash
   cd ../..
   ./deploy-all.sh
   ```

**Note importante :** 
- Hardhat DOIT être installé localement dans `src/hardhat/node_modules/`
- Une installation globale de Hardhat ne suffit pas
- Le script `install.sh` gère cela automatiquement, mais si vous avez sauté cette étape, installez manuellement

#### Erreur 4e: "Nonce too high" ou "Transaction underpriced"

**Symptômes:**
```
Error: nonce too high
ou
Error: transaction underpriced
```

**Cause:**
Hardhat node a été redémarré ou les transactions sont en conflit.

**Solution:**
1. **Redémarrez Hardhat node proprement :**
   ```bash
   # Arrêtez Hardhat node (Ctrl+C)
   # Relancez-le :
   cd src/hardhat
   npx hardhat node
   ```

2. **Attendez que Hardhat node soit complètement démarré** (message "Started HTTP...")

3. **Relancez le déploiement :**
   ```bash
   ./deploy-all.sh
   ```

#### Erreur 4f: "Library not found" ou erreurs de linking

**Symptômes:**
```
Error: Library DisputeDeployer not found
ou erreurs de linking de bytecode
```

**Cause:**
Les bibliothèques n'ont pas été déployées avant les contrats qui les utilisent.

**Solution:**
1. **Vérifiez l'ordre de déploiement dans `deployCompleteStack.ts`** :
   - Les bibliothèques doivent être déployées en premier
   - DisputeDeployer doit être déployé avant OptimisticSOXAccount

2. **Relancez le déploiement complet** (le script gère l'ordre automatiquement) :
   ```bash
   ./deploy-all.sh
   ```

#### Erreur 4g: Script de déploiement se bloque ou timeout

**Symptômes:**
Le script `deploy-all.sh` se bloque sans erreur visible.

**Causes possibles:**
- Hardhat node ne répond pas
- Transaction bloquée
- Problème de réseau

**Solution:**
1. **Vérifiez que Hardhat node répond :**
   ```bash
   curl -X POST http://localhost:8545 \
     -H "Content-Type: application/json" \
     -d '{"jsonrpc":"2.0","method":"eth_blockNumber","params":[],"id":1}'
   ```

2. **Vérifiez les logs de Hardhat node** pour voir où ça bloque

3. **Redémarrez Hardhat node** si nécessaire :
   ```bash
   # Arrêtez (Ctrl+C) et relancez
   cd src/hardhat
   npx hardhat node
   ```

4. **Relancez le déploiement avec plus de verbosité :**
   ```bash
   cd src/hardhat
   npx hardhat run scripts/deployCompleteStack.ts --network localhost --verbose
   ```

#### Erreur 4h: "Cannot read property" ou erreurs JavaScript dans les scripts

**Symptômes:**
```
TypeError: Cannot read property '...' of undefined
ou erreurs JavaScript dans les scripts de déploiement
```

**Cause:**
Les scripts essaient d'accéder à des propriétés qui n'existent pas (contrats non déployés, config manquante, etc.).

**Solution:**
1. **Vérifiez que tous les prérequis sont remplis :**
   - Hardhat node lancé
   - Contrats compilés (`npx hardhat compile`)
   - Configuration du bundler existe

2. **Exécutez les scripts dans l'ordre :**
   ```bash
   # 1. EntryPoint
   npx hardhat run scripts/deployEntryPointV8.ts --network localhost
   
   # 2. Simulations
   npx hardhat run scripts/deployPimlicoSimulations.ts --network localhost
   npx hardhat run scripts/deployEntryPointSimulationsV8.ts --network localhost
   
   # 3. Stack complet
   npx hardhat run scripts/deployCompleteStack.ts --network localhost
   ```

3. **Vérifiez les logs** pour identifier quel script échoue exactement

### Problème 4: "spawn precontract_cli ENOENT"

**Solution:**
- Compilez le binaire Rust manuellement :
  ```bash
  cd src/wasm
  cargo build --release --bin precontract_cli
  ```
- Vérifiez que le binaire existe : `ls -lh target/release/precontract_cli`

### Problème 5: "forge: command not found"

**Solution:**
- Installez Foundry :
  ```bash
  curl -L https://foundry.paradigm.xyz | bash
  source $HOME/.foundry/bin/foundryup
  ```
- Ajoutez au PATH : `export PATH="$HOME/.foundry/bin:$PATH"`

### Problème 6: "EntryPoint address not found"

**Solution:**
- Vérifiez que l'EntryPoint v0.8 est déployé à l'adresse canonique
- Relancez `./deploy-all.sh` qui utilise maintenant `deployEntryPointV8.ts`
- Vérifiez que `bundler-alto/scripts/config.local.json` contient la bonne adresse EntryPoint

### Problème 7: Erreurs de permissions npm

**Solution:**
- Utilisez `sudo` si nécessaire : `sudo npm install`
- Ou configurez npm pour utiliser un répertoire local :
  ```bash
  mkdir ~/.npm-global
  npm config set prefix '~/.npm-global'
  export PATH=~/.npm-global/bin:$PATH
  ```

---

## 📝 Modifications importantes

### 1. Script `install.sh`

**Modifications:**
- ✅ Vérifie et installe automatiquement pnpm
- ✅ Compile le binaire Rust `precontract_cli`
- ✅ Initialise la base de données SQLite
- ✅ Installe et configure Alto bundler

### 2. Script `deploy-all.sh`

**Modifications:**
- ✅ Utilise maintenant `deployEntryPointV8.ts` au lieu de `deployEntryPointForBundler.ts`
- ✅ Déploie l'EntryPoint v0.8 canonique (`0x4337084D9E255Ff0702461CF8895CE9E3b5Ff108`)
- ✅ Utilise `deployEntryPointSimulationsV8.ts` pour les simulations v0.8
- ✅ Utilise `deployCompleteStack.ts` qui génère `deployed-contracts.json`

### 3. Configuration `bundler-alto/scripts/config.local.json`

**Modifications critiques:**
- ✅ `entrypoints`: Adresse EntryPoint v0.8 canonique
- ✅ `enable-cors: true` - **ESSENTIEL** pour les requêtes depuis Next.js
- ✅ `deploy-simulations-contract: false` - Les contrats sont déployés via Hardhat
- ✅ `entrypoint-simulation-contract-v8`: Adresse du contrat de simulation v0.8
- ✅ `pimlico-simulation-contract`: Adresse du contrat de simulation Pimlico

### 4. Fichiers `deployed-contracts.json`

**Création:**
- ✅ `deployed-contracts.json` à la racine (vide initialement)
- ✅ `src/deployed-contracts.json` (vide initialement)
- ✅ Remplis automatiquement par `deployCompleteStack.ts`

### 5. Script `run-alto.sh`

**Modifications:**
- ✅ Vérifie que le bundler est construit
- ✅ Vérifie que la configuration existe
- ✅ Vérifie que Hardhat node est lancé
- ✅ Utilise le port depuis la configuration

### 6. Compilation Rust

**Modifications:**
- ✅ Le binaire `precontract_cli` est compilé automatiquement dans `install.sh`
- ✅ Chemin: `src/wasm/target/release/precontract_cli`
- ✅ Nécessaire pour les précomputes dans l'application

---

## 📚 Ordre d'exécution complet

Voici l'ordre exact pour démarrer le projet :

```bash
# 1. Installation (une seule fois)
./install.sh

# 2. Terminal 1: Lancer Hardhat node
cd src/hardhat
npx hardhat node

# 3. Terminal 2: Déployer les contrats
cd /Applications/sox_implementation
./deploy-all.sh

# 4. Terminal 3: Lancer le bundler
./run-alto.sh

# 5. Terminal 4: Lancer Next.js
npm run dev

# 6. Terminal 5 (Optionnel): Lancer Electron
cd desktop && npm start
```

---

## 🎯 Checklist de vérification

Avant de commencer à utiliser l'application, vérifiez :

- [ ] Node.js >= 22.13.1 installé
- [ ] Rust/Cargo installé
- [ ] sqlite3 installé
- [ ] `./install.sh` exécuté avec succès
- [ ] Hardhat node lancé et écoute sur port 8545
- [ ] `./deploy-all.sh` exécuté avec succès
- [ ] `deployed-contracts.json` contient des adresses
- [ ] Bundler Alto lancé et écoute sur port 4337
- [ ] Bundler répond aux requêtes RPC
- [ ] Next.js lancé et accessible sur http://localhost:3000
- [ ] Binaire Rust `precontract_cli` existe et est exécutable
- [ ] Configuration `bundler-alto/scripts/config.local.json` correcte
- [ ] `enable-cors: true` dans la config du bundler

---

## 🔗 URLs importantes

- **Application Web**: http://localhost:3000
- **Bundler RPC**: http://localhost:4337/rpc
- **Hardhat RPC**: http://localhost:8545
- **Bundler Health**: http://localhost:4337/health

---

## 📞 Support

Si vous rencontrez des problèmes non couverts dans ce guide :

1. Vérifiez les logs de chaque service
2. Vérifiez que tous les ports sont disponibles
3. Vérifiez que tous les fichiers de configuration sont corrects
4. Relancez les services dans l'ordre indiqué

---

**Dernière mise à jour:** Janvier 2025
**Version:** 1.0

