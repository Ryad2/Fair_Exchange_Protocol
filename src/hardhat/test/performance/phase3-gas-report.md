# Phase 3 Gas and Coverage Report

Generated from:

```bash
npx hardhat test test/Phase3ExhaustiveAndGas.test.ts test/Phase3Variants.test.ts test/OptimisticSOXAccount.ts
npx hardhat run scripts/measurePhase3ExecutionTimes.ts
PHASE3_TIMING_SIZES_MB=none PHASE3_STREAMING_SHA256_MB=1024 PHASE3_STREAMING_HARDCODED_MB=1024 PHASE3_NORMAL_PIPELINE_ESTIMATE_MB=1024 npx hardhat run scripts/measurePhase3ExecutionTimes.ts
```

Environment: Hardhat local network, Solidity 0.8.28, `viaIR=true`, optimizer enabled with `runs=1`.

## Coverage

- The 12 conceptual Phase 2 combinations of `S`, `SB`, and `SV` are executed end-to-end on `OptimisticSOXAccount`.
- `no_S_deposit` is executed with all four `SB/SV` self-sponsor combinations.
- The retained dispute comparison requested for the May presentation is measured:
  - normal external dispute sponsors;
  - self-sponsors `SB=B/SV=V`;
  - hardcoded SHA256 circuit;
  - self-sponsors plus hardcoded SHA256 circuit.
- Security/error paths are covered for:
  - external `SB` without buyer authorization;
  - invalid buyer authorization;
  - underfunded `S=B` fused deployment;
  - invalid hardcoded SHA256 metadata;
  - hardcoded SHA256 configuration after the key has been sent.
- Hardcoded SHA256 dispute measurements use real V2 WASM proofs and a real `DisputeSOXAccount`.
- Large-file on-chain measurements cover both 900 MiB and 1 GiB equivalent circuits.
- Off-chain execution timings are measured for the current WASM V2 pipeline and for 900 MiB / 1 GiB streaming hardcoded metadata.

## Measurement Scope Correction

Following the professor's feedback, the optimistic path and the dispute path are now reported with separate scopes:

- `optimistic success path`: deployment + `sendPayment` + `sendKey` + `completeTransaction`;
- `pre-dispute path`: deployment + `sendPayment` + `sendKey` + `SB` + `SV`;
- `first Step 8a transaction`: cost up to the first `submitCommitment`;
- `full dispute until End`: the complete dispute, including Step 9 restarts and final `completeDispute` or `cancelDispute`.

In the tables below, `submitCommitment` is the vendor Step 8a transaction in the general case (`WaitVendorData`). `pi_1 items` is the number of sibling hashes in the Merkle membership proof over `hCircuit`.

## Optimistic Success Path Gas

This table is the correct comparator for Hana's "deployment + optimistic execution" figure.

| Scenario | Deploy | Payment | Key | Complete | Total |
| --- | ---: | ---: | ---: | ---: | ---: |
| normal | 2,793,386 | 104,441 | 58,908 | 69,571 | 3,026,306 |
| `S=B` | 2,857,885 | 0 | 58,908 | 67,071 | 2,983,864 |
| `S=V` | 2,793,628 | 104,441 | 58,908 | 67,071 | 3,024,048 |
| `no_S_deposit` | 2,773,503 | 82,100 | 58,908 | 62,865 | 2,977,376 |

Interpretation:

- the normal success path is now measured separately at `3,026,306 gas`;
- `S=B` saves `42,442 gas` versus the normal success path;
- `no_S_deposit` saves `48,930 gas` versus the normal success path;
- `S=V` is slightly cheaper than normal in the success-only path, but the effect remains modest.

## Pre-Dispute Path Gas

This table includes the optimistic path plus the `SB` and `SV` steps that trigger the dispute, so it should not be compared directly with Hana's "success" number.

