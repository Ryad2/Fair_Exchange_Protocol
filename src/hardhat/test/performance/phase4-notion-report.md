# Phase 4 - Mesures experimentales SOX

## Objectif

Cette phase a pour objectif de produire des mesures experimentales claires sur les couts en gas, puis de comparer trois niveaux : la version initiale, la version monolithique actuelle issue de la Phase 3, et la version specialisee finale.

Ce rapport remplace les versions precedentes de la Phase 4. La correction principale est une clarification stricte des scopes de mesure. Dans les versions precedentes, certains tableaux melangeaient couts fixes, couts marginaux, dispute apres trigger, temps off-chain et gas on-chain. Cela rendait plusieurs totaux difficiles a verifier. Ici, chaque tableau est construit pour que les totaux soient recomposables depuis les colonnes visibles.

Dans ce rapport :

- **version initiale** designe l'implementation historique de Hana et les chiffres de reference associes;
- **version monolithique actuelle** designe le contrat courant issu de la Phase 3, mesure dans le meme scope que la version initiale, avant l'utilisation des clones et contrats specialises;
- **version specialisee finale** designe l'architecture finale avec factory, clones minimaux, contrats specialises et chemin hardcoded strict.

## 0. Regles de lecture des mesures

### 0.1 Mapping entre fonctions Solidity et protocole

| Nom dans l'implementation | Etape du protocole | Ce que la mesure inclut |
|---|---:|---|
| `sendPayment` | Step 2 | Paiement de `B` |
| `sendKey` | Step 3 | Envoi de la cle par `V` |
| `sendBuyerDisputeSponsorFee*` | Step 4/5 cote `SB` | Enregistrement/depot de `SB`; dans le cas `SB=B`, fusion logique avec le buyer |
| `triggerDispute` / `sendVendorDisputeSponsorFee*` | Step 6 | Enregistrement/depot de `SV` et deploiement de la dispute |
| `respondChallenge` | Step 7b | Publication on-chain d'un `hpre` par `B` |
| `giveOpinion` | Step 7c | Reponse on-chain de `V` au `hpre` |
| `submitCommitment` / `submitCommitmentLeft` | Step 8 | Verification on-chain de la gate contestee et des preuves |
| `completeDispute` / `cancelDispute` | Step 9 | Finalisation de la dispute |

Point important : dans plusieurs tests, la transaction appelee `triggerDispute` inclut aussi le dernier depot de sponsor de dispute et le deploiement du contrat de dispute. Ce n'est donc pas seulement une petite transition d'etat.

### 0.2 Scopes utilises dans le rapport

| Scope | Definition | A ne pas confondre avec |
|---|---|---|
| Cout fixe d'infrastructure | Deploiement unique de la factory et/ou des implementations reutilisables | Cout par echange |
| Cout marginal par echange | Cout d'un nouvel echange une fois l'infrastructure deployee | Cout du premier deploiement complet |
| Chemin optimiste | Deploiement/creation du contrat optimiste + Step 2 + Step 3 + completion si pas de dispute | Dispute |
| Dispute apres trigger | `respondChallenge` + `giveOpinion` + `submitCommitment` + `finalize` | `triggerDispute` |
| Total complet avec dispute | Chemin optimiste avant dispute + trigger + dispute apres trigger | Cout marginal optimiste seul |
| Temps off-chain | Temps CPU/local pour CLI, precontrat, generation `hpre`, preuves | Gas on-chain |

### 0.3 Sources reproductibles

| Source | Commande / test | Role dans le rapport |
|---|---|---|
| Reference initiale | chiffres de reference de l'implementation initiale | Baseline historique demandee par le professeur |
| `HanaComparisonCurrent.test.ts` | mesure le repo courant dans le meme scope que la reference initiale | Montre que le chemin monolithique actuel n'est pas le chemin optimise final |
| `SpecializedContractArchitecture.test.ts` | mesure bytecode, contrats directs, clones, hardcoded specialise | Mesure l'architecture finale |
| `Phase3ExhaustiveAndGas.test.ts` | mesure les quatre scenarios de dispute 16 KiB sur le chemin monolithique actuel | Compare normal, self-sponsored, hardcoded, self-sponsored+hardcoded dans un meme contrat |
| `SpecializedFinalSameScope.test.ts` | mesure la version specialisee finale aux memes tailles que 3.1 et 3.2 | Ferme la comparaison a taille et scope identiques |
| `NativeHardcodedSHA256FullDispute1GB.test.ts` | mesure une dispute hardcoded stricte 16 KiB et 1 GiB | Valide le chemin final strict avec `gateBytes=0x` et `proof1=[]` |

## 1. Changements depuis la version initiale

### 1.1 Point de depart

La version initiale etait fonctionnelle et couvrait deja :

- la generation du precontrat;
- le chiffrement AES-CTR;
- la description `desc = SHA256`;
- les engagements `h_ct`, `h_circuit` et `commitment`;
- la partie optimiste;
- la dispute;
- le chemin ERC-4337/UserOperation;
- un deploiement de contrat optimiste par echange;
- un deploiement de contrat de dispute lorsqu'une dispute est declenchee.

