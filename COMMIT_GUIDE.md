# Guide pour Committer Tous les Fichiers Importants

## ✅ État Actuel

Votre projet contient tous les fichiers source importants déjà trackés par Git :
- ✅ **15+ contrats Solidity** (DisputeSOXAccount, OptimisticSOXAccount, etc.)
- ✅ **70+ scripts TypeScript** (déploiement, tests)
- ✅ **100+ fichiers Next.js** (API, composants, librairies)
- ✅ **14 fichiers Rust** (WASM, circuits, cryptographie)
- ✅ **Configuration complète** (package.json, tsconfig.json, etc.)

## 🚨 Problème : Taille du Dépôt (2.30 GiB)

Le dépôt fait **2.30 GiB** à cause de gros fichiers dans l'historique Git. GitHub refuse les packs > 2 GiB.

## 📋 Solution en 3 Étapes

### Étape 1 : Commit les Changements Actuels

```bash
# Ajouter tous les fichiers modifiés
git add -A

# Vérifier ce qui sera commité
git status

# Créer le commit
git commit -m "feat: update essential project files

- Updated contracts (DisputeSOXAccount.sol)
- Updated deployment scripts
- Updated .gitignore to exclude large directories
- Added documentation files"
```

### Étape 2 : Nettoyer l'Historique Git (OBLIGATOIRE)

**Option A : Solution Simple (Recommandée)**

```bash
# Exécuter le script de nettoyage
./cleanup-git-simple.sh

# Suivre les instructions à l'écran
# Cela créera une nouvelle branche propre sans historique
```

**Option B : Nettoyage Manuel**

```bash
# 1. Créer une sauvegarde
git branch backup-ahana

# 2. Créer une branche orpheline (sans historique)
git checkout --orphan ahana-clean

# 3. Ajouter tous les fichiers actuels
git add .

# 4. Commit initial
git commit -m "Initial commit: clean repository with all essential files"

# 5. Vérifier la taille
git count-objects -vH  # Devrait être < 100 MB

# 6. Remplacer l'ancienne branche
git branch -D ahana
git branch -m ahana-clean ahana
```

### Étape 3 : Push sur GitHub

```bash
# Force push (nécessaire car l'historique a changé)
git push --force origin ahana
```

## 📁 Fichiers Importants Inclus dans le Commit

### Contrats Solidity (src/hardhat/contracts/)
- `DisputeSOXAccount.sol` - Contrat principal de dispute
- `OptimisticSOXAccount.sol` - Compte optimiste
- `EvaluatorSOX_V2.sol` - Évaluateur de circuits
- `DisputeSOXHelpers.sol` - Helpers pour disputes
- `AccumulatorSOX.sol` - Accumulateur
- `CommitmentSOX.sol` - Engagements
- `SHA256Evaluator.sol` - Évaluateur SHA256
- `AES128CtrEvaluator.sol` - Évaluateur AES
- `SimpleOperationsEvaluator.sol` - Opérations simples
- Et tous les autres contrats...

### Scripts TypeScript (src/hardhat/scripts/)
- `deployAll.ts` - Déploiement complet
- `deployCompleteStack.ts` - Stack complète
- `testFullFlow.ts` - Tests de flux complet
- Et 70+ autres scripts...

### Application Next.js (src/app/)
- `api/**/*.ts` - Routes API (disputes, contracts, proofs, etc.)
- `components/**/*.tsx` - Composants React
- `lib/**/*.ts` - Bibliothèques (blockchain, crypto, sqlite)
- `db/init.sql` - Schéma de base de données
- `page.tsx`, `layout.tsx` - Pages principales

### Code Rust/WASM (src/wasm/src/)
- `lib.rs` - Point d'entrée
- `accumulator.rs` - Accumulateur
- `circuits.rs`, `circuits_v2.rs` - Circuits
- `commitment.rs` - Engagements
- `encryption.rs` - Chiffrement
- `sha256.rs` - SHA256
- `aes_ctr.rs` - AES CTR
- `simple_operations.rs` - Opérations simples
- `bin/*.rs` - Binaires CLI

### Configuration
- `package.json` (racine, src/hardhat, src/app, desktop)
- `tsconfig.json`
- `hardhat.config.ts`
- `next.config.ts`
- `Cargo.toml`, `Cargo.lock`
- `.gitignore`

### Scripts Shell
- `deploy-all.sh`
- `START_ALL.sh`
- `start-web.sh`
- `run-anvil.sh`
- Et autres scripts de déploiement...

## ⚠️ Fichiers EXCLUS (dans .gitignore)

- ❌ `node_modules/` - Dépendances (à installer avec `npm install`)
- ❌ `bundler/`, `bundler-alto/` - Bundlers (exclus)
- ❌ `src/hardhat/bundler/` - Bundler Hardhat (exclus)
- ❌ `target/`, `artifacts/`, `.next/` - Build artifacts
- ❌ `test_1gb.*` - Fichiers de test volumineux
- ❌ `*.sqlite` - Bases de données

## ✅ Checklist Avant Push

- [ ] Tous les fichiers source sont trackés
- [ ] `.gitignore` est à jour
- [ ] Les gros dossiers sont exclus
- [ ] L'historique Git est nettoyé (taille < 100 MB)
- [ ] Commit créé avec tous les fichiers
- [ ] Force push prêt (si historique nettoyé)

## 🚀 Commandes Finales

```bash
# 1. Vérifier la taille finale
git count-objects -vH

# 2. Voir les fichiers trackés
git ls-files | wc -l

# 3. Voir les commits
git log --oneline -5

# 4. Push (avec force si historique nettoyé)
git push --force origin ahana
```

## 📝 Note Importante

Après le push, les autres développeurs devront :
1. Cloner le dépôt
2. Installer les dépendances : `npm install`
3. Compiler le WASM : `cd src/wasm && cargo build`
4. Initialiser la DB : `cat src/app/db/init.sql | sqlite3 src/app/db/sox.sqlite`

Tous les fichiers source essentiels sont inclus dans le dépôt !


