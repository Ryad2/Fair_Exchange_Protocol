# SOX Implementation

Complete implementation of the SOX (Secure Optimistic Exchange) protocol with ERC-4337 support.

## 🚀 Quick Start

### Automatic Installation

```bash
# 1. Install all dependencies
./install.sh

# 2. In Terminal 1: Start Hardhat node
cd src/hardhat && npx hardhat node

# 3. In Terminal 2: Deploy contracts
./deploy-all.sh

# 4. In Terminal 3: Start the bundler
./run-alto.sh

# 5. In Terminal 4: Start Next.js
npm run dev

# 6. In Terminal 5 (Optional): Start Electron Desktop
# ⚠️ IMPORTANT: Next.js must be running BEFORE Electron
cd desktop && npm start
```

### Access

- **Web Application**: http://localhost:3000 (required for Electron)
- **Desktop Application**: Electron (`cd desktop && npm start` after starting Next.js)
- **Bundler RPC**: http://localhost:4337/rpc
- **Hardhat RPC**: http://localhost:8545

## 📚 Documentation

### Complete Installation Guide

For a detailed guide with all steps, configurations, and troubleshooting, see:

**[📖 INSTALLATION_GUIDE_COMPLETE.md](./INSTALLATION_GUIDE_COMPLETE.md)**

This guide covers:
- ✅ Complete installation from scratch
- ✅ Configuration of all components
- ✅ Contract deployment
- ✅ Resolution of all common problems
- ✅ Compatibility with macOS, Linux, and Windows (WSL)

### Quick Start Guide

For a quick start, see:

**[⚡ QUICK_START.md](./QUICK_START.md)**

## 🔧 Prerequisites

- **Node.js** >= 22.13.1
- **Rust/Cargo** (to compile the WASM binary)
- **sqlite3** (for the database)
- **pnpm** (automatically installed by `install.sh`)
- **Foundry (forge)** (automatically installed for Alto bundler)

## 📦 Architecture

The project consists of several components:

- **Next.js Frontend** : Web interface (`src/app/`)
- **Hardhat** : Contract deployment and testing (`src/hardhat/`)
- **Alto Bundler** : ERC-4337 bundler (`bundler-alto/`)
- **Rust Binary** : Native precomputation (`src/wasm/`)
- **Electron Desktop** : Desktop application (optional, `desktop/`)
  - Loads the Next.js application in an Electron window
  - Allows execution of native Rust precompute locally
  - Requires Next.js to be running on `http://localhost:3000`

## 🛠️ Available Scripts

### Installation

```bash
./install.sh              # Complete automatic installation
./install-alto.sh          # Install Alto bundler only
```

### Deployment

```bash
./deploy-all.sh           # Complete contract deployment
./deploy-contracts.sh     # Alternative deployment
```

### Launch

```bash
./run-alto.sh             # Start Alto bundler
npm run dev               # Start Next.js (web application)
cd desktop && npm start   # Start Electron (optional desktop application)
```

**⚠️ IMPORTANT - Launch Order:**
1. **First**: Run `npm run dev` (Next.js must be active on `http://localhost:3000`)
2. **Then**: Launch Electron with `cd desktop && npm start`

Electron loads the Next.js application in an Electron window, so Next.js must be started first.

## 🔍 Troubleshooting

### Common Issues

- **"Module not found: deployed-contracts.json"** → See [Complete Guide - Issue 3a](./INSTALLATION_GUIDE_COMPLETE.md#problem-3a-module-not-found-cant-resolve-deployed-contractsjson)
- **"Failed to fetch"** → Check that `enable-cors: true` is in `bundler-alto/scripts/config.local.json`
- **"No deployed library addresses found"** → Run `./deploy-all.sh` again to deploy contracts
- **"spawn precontract_cli ENOENT"** → Compile the Rust binary: `cd src/wasm && cargo build --release --bin precontract_cli`

For the complete list of issues and solutions, see the [Complete Installation Guide](./INSTALLATION_GUIDE_COMPLETE.md#-troubleshooting).

## 📝 Project Structure

```
sox_implementation/
├── src/
│   ├── app/              # Next.js application
│   ├── hardhat/          # Solidity contracts and deployment scripts
│   └── wasm/             # Rust binary for precomputation
├── bundler-alto/         # ERC-4337 bundler (Pimlico Alto)
├── desktop/              # Electron application (optional)
├── install.sh            # Automatic installation script
├── deploy-all.sh         # Contract deployment script
├── run-alto.sh           # Script to start the bundler
└── INSTALLATION_GUIDE_COMPLETE.md  # Detailed installation guide
```

## 🔗 Useful Links

- [Complete Installation Guide](./INSTALLATION_GUIDE_COMPLETE.md)
- [Quick Start](./QUICK_START.md)
- [ERC-4337 Documentation](https://eips.ethereum.org/EIPS/eip-4337)
- [Pimlico Alto Bundler](https://docs.pimlico.io/infra/bundler)

## 📄 License

[To be completed according to project license]

## 👥 Contributors

[To be completed]

---

**For any questions or issues, see the [Complete Installation Guide](./INSTALLATION_GUIDE_COMPLETE.md).**