Sa limite principale etait le cout marginal : un echange payait un deploiement complet de contrat, meme lorsque le cas concret etait connu a l'avance.

### 1.2 Reorientation apres les retours du professeur

Les retours du professeur ont conduit a recentrer l'implementation sur les cas qui changent reellement le cout :

| Point protocolaire | Decision d'implementation |
|---|---|
| `no_S_deposit` | Mode explicite sans depot initial de `S` dans la partie optimiste |
| `S=B` | Cas determine au precontrat, fusion logique de Step 1+2 |
| `S=V` | Cas determine au precontrat |
| `SB=B` | Cas determine apres Step 4, fusion logique de Step 4+5 |
| `SV=V` | Cas determine apres Step 4 |
| `desc = SHA256` hardcoded | Circuit determine par `len(x)`, suppression de `h_circuit/pi_1` dans Step 8 |

La premiere implementation de Phase 3 avait ajoute beaucoup de logique dans un contrat monolithique. Elle validait les chemins fonctionnels, mais elle augmentait le bytecode et le gas. Cette piste a donc ete abandonnee comme architecture finale.

### 1.3 Passage concret de la version monolithique a la version specialisee finale

La transition entre la fin de Phase 3 et la version specialisee finale n'est pas seulement une nouvelle mesure de gas. C'est une restructuration de l'implementation pour retirer du contrat les choix qui peuvent etre faits avant le deploiement.

| Element fin Phase 3 monolithique | Changement implemente en Phase 4 | Effet recherche |
|---|---|---|
| Un contrat optimiste monolithique contenait plusieurs branches de modes | Separation en contrats specialises et clones minimaux | Moins de bytecode et cout marginal reduit par echange |
| Les cas `no_S_deposit`, `S=B` et `S=V` etaient geres comme variantes internes | Creation de chemins optimistes separes par mode | Le mode est fixe au precontrat au lieu d'etre porte par un contrat couteau suisse |
| La logique de dispute restait mesuree principalement dans le chemin monolithique | Ajout de chemins de dispute specialises : normal, self-sponsored, hardcoded SHA256 | Comparaison propre entre nombre d'iterations, verification de gate et cout de trigger |
| Le cas hardcoded SHA256 etait d'abord une optimisation locale faible | Creation d'un chemin strict avec `gateBytes=0x`, `proof1=[]` et reconstruction on-chain de la gate | Le contrat ne verifie plus `pi_1`; il reconstruit lui-meme la structure SHA256 attendue |
| Les mesures melangeaient parfois cout fixe, cout marginal et dispute | Separation explicite des scopes : infrastructure, marginal par echange, dispute apres trigger, total complet | Les chiffres deviennent recomposables et comparables a la version initiale |
| Le chemin gros fichier dependait fortement du WASM/browser | Validation du chemin natif CLI pour 1 GiB et dispute hardcoded stricte | Les grandes tailles deviennent mesurables sans bloquer sur la memoire WASM |

En resume, la version specialisee finale conserve la logique fonctionnelle validee en Phase 3, mais elle remplace l'approche monolithique par une architecture specialisee. Le but n'est pas d'ajouter plus de cas dans un seul contrat, mais de deployer le minimum necessaire pour le cas choisi.

### 1.4 Architecture finale

L'architecture actuelle separe les modes au lieu de garder un contrat couteau suisse.

| Composant | Role |
|---|---|
| Frontend/backend | Determine le mode au precontrat et prepare les arguments |
| `SOXFactory` | Cree le bon clone optimiste |
| `OptimisticSOXClone*` | Contrats minimaux par mode optimiste |
| `OptimisticSOXAccountHardcodedSHA256` | Contrat optimiste direct pour `desc = SHA256` hardcoded |
| `DisputeSOXAccountNormal` | Dispute normale |
| `DisputeSOXAccountSelfSponsored` | Dispute avec `SB=B` et `SV=V` |
| `DisputeSOXAccountHardcodedSHA256` | Dispute hardcoded stricte |
| `HardcodedSha256CircuitLib` | Reconstruction on-chain de la gate attendue sans `pi_1` |

## 2. Partie optimiste

### 2.1 Reference initiale

Ces chiffres sont le scope historique cite pour la partie optimiste complete.

| Mesure initiale | Gas |
|---|---:|
| Deploiement `OptimisticSOXAccount` | `2,077,362` |
| Execution optimiste | `222,839` |
| Total optimiste initial | `2,300,201` |

Formule :

```text
2,077,362 + 222,839 = 2,300,201 gas
```

### 2.2 Version monolithique actuelle mesuree dans le meme scope

Ce tableau repond a la question : que se passe-t-il si l'on mesure le contrat monolithique actuel du repo, sans utiliser l'architecture finale par clones ?

