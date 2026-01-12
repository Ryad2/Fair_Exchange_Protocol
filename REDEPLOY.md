# 🚀 Guide de redéploiement des contrats

## ✅ Correction apportée

Le problème `require(false)` lors de l'envoi des frais du sponsor vendor a été corrigé dans :
- **OptimisticSOXAccount.sol** : Passage de `msg.sender` directement au constructeur
- **DisputeSOXAccount.sol** : Validation que `buyerDisputeSponsor` et `vendorDisputeSponsor` sont définis

## 📋 Comment redéployer

### Méthode simple (recommandée)

**Exécutez simplement ce script qui fait tout automatiquement** :

```bash
cd /Applications/sox_implementation/src/hardhat
npx hardhat run scripts/deployCompleteStack.ts --network localhost
```

Ce script va automatiquement :
1. ✅ Compiler tous les contrats (avec les corrections)
2. ✅ Déployer toutes les libraries nécessaires
3. ✅ Déployer DisputeDeployer (avec les libraries linkées)
4. ✅ Déployer EntryPoint (ERC-4337)
5. ✅ Copier les ABI/JSON dans `src/app/lib/blockchain/contracts/`
6. ✅ Mettre à jour la config du bundler
7. ✅ Créer/mettre à jour `.env.local` avec les nouvelles adresses

### Après le déploiement

1. **Redémarrer l'application web** :
```bash
cd /Applications/sox_implementation
# Arrêter l'app si elle tourne (Ctrl+C)
npm run dev
```

2. **Redémarrer le bundler** (si nécessaire) :
```bash
# Le bundler devrait utiliser automatiquement la nouvelle config
# Sinon, redémarrer le bundler manuellement
```

3. **Tester avec un nouveau contrat** :
   - Créez un **nouveau contrat** via l'interface web
   - Les anciens contrats ne seront **pas** mis à jour automatiquement
   - Vous devez créer de nouveaux contrats avec la nouvelle version déployée

## ⚠️ Important

- Les contrats déployés **avant** ce redéploiement continueront d'utiliser l'ancienne version
- Vous devez créer de **nouveaux contrats** pour bénéficier des corrections
- Les anciens contrats existants ne seront **pas** affectés par ce redéploiement

## 🧪 Vérification

Pour vérifier que tout fonctionne :

```bash
cd /Applications/sox_implementation/src/hardhat
npx hardhat run scripts/testDeployOptimisticSOXAccount.ts --network localhost
```

Ce script va déployer un contrat de test et vérifier que tout fonctionne correctement.
