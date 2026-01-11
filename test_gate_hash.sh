#!/bin/bash

set -e

ROOT_DIR="/Applications/sox_implementation"
cd "$ROOT_DIR"

echo "=== Test de hashage d'une gate V2 (Rust vs Solidity) ==="
echo ""

# 1. Compiler et exécuter le test Rust
echo "1. Compilation du test Rust..."
cd src/wasm
cargo build --release --bin test_gate_hash 2>&1 | tail -3

echo ""
echo "2. Exécution du test Rust..."
./target/release/test_gate_hash

cd "$ROOT_DIR"

echo ""
echo "3. Compilation du contrat Solidity..."
cd src/hardhat
npx hardhat compile 2>&1 | grep -E "Compiled|Error" | head -5

echo ""
echo "4. Test avec Hardhat console..."
echo "Pour tester manuellement:"
echo "  npx hardhat console"
echo "  const TestGateHash = await ethers.getContractFactory('TestGateHash');"
echo "  const test = await TestGateHash.deploy();"
echo "  await test.deployed();"
echo ""
echo "  // Gate 1: AES-CTR avec son g_{-1}"
echo "  const gate1 = '0x01' + 'ffffffffffffff' + '00'.repeat(16) + '0040' + '00'.repeat(44);"
echo "  const hash1 = await test.sha256GateV2(gate1);"
echo "  console.log('Hash Solidity:', hash1);"
echo ""
echo "Comparez avec les hash Rust dans gate_*_hash_rust.txt"


