| Mesure meme scope | Version initiale | Version monolithique actuelle | Ecart |
|---|---:|---:|---:|
| Deploiement optimistic | `2,077,362` | `2,813,862` | `+736,500` (`+35.45%`) |
| Execution optimiste | `222,839` | `232,920` | `+10,081` (`+4.52%`) |
| Total optimiste | `2,300,201` | `3,046,782` | `+746,581` (`+32.46%`) |

Conclusion : le chemin monolithique actuel n'est pas l'optimisation finale. Il est plus cher que la reference initiale. C'est precisement pour cette raison que l'architecture finale a ete deplacee vers des contrats specialises et des clones minimaux.

### 2.3 Couts fixes de l'architecture clone

Ces couts sont payes une fois pour deployer l'infrastructure reutilisable. Ils ne sont pas inclus dans le cout marginal par echange.

| Infrastructure reutilisable | Gas |
|---|---:|
| `SOXFactory` seule | `561,126` |
| Implementation `OptimisticSOXCloneNormal` | `1,492,453` |
| Implementation `OptimisticSOXCloneNoSDeposit` | `1,482,093` |
| Implementation `OptimisticSOXCloneSponsorIsBuyer` | `1,529,267` |
| Implementation `OptimisticSOXCloneSponsorIsVendor` | `1,519,062` |
| Total infrastructure optimiste clone | `6,584,001` |

Formule :

```text
561,126 + 1,492,453 + 1,482,093 + 1,529,267 + 1,519,062
= 6,584,001 gas
```

Lecture : cette infrastructure doit etre amortie sur plusieurs echanges. Les chiffres de la section suivante sont les couts marginaux une fois cette infrastructure deployee.

### 2.4 Couts marginaux par echange avec clones

| Mode actuel | Creation clone | Payment | Key | Complete | Total marginal | Gain vs total initial `2,300,201` |
|---|---:|---:|---:|---:|---:|---:|
| `no_S_deposit` | `299,694` | `82,272` | `61,363` | `57,391` | `500,720` | `-1,799,481` (`-78.23%`) |
| `S=B` | `393,412` | `0` | `61,363` | `61,574` | `516,349` | `-1,783,852` (`-77.55%`) |
| `S=V` | `328,926` | `104,446` | `61,363` | `61,574` | `556,309` | `-1,743,892` (`-75.81%`) |

Formules :

```text
no_S_deposit: 299,694 + 82,272 + 61,363 + 57,391 = 500,720
S=B:          393,412 + 0      + 61,363 + 61,574 = 516,349
S=V:          328,926 + 104,446 + 61,363 + 61,574 = 556,309
```

Conclusion : les gains de `500k-556k gas` sont des gains marginaux par echange. Ils ne doivent pas etre presentes comme le cout du premier deploiement complet avec toute l'infrastructure.

### 2.5 Contrats directs specialises sans clones

Ces chiffres sont moins bons que les clones, mais ils montrent que la separation des contrats reduit deja le cout meme sans proxy minimal.

| Mode direct specialise | Deploy direct | Payment | Key | Complete | Total direct | Gain vs total initial `2,300,201` |
|---|---:|---:|---:|---:|---:|---:|
| `no_S_deposit` direct | `1,531,226` | `79,606` | `58,694` | `54,725` | `1,724,251` | `-575,950` (`-25.04%`) |
| `S=B` direct | `1,633,698` | `0` | `58,694` | `58,908` | `1,751,300` | `-548,901` (`-23.86%`) |
| `S=V` direct | `1,567,907` | `101,780` | `58,694` | `58,908` | `1,787,289` | `-512,912` (`-22.30%`) |

Les clones sont donc l'architecture marginale la plus interessante.

## 3. Partie dispute monolithique actuelle

### 3.1 Reference initiale et version monolithique actuelle

Ces mesures reprennent le meme scope que la reference initiale sur un fichier de `4 MiB`.

| Mesure dispute | Version initiale | Version monolithique actuelle | Ecart |
|---|---:|---:|---:|
| Deploiement `DisputeSOXAccount` | `4,651,201` | `5,779,296` | `+1,128,095` (`+24.25%`) |
| Exchange + dispute triggering | `4,977,003` | `6,058,245` | `+1,081,242` (`+21.72%`) |
| Optimistic deploy + dispute init total | `7,054,365` | `8,872,119` | `+1,817,754` (`+25.77%`) |
| One challenge round average | `82,624` | `103,282` | `+20,658` (`+25.00%`) |
| `submitCommitment`, gate SHA256 4 MiB | `320,000` | `379,686` | `+59,686` (`+18.65%`) |

Conclusion : comme pour la partie optimiste, le chemin monolithique actuel n'est pas le chemin optimise final. Il sert surtout de point de comparaison de meme scope avec la version initiale.

### 3.2 Diagnostic monolithique actuel : quatre scenarios de dispute 16 KiB

Cette table ne mesure ni la version initiale, ni les clones optimistes, ni le chemin hardcoded strict final. Elle mesure le contrat monolithique actuel issu de la Phase 3, avec le meme contrat `OptimisticSOXAccount` et le meme `DisputeDeployer`, afin d'isoler l'effet des variantes de dispute dans un environnement identique.

