// SPDX-License-Identifier: GPL-3.0
pragma solidity ^0.8.0;

/**
 * @title DisputeSOX_V1
 * @notice Version V1 du contrat DisputeSOX (pour référence uniquement)
 * @dev Ce fichier est conservé pour référence historique.
 *      Le contrat DisputeSOX actuel ne supporte que V2.
 *
 *      Différences principales V1 vs V2:
 *      - V1 utilise CircuitEvaluator.evaluateGate avec uint32[] pour les gates
 *      - V1 utilise extractInAndNotInL et extractNonConstantSons avec uint32[]
 *      - V1 utilise isConstantIdx avec CONSTANT_FLAG
 *      - V2 utilise EvaluatorSOX_V2.evaluateGateFromSons avec bytes (64 bytes)
 *      - V2 utilise extractInAndNotInL_V2 et extractNonConstantSons_V2 avec bytes
 */
contract DisputeSOX_V1 {
    // NOTE: Ce fichier est une référence. Le code V1 complet devrait être restauré depuis git
    // si nécessaire. Les principales différences sont documentées ci-dessus.
}





