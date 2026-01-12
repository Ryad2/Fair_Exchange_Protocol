#!/bin/bash

set -e

ROOT_DIR="/Applications/sox_implementation"
cd "$ROOT_DIR"

echo "=== Comparaison des hash de gates V2 (Rust vs Solidity) ==="
echo ""

# 1. Exécuter le test Rust
echo "1. Test Rust:"
cd src/wasm
cargo test test_gate_hash_for_solidity_comparison --release -- --nocapture 2>&1 | grep -A 20 "Test de hashage" | head -25

cd "$ROOT_DIR"

echo ""
echo "2. Résultats Rust:"
echo "   Gate 1 (AES-CTR): cce128d36e00bb7af7c5178f90b4a2cdf53d73a9b1ec3b9f14c9b0d28f5ef461"
echo "   Gate 2 (SHA2):     f33d5479d7846de0011754e9a28b8f8c9bea04b65a74a600c5b3daadcff27c53"
echo "   Gate 3 (CONST):    67171a1e9c85caf3f8cc3ee8bf09b1775e1f1fbe9d7cf36cdaada71241bc8ff6"
echo ""

echo "3. Pour tester avec Solidity, utilisez:"
echo "   cd src/hardhat"
echo "   npx hardhat console"
echo ""
echo "   Puis dans la console:"
echo "   const TestGateHash = await ethers.getContractFactory('TestGateHash');"
echo "   const test = await TestGateHash.deploy();"
echo "   await test.deployed();"
echo ""
echo "   // Gate 1"
echo "   const gate1 = '0x01ffffffffffff000000000000000000000000000000000040000000000000000000000000000000000000000000000000000000000000000000000000000000';"
echo "   const hash1 = await test.sha256GateV2(gate1);"
echo "   console.log('Hash Solidity:', hash1);"
echo "   // Attendu: 0xcce128d36e00bb7af7c5178f90b4a2cdf53d73a9b1ec3b9f14c9b0d28f5ef461"
echo ""
echo "   // Gate 2"
echo "   const gate2 = '0x02000000000001000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000';"
echo "   const hash2 = await test.sha256GateV2(gate2);"
echo "   console.log('Hash Solidity:', hash2);"
echo "   // Attendu: 0xf33d5479d7846de0011754e9a28b8f8c9bea04b65a74a600c5b3daadcff27c53"
echo ""
echo "   // Gate 3"
echo "   const gate3 = '0x03800000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000';"
echo "   const hash3 = await test.sha256GateV2(gate3);"
echo "   console.log('Hash Solidity:', hash3);"
echo "   // Attendu: 0x67171a1e9c85caf3f8cc3ee8bf09b1775e1f1fbe9d7cf36cdaada71241bc8ff6"



