La taille `16 KiB` est volontaire : elle permet d'executer une dispute complete avec vraies preuves jusqu'a `End` pour les quatre cas retenus, de maniere rapide et reproductible. Cette table sert donc a comparer les variantes entre elles, pas a comparer directement la version initiale et la version finale.

Le chemin specialise final est mesure a scope comparable en section 3.5. Le chemin hardcoded strict end-to-end avec `gateBytes=0x` et `proof1=[]` est ensuite mesure plus largement en section 5 sur `16 KiB` et `1 GiB`.

| Cas dispute 16 KiB | Configure | SB step | Trigger dispute | Respond challenge | Give opinion | Submit commitment | Finalize | Total complet | Iterations `Step 7+8` |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| normal, sponsors externes | `0` | `115,588` | `5,779,296` | `730,818` | `765,456` | `877,792` | `76,462` | `8,345,412` | `2` |
| self-sponsored `SB=B/SV=V` | `0` | `106,954` | `5,781,134` | `365,409` | `382,728` | `455,753` | `73,962` | `7,165,940` | `1` |
| hardcoded SHA256 | `81,897` | `115,565` | `5,787,348` | `730,818` | `765,456` | `752,660` | `76,462` | `8,310,206` | `2` |
| self-sponsored + hardcoded SHA256 | `81,897` | `106,954` | `5,789,186` | `365,409` | `382,728` | `393,199` | `73,962` | `7,193,335` | `1` |

Verification des totaux :

```text
normal:
0 + 115,588 + 5,779,296 + 730,818 + 765,456 + 877,792 + 76,462
= 8,345,412

self-sponsored:
0 + 106,954 + 5,781,134 + 365,409 + 382,728 + 455,753 + 73,962
= 7,165,940

hardcoded:
81,897 + 115,565 + 5,787,348 + 730,818 + 765,456 + 752,660 + 76,462
= 8,310,206

self-sponsored + hardcoded:
81,897 + 106,954 + 5,789,186 + 365,409 + 382,728 + 393,199 + 73,962
= 7,193,335
```

### 3.3 Lecture correcte du self-sponsoring

Le self-sponsoring reduit bien le nombre d'iterations `Step 7+8`. Il ne divise pas le total complet par deux parce que `triggerDispute` est un cout fixe dominant d'environ `5.79M gas`.

| Comparaison | Partie variable apres trigger | Ecart |
|---|---:|---:|
| normal, sponsors externes | `2,450,528` | reference |
| self-sponsored `SB=B/SV=V` | `1,277,852` | `-1,172,676` (`-47.85%`) |
| hardcoded SHA256 | `2,325,396` | `-125,132` (`-5.11%`) |
| self-sponsored + hardcoded SHA256 | `1,215,298` | `-1,235,230` (`-50.41%`) |

Formule importante :

```text
hardcoded externe, apres trigger:
730,818 + 765,456 + 752,660 + 76,462 = 2,325,396

self-sponsored + hardcoded, apres trigger:
365,409 + 382,728 + 393,199 + 73,962 = 1,215,298

gain:
1,215,298 - 2,325,396 = -1,110,098 gas (-47.74%)
```

Conclusion : l'effet attendu existe bien. La confusion precedente venait du fait que le tableau masquait `configure` et `SB step`, ce qui rendait le total non recomposable.

### 3.4 Meme scope `4 MiB` avec la version specialisee finale

Cette table reprend le meme scope que 3.1, mais remplace le contrat monolithique par le chemin specialise final normal : `SOXFactory` + clone normal + `DisputeSOXAccountNormal`. Les couts fixes d'infrastructure de la factory et des implementations ne sont pas inclus ici; on mesure le cout marginal par echange, comme dans la section 2.4.

| Mesure dispute `4 MiB` | Version initiale | Monolithique actuelle | Specialisee finale | Lecture |
|---|---:|---:|---:|---|
| Creation/deploiement optimiste | `2,077,362` | `2,813,862` | `348,946` | clone normal marginal |
| Deploiement dispute / trigger | `4,651,201` | `5,779,296` | `4,862,324` | `-15.87%` vs monolithique, `+4.54%` vs initiale |
| Exchange + dispute triggering | `4,977,003` | `6,058,245` | `5,146,215` | `-15.05%` vs monolithique, `+3.40%` vs initiale |
| Optimistic deploy + dispute init total | `7,054,365` | `8,872,119` | `5,495,161` | `-38.06%` vs monolithique, `-22.10%` vs initiale |
| One challenge round average | `82,624` | `103,282` | `103,128` | pratiquement identique au monolithique |
| `submitCommitment`, gate SHA256 `4 MiB` | `320,000` | `379,686` | `382,181` | pas optimise dans le chemin generique |

Formule principale :

```text
specialisee finale, optimistic deploy + dispute init total:
348,946 + 5,146,215 = 5,495,161 gas

gain vs monolithique actuelle:
5,495,161 - 8,872,119 = -3,376,958 gas (-38.06%)

gain vs version initiale:
5,495,161 - 7,054,365 = -1,559,204 gas (-22.10%)
```

