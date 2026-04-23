# Rapport detaille Phase 3 - Implementation des variantes principales SOX

## 1. Objectif de la Phase 3

La Phase 3 avait pour objectif de passer de l'analyse/specification des variantes de la Phase 2 a une implementation concrete dans les contrats, puis de produire les premieres mesures comparatives exploitables pour la reunion du 6 mai et la presentation du 9 mai.

Le travail vise principalement a repondre aux demandes suivantes:

- integrer les variantes principales de sponsoring dans les smart contracts;
- implementer le mode `no_S_deposit`;
- implementer le cas de circuit hard-code pour `desc = SHA256(x)`;
- adapter les tests de validation;
- produire les premieres mesures de gas et de temps d'execution;
- mesurer les cas pertinents pour comparer avec d'autres protocoles.

Les resultats de cette phase sont disponibles dans le depot GitHub:

```text
Repository: git@github.com:Ryad2/Fair_Exchange_Protocol.git
Branch: main
Derniers commits de mesure:
- 9347ad6: implementation Phase 3 principale
- 1cbb0d1: mesures complementaires pour comparaison professeur
- d2992dc: mesures 1 GiB off-chain/on-chain
```

## 2. Recentrage suite aux remarques du professeur

Apres l'envoi du rapport de Phase 2, le professeur a donne plusieurs remarques importantes. La Phase 3 a donc ete ajustee pour s'aligner avec ces commentaires.

### 2.1 Step 1 + Step 2

Dans le protocole:

- Step 1: `S` deploie le smart contract optimiste et effectue son depot.
- Step 2: `B` effectue son depot.

Le professeur a souligne qu'avoir deux etapes separees cree un risque pour `S`: `S` paie le deploiement/depot, mais `B` peut ne jamais poursuivre. Cela augmente aussi le gas et la latence. La fusion `Step 1+2` est donc interessante quand elle est possible.

Alignement dans l'implementation:

- le cas `S = B` est implemente comme une fusion directe;
- si le deployeur du contrat optimiste est le buyer, le constructeur recoit directement la valeur couvrant le depot sponsor et le depot buyer;
- l'etat initial saute `WaitPayment` et passe directement a `WaitKey`;
- il n'y a donc plus de transaction `sendPayment` separee dans ce cas.

Effet mesure:

| Scenario | Total gas | Delta vs normal |
| --- | ---: | ---: |
| normal, SB external, SV external | 3,189,656 | 0 |
| `S=B`, SB external, SV external | 3,149,737 | -39,919 |

Conclusion:

Le cas `S=B` donne une economie reelle sur le chemin optimiste, car la transaction de paiement du buyer disparait. L'economie nette est de 39,919 gas malgre un deploiement legerement plus cher.

### 2.2 Step 4 + Step 5

Dans le protocole:

- Step 4: `B` annonce qu'il n'est pas satisfait.
- Step 5: `SB` s'enregistre et fait un depot.

Le professeur a souligne que la fusion `Step 4+5` est triviale pour `SB = B`, mais que pour un sponsor externe il faut eviter qu'un `SB` externe puisse faire croire que `B` est mecontent sans que ce soit vrai. Il a suggere que le mecontentement puisse etre exprime par une valeur connue uniquement de `B`.

Alignement dans l'implementation:

- le cas `SB = B` est implemente par `sendBuyerSelfDisputeSponsorFee`;
- le cas `SB` externe ne peut plus appeler l'ancien chemin sans preuve;
- un nouveau chemin `sendBuyerDisputeSponsorFeeWithAuthorization` exige une autorisation signee par `B`;
- le hash d'autorisation inclut le chain id, l'adresse du contrat, le buyer, le sponsor externe et le commitment;
- ainsi, un sponsor externe ne peut pas declarer le mecontentement de `B` sans signature de `B`.

Effet mesure:

| Scenario | SB step gas |
| --- | ---: |
| normal, SB external | 115,577 - 115,600 selon run |
| `SB=B` | 106,954 |

Gain typique:

```text
115,577 - 106,954 = 8,623 gas
```

Conclusion:

Le cas `SB=B` donne une economie directe et supprime le besoin d'une signature externe. Pour `SB` externe, la fusion logique est securisee par une autorisation signee par `B`.

### 2.3 no_S_deposit

Le professeur a precise que `no_S_deposit` signifie que chacun paie son gas dans la partie optimiste. Il ne s'agit donc pas simplement d'un probleme d'alimentation de l'EntryPoint: toute la logique de sponsoring optimiste devient inutile.

