#!/bin/bash

# Script pour tester l'envoi d'une UserOperation
# Usage: ./test_userop.sh <CONTRACT_ADDRESS> <VENDOR_PRIVATE_KEY> [KEY_TO_SEND]

if [ -z "$1" ] || [ -z "$2" ]; then
    echo "Usage: $0 <CONTRACT_ADDRESS> <VENDOR_PRIVATE_KEY> [KEY_TO_SEND]"
    echo ""
    echo "Exemple:"
    echo "  $0 0x1234... 0xabcd... 0x5678"
    echo ""
    echo "Variables d'environnement:"
    echo "  CONTRACT_ADDRESS: Adresse du contrat OptimisticSOXAccount"
    echo "  VENDOR_PRIVATE_KEY: Clé privée du vendor (ou session key)"
    echo "  KEY_TO_SEND: Clé à envoyer (optionnel, défaut: 0x1234)"
    exit 1
fi

CONTRACT_ADDRESS=$1
VENDOR_PRIVATE_KEY=$2
KEY_TO_SEND=${3:-"0x1234"}

echo "🧪 Test d'envoi de UserOperation"
echo "   Contrat: $CONTRACT_ADDRESS"
echo "   Clé à envoyer: $KEY_TO_SEND"
echo ""

cd src/hardhat

CONTRACT_ADDRESS="$CONTRACT_ADDRESS" \
VENDOR_PRIVATE_KEY="$VENDOR_PRIVATE_KEY" \
KEY_TO_SEND="$KEY_TO_SEND" \
npx hardhat run scripts/testSendUserOp.ts --network localhost