Conclusion : la version specialisee finale est bien meilleure sur le cout global de mise en dispute grace au clone. En revanche, le cout local d'un round et d'un `submitCommitment` generique reste proche du monolithique, car l'optimisation principale porte ici sur l'architecture de deploiement, pas encore sur le verificateur generique Step 8.

### 3.5 Meme scope `16 KiB` avec la version specialisee finale

Cette table reprend le meme scope que 3.2 : elle exclut la creation du contrat optimiste, le paiement et l'envoi de cle, pour comparer uniquement la dispute a partir de `SB step`. Cela donne une comparaison directe avec le diagnostic monolithique `16 KiB`.

| Cas dispute `16 KiB` | Monolithique actuelle | Specialisee finale meme scope | Gain |
|---|---:|---:|---:|
| normal, sponsors externes | `8,345,412` | `7,432,623` | `-912,789` (`-10.94%`) |
| self-sponsored `SB=B/SV=V` | `7,165,940` | `5,946,433` | `-1,219,507` (`-17.02%`) |
| hardcoded SHA256 | `8,310,206` | `5,195,034` | `-3,115,172` (`-37.49%`) |
| self-sponsored + hardcoded SHA256 | `7,193,335` | `4,042,185` | `-3,151,150` (`-43.81%`) |

Details comptables de la version specialisee finale :

| Cas dispute `16 KiB` specialise | SB step | Trigger dispute | Respond challenge | Give opinion | Submit commitment | Finalize | Total comparable |
|---|---:|---:|---:|---:|---:|---:|---:|
| normal, sponsors externes | `118,094` | `4,862,324` | `729,630` | `763,872` | `880,026` | `78,677` | `7,432,623` |
| self-sponsored `SB=B/SV=V` | `109,415` | `4,593,958` | `364,815` | `381,986` | `420,060` | `76,199` | `5,946,433` |
| hardcoded SHA256 | `115,600` | `2,719,333` | `729,630` | `763,872` | `790,225` | `76,374` | `5,195,034` |
| self-sponsored + hardcoded SHA256 | `106,954` | `2,721,171` | `364,815` | `381,936` | `393,435` | `73,874` | `4,042,185` |

Verification des totaux :

```text
normal specialise:
118,094 + 4,862,324 + 729,630 + 763,872 + 880,026 + 78,677
= 7,432,623

self-sponsored specialise:
109,415 + 4,593,958 + 364,815 + 381,986 + 420,060 + 76,199
= 5,946,433

hardcoded specialise:
115,600 + 2,719,333 + 729,630 + 763,872 + 790,225 + 76,374
= 5,195,034

self-sponsored + hardcoded specialise:
106,954 + 2,721,171 + 364,815 + 381,936 + 393,435 + 73,874
= 4,042,185
```

Pour transparence, le meme test a aussi mesure le scope plus large incluant creation du contrat optimiste, paiement et cle :

| Cas specialise `16 KiB` | Creation compte | Payment | Key | Total large |
|---|---:|---:|---:|---:|
| normal, sponsors externes | `348,946` | `104,446` | `61,363` | `7,947,378` |
| self-sponsored `SB=B/SV=V` | `348,946` | `104,446` | `61,363` | `6,461,188` |
| hardcoded SHA256 | `2,668,276` | `104,441` | `58,908` | `8,026,659` |
| self-sponsored + hardcoded SHA256 | `2,668,264` | `104,441` | `58,908` | `6,873,798` |

Conclusion : a taille et scope identiques, la version specialisee finale reduit bien les quatre scenarios. Le gain est modere pour le cas normal, mais devient tres important quand le chemin hardcoded evite le deployer monolithique et la configuration separee.

## 4. Hardcoded `desc = SHA256`

### 4.1 Moment de determination

Le cas hardcoded `desc = SHA256` est determine au moment du precontrat/deploiement du contrat optimiste hardcoded. Il n'est pas choisi pendant la dispute.

| Donnee | Statut |
|---|---|
| `hardcodedSha256Circuit` | fixe a `true` |
| `descriptionHash` | immutable |
| `plaintextLength` | immutable |
| `ciphertextIv` | immutable |
| `numBlocks` | verifie contre `plaintextLength` |
| `numGates` | verifie contre `plaintextLength` |

### 4.2 Ce que le smart contract determine dans Step 8

Dans le chemin hardcoded strict, le test appelle `submitCommitmentLeft` avec :

| Parametre | Valeur |
|---|---|
| `_gateBytes` | `0x` |
| `_proof1` | `[]` |

Le contrat reconstruit lui-meme la gate `g_i` avec `HardcodedSha256CircuitLib`. Il utilise `i`, `len(x)`, `numBlocks`, `descriptionHash` et `ciphertextIv`. `V` ne fournit donc plus la description de la gate ni la preuve `pi_1`.

`V` fournit encore les valeurs temoins necessaires a l'evaluation de la gate. Ces valeurs sont verifiees contre `h_ct` ou `hpre` via preuves Merkle. Elles ne remplacent pas la description du circuit.