Alignement dans l'implementation:

- si le contrat est deploie avec `msg.value == 0`, le mode `noSponsorDeposit` est active;
- le sponsor ne depose plus `SPONSOR_FEES`;
- `sendPayment` ne demande plus `agreedPrice + completionTip`, mais seulement `agreedPrice`;
- `sponsorTip` vaut zero;
- `depositToEntryPoint` est desactive dans ce mode;
- `validateUserOp` refuse de top-up automatiquement l'EntryPoint;
- `completeTransaction` ne tente pas de retirer de depot EntryPoint sponsorise.

Effet mesure:

| Scenario | Total gas | Delta vs normal |
| --- | ---: | ---: |
| normal, SB external, SV external | 3,189,656 | 0 |
| `no_S_deposit`, SB external, SV external | 3,147,455 | -42,201 |
| `no_S_deposit + SB=B` | 3,138,809 | -50,847 |

Conclusion:

`no_S_deposit` est le meilleur gain mesure sur la phase optimiste, surtout combine avec `SB=B`.

### 2.4 Cas a retenir

Le professeur a aussi corrige l'interpretation des cas:

- `normal`, `no_S_deposit`, `S=B`, `S=V` sont determines au moment du precontrat;
- `SB=B` et `SV=V` sont determines seulement apres Step 4;
- les cas `SB=B` et `SV=V` changent moins structurellement le protocole, mais restent utiles a mesurer;
- les cas les plus importants pour l'evaluation gas optimiste sont `normal`, `SB=B`, `no_S_deposit`, `no_S_deposit + SB=B`;
- pour la dispute, les cas interessants sont `normal`, self-sponsors, hardcoded, self-sponsors + hardcoded.

Alignement dans l'implementation:

- ajout d'un enum `PreContractVariant`;
- detection de `normal`, `no_S_deposit`, `S=B`, `S=V` au deploiement;
- `SB=B` et `SV=V` restent des choix runtime via fonctions dediees;
- les 12 cas conceptuels de Phase 2 sont toujours testes, mais les mesures mises en avant suivent le recentrage du professeur.

## 3. Resume de l'implementation

### 3.1 Contrat `OptimisticSOXAccount`

Principales modifications:

- ajout de `PreContractVariant`:
  - `Normal`;
  - `NoSDeposit`;
  - `SponsorIsBuyer`;
  - `SponsorIsVendor`.
- ajout de flags:
  - `noSponsorDeposit`;
  - `sponsorIsBuyer`;
  - `sponsorIsVendor`.
- detection automatique du mode au constructeur;
- fusion `Step 1+2` pour `S=B`;
- mode `no_S_deposit`;
- fonctions de self-sponsoring:
  - `sendBuyerSelfDisputeSponsorFee`;
  - `sendVendorSelfDisputeSponsorFee`.
- fonction securisee pour sponsor externe buyer:
  - `buyerUnhappyAuthorizationHash`;
  - `sendBuyerDisputeSponsorFeeWithAuthorization`.
- configuration du circuit hard-code:
  - `configureHardcodedSha256Circuit`;
  - `expectedHardcodedSha256NumBlocks`;
  - `expectedHardcodedSha256NumGates`.

### 3.2 Contrat `DisputeSOXAccount`

Principales modifications:

- propagation des metadata hardcoded depuis le contrat optimiste;
- stockage immutable:
  - `hardcodedSha256Circuit`;
  - `hardcodedDescriptionHash`;
  - `hardcodedPlaintextLength`;
  - `hardcodedCiphertextIv`.
- validation de coherence:
  - longueur plaintext;
  - nombre de blocs;
  - nombre de gates.
- ajout de derivation on-chain des gates attendues:
  - gates AES-CTR;
  - gates de padding SHA256;
  - chaine SHA256;
  - gate constante contenant `desc`;
  - gate de comparaison finale.
- suppression de la verification `pi_1` dans le cas hardcoded:
  - mode normal: verifier `gateHash` via `AccumulatorVerifier.verify(hCircuit, ..., pi_1)`;
  - mode hardcoded: verifier `gateHash == expectedHardcodedGateHash(gateNum)`.

### 3.3 Frontend / couche blockchain

Principales modifications:

- ajout de `PreContractVariantName`;
- ajout d'options Phase 3:
  - `preContractVariant`;
  - `noSponsorDeposit`;
  - metadata hardcoded;
  - depot EntryPoint optionnel.
- adaptation du deploiement:
  - valeur sponsor differente selon `normal`, `S=B`, `S=V`, `no_S_deposit`;
  - verification que le signataire correspond au role du sponsor pour `S=B` et `S=V`.
- adaptation de `sendPayment`:
  - depot normal: `agreedPrice + completionTip`;
  - depot no_S_deposit: `agreedPrice`.
- adaptation du Step 4+5:
  - buyer self-sponsor;
  - sponsor externe avec autorisation signee.
- synchronisation des artefacts JSON des contrats.

## 4. Tests ajoutes ou adaptes

### 4.1 Nouveaux fichiers de tests

```text
src/hardhat/test/Phase3Variants.test.ts
src/hardhat/test/Phase3ExhaustiveAndGas.test.ts
src/hardhat/scripts/measurePhase3ExecutionTimes.ts
src/hardhat/test/performance/phase3-gas-report.md
src/hardhat/test/performance/phase3-notion-report.md
```

### 4.2 Tests fonctionnels Phase 3

Les tests couvrent:

- `no_S_deposit`;
- `S=B`;
- `S=V`;
- `SB=B`;
- `SV=V`;
- `SB` externe avec autorisation signee;
- metadata hardcoded SHA256 valide;
- metadata hardcoded SHA256 invalide;
- propagation des metadata hardcoded vers le contrat de dispute;
- refus de configurer hardcoded apres envoi de la cle;
- refus d'un deploiement `S=B` sous-finance;
- refus d'un sponsor externe `SB` sans autorisation de `B`;
- refus d'une autorisation signee par un attaquant.

### 4.3 Couverture des 12 cas Phase 2

Les 12 combinaisons conceptuelles `S/SB/SV` sont executees end-to-end sur le contrat optimiste:

| Precontract | SB | SV |
| --- | --- | --- |
| normal | externe | externe |
| normal | `SB=B` | externe |
| normal | externe | `SV=V` |
| normal | `SB=B` | `SV=V` |
| `S=B` | externe | externe |
| `S=B` | `SB=B` | externe |
| `S=B` | externe | `SV=V` |
| `S=B` | `SB=B` | `SV=V` |
| `S=V` | externe | externe |
| `S=V` | `SB=B` | externe |
| `S=V` | externe | `SV=V` |
| `S=V` | `SB=B` | `SV=V` |

Le mode `no_S_deposit` est teste avec les quatre combinaisons `SB/SV`:

| Mode | SB | SV |
| --- | --- | --- |
| `no_S_deposit` | externe | externe |
| `no_S_deposit` | `SB=B` | externe |
| `no_S_deposit` | externe | `SV=V` |
| `no_S_deposit` | `SB=B` | `SV=V` |

### 4.4 Commandes executees

Suite principale Phase 3:

```bash
docker run --rm -v "$PWD":/work -w /work/src/hardhat node:22 ./node_modules/.bin/hardhat test test/Phase3ExhaustiveAndGas.test.ts test/Phase3Variants.test.ts test/OptimisticSOXAccount.ts
```

Resultat:

```text
21 passing
```

Benchmark off-chain:

```bash
docker run --rm -v "$PWD":/work -w /work/src/hardhat node:22 ./node_modules/.bin/hardhat run scripts/measurePhase3ExecutionTimes.ts
```

Benchmark off-chain 1 GiB:

```bash
docker run --rm -v "$PWD":/work -w /work/src/hardhat \
  -e PHASE3_TIMING_SIZES_MB=none \
  -e PHASE3_STREAMING_SHA256_MB=1024 \
  -e PHASE3_STREAMING_HARDCODED_MB=1024 \
  -e PHASE3_NORMAL_PIPELINE_ESTIMATE_MB=1024 \
  node:22 ./node_modules/.bin/hardhat run scripts/measurePhase3ExecutionTimes.ts
```

## 5. Mesures de gas - phase optimiste

Les mesures ci-dessous incluent:

- deploiement du contrat optimiste;
- paiement buyer;
- envoi de cle vendor;
- etape `SB`;
- etape `SV`;
- configuration hardcoded quand applicable.

Baseline:

```text
normal, SB external, SV external = 3,189,656 gas
```

