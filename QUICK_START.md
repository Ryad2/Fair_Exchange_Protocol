# 🚀 Quick Start - SOX Implementation

Guide rapide pour démarrer le projet SOX.

## Installation rapide

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

## Accès

- **Application Web**: http://localhost:3000
- **Bundler RPC**: http://localhost:4337/rpc

## Guide complet

Pour un guide détaillé avec toutes les étapes, configurations et résolution de problèmes, consultez **[GUIDE_INSTALLATION_COMPLET.md](./GUIDE_INSTALLATION_COMPLET.md)**

## Prérequis

- Node.js >= 22.13.1
- Rust/Cargo (pour compiler le binaire WASM)
- sqlite3 (pour la base de données)
- pnpm (installé automatiquement)

## Problèmes courants

### "Failed to fetch"
→ Vérifiez que `enable-cors: true` est dans `bundler-alto/scripts/config.local.json` et redémarrez le bundler

### "No deployed library addresses found"
→ Relancez `./deploy-all.sh` pour déployer les contrats

### "spawn precontract_cli ENOENT"
→ Compilez le binaire Rust : `cd src/wasm && cargo build --release --bin precontract_cli`

Pour plus de détails, consultez le [Guide Complet](./GUIDE_INSTALLATION_COMPLET.md)