### 4.3 Taille bytecode apres specialisation

| Contrat / librairie | Bytecode deploye | Statut mainnet |
|---|---:|---|
| `OptimisticSOXAccountHardcodedSHA256` | `10,713 bytes` | sous `24,576` |
| `DisputeSOXAccountHardcodedSHA256` | `11,194 bytes` | sous `24,576` |
| `DisputeDeployerHardcodedSHA256` | `13,644 bytes` | sous `24,576` |
| `HardcodedSha256CircuitLib` | `16,429 bytes` | sous `24,576` |

### 4.4 Effet local sur `submitCommitment`

Cette table mesure uniquement Step 8, pas toute la dispute.

| Taille | Normal `submitCommitment` | Hardcoded `submitCommitment` | `pi_1` normal | `pi_1` hardcoded | Gain local |
|---|---:|---:|---:|---:|---:|
| `13 bytes` | `251,444` | `234,626` | `3` items | `0` item | `-16,818` |
| `16 KiB` | `463,532` | `400,990` | `10` items | `0` item | `-62,542` |

Conclusion : le hardcoded supprime bien la preuve `pi_1`, mais le gain local est partiellement masque dans une dispute complete par les couts fixes et par les autres verifications de Step 8.

### 4.5 Effet sur grands circuits equivalents

Ici, on isole la verification d'appartenance a `h_circuit`, qui est la partie que le hardcoded supprime.

| Taille equivalente | Gates | Profondeur | Verification normale `h_circuit/pi_1` | Verification hardcoded | Gain |
|---|---:|---:|---:|---:|---:|
| `900 MiB` | `29,491,205` | `25` | `192,267` | `29,639` a `32,390` | `159,877` a `162,628` |
| `1 GiB` | `33,554,437` | `26` | `198,585` | `29,639` a `32,390` | `166,195` a `168,946` |

Conclusion : le hardcoded est surtout pertinent pour les grands circuits, parce que la preuve `h_circuit/pi_1` grandit avec la profondeur Merkle.

### 4.6 Chemin hardcoded specialise : deploy + trigger

Ce benchmark compare l'ancien chemin hardcoded monolithique intermediaire et le chemin hardcoded specialise. Ce n'est pas la reference initiale; c'est une comparaison architecturale interne.

| Mesure | Monolithique intermediaire | Hardcoded specialise | Gain |
|---|---:|---:|---:|
| Deploiement optimistic | `2,793,374` | `2,647,776` | `-145,598` |
| Configuration hardcoded separee | `81,897` | `0` | `-81,897` |
| Trigger dispute | `5,767,448` | `2,699,433` | `-3,068,015` |
| Total scope deploy + payment/key + SB + trigger | `8,921,668` | `5,626,146` | `-3,295,522` |

Lecture : le gros gain vient de la specialisation du deployer de dispute hardcoded, pas seulement de la suppression de `pi_1`.

## 5. Version specialisee finale hardcoded stricte end-to-end

### 5.1 Scenario mesure : specialise final, pas initial ni monolithique

Cette section mesure uniquement la **version specialisee finale hardcoded stricte**. Elle ne mesure ni la version initiale, ni la version monolithique actuelle. Le chemin utilise :

- `OptimisticSOXAccountHardcodedSHA256`;
- `DisputeSOXAccountHardcodedSHA256`;
- `DisputeDeployerHardcodedSHA256`;
- `HardcodedSha256CircuitLib`.

Le scenario exact est :

- mode `desc = SHA256` hardcoded;
- `SB=B` et `SV=V`;
- `gateBytes = 0x`;
- `proof1 = []`;
- le contrat reconstruit la gate;
- execution complete jusqu'a l'etat `End`.

### 5.2 Gas complet specialise final : 16 KiB et 1 GiB

Point de lecture important : le `Deploiement optimistic hardcoded` mesure ici un contrat direct `OptimisticSOXAccountHardcodedSHA256`, pas un clone minimal. Il est donc a comparer au chemin hardcoded monolithique/intermediaire direct, pas aux couts marginaux des clones optimistes de la section 2.4. Le hardcoded reduit surtout le cout de `triggerDispute`, du deployer de dispute et de `Step 8/pi_1`; il n'a pas pour effet principal de reduire le deploiement du contrat optimiste.

Tous les chiffres du tableau ci-dessous appartiennent donc au chemin **specialise final hardcoded strict**.

| Etape specialisee finale hardcoded stricte | 16 KiB | 1 GiB |
|---|---:|---:|
| Deploiement optimistic hardcoded | `2,668,072` | `2,668,072` |
| Paiement `B` | `104,441` | `104,441` |
| Envoi de cle `V` | `58,896` | `58,896` |
| Depot dispute `SB=B` | `106,954` | `106,954` |
| Total optimiste avant trigger | `2,938,363` | `2,938,363` |
| Trigger dispute / deploy dispute | `2,721,171` | `2,721,171` |
| Total optimistic + trigger | `5,659,534` | `5,659,534` |
| `respondChallenge` total | `608,190` | `1,581,282` |
| `giveOpinion` total | `421,615` | `1,095,903` |
| `submitCommitmentLeft`, sans `gateBytes/pi_1` | `5,449,005` | `5,577,730` |
| Finalize | `75,667` | `75,667` |
| Total dispute apres trigger | `6,554,477` | `8,330,582` |
| Total complet mesure | `12,214,011` | `13,990,116` |