| Scenario | Deploy | Payment | Key | SB | SV | Configure | Total |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| normal, SB external, SV external | 2,790,122 | 104,441 | 58,908 | 115,577 | 120,608 | 0 | 3,189,656 |
| `S=B`, SB external, SV external | 2,854,621 | 0 | 58,908 | 115,600 | 120,608 | 0 | 3,149,737 |
| `S=V`, SB external, SV external | 2,790,364 | 104,441 | 58,908 | 115,600 | 120,608 | 0 | 3,189,921 |
| normal, `SB=B`, SV external | 2,790,122 | 104,441 | 58,908 | 106,954 | 120,608 | 0 | 3,181,033 |
| normal, SB external, `SV=V` | 2,790,110 | 104,441 | 58,908 | 115,588 | 122,446 | 0 | 3,191,493 |
| normal, `SB=B`, `SV=V` | 2,790,122 | 104,441 | 58,908 | 106,954 | 122,446 | 0 | 3,182,871 |
| `no_S_deposit`, SB external, SV external | 2,770,239 | 82,100 | 58,908 | 115,600 | 120,608 | 0 | 3,147,455 |
| `no_S_deposit`, `SB=B`, SV external | 2,770,239 | 82,100 | 58,908 | 106,954 | 120,608 | 0 | 3,138,809 |
| `S=B` + hardcoded SHA256 config | 2,854,621 | 0 | 58,908 | 115,565 | 120,608 | 79,982 | 3,229,684 |

### 5.1 Gains optimistes

| Scenario | Delta vs baseline | Interpretation |
| --- | ---: | --- |
| `S=B` | -39,919 | Fusion `Step 1+2`, disparition de `sendPayment`. |
| `S=V` | +265 | Quasi neutre en gas dans l'implementation actuelle. |
| `SB=B` | -8,623 | Fusion `Step 4+5`, pas de signature buyer externe. |
| `SV=V` | +1,837 | Leger surcout du wrapper self-sponsor. |
| `SB=B + SV=V` | -6,785 | Gain `SB=B` partiellement compense par `SV=V`. |
| `no_S_deposit` | -42,201 | Suppression depot sponsor et simplification paiement. |
| `no_S_deposit + SB=B` | -50,847 | Meilleur gain mesure sur la phase optimiste. |

Conclusion phase optimiste:

- le meilleur cas mesure est `no_S_deposit + SB=B`;
- `S=B` est aussi interessant car il reduit la latence et le risque de `S`;
- `S=V` est surtout une simplification de roles, pas encore une economie gas significative;
- `SV=V` seul n'est pas interessant economiquement dans l'etat actuel.

## 6. Mesures de gas - dispute normale vs hardcoded SHA256

Ces mesures utilisent:

- de vrais outputs WASM V2;
- `compute_precontract_values_v2`;
- `evaluate_circuit_v2_wasm`;
- `compute_proofs_v2`;
- un vrai `DisputeSOXAccount`.

| Scenario | Configure | SB step | Trigger dispute | submitCommitment | Total measured | `pi_1` items |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| normal `hCircuit`, 13 bytes | 0 | 115,577 | 5,779,296 | 251,444 | 6,146,317 | 3 |
| hardcoded SHA256, 13 bytes | 81,897 | 115,565 | 5,787,348 | 234,626 | 6,219,436 | 0 |
| normal `hCircuit`, 16 KB | 0 | 115,577 | 5,779,296 | 463,544 | 6,358,417 | 10 |
| hardcoded SHA256, 16 KB | 81,897 | 115,577 | 5,787,348 | 400,990 | 6,385,812 | 0 |

### 6.1 Interpretation hardcoded

Gain sur `submitCommitment`:

| Taille | Normal submitCommitment | Hardcoded submitCommitment | Gain |
| --- | ---: | ---: | ---: |
| 13 bytes | 251,444 | 234,626 | 16,818 |
| 16 KB | 463,544 | 400,990 | 62,554 |

Le circuit hardcoded supprime totalement la preuve `pi_1`:

| Taille | Normal `pi_1` items | Hardcoded `pi_1` items |
| --- | ---: | ---: |
| 13 bytes | 3 | 0 |
| 16 KB | 10 | 0 |

Mais l'implementation actuelle ajoute aussi:

```text
configuration metadata hardcoded ~= 81,897 gas
surcout deployment dispute hardcoded ~= 8,052 gas
```

Conclusion:

- pour petits/moyens fichiers, le hardcoded reduit bien `submitCommitment`, mais le cout fixe actuel annule encore le gain end-to-end;
- pour gros circuits, le gain sur `pi_1` devient suffisant pour depasser ce cout fixe;
- une optimisation future evidente serait d'integrer les metadata hardcoded directement dans le deploiement/precontrat au lieu d'une transaction separee.

## 7. Cas dispute demandes par le professeur

Le professeur demandait, pour la dispute, les cas:

- normal;
- self-sponsors;
- hardcoded;
- self-sponsors + hardcoded.

Mesure retenue sur fichier 16 KB:

| Scenario | Configure | SB step | Trigger dispute | submitCommitment | Total measured | `pi_1` items |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| normal, external `SB/SV` | 0 | 115,600 | 5,779,296 | 463,544 | 6,358,440 | 10 |
| self-sponsors `SB=B/SV=V` | 0 | 106,954 | 5,781,134 | 455,741 | 6,343,829 | 10 |
| hardcoded SHA256, external `SB/SV` | 81,897 | 115,577 | 5,787,348 | 400,990 | 6,385,812 | 0 |
| self-sponsors `SB=B/SV=V` + hardcoded SHA256 | 81,897 | 106,954 | 5,789,186 | 393,187 | 6,371,224 | 0 |

Gains:

```text
self-sponsors vs normal:
6,358,440 - 6,343,829 = 14,611 gas economises

hardcoded submitCommitment vs normal submitCommitment:
463,544 - 400,990 = 62,554 gas economises

self-sponsors + hardcoded submitCommitment vs normal submitCommitment:
463,544 - 393,187 = 70,357 gas economises
```

Conclusion:

- self-sponsors economise environ 14.6k gas sur ce chemin de dispute;
- hardcoded economise fortement sur `submitCommitment`;
- `self-sponsors + hardcoded` combine les deux effets;
- mais a 16 KB, le cout fixe hardcoded actuel reste trop important pour que le total end-to-end soit deja meilleur que normal.

## 8. Benchmarks gros fichiers - 900 MiB et 1 GiB

### 8.1 Pourquoi un benchmark equivalent on-chain

Le smart contract ne lit jamais directement un fichier de 900 MiB ou 1 GiB. Ce qui impacte le gas on-chain pour la partie hardcoded est principalement:

- `plaintextLength`;
- `numBlocks`;
- `numGates`;
- profondeur Merkle de la preuve `hCircuit`;
- cout de calcul du hash de gate hardcoded.

Donc, pour la mesure on-chain, il est plus juste et plus stable de simuler exactement les parametres du circuit large plutot que de generer un fichier enorme dans le test Solidity.

### 8.2 Parametres 900 MiB

```text
plaintext length = 943,718,400 bytes
numBlocks = 14,745,600
numGates = 29,491,205
proof depth = 25
```

| Measurement | Gas |
| --- | ---: |
| configure hardcoded metadata | 81,909 |
| trigger hardcoded dispute/deploy dispute | 5,787,348 |
| before: normal `hCircuit` proof verification | 192,267 |
| after: hardcoded AES gate hash | 32,390 |
| after: hardcoded SHA chain gate hash | 29,639 |
| after: hardcoded final comparison gate hash | 32,115 |
| best proof-only saving | 162,628 |
| worst proof-only saving | 159,877 |

Apres overhead:

```text
overhead = 81,909 + 8,052 = 89,961 gas

best net saving ~= 162,628 - 89,961 = 72,667 gas
worst net saving ~= 159,877 - 89,961 = 69,916 gas
```

Conclusion 900 MiB:

Le hardcoded devient end-to-end positif meme en comptant le cout fixe actuel.

### 8.3 Parametres 1 GiB

```text
plaintext length = 1,073,741,824 bytes
numBlocks = 16,777,216
numGates = 33,554,437
proof depth = 26
```

| Measurement | Gas |
| --- | ---: |
| configure hardcoded metadata | 81,897 |
| trigger hardcoded dispute/deploy dispute | 5,787,348 |
| before: normal `hCircuit` proof verification | 198,585 |
| after: hardcoded AES gate hash | 32,390 |
| after: hardcoded SHA chain gate hash | 29,639 |
| after: hardcoded final comparison gate hash | 32,103 |
| best proof-only saving | 168,946 |
| worst proof-only saving | 166,195 |

Apres overhead:

```text
overhead = 81,897 + 8,052 = 89,949 gas

best net saving ~= 168,946 - 89,949 = 78,997 gas
worst net saving ~= 166,195 - 89,949 = 76,246 gas
```

