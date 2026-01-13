#!/bin/bash

# Script to automatically configure bundler and update public keys
# after downloading/cloning the bundler

set -e

echo "=================================================================================="
echo "🔧 AUTOMATIC BUNDLER AND PUBLIC KEYS CONFIGURATION"
echo "=================================================================================="
echo ""

# Colors
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

# Check that Node.js is installed
if ! command -v node &> /dev/null; then
    echo "❌ Node.js is not installed. Please install it first."
    exit 1
fi

# Check that bundler exists
if [ ! -d "bundler-alto" ]; then
    echo "❌ bundler-alto directory does not exist."
    echo "💡 Run first: ./install-alto.sh"
    exit 1
fi

# Extract private keys from hardhat.config.ts
echo "📋 STEP 1: Extracting private keys from hardhat.config.ts..."
HARDHAT_CONFIG="src/hardhat/hardhat.config.ts"

if [ ! -f "$HARDHAT_CONFIG" ]; then
    echo "❌ hardhat.config.ts file not found: $HARDHAT_CONFIG"
    exit 1
fi

# Extract private keys (first 4 Hardhat accounts)
PRIVATE_KEYS=(
    "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80"  # sponsor
    "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d"  # buyer
    "0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a"  # vendor
    "0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6"  # buyer dispute sponsor
)

EXECUTOR_KEYS="${PRIVATE_KEYS[0]},${PRIVATE_KEYS[1]},${PRIVATE_KEYS[2]},${PRIVATE_KEYS[3]}"
UTILITY_KEY="${PRIVATE_KEYS[0]}"

echo "   ✅ Private keys extracted"
echo "   Executor keys: ${EXECUTOR_KEYS:0:50}..."
echo "   Utility key: ${UTILITY_KEY:0:50}..."

# Extract EntryPoint address from deployed-contracts.json or .env.local
echo ""
echo "📋 STEP 1b: Extracting EntryPoint address..."

ENTRY_POINT_ADDRESS=""

# Try from deployed-contracts.json
if [ -f "deployed-contracts.json" ]; then
    if command -v jq &> /dev/null; then
        ENTRY_POINT_ADDRESS=$(jq -r '.entryPoint // empty' deployed-contracts.json 2>/dev/null)
    else
        ENTRY_POINT_ADDRESS=$(grep -o '"entryPoint":\s*"[^"]*"' deployed-contracts.json | cut -d'"' -f4)
    fi
fi

# If not found, try from .env.local
if [ -z "$ENTRY_POINT_ADDRESS" ] && [ -f ".env.local" ]; then
    ENTRY_POINT_ADDRESS=$(grep "NEXT_PUBLIC_ENTRY_POINT=" .env.local | cut -d'=' -f2 | tr -d ' \n')
fi

# If still not found, use canonical default address
if [ -z "$ENTRY_POINT_ADDRESS" ]; then
    ENTRY_POINT_ADDRESS="0x4337084D9E255Ff0702461CF8895CE9E3b5Ff108"
    echo "   ⚠️  EntryPoint address not found, using default canonical address"
else
    echo "   ✅ EntryPoint address found"
fi

echo "   EntryPoint: ${ENTRY_POINT_ADDRESS}"

# Calculate corresponding public keys
echo ""
echo "📋 STEP 2: Calculating corresponding public keys..."

# Use ethers from src/hardhat/node_modules
HARDHAT_NODE_MODULES="src/hardhat/node_modules"

if [ ! -d "$HARDHAT_NODE_MODULES" ]; then
    echo "   ⚠️  Hardhat node_modules not found, installing..."
    cd src/hardhat
    npm install
    cd ../..
fi

# Create temporary Node.js script to calculate addresses
TEMP_SCRIPT=$(mktemp)
cat > "$TEMP_SCRIPT" << EOF
const path = require('path');
const { ethers } = require(path.join(process.cwd(), 'src/hardhat/node_modules/ethers'));

const privateKeys = process.argv.slice(2);
const publicKeys = privateKeys.map(pk => {
    const wallet = new ethers.Wallet(pk);
    return wallet.address;
});

console.log(JSON.stringify(publicKeys));
EOF

cd /Applications/sox_implementation
PUBLIC_KEYS_JSON=$(node "$TEMP_SCRIPT" ${PRIVATE_KEYS[@]})
rm "$TEMP_SCRIPT"

# Parse JSON (simple extraction)
PUBLIC_KEYS=($(echo "$PUBLIC_KEYS_JSON" | node -e "const d=require('fs').readFileSync(0,'utf8'); JSON.parse(d).forEach(k=>console.log(k))"))

echo "   ✅ Public keys calculated:"
for i in "${!PUBLIC_KEYS[@]}"; do
    echo "      ${PUBLIC_KEYS[$i]}"
done

# Update config.localhost.json
echo ""
echo "📋 STEP 3: Updating bundler-alto/config.localhost.json..."

CONFIG_FILE="bundler-alto/config.localhost.json"