| Scenario | Deploy | Payment | Key | SB | SV | Configure | Total |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| normal, `SB` external, `SV` external | 2,793,386 | 104,441 | 58,908 | 115,600 | 120,608 | 0 | 3,192,943 |
| `S=B`, `SB` external, `SV` external | 2,857,885 | 0 | 58,908 | 115,565 | 120,608 | 0 | 3,152,966 |
| `S=V`, `SB` external, `SV` external | 2,793,628 | 104,441 | 58,908 | 115,553 | 120,608 | 0 | 3,193,138 |
| normal, `SB=B`, `SV` external | 2,793,374 | 104,441 | 58,908 | 106,954 | 120,608 | 0 | 3,184,285 |
| normal, `SB` external, `SV=V` | 2,793,386 | 104,441 | 58,908 | 115,565 | 122,446 | 0 | 3,194,746 |
| normal, `SB=B`, `SV=V` | 2,793,386 | 104,441 | 58,908 | 106,954 | 122,446 | 0 | 3,186,135 |
| `no_S_deposit`, `SB` external, `SV` external | 2,773,503 | 82,100 | 58,908 | 115,577 | 120,608 | 0 | 3,150,696 |
| `no_S_deposit`, `SB=B`, `SV` external | 2,773,503 | 82,100 | 58,908 | 106,954 | 120,608 | 0 | 3,142,073 |
| `S=B` + hardcoded SHA256 config | 2,857,885 | 0 | 58,908 | 115,600 | 120,608 | 79,982 | 3,232,983 |

Interpretation:

- `S=B` saves `39,977 gas` on the pre-dispute path;
- `SB=B` saves `8,658 gas` on the pre-dispute path;
- `no_S_deposit + SB=B` gives the best measured pre-dispute saving: `50,870 gas`;
- the hardcoded SHA256 option is not meant to optimize this optimistic/pre-dispute segment.

## First Step 8a Measurements

These measurements use real `compute_precontract_values_v2`, `evaluate_circuit_v2_wasm`, and `compute_proofs_v2` outputs. They stop after the first Step 8a transaction (`submitCommitment`).

| Scenario | Configure | SB step | Trigger dispute | submitCommitment | Total measured | `pi_1` items |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| normal `hCircuit`, 13 bytes | 0 | 115,588 | 5,779,296 | 251,444 | 6,146,328 | 3 |
| hardcoded SHA256, 13 bytes | 81,897 | 115,600 | 5,787,348 | 234,614 | 6,219,459 | 0 |
| normal `hCircuit`, 16 KB | 0 | 115,588 | 5,779,296 | 463,544 | 6,358,428 | 10 |
| hardcoded SHA256, 16 KB | 81,897 | 115,577 | 5,787,348 | 400,966 | 6,385,788 | 0 |

Interpretation:

- hardcoded SHA256 removes `pi_1` entirely;
- on `submitCommitment` alone, the saving is `16,830 gas` at 13 bytes and `62,578 gas` at 16 KB;
- this first-Step-8 measurement does not include the extra Step 9 loops avoided by self-sponsoring.

## Specialized Hardcoded Deployment Path

The measurements above correspond to the original monolithic hardcoded path, where the optimistic account is deployed first and then configured with a separate `configureHardcodedSha256Circuit(...)` transaction.

The current app path no longer uses that deployment mode. It now deploys dedicated hardcoded contracts with the SHA256 metadata embedded in the constructor:

- `OptimisticSOXAccountHardcodedSHA256`
- `DisputeDeployerHardcodedSHA256`
- `DisputeSOXAccountHardcodedSHA256`

This removes the standalone configuration transaction and avoids paying the full non-hardcoded bytecode tax in the optimistic account.

Bytecode comparison:

| Contract | Monolithic bytes | Specialized hardcoded bytes | Delta |
| --- | ---: | ---: | ---: |
| optimistic account | 11,456 | 10,740 | -716 |
| dispute account | 26,439 | 26,261 | -178 |

Gas comparison for the deployed hardcoded path:

| Measurement | Monolithic hardcoded | Specialized hardcoded | Saving |
| --- | ---: | ---: | ---: |
| optimistic deploy | 2,793,386 | 2,649,667 | 143,719 |
| hardcoded setup tx | 81,897 | 0 | 81,897 |
| vendor dispute-trigger tx | 5,767,448 | 5,723,102 | 44,346 |
| total deploy + trigger path | 8,921,680 | 8,651,674 | 270,006 |

Interpretation:

- the gain is smaller than for the normal-path split because the hardcoded helpers still have to exist somewhere;
- the important practical win is that the hardcoded metadata is now part of deployment, so there is no extra setup transaction in the real app flow;
- the previously reported `~81.9k gas` hardcoded configuration overhead is therefore no longer paid by the deployed hardcoded path.

## Retained First-Step-8 Comparison

This compact table matches the four cases requested for the presentation, but it is still a first-Step-8 view, not the full dispute to `End`.