Verification des totaux :

```text
16 KiB:
2,668,072 + 104,441 + 58,896 + 106,954 = 2,938,363
2,938,363 + 2,721,171 = 5,659,534
608,190 + 421,615 + 5,449,005 + 75,667 = 6,554,477
5,659,534 + 6,554,477 = 12,214,011

1 GiB:
2,668,072 + 104,441 + 58,896 + 106,954 = 2,938,363
2,938,363 + 2,721,171 = 5,659,534
1,581,282 + 1,095,903 + 5,577,730 + 75,667 = 8,330,582
5,659,534 + 8,330,582 = 13,990,116
```

### 5.3 Taille et nombre de rounds

| Taille fichier | `numBlocks` | `numGates` | Rounds `Step 7` | Gate finale |
|---|---:|---:|---:|---|
| `16 KiB` | `256` | `517` | `10` | `g_1`, AES |
| `1 GiB` | `16,777,216` | `33,554,437` | `26` | `g_1`, AES |

Le nombre de rounds suit la recherche binaire : environ `log2(numGates)`.

### 5.4 Temps off-chain du benchmark 1 GiB

Ces temps ne sont pas du gas. Ils mesurent le temps wall-clock local du benchmark. Ils ne correspondent pas tous au meme acteur : certains sont du travail de `V`, certains de `B`, et certains sont des temps agreges du script de mesure.

| Mesure 1 GiB | Temps | Acteur protocolaire principal | Lecture correcte |
|---|---:|---|---|
| Precontrat CLI natif | `48.70 s` | `V` | Preparation du precontrat : lecture de `x`, chiffrement, `ct`, engagements et metadonnees |
| Generation native dispute | `35.46 s` | Benchmark global | Temps du script natif qui prepare toutes les donnees de dispute mesurees; ce n'est pas le temps d'un seul acteur dans une execution interactive |
| Generation totale des `hpre` | `11.92 s` | `B` | Somme des calculs off-chain de `hpre_i` pour les 26 rounds de recherche binaire |
| Execution locale des transactions Hardhat | `0.56 s` | `B` + `V` + chaine locale | Temps wall-clock local pour envoyer les transactions dans Hardhat; ce n'est pas une mesure cryptographique par acteur |

Attribution par acteur :

| Acteur | Temps directement attribuable dans ce benchmark | Ce que cela couvre |
|---|---:|---|
| `V` | `48.70 s` | Preparation initiale du precontrat pour `1 GiB` |
| `B` | `11.92 s` | Calcul cumule des `hpre_i` publies dans `respondChallenge` |
| `V` pendant la dispute | non isole separement | `giveOpinion` et preparation des temoins/proofs Step 8 sont inclus dans la generation native dispute globale |
| `B + V + local chain` | `0.56 s` | Envoi local des transactions Hardhat, sans latence reseau reelle |

Le chiffre `35.46 s` est donc a lire comme un temps d'outil de benchmark : il regroupe la generation native des donnees necessaires a la dispute complete. Il contient notamment les calculs de `hpre`, mais il n'est pas directement attribuable a un seul participant du protocole.

Verification pre-dispute par `B` :

| Cas | Ce que `B` doit verifier avant d'accepter | Est-ce le meme travail que `V` ? |
|---|---|---|
| Circuit generique | Obtenir/inspecter le circuit, verifier que `desc` correspond a l'echange attendu, verifier les engagements publics comme `h_ct` et `h_circuit` | Non. `B` ne connait pas encore `x` en clair; il ne refait pas la generation du precontrat depuis le plaintext |
| Hardcoded `desc = SHA256` | Verifier les metadonnees publiques : `desc = SHA256`, `len(x)`, `numBlocks`, `numGates`, `IV`, `h_ct`, et le commitment | Non. Le circuit est derive de `len(x)`; `B` n'a pas besoin de recevoir ou reconstruire un gros `circuit_bytes` complet |
| Apres reception de la cle | Dechiffrer/verifier localement que le fichier obtenu satisfait `desc` | C'est le controle fonctionnel de `B`; s'il echoue, `B` peut declencher la dispute |

Ainsi, `B` verifie bien la coherence du precontrat avant la dispute. La difference est que, dans le mode hardcoded, la structure du circuit SHA256 est determinee par les metadonnees publiques et n'a pas besoin d'etre materialisee comme un circuit generique complet. C'est un des interets du mode hardcoded.

### 5.5 Detail des premiers `hpre`

| Round | Indice de challenge `i` | Temps off-chain `hpre_i` |
|---:|---:|---:|
| `0` | `16,777,219` | `6.04 s` |
| `1` | `8,388,610` | `2.46 s` |
| `2` | `4,194,305` | `1.33 s` |
| `3` | `2,097,153` | `0.71 s` |
| `4` | `1,048,577` | `0.39 s` |

