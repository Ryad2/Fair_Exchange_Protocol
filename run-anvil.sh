#!/bin/bash

# Script pour lancer Anvil (Foundry) au lieu de Hardhat node
# Anvil supporte mieux les tracers nécessaires pour Alto

set -e

echo "🚀 Lancement d'Anvil (Foundry node)..."

# Lancer Anvil avec les mêmes paramètres que Hardhat node
anvil \
  --host 127.0.0.1 \
  --port 8545 \
  --chain-id 31337 \
  --block-time 1 \
  --gas-limit 30000000





















