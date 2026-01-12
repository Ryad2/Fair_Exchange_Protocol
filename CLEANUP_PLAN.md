# Plan de Nettoyage du Projet

## Fichiers à Supprimer

### 📄 Documentation Temporaire/Debug (à supprimer)
- ANALYSE_*.md (ANALYSE_DISPUTE_PROBLEME.md, ANALYSE_GATE1.md, ANALYSE_GATE3.md, ANALYSE_VERIFYEXT_GATE1.md)
- DIAGNOSTIC_*.md (DIAGNOSTIC_ERREUR_PREUVES.md)
- EXPLICATION_*.md (EXPLICATION_CIPHERTEXT_DISPUTE.md, EXPLICATION_FICHIER_DISPUTE.md, EXPLICATION_INDEXATION_STEP8B.md)
- FIX_*.md (FIX_BUILD_ERRORS.md, FIX_NEXT_ERRORS.md)
- RESUME_*.md (RESUME_CORRECTION_GATE3.md, RESUME_FINAL.md)
- SOLUTION_*.md (SOLUTION_NETTOYAGE_GIT.md, SOLUTION_VERIFYEXT_GATE1.md)
- COMMIT_GUIDE.md
- FICHIERS_A_COMMITTER.md
- COMPARAISON_LOGIC_INDICES.md
- POURQUOI_BYTES32_0.md
- OU_TELECHARGER_CIPHERTEXT.md
- REPONSE_V2_OPCODES.md

### 🧹 Scripts de Nettoyage Git (à supprimer)
- cleanup-git-history.sh
- cleanup-git-simple.sh
- check_and_restore_bundler.sh
- check_and_restore_git.sh
- commit-all-important.sh

### 🧪 Scripts de Test/Debug (à supprimer)
- scripts/test_*.ts
- scripts/diagnose_*.ts
- scripts/check_*.ts
- test_*.sh (tous les scripts de test shell)
- test_*.bin, test_*.circuit, test_*.ct (fichiers de test volumineux)
- test_*.js

### 🔧 Scripts Hardhat de Debug/Test (à supprimer partiellement)
Dans src/hardhat/scripts/ :
- check*.ts (sauf checkContract.ts si utilisé)
- debug*.ts
- diagnose*.ts
- test*.ts (sauf scripts de déploiement essentiels)
- compare*.ts
- find*.ts

### 📦 Autres Fichiers Temporaires
- sox.pdf (si pas nécessaire)
- sponsoring_flow.py
- package-lock.circuit
- package-lock.ct
- src/hardhat/test_empty_string.sol
- src/hardhat/test_debug_proof_right.ts

## Fichiers à GARDER

### ✅ Documentation Essentielle
- INSTALLATION_GUIDE_COMPLETE.tex (guide d'installation)
- REDEPLOY.md (guide de redéploiement - utile)

### ✅ Scripts Essentiels
- deploy-contracts.sh
- deploy-all.sh
- START_ALL.sh
- start-web.sh
- LANCER_APP.sh
- run-anvil.sh
- run-alto.sh
- install-alto.sh
- reset_bundler.sh
- scripts/start-all-synchronized.sh
- scripts/stop-all.sh

### ✅ Scripts Hardhat Essentiels
- deployAll.ts
- deployCompleteStack.ts
- deployEntryPoint*.ts
- deployPimlicoSimulations.ts
- deployEip7702Delegate.ts
- deploy_libraries.ts

### ✅ Tout le Code Source
- src/app/ (application Next.js)
- src/hardhat/contracts/ (contrats Solidity)
- src/wasm/ (code Rust/WASM)
- src/hardhat/test/ (tests - garder)