| Scenario | Configure | SB step | Trigger dispute | submitCommitment | Total measured | `pi_1` items |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| normal, external `SB/SV` | 0 | 115,577 | 5,779,296 | 463,544 | 6,358,417 | 10 |
| self-sponsors `SB=B/SV=V` | 0 | 106,954 | 5,781,134 | 455,741 | 6,343,829 | 10 |
| hardcoded SHA256, external `SB/SV` | 81,897 | 115,577 | 5,787,348 | 400,990 | 6,385,812 | 0 |
| self-sponsors `SB=B/SV=V` + hardcoded SHA256 | 81,897 | 106,954 | 5,789,186 | 393,187 | 6,371,224 | 0 |

## Full Dispute Until End

This is the corrected measurement for the self-sponsor effect. It includes Step 9 restarts, all challenge/opinion rounds, every Step 8a submission, and the final `cancelDispute` or `completeDispute`.

The measured path below ends in `Cancel` for all four rows because the chosen proof path makes the buyer win. The important comparison is the number of full Step 8 cycles and total gas.

| Scenario | Configure | SB step | Trigger dispute | respondChallenge | giveOpinion | submitCommitment | Finalize | Total measured | Challenge restarts | Step 8 submissions | Final decision |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| normal, external `SB/SV` | 0 | 115,577 | 5,779,296 | 730,818 | 765,456 | 877,792 | 76,462 | 8,345,401 | 2 | 2 | Cancel |
| self-sponsors `SB=B/SV=V` | 0 | 106,954 | 5,781,134 | 365,409 | 382,728 | 455,753 | 73,962 | 7,165,940 | 1 | 1 | Cancel |
| hardcoded SHA256, external `SB/SV` | 81,897 | 115,600 | 5,787,348 | 730,818 | 765,456 | 752,660 | 76,462 | 8,310,241 | 2 | 2 | Cancel |
| self-sponsors `SB=B/SV=V` + hardcoded SHA256 | 81,897 | 106,954 | 5,789,186 | 365,409 | 382,728 | 393,199 | 73,962 | 7,193,335 | 1 | 1 | Cancel |

Interpretation for the historical monolithic hardcoded path:

- this is where the self-sponsor effect becomes large, as expected from Step 9;
- external sponsors require two full challenge/Step-8 cycles in this path, while self-sponsors need only one;
- the measured end-to-end saving is `1,179,461 gas` for self-sponsors versus normal in the non-hardcoded case;
- with hardcoded SHA256, the same full-dispute saving remains very large: `1,116,906 gas`;
- at 16 KB, hardcoded SHA256 is already slightly cheaper than the normal external full dispute (`8,310,241` vs `8,345,401`), but it is still slightly more expensive than the self-sponsored non-hardcoded path in the monolithic configuration because of the fixed hardcoded setup overhead.

## Large-File Equivalent Benchmark

This benchmark does not generate a real 900 MiB or 1 GiB input file. Instead, it measures the exact on-chain scaling factor affected by the hardcoded SHA256 optimization: the `hCircuit` membership proof depth.

Parameters for 900 MiB:

- Plaintext length: 943,718,400 bytes, i.e. 900 MiB.
- SHA256/AES block count: 14,745,600.
- Hardcoded circuit gate count: 29,491,205.
- Normal `hCircuit` proof depth: 25 Merkle levels.

Parameters for 1 GiB:

- Plaintext length: 1,073,741,824 bytes, i.e. 1 GiB.
- SHA256/AES block count: 16,777,216.
- Hardcoded circuit gate count: 33,554,437.
- Normal `hCircuit` proof depth: 26 Merkle levels.

| Measurement | Gas |
| --- | ---: |
| 900 MiB: configure hardcoded metadata | 81,909 |
| 900 MiB: trigger hardcoded dispute/deploy dispute contract | 5,787,348 |
| 900 MiB before: normal `hCircuit` proof verification, depth 25 | 192,267 |
| 900 MiB after: hardcoded AES gate hash | 32,390 |
| 900 MiB after: hardcoded SHA chain gate hash | 29,639 |
| 900 MiB after: hardcoded final comparison gate hash | 32,115 |
| 900 MiB best proof-only saving | 162,628 |
| 900 MiB worst proof-only saving | 159,877 |
| 1 GiB: configure hardcoded metadata | 81,897 |
| 1 GiB: trigger hardcoded dispute/deploy dispute contract | 5,787,348 |
| 1 GiB before: normal `hCircuit` proof verification, depth 26 | 198,585 |
| 1 GiB after: hardcoded AES gate hash | 32,390 |
| 1 GiB after: hardcoded SHA chain gate hash | 29,639 |
| 1 GiB after: hardcoded final comparison gate hash | 32,103 |
| 1 GiB best proof-only saving | 168,946 |
| 1 GiB worst proof-only saving | 166,195 |

