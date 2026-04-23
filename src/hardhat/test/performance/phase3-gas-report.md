# Phase 3 Gas and Coverage Report

Generated from:

```bash
npx hardhat test test/Phase3ExhaustiveAndGas.test.ts test/Phase3Variants.test.ts test/OptimisticSOXAccount.ts
```

Environment: Hardhat local network, Solidity 0.8.28, `viaIR=true`, optimizer enabled with `runs=1`.

## Coverage

- The 12 conceptual Phase 2 combinations of `S`, `SB`, and `SV` are executed end-to-end on `OptimisticSOXAccount`.
- `no_S_deposit` is executed with all four `SB/SV` self-sponsor combinations.
- Security/error paths are covered for:
  - external `SB` without buyer authorization;
  - invalid buyer authorization;
  - underfunded `S=B` fused deployment;
  - invalid hardcoded SHA256 metadata;
  - hardcoded SHA256 configuration after the key has been sent.
- Hardcoded SHA256 dispute measurements use real V2 WASM proofs and a real `DisputeSOXAccount`.

## Optimistic Phase Gas

The totals below include deployment plus the optimistic/dispute-trigger steps measured in the mock-dispute matrix.

| Scenario | Deploy | Payment | Key | SB | SV | Configure | Total |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| normal, SB external, SV external | 2,790,122 | 104,441 | 58,908 | 115,577 | 120,608 | 0 | 3,189,656 |
| S=B, SB external, SV external | 2,854,621 | 0 | 58,908 | 115,600 | 120,608 | 0 | 3,149,737 |
| S=V, SB external, SV external | 2,790,364 | 104,441 | 58,908 | 115,600 | 120,608 | 0 | 3,189,921 |
| normal, SB=B, SV external | 2,790,122 | 104,441 | 58,908 | 106,954 | 120,608 | 0 | 3,181,033 |
| normal, SB external, SV=V | 2,790,110 | 104,441 | 58,908 | 115,588 | 122,446 | 0 | 3,191,493 |
| normal, SB=B, SV=V | 2,790,122 | 104,441 | 58,908 | 106,954 | 122,446 | 0 | 3,182,871 |
| no_S_deposit, SB external, SV external | 2,770,239 | 82,100 | 58,908 | 115,600 | 120,608 | 0 | 3,147,455 |
| no_S_deposit, SB=B, SV external | 2,770,239 | 82,100 | 58,908 | 106,954 | 120,608 | 0 | 3,138,809 |
| S=B + hardcoded SHA256 config | 2,854,621 | 0 | 58,908 | 115,565 | 120,608 | 79,982 | 3,229,684 |

## Optimistic Savings

Baseline: `normal, SB external, SV external = 3,189,656 gas`.

| Scenario | Delta vs baseline | Interpretation |
| --- | ---: | --- |
| S=B | -39,919 | Saves one payment transaction, but deployment is more expensive because the buyer deposit is fused into construction. |
| S=V | +265 | Essentially gas-neutral in the current implementation; main benefit is role simplification, not gas. |
| SB=B | -8,623 | Real saving on Step 4+5 because no buyer authorization signature is needed. |
| SV=V | +1,837 | Slightly more expensive due to the self-sponsor wrapper/event; useful mostly for coordination simplification. |
| SB=B + SV=V | -6,785 | SB saving is partly offset by the SV self-sponsor overhead. |
| no_S_deposit | -42,201 | Removes sponsor deposit logic and lowers buyer payment gas/value path. |
| no_S_deposit + SB=B | -50,847 | Best measured optimistic-path saving among retained variants. |

## Hardcoded SHA256 Dispute Gas

These measurements use real `compute_precontract_values_v2`, `evaluate_circuit_v2_wasm`, and `compute_proofs_v2` outputs.

| Scenario | Configure | Trigger dispute | submitCommitment | proof1 items |
| --- | ---: | ---: | ---: | ---: |
| normal hCircuit proof, 13 bytes | 0 | 5,779,296 | 251,444 | 3 |
| hardcoded SHA256, 13 bytes | 81,897 | 5,787,348 | 234,626 | 0 |
| normal hCircuit proof, 16 KB | 0 | 5,779,296 | 463,532 | 10 |
| hardcoded SHA256, 16 KB | 81,897 | 5,787,348 | 400,990 | 0 |

## 900 MiB Equivalent Benchmark

This benchmark does not generate a real 900 MiB input file. Instead, it measures the exact on-chain scaling factor affected by the hardcoded SHA256 optimization: the `hCircuit` membership proof depth.

Parameters:

- Plaintext length: 943,718,400 bytes, i.e. 900 MiB.
- SHA256/AES block count: 14,745,600.
- Hardcoded circuit gate count: 29,491,205.
- Normal `hCircuit` proof depth: 25 Merkle levels.

| Measurement | Gas |
| --- | ---: |
| Configure hardcoded metadata | 81,909 |
| Trigger hardcoded dispute/deploy dispute contract | 5,787,348 |
| Before: normal `hCircuit` proof verification, depth 25 | 192,267 |
| After: hardcoded AES gate hash | 32,390 |
| After: hardcoded SHA chain gate hash | 29,639 |
| After: hardcoded final comparison gate hash | 32,115 |
| Best proof-only saving | 162,628 |
| Worst proof-only saving | 159,877 |

For a 900 MiB-equivalent circuit, the hardcoded SHA256 path saves about 160k gas on the `hCircuit` membership check alone. If we also charge the one-time 81,909 gas configuration cost and the measured 8,052 gas hardcoded dispute deployment overhead, the first dispute is still about 69k to 73k gas cheaper in this isolated large-file scenario.

## Hardcoded SHA256 Interpretation

- `submitCommitment` is cheaper with the hardcoded circuit:
  - 13-byte file: saves 16,818 gas.
  - 16 KB file: saves 62,542 gas.
- The current implementation also pays:
  - about 81,897 gas to configure hardcoded metadata;
  - about 8,052 extra gas when deploying the dispute contract.
- Therefore, for a single small/medium dispute, hardcoded SHA256 is cheaper at the proof step but not yet cheaper end-to-end once configuration and deployment overhead are included.
- The 900 MiB-equivalent benchmark confirms the expected break-even behavior: once the normal proof reaches depth 25, the proof saving is large enough to beat the current one-time overhead.
- The variant becomes even more attractive for larger circuits, repeated measurements, or if hardcoded metadata is folded into deployment/precontract setup instead of configured by a separate transaction.

## Notes

- The optimistic matrix uses `MockDisputeDeployer` to isolate Phase 3 role/fusion behavior from full dispute bytecode cost.
- The hardcoded SHA256 measurements deploy a real dispute contract and validate real WASM-generated proofs.
- `DisputeSOXAccount` still exceeds the EVM mainnet code-size limit in this implementation; this does not affect Hardhat local measurements but must be addressed before mainnet-style deployment.