La colonne `i` est l'indice de recherche binaire, pas un cout en gas. Dans ce scenario, on force la branche gauche et `V` disagree a chaque round. L'indice `i` est donc divise approximativement par deux a chaque round. Le temps off-chain de `hpre_i` diminue parce que l'implementation native recalcule le prefixe/accumulateur necessaire pour cet indice.

Le gas de `respondChallenge` et `giveOpinion` ne suit pas cette division par deux. Dans le benchmark 1 GiB, les totaux sont :

```text
respondChallenge: 1,581,282 gas pour 26 rounds, soit environ 60,819 gas/round
giveOpinion:      1,095,903 gas pour 26 rounds, soit environ 42,150 gas/round
```

## 6. Gros fichiers et off-chain

### 6.1 Pourquoi le CLI natif est utilise

Le WASM direct reste utile pour l'integration JavaScript et les fichiers petits/moyens. En revanche, il n'est pas le chemin fiable pour `1 GiB`, car la pression memoire devient trop forte dans le contexte JS/WASM.

Le CLI Rust natif est le chemin de benchmark pour les gros fichiers. Il a permis d'executer une dispute complete hardcoded `1 GiB` jusqu'a `End`.

### 6.2 Limite du WASM direct observee

| Taille WASM direct | Observation |
|---|---|
| `640 MiB` | passe apres patch memoire, environ `59.7 s` |
| `704 MiB` | passe apres patch memoire, environ `61.9 s` |
| `736 MiB` | echoue encore |
| `900 MiB / 1 GiB` | hors cible WASM direct |

Conclusion : le support `1 GiB` doit etre revendique pour le CLI natif, pas pour le chemin WASM direct.

## 7. Synthese comptable des resultats

| Axe | Resultat rigoureux |
|---|---|
| Chemin monolithique actuel | Plus cher que la version initiale si mesure dans le meme scope |
| Architecture finale optimiste | Cout marginal reduit a `500,720` - `556,309 gas` selon le mode |
| Specialisee finale `4 MiB` meme scope | `5,495,161 gas`, soit `-38.06%` vs monolithique et `-22.10%` vs initiale |
| Specialisee finale dispute `16 KiB` | Gain de `-10.94%` a `-43.81%` selon le cas, a scope identique avec 3.2 |
| `SOXFactory` | Cout fixe unique `561,126 gas` |
| Infrastructure clone complete | Cout fixe `6,584,001 gas` a amortir |
| Self-sponsoring dispute | Reduit bien `Step 7+8` de `2` iterations a `1` dans le benchmark 16 KiB |
| Hardcoded SHA256 local | Supprime `pi_1`, gain `62,542 gas` sur `submitCommitment` 16 KiB |
| Hardcoded SHA256 grands circuits | Economie `166,195` a `168,946 gas` sur la preuve `h_circuit/pi_1` a `1 GiB` |
| Hardcoded strict 1 GiB | Dispute complete jusqu'a `End`, `26` rounds, `13,990,116 gas` total avec optimistic + trigger + dispute |

## 8. Limites restantes

| Limite | Impact |
|---|---|
| `triggerDispute` reste tres couteux | Il domine les totals complets de dispute |
| `submitCommitment` generique reste proche du monolithique | La specialisation architecturale reduit surtout le deploiement/trigger, pas encore le verificateur generique |
| `submitCommitmentLeft` AES reste couteux | Le hardcoded supprime `pi_1`, mais AES + preuves `h_ct/hpre` restent dominants |
| WASM direct ne supporte pas `1 GiB` | Le backend/benchmark doit utiliser le CLI natif |
| Les couts de factory/implementations sont fixes | Les gains de clones sont des gains marginaux amortis, pas des couts premier deploiement |

## 9. Conclusion Phase 4

La Phase 4 peut etre consideree comme terminee, avec une interpretation corrigee des mesures.

Les resultats importants sont :

- la mesure monolithique brute du repo courant est plus chere que la version initiale, ce qui justifie l'abandon du contrat couteau suisse;
- les variantes optimistes specialisees avec clones reduisent le cout marginal par echange d'environ `75.8%` a `78.2%`;
- a meme scope `4 MiB`, la version specialisee finale reduit le cout optimistic deploy + dispute init de `8,872,119` a `5,495,161 gas`;
- a meme scope `16 KiB`, les quatre scenarios de dispute specialises sont tous moins chers que leurs equivalents monolithiques;
- le self-sponsoring reduit bien le nombre d'iterations de dispute;
- le hardcoded `desc = SHA256` supprime bien `pi_1` et devient surtout utile pour les grands circuits;
- le chemin hardcoded strict ne depend plus d'une gate fournie par `V`;
- une dispute hardcoded `1 GiB` a ete executee completement jusqu'a `End`.

La prochaine cible d'optimisation devrait etre `triggerDispute` et `submitCommitmentLeft` pour les gates AES, car ce sont maintenant les couts dominants.