if [ ! -f "$CONFIG_FILE" ]; then
    echo "   ⚠️  File not found, creating..."
    mkdir -p bundler-alto
    cat > "$CONFIG_FILE" << EOF
{
  "network-name": "local",
  "rpc-url": "http://127.0.0.1:8545",
  "min-entity-stake": 1,
  "min-executor-balance": "1000000000000000000",
  "min-entity-unstake-delay": 1,
  "max-bundle-wait": 3,
  "max-bundle-size": 10,
  "max-block-range": 500,
  "port": 3000,
  "executor-private-keys": "${EXECUTOR_KEYS}",
  "utility-private-key": "${UTILITY_KEY}",
  "entrypoints": "${ENTRY_POINT_ADDRESS}",
  "deploy-simulations-contract": true,
  "enable-debug-endpoints": true,
  "safe-mode": false,
  "mempool-max-parallel-ops": 5,
  "mempool-max-queued-ops": 5,
  "enforce-unique-senders-per-bundle": false
}
EOF
else
    # Update with jq if available, otherwise with sed
    if command -v jq &> /dev/null; then
        jq ".executor-private-keys = \"${EXECUTOR_KEYS}\" | .utility-private-key = \"${UTILITY_KEY}\" | .entrypoints = \"${ENTRY_POINT_ADDRESS}\"" "$CONFIG_FILE" > "${CONFIG_FILE}.tmp" && mv "${CONFIG_FILE}.tmp" "$CONFIG_FILE"
    else
        # Use sed as fallback
        sed -i.bak "s|\"executor-private-keys\": \".*\"|\"executor-private-keys\": \"${EXECUTOR_KEYS}\"|" "$CONFIG_FILE"
        sed -i.bak "s|\"utility-private-key\": \".*\"|\"utility-private-key\": \"${UTILITY_KEY}\"|" "$CONFIG_FILE"
        sed -i.bak "s|\"entrypoints\": \".*\"|\"entrypoints\": \"${ENTRY_POINT_ADDRESS}\"|" "$CONFIG_FILE"
        rm -f "${CONFIG_FILE}.bak"
    fi
fi

echo "   ✅ ${CONFIG_FILE} updated"

# Update scripts/config.local.json
echo ""
echo "📋 STEP 4: Updating bundler-alto/scripts/config.local.json..."

SCRIPTS_CONFIG_FILE="bundler-alto/scripts/config.local.json"

if [ ! -f "$SCRIPTS_CONFIG_FILE" ]; then
    echo "   ⚠️  File not found, creating..."
    mkdir -p bundler-alto/scripts
    cat > "$SCRIPTS_CONFIG_FILE" << EOF
{
  "network-name": "local",
  "rpc-url": "http://127.0.0.1:8545",
  "min-entity-stake": 1,
  "min-executor-balance": "1000000000000000000",
  "min-entity-unstake-delay": 1,
  "max-bundle-wait": 3,
  "max-bundle-size": 10,
  "max-block-range": 500,
  "port": 3000,
  "executor-private-keys": "${EXECUTOR_KEYS}",
  "utility-private-key": "${UTILITY_KEY}",
  "entrypoints": "${ENTRY_POINT_ADDRESS}",
  "deploy-simulations-contract": true,
  "enable-debug-endpoints": true,
  "safe-mode": false,
  "mempool-max-parallel-ops": 5,
  "mempool-max-queued-ops": 5,
  "enforce-unique-senders-per-bundle": false
}
EOF
else
    if command -v jq &> /dev/null; then
        jq ".executor-private-keys = \"${EXECUTOR_KEYS}\" | .utility-private-key = \"${UTILITY_KEY}\" | .entrypoints = \"${ENTRY_POINT_ADDRESS}\"" "$SCRIPTS_CONFIG_FILE" > "${SCRIPTS_CONFIG_FILE}.tmp" && mv "${SCRIPTS_CONFIG_FILE}.tmp" "$SCRIPTS_CONFIG_FILE"
    else
        sed -i.bak "s|\"executor-private-keys\": \".*\"|\"executor-private-keys\": \"${EXECUTOR_KEYS}\"|" "$SCRIPTS_CONFIG_FILE"
        sed -i.bak "s|\"utility-private-key\": \".*\"|\"utility-private-key\": \"${UTILITY_KEY}\"|" "$SCRIPTS_CONFIG_FILE"
        sed -i.bak "s|\"entrypoints\": \".*\"|\"entrypoints\": \"${ENTRY_POINT_ADDRESS}\"|" "$SCRIPTS_CONFIG_FILE"
        rm -f "${SCRIPTS_CONFIG_FILE}.bak"
    fi
fi

echo "   ✅ ${SCRIPTS_CONFIG_FILE} updated"

# Check that dependencies are installed
echo ""
echo "📋 STEP 5: Checking bundler dependencies..."

if [ ! -d "bundler-alto/node_modules" ]; then
    echo "   ⚠️  node_modules not found, installing..."
    cd bundler-alto
    if command -v pnpm &> /dev/null; then
        pnpm install
    else
        echo "   ❌ pnpm is not installed. Installing..."
        npm install -g pnpm
        pnpm install
    fi
    cd ..
else
    echo "   ✅ Dependencies already installed"
fi

# Summary
echo ""
echo "=================================================================================="
echo -e "${GREEN}✅ CONFIGURATION COMPLETED SUCCESSFULLY !${NC}"
echo "=================================================================================="
echo ""
echo "📋 SUMMARY:"
echo ""
echo "   Private keys configured:"
echo "      Executor keys: ${EXECUTOR_KEYS:0:50}..."
echo "      Utility key: ${UTILITY_KEY:0:50}..."
echo ""
echo "   Corresponding public keys:"
for i in "${!PUBLIC_KEYS[@]}"; do
    echo "      ${PUBLIC_KEYS[$i]}"
done
echo ""
echo "   EntryPoint configured:"
echo "      ${ENTRY_POINT_ADDRESS}"
echo ""
echo "   Files updated:"
echo "      ✅ bundler-alto/config.localhost.json"
echo "      ✅ bundler-alto/scripts/config.local.json"
echo ""
echo "📋 NEXT STEPS:"
echo ""
echo "1. Verify Hardhat node is running:"
echo "   cd src/hardhat && npx hardhat node"
echo ""
echo "2. Start bundler:"
echo "   cd bundler-alto && ./run-local.sh"
echo ""
echo "3. (Optional) Build bundler if needed:"
echo "   cd bundler-alto && pnpm run build:all"
echo ""