Conclusion 1 GiB:

Le circuit hardcoded est clairement rentable on-chain pour un circuit equivalent 1 GiB. Le gain net attendu pour une premiere dispute est environ 76k a 79k gas dans l'implementation actuelle.

## 9. Benchmarks off-chain

### 9.1 Pipeline normal V2 actuel

Le pipeline normal V2 materialise:

- le fichier plaintext `x`;
- le ciphertext `ct`;
- le circuit `hCircuit`;
- les valeurs evaluees;
- les preuves Merkle.

Mesures:

| Size | Blocks | Gates | Precontract V2 | Evaluate V2 | One `compute_proofs_v2` | `pi_1` items | Peak RSS |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 1 MiB | 16,384 | 32,773 | 138.279 ms | 94.195 ms | 159.071 ms | 16 | 170.7 MiB |
| 16 MiB | 262,144 | 524,293 | 1,473.719 ms | 2,219.128 ms | 4,000.768 ms | 20 | 656.3 MiB |
| 64 MiB | 1,048,576 | 2,097,157 | 5,280.358 ms | 7,449.804 ms | 102,660.501 ms | 22 | 2,109.3 MiB |

Observations:

- jusqu'a 16 MiB, le pipeline reste executable;
- a 64 MiB, une seule generation `compute_proofs_v2` prend deja environ 102.7 secondes;
- la memoire atteint environ 2.1 GiB RSS;
- la progression n'est donc pas lineairement confortable pour 1 GiB.

### 9.2 Hardcoded streaming

Le hardcoded SHA256 n'a pas besoin de materialiser `hCircuit` pour representer le circuit de `desc = SHA256(x)`. Il suffit de connaitre:

- la longueur du fichier;
- le hash de description;
- l'IV/counter AES-CTR;
- les regles deterministes de construction des gates.

Mesures streaming:

| Benchmark | Size | Time | Throughput |
| --- | ---: | ---: | ---: |
| streaming SHA256 | 900 MiB | 782.309 ms | 1,150.441 MiB/s |
| streaming SHA256 | 1 GiB | 846.887 ms | 1,209.134 MiB/s |
| streaming AES-CTR + SHA256 | 1 GiB | 2,159.937 ms | 474.088 MiB/s |

Conclusion:

Le chemin hardcoded streaming est compatible avec des fichiers de 1 GiB sur cette machine. Il est beaucoup plus adapte aux gros fichiers que le pipeline normal qui materialise tout le circuit.

### 9.3 Pourquoi le full normal 1 GiB n'a pas ete execute

Le chemin normal complet 1 GiB n'a pas ete execute volontairement, par garde-fou memoire.

Donnees disponibles:

```text
Memoire WSL disponible pendant la mesure: environ 6,555 MiB
Raw data estimee a materialiser pour 1 GiB normal: environ 5,120 MiB
RSS extrapolee depuis le run 64 MiB: environ 33,748.8 MiB
```

Raison:

Le pipeline normal V2 actuel ne stream pas les donnees: il garde de grosses structures en memoire. A 64 MiB, la RSS observee est deja 2,109.3 MiB. Une extrapolation vers 1 GiB donne environ 33.7 GiB de RSS, ce qui depasse largement la machine disponible.

Conclusion:

Le chemin hardcoded 1 GiB a ete teste en vrai cote off-chain streaming. Le chemin normal full 1 GiB doit etre considere comme non praticable dans l'implementation actuelle sans redesign du generateur de preuves/off-chain.

## 10. Synthese des resultats importants

### 10.1 Meilleurs gains optimistes

| Variante | Gain |
| --- | ---: |
| `S=B` | -39,919 gas |
| `SB=B` | -8,623 gas |
| `no_S_deposit` | -42,201 gas |
| `no_S_deposit + SB=B` | -50,847 gas |

Conclusion:

Pour la partie optimiste, le cas le plus interessant est `no_S_deposit + SB=B`.

### 10.2 Gains dispute

| Variante | Gain principal |
| --- | ---: |
| self-sponsors a 16 KB | -14,611 gas total measured |
| hardcoded `submitCommitment` a 16 KB | -62,554 gas |
| self-sponsors + hardcoded `submitCommitment` a 16 KB | -70,357 gas |
| hardcoded 900 MiB proof-only | -159,877 a -162,628 gas |
| hardcoded 1 GiB proof-only | -166,195 a -168,946 gas |

