# Fichiers Essentiels à Committer

## ✅ Fichiers à COMMITTER (essentiels pour faire fonctionner l'application)

### 📋 Configuration Racine
- `package.json` - Dépendances principales
- `package-lock.json` - Verrouillage des versions
- `tsconfig.json` - Configuration TypeScript
- `next.config.ts` - Configuration Next.js
- `postcss.config.mjs` - Configuration PostCSS
- `eslint.config.mjs` - Configuration ESLint
- `.gitignore` - **IMPORTANT : Fichiers à ignorer**

### 🔷 Contrats Solidity (src/hardhat/contracts/)
- `*.sol` - Tous les contrats source (DisputeSOXAccount.sol, OptimisticSOXAccount.sol, etc.)
- `mocks/*.sol` - Contrats de test/mock
- `tests/*.sol` - Tests de contrats

### ⚙️ Scripts Hardhat (src/hardhat/)
- `hardhat.config.ts` - Configuration Hardhat
- `package.json` - Dépendances Hardhat
- `scripts/*.ts` - Scripts de déploiement et tests

### 🌐 Application Next.js (src/app/)
- `package.json` - Dépendances Next.js
- `package-lock.json` - Verrouillage des versions
- `layout.tsx` - Layout principal
- `page.tsx` - Page d'accueil
- `error.tsx` - Gestion d'erreurs
- `globals.css` - Styles globaux
- `favicon.ico` - Icône
- `api/**/*.ts` - Routes API
- `components/**/*.tsx` - Composants React
- `lib/**/*.ts` - Bibliothèques utilitaires
- `db/init.sql` - **IMPORTANT : Schéma de base de données**
- `lib/crypto_lib/*.d.ts` - Types TypeScript pour WASM
- `lib/crypto_lib/package.json` - Package WASM
- `lib/blockchain/contracts/*.json` - ABI des contrats déployés

### 🦀 Code Rust/WASM (src/wasm/)
- `Cargo.toml` - Configuration Cargo
- `Cargo.lock` - Verrouillage des versions Rust
- `src/**/*.rs` - Code source Rust
- `deploy.sh` - Script de déploiement WASM

### 📜 Scripts Shell Essentiels
- `deploy-all.sh` - Déploiement complet
- `deploy-contracts.sh` - Déploiement des contrats
- `START_ALL.sh` - Script de démarrage complet
- `start-web.sh` - Démarrage de l'interface web
- `LANCER_APP.sh` - Lancement de l'application
- `run-anvil.sh` - Lancement Anvil
- `run-alto.sh` - Lancement du bundler Alto
- `scripts/start-all-synchronized.sh` - Démarrage synchronisé
- `scripts/stop-all.sh` - Arrêt de tous les services

### 🖥️ Application Desktop (desktop/)
- `package.json` - Dépendances Electron
- `package-lock.json` - Verrouillage des versions
- `index.html` - Interface Electron
- `main.js` - Processus principal Electron
- `preload.js` - Script de préchargement

### 📚 Documentation (optionnel mais recommandé)
- `README.md` - Documentation principale
- `INSTALLATION_GUIDE_COMPLETE.tex` - Guide d'installation
- `REDEPLOY.md` - Guide de redéploiement

---

## ❌ Fichiers à NE PAS COMMITTER (déjà dans .gitignore)

### Dossiers volumineux exclus :
- `/node_modules` - Dépendances npm (à installer avec `npm install`)
- `/bundler` - Bundler (exclu)
- `src/hardhat/bundler` - Bundler Hardhat (exclu)
- `bundler-alto/` - Bundler Alto (exclu)
- `desktop/node_modules` - Dépendances Electron (exclu)
- `src/wasm/target` - Build Rust (exclu)
- `src/wasm/pkg` - WASM compilé (généré)
- `src/hardhat/artifacts/` - Artifacts Hardhat (généré)
- `src/hardhat/cache/` - Cache Hardhat (généré)
- `.next/` - Build Next.js (généré)
- `src/app/uploads/` - Fichiers uploadés (données)
- `*.sqlite` - Bases de données (données)
- `test_*.bin`, `test_*.circuit`, `test_*.ct` - Fichiers de test volumineux
- `deployed-contracts.json` - Données de déploiement (sensible)

---

## 🚀 Commandes pour vérifier ce qui sera commité

```bash
# Voir les fichiers modifiés/ajoutés
git status

# Voir uniquement les fichiers qui seront commités (pas les ignorés)
git status --short | grep -v "^??"

# Vérifier la taille du commit
git diff --cached --stat
```

---

## 📝 Checklist avant de commit

- [ ] `.gitignore` est à jour (exclut node_modules, bundler, target, etc.)
- [ ] Les gros dossiers sont retirés de l'index : `git rm -r --cached src/hardhat/bundler bundler-alto desktop/node_modules`
- [ ] Tous les fichiers source (.sol, .ts, .tsx, .rs) sont présents
- [ ] Les fichiers de configuration (package.json, tsconfig.json, etc.) sont présents
- [ ] Le schéma de base de données (init.sql) est présent
- [ ] Les scripts shell essentiels sont présents

---

## 💡 Note importante

Après avoir retiré les gros dossiers de l'index Git, vous devez :
1. Vérifier que `.gitignore` est commité
2. Commit les changements : `git add .gitignore && git commit -m "Update .gitignore to exclude large directories"`
3. Les autres fichiers peuvent être commités normalement

Les dépendances (node_modules, etc.) seront réinstallées avec `npm install` lors du clonage du dépôt.


