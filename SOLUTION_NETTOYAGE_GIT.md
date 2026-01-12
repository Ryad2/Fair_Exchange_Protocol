# Solution pour Nettoyer l'Historique Git (2.30 GiB → < 100 MB)

## 🔴 Problème
Votre dépôt Git fait **2.30 GiB** à cause de gros fichiers dans l'historique :
- `test_1gb.ct` : 1 GB (plusieurs fois)
- `test_1gb.bin` : 1 GB  
- `test_1gb.circuit` : 847 MB
- `desktop/node_modules/electron/...` : 150 MB
- Et beaucoup d'autres fichiers volumineux

GitHub refuse les packs > 2 GiB.

## ✅ Solution Recommandée : Branche Propre (Simple et Sûre)

### Option 1 : Script Automatique (Recommandé)

```bash
# Exécuter le script de nettoyage
./cleanup-git-simple.sh
```

Ce script va :
1. Créer une sauvegarde de votre branche actuelle
2. Créer une nouvelle branche sans historique
3. Ajouter uniquement les fichiers actuels (respectant .gitignore)
4. Créer un commit initial propre

### Option 2 : Manuel (Plus de contrôle)

```bash
# 1. Sauvegarder la branche actuelle
CURRENT_BRANCH=$(git branch --show-current)
git branch backup-$CURRENT_BRANCH

# 2. Créer une nouvelle branche orpheline (sans historique)
git checkout --orphan clean-$CURRENT_BRANCH

# 3. Ajouter tous les fichiers actuels
git add .

# 4. Créer le commit initial
git commit -m "Initial commit: clean repository without large files"

# 5. Vérifier la taille
git count-objects -vH

# 6. Si tout est bon, remplacer l'ancienne branche
git branch -D $CURRENT_BRANCH
git branch -m clean-$CURRENT_BRANCH $CURRENT_BRANCH

# 7. Force push (ATTENTION : cela réécrit l'historique sur GitHub)
git push --force origin $CURRENT_BRANCH
```

## 🔧 Solution Alternative : Nettoyer l'Historique (Avancé)

Si vous voulez garder l'historique mais supprimer les gros fichiers :

### Installer git-filter-repo (Recommandé)

```bash
# macOS
brew install git-filter-repo

# Ou avec pip
pip install git-filter-repo
```

### Nettoyer avec git-filter-repo

```bash
# Supprimer test_1gb.* de tout l'historique
git filter-repo --path test_1gb.bin --path test_1gb.ct --path test_1gb.circuit --invert-paths

# Supprimer desktop/node_modules
git filter-repo --path desktop/node_modules --invert-paths

# Supprimer bundler
git filter-repo --path bundler --path bundler-alto --path src/hardhat/bundler --invert-paths

# Nettoyer
git reflog expire --expire=now --all
git gc --prune=now --aggressive
```

## ⚠️ AVANT DE PUSH

1. **Vérifiez la taille** :
   ```bash
   git count-objects -vH
   ```
   La taille devrait être < 100 MB

2. **Vérifiez les fichiers** :
   ```bash
   git ls-files | head -20
   ```

3. **Testez localement** que tout fonctionne

4. **Force push uniquement si vous êtes sûr** :
   ```bash
   git push --force origin votre-branche
   ```

## 📋 Checklist

- [ ] Sauvegarde créée (`backup-*` ou `git branch backup`)
- [ ] Nouvelle branche créée et testée
- [ ] Taille vérifiée (< 100 MB)
- [ ] Fichiers essentiels présents
- [ ] Application fonctionne localement
- [ ] Force push effectué

## 🔄 En cas de problème

Pour revenir à l'ancienne branche :
```bash
git checkout backup-votre-branche
git branch -D votre-branche
git checkout -b votre-branche
```

## 📝 Fichiers qui DOIVENT être commités

Voir `FICHIERS_A_COMMITTER.md` pour la liste complète.

Les fichiers essentiels incluent :
- ✅ Contrats Solidity (`.sol`)
- ✅ Code source TypeScript/React (`.ts`, `.tsx`)
- ✅ Code Rust source (`.rs`)
- ✅ Configuration (`package.json`, `tsconfig.json`, etc.)
- ✅ Scripts de déploiement
- ✅ Schéma de base de données (`init.sql`)

Les fichiers qui NE DOIVENT PAS être commités :
- ❌ `node_modules/`
- ❌ `bundler/`, `bundler-alto/`
- ❌ `target/`, `artifacts/`, `.next/`
- ❌ `test_1gb.*`
- ❌ Fichiers générés