Conclusion:

Le hardcoded est surtout interessant pour les gros circuits. Pour les petits fichiers, le gain est visible sur `submitCommitment`, mais le cout fixe de configuration/deploiement est encore trop eleve.

### 10.3 Timings

| Pipeline | Taille | Temps |
| --- | ---: | ---: |
| normal V2 precontract | 64 MiB | 5.28 s |
| normal V2 evaluation | 64 MiB | 7.45 s |
| normal V2 one proof | 64 MiB | 102.66 s |
| streaming SHA256 | 1 GiB | 0.847 s |
| streaming AES-CTR + SHA256 | 1 GiB | 2.160 s |

Conclusion:

Le goulot d'etranglement actuel pour les gros fichiers est la generation de preuves normale/off-chain, pas le hash SHA256 streaming.

## 11. Limites connues

### 11.1 Taille du bytecode

`DisputeSOXAccount` depasse encore la limite de taille EVM mainnet dans cette implementation. Cela n'empeche pas les mesures Hardhat locales, mais c'est un point a traiter avant un deploiement mainnet-like.

Pistes:

- separer davantage les helpers;
- externaliser des librairies;
- reduire le code ERC-4337 inclus dans le dispute account;
- separer contrat normal et contrat hardcoded.

### 11.2 Hardcoded metadata configuree par transaction separee

Aujourd'hui, `configureHardcodedSha256Circuit` coute environ 81.9k gas. Ce cout penalise les petits fichiers.

Piste:

Integrer les metadata hardcoded directement au moment du deploiement/precontrat pour eviter une transaction separee.

### 11.3 Pipeline normal gros fichiers

Le pipeline normal V2 materialise trop de donnees pour 1 GiB. Cela confirme une remarque initiale du professeur sur la necessite de manipuler des `x` volumineux hors browser et avec une implementation plus adaptee.

Pistes:

- streaming du calcul;
- preuves incrementales;
- stockage disque temporaire;
- eviter de garder toutes les valeurs evaluees en memoire;
- generation de preuves ciblee sans materialiser tout `hCircuit`.

### 11.4 `S=V`

Le cas `S=V` est implemente et mesure, mais ne donne pas encore de gain gas significatif dans l'implementation actuelle.

Interpretation:

Le benefice de `S=V` est plutot une simplification potentielle de coordination et de sponsoring 4337. Pour obtenir un gain gas net, il faudrait probablement aller plus loin dans la fusion des etapes et la suppression de logique EntryPoint/bundler dans ce mode.

## 12. Conclusion Phase 3

La Phase 3 peut etre consideree comme fonctionnellement cloturee:

- les variantes principales sont implementees;
- les remarques du professeur sur `Step 1+2`, `Step 4+5`, `no_S_deposit` et les cas a retenir ont ete integrees;
- les 12 cas conceptuels de Phase 2 sont testes;
- les cas vraiment importants pour les mesures sont mis en avant;
- le circuit hardcoded `desc = SHA256` est implemente;
- la suppression de `pi_1` est effective dans le mode hardcoded;
- des mesures de gas optimiste, dispute, hardcoded, self-sponsor, 900 MiB et 1 GiB sont disponibles;
- les timings off-chain montrent clairement la difference entre pipeline normal et approche hardcoded streaming.

Message principal a retenir:

```text
Pour la phase optimiste, no_S_deposit + SB=B donne le meilleur gain mesure.
Pour la dispute, le circuit hardcoded SHA256 reduit fortement le cout de Step 8 en supprimant pi_1.
Pour petits fichiers, le cout fixe hardcoded actuel mange encore le gain end-to-end.
Pour gros fichiers, notamment 900 MiB et 1 GiB equivalents, le hardcoded devient clairement rentable on-chain.
Cote off-chain, le pipeline normal actuel ne passe pas raisonnablement a 1 GiB, tandis que le chemin hardcoded streaming passe en environ 2.16 s pour AES-CTR + SHA256.
```

La suite logique pour la Phase 4 serait donc:

- optimiser le cout fixe du hardcoded;
- integrer les metadata hardcoded des le deploiement;
- reduire la taille de `DisputeSOXAccount`;
- redesign le pipeline off-chain normal pour les gros fichiers;
- produire des mesures plus fines par type de gate si l'objectif devient l'optimisation Step 8 bas niveau AES/SHA.
