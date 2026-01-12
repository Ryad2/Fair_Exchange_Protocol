#!/bin/bash

# Script pour déployer tous les contrats SOX
# Alias pour deploy-contracts.sh

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
exec "$SCRIPT_DIR/deploy-contracts.sh" "$@"