For a 900 MiB-equivalent circuit, the hardcoded SHA256 path saves about 160k gas on the `hCircuit` membership check alone. If we also charge the one-time 81,909 gas configuration cost and the measured 8,052 gas hardcoded dispute deployment overhead, the first dispute is still about 69k to 73k gas cheaper in this isolated large-file scenario.

For a 1 GiB-equivalent circuit, the hardcoded SHA256 path saves about 166k to 169k gas on the `hCircuit` membership check alone. After charging the one-time 81,897 gas configuration cost and the same 8,052 gas hardcoded dispute deployment overhead, the first dispute is still about 76k to 79k gas cheaper in this isolated large-file scenario.

## Off-Chain Execution Times

Measured with:

```bash
npx hardhat run scripts/measurePhase3ExecutionTimes.ts
```

The current normal V2 WASM pipeline materializes the circuit and the evaluated circuit. This is useful for the existing implementation, but it is not the target data flow for a dedicated hardcoded SHA256 circuit.

| Size | Blocks | Gates | Precontract V2 | Evaluate V2 | One `compute_proofs_v2` | `pi_1` items | Peak RSS |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 1 MiB | 16,384 | 32,773 | 138.279 ms | 94.195 ms | 159.071 ms | 16 | 170.7 MiB |
| 16 MiB | 262,144 | 524,293 | 1,473.719 ms | 2,219.128 ms | 4,000.768 ms | 20 | 656.3 MiB |
| 64 MiB | 1,048,576 | 2,097,157 | 5,280.358 ms | 7,449.804 ms | 102,660.501 ms | 22 | 2,109.3 MiB |

For the hardcoded SHA256 direction, the expensive normal-circuit materialization is avoided. As a size-only reference, streaming SHA256 over 900 MiB took 782.309 ms, i.e. about 1,150.441 MiB/s, with constant memory. The explicit 1 GiB run took 846.887 ms for SHA256 only, and 2,159.937 ms for a streaming AES-CTR plus SHA256 pass.

| Hardcoded metadata benchmark | Size | Time | Throughput |
| --- | ---: | ---: | ---: |
| streaming SHA256 | 900 MiB | 782.309 ms | 1,150.441 MiB/s |
| streaming SHA256 | 1 GiB | 846.887 ms | 1,209.134 MiB/s |
| streaming AES-CTR + SHA256 | 1 GiB | 2,159.937 ms | 474.088 MiB/s |

The 64 MiB timing shows the current normal proof generation path is not suitable for very large files without further optimization. The hardcoded circuit directly addresses the largest on-chain proof component, and a production hardcoded pipeline should also avoid generating and storing the full `hCircuit` off-chain.

The current normal V2 full path was not executed at 1 GiB on this WSL VM because it is not memory-safe here. Based on the measured 64 MiB run, the 1 GiB normal path has about 5,120 MiB of raw data to materialize (`x`, `ct`, `hCircuit`, evaluated values) and an extrapolated RSS of about 33,748.8 MiB, while the VM reported about 6,555 MiB available. The hardcoded streaming path is therefore the only 1 GiB end-to-end path that is practical on this machine without redesigning the normal off-chain proof generation.

## Hardcoded SHA256 Interpretation

- `submitCommitment` is cheaper with the hardcoded circuit:
  - 13-byte file: saves 16,818 gas.
  - 16 KB file: saves 62,554 gas.
- The current implementation also pays:
  - about 81,897 gas to configure hardcoded metadata;
  - about 8,052 extra gas when deploying the dispute contract.
- Therefore, for a single small/medium dispute, hardcoded SHA256 is cheaper at the proof step but not yet cheaper end-to-end once configuration and deployment overhead are included.
- The 900 MiB and 1 GiB-equivalent benchmarks confirm the expected break-even behavior: once the normal proof reaches depth 25-26, the proof saving is large enough to beat the current one-time overhead.
- The variant becomes even more attractive for larger circuits, repeated measurements, or if hardcoded metadata is folded into deployment/precontract setup instead of configured by a separate transaction.

## Notes

- The optimistic matrix uses `MockDisputeDeployer` to isolate Phase 3 role/fusion behavior from full dispute bytecode cost.
- The hardcoded SHA256 measurements deploy a real dispute contract and validate real WASM-generated proofs.
- `DisputeSOXAccount` still exceeds the EVM mainnet code-size limit in this implementation; this does not affect Hardhat local measurements but must be addressed before mainnet-style deployment.
