# Phase 4 - Mesures experimentales SOX

## Objectif

Cette phase cloture les mesures experimentales demandees pour les semaines 11 a 13. Le but n'est pas seulement de donner des chiffres de gas, mais de montrer clairement comment la version actuelle ameliore la version initiale du protocole implemente.

Dans ce rapport, la reference est toujours appelee **version initiale**. Elle correspond au depot historique execute localement dans les memes conditions de test. Les comparaisons ci-dessous ne reposent donc pas sur des chiffres repris d'un ancien rapport, mais sur une execution locale de la version initiale.

La version monolithique intermediaire, qui avait ete produite au debut de la Phase 3 pour valider rapidement les variantes, n'est plus utilisee comme reference de comparaison. Elle est mentionnee uniquement pour expliquer une decision d'architecture : ajouter toutes les variantes dans un seul contrat augmente le bytecode et ne permet pas de reduire le gas. Cette piste a donc ete abandonnee.

## 0. Clarifications apres le dernier feedback

Cette section repond explicitement aux ambiguites relevees dans le dernier retour.

### 0.1 Hardcoded `desc = SHA256` et moment de determination

Le mode hardcoded `desc = SHA256` est determine au moment du precontrat/deploiement du contrat optimiste hardcoded. Les donnees suivantes sont fixees dans `OptimisticSOXAccountHardcodedSHA256` :

| Donnee | Statut |
|---|---|
| `hardcodedSha256Circuit` | constante `true` |
| `descriptionHash` | immutable |
| `plaintextLength` | immutable |
| `ciphertextIv` | immutable |
| `numBlocks` | verifie contre `plaintextLength` |
| `numGates` | verifie contre `plaintextLength` et `numBlocks` |

Ainsi, le cas hardcoded n'est pas choisi pendant la dispute. Il est deja fixe avant paiement/cle/dispute.

### 0.2 Ce que le contrat determine dans `Step 8`

Apres patch, le contrat de dispute hardcoded surcharge `submitCommitment` et `submitCommitmentLeft`. En mode hardcoded, les parametres legacy `_gateBytes` et `_proof1` sont ignores. Le test end-to-end appelle maintenant `submitCommitmentLeft` avec :

| Parametre | Valeur dans le test hardcoded strict |
|---|---|
| `_gateBytes` | `0x` |
| `_proof1` | `[]` |

Le contrat reconstruit lui-meme la gate `g_i` avec `HardcodedSha256CircuitLib`, a partir de `i`, `|x|`, `numBlocks`, `descriptionHash` et `ciphertextIv`. Il n'utilise donc plus une gate fournie par `V`.

Precision importante : `V` fournit encore les valeurs temoins necessaires a l'evaluation locale de la gate contestee. Ces valeurs ne sont pas acceptees librement : le contrat verifie leur appartenance a `h_ct` ou a `hpre` via les preuves Merkle, puis recalcule le resultat de la gate on-chain. Autrement dit, le contrat determine la structure de la gate et les indices attendus; les valeurs sont des temoins authentifies, pas une description de circuit fournie par `V`.

### 0.3 Ce que mesurent les chiffres de gas

Les chiffres ci-dessous sont separes par scope pour eviter toute confusion.

| Nom du chiffre | Ce que cela mesure | Ce que cela ne mesure pas |
|---|---|---|
| Cout marginal optimiste par clone | creation du clone + appels optimistes utiles jusqu'a `Complete` | deploiement initial de la factory et des implementations |
| Deploiement optimistic hardcoded | deploiement d'un contrat optimiste hardcoded direct | pas le cout marginal clone |
| `triggerDispute` | transaction qui enregistre `SV`, transfere les depots et deploie la dispute | pas les rounds `respondChallenge/giveOpinion` |
| `respondChallenge` | transaction on-chain de `B` pour publier un `hpre` | pas le temps off-chain pour calculer ce `hpre` |
| `giveOpinion` | transaction on-chain de `V` pour accepter/refuser le `hpre` | pas un recalcul off-chain complet par `V` |
| `submitCommitment` / `submitCommitmentLeft` | une execution on-chain de `Step 8` | pas toute la dispute |
| Preuve `h_circuit / pi_1` | sous-composant de `Step 8` dans le circuit generique | pas le cout complet de `Step 8` |
| Gate hardcoded | reconstruction/verif de la gate attendue sans `pi_1` | pas l'evaluation AES/SHA complete ni les preuves `h_ct/hpre` |
| Precontrat CLI natif | generation off-chain du precontrat, chiffrement et engagements | pas les transactions on-chain |

### 0.4 Chiffres actuels importants apres patch strict

Taille bytecode specialisee :

| Contrat/librairie | Bytecode deploye |
|---|---:|
| `OptimisticSOXAccountHardcodedSHA256` | `10,713 bytes` |
| `DisputeSOXAccountHardcodedSHA256` | `11,194 bytes` |
| `DisputeDeployerHardcodedSHA256` | `13,644 bytes` |
| `HardcodedSha256CircuitLib` | `16,429 bytes` |

Tous ces elements hardcoded specialises sont donc sous la limite mainnet de `24,576 bytes`.

Mesure hardcoded specialisee contre ancienne version monolithique intermediaire :

| Mesure | Monolithique intermediaire | Hardcoded specialise actuel | Gain |
|---|---:|---:|---:|
| Runtime dispute hardcoded | `26,439 bytes` | `11,194 bytes` | `-15,245 bytes` |
| Trigger dispute hardcoded | `5,767,448 gas` | `2,699,433 gas` | `-3,068,015 gas` |
| Total deploy/trigger scope hardcoded | `8,921,668 gas` | `5,626,146 gas` | `-3,295,522 gas` |

Benchmark end-to-end hardcoded strict, `16 KiB`, avec `gateBytes = 0x` et `proof1 = []` :

| Mesure | Valeur |
|---|---:|
| `numBlocks` | `256` |
| `numGates` | `517` |
| rounds `Step 7` | `10` |
| precontrat CLI natif | `25.90 ms` |
| generation native dispute | `63.88 ms` |
| total `hpre` natif | `44.44 ms` |
| trigger dispute | `2,721,171 gas` |
| `respondChallenge` total | `608,190 gas` |
| `giveOpinion` total | `421,615 gas` |
| `submitCommitmentLeft` sans gate/proof1 | `5,448,993 gas` |
| finalize | `75,667 gas` |
| total dispute apres trigger | `6,554,465 gas` |
| total chemin optimistic + trigger + dispute | `12,213,999 gas` |

Benchmark end-to-end hardcoded strict, `1 GiB`, avec `gateBytes = 0x` et `proof1 = []` :

| Mesure | Valeur |
|---|---:|
| `numBlocks` | `16,777,216` |
| `numGates` | `33,554,437` |
| rounds `Step 7` | `26` |
| precontrat CLI natif | `42.79 s` |
| generation native dispute | `22.65 s` |
| total `hpre` natif | `11.03 s` |
| execution on-chain locale dispute | `0.43 s` |
| trigger dispute | `2,721,171 gas` |
| `respondChallenge` total | `1,581,282 gas` |
| `giveOpinion` total | `1,095,903 gas` |
| `submitCommitmentLeft` sans gate/proof1 | `5,577,706 gas` |
| finalize | `75,667 gas` |
| total dispute apres trigger | `8,330,558 gas` |
| total chemin optimistic + trigger + dispute | `13,990,092 gas` |

### 0.5 Lecture correcte du gain hardcoded

Le gain hardcoded ne doit pas etre lu comme une reduction automatique de tout `Step 8`. Le hardcoded supprime precisement la verification de `pi_1` contre `h_circuit`. Sur un circuit `1 GiB`, cette sous-partie vaut environ `198,585 gas` en mode generique, contre environ `29,639` a `32,390 gas` pour reconstruire/verifier la gate hardcoded. Le gain local sur ce sous-composant est donc environ `166k` a `169k gas`.

En revanche, `submitCommitmentLeft` complet contient aussi l'evaluation de la gate AES, la preuve `h_ct`, la verification `hpre`/`proof_ext` et la logique d'etat. C'est pour cela que le `submitCommitmentLeft` complet 1 GiB mesure `5,577,706 gas` : ce chiffre n'est pas seulement la suppression de `pi_1`, il couvre toute l'execution on-chain du `Step 8` final gauche.

## 1. Changements effectues depuis la version initiale

### 1.1 Point de depart : version initiale

La version initiale etait deja fonctionnelle. Elle couvrait :

- la generation du precontrat off-chain;
- le chiffrement AES-CTR;
- la description SHA256;
- le circuit V2;
- les engagements `h_ct`, `h_circuit` et commitment;
- le contrat optimiste;
- le contrat de dispute;
- le chemin ERC-4337 / UserOperation;
- le deploiement d'un contrat optimiste par echange;
- le deploiement d'un contrat de dispute lorsqu'une dispute est declenchee.

Sa limite principale etait architecturale : chaque echange payait un deploiement complet de contrat. Le cout marginal par echange etait donc eleve, meme lorsque le cas concret du protocole etait connu a l'avance.

### 1.2 Decisions prises apres les retours du professeur

Les retours recus ont conduit a recentrer l'implementation sur les cas qui changent vraiment le cout en gas.

Decisions retenues :

| Point protocolaire | Decision d'implementation |
|---|---|
| `Step 1 + Step 2` | fusion lorsque `S=B` |
| `Step 4 + Step 5` | fusion lorsque `SB=B`, avec autorisation buyer si `SB` est externe |
| `no_S_deposit` | mode explicite sans depot initial de `S` dans la partie optimiste |
| `S=B` et `S=V` | cas determines des le precontrat |
| `SB=B` et `SV=V` | cas determines apres `Step 4` |
| `desc = SHA256` hardcoded | suppression de la preuve generique `pi_1` liee a `h_circuit` dans `Step 8` |

### 1.3 Abandon de l'approche monolithique

La premiere implementation des variantes avait ete faite dans un contrat unique. Elle validait les chemins fonctionnels, mais elle faisait payer a chaque echange la logique de tous les modes. C'etait contraire a l'objectif principal du projet : reduire le gas.

Cette version intermediaire a donc servi a comprendre le probleme, mais elle n'est pas la version finale et elle n'est pas utilisee comme reference dans les tableaux comparatifs. La comparaison importante est :

**version initiale executee localement vs version actuelle specialisee.**

### 1.4 Architecture actuelle

La version actuelle transforme l'architecture en separant les modes.

Architecture actuelle :

- le frontend/backend determine le mode exact au moment du precontrat;
- `SOXFactory` cree le bon contrat par echange;
- les variantes optimistes utilisent des contrats specialises;
- les modes frequents utilisent des clones minimaux;
- les deployers de dispute sont separes entre normal, self-sponsored et hardcoded SHA256;
- le mode hardcoded SHA256 utilise un verifier specialise sans preuve `pi_1` pour `h_circuit`.

Contrats optimistes specialises :

| Contrat | Cas couvert |
|---|---|
| `OptimisticSOXAccountNormal` | cas normal |
| `OptimisticSOXAccountNoSDeposit` | mode `no_S_deposit` |
| `OptimisticSOXAccountSponsorIsBuyer` | mode `S=B` |
| `OptimisticSOXAccountSponsorIsVendor` | mode `S=V` |
| `OptimisticSOXAccountHardcodedSHA256` | circuit `desc = SHA256` hardcoded |
| `OptimisticSOXClone*` | cout marginal reduit par clone minimal |

Contrats de dispute specialises :

| Contrat | Cas couvert |
|---|---|
| `DisputeSOXAccountNormal` | dispute normale |
| `DisputeSOXAccountSelfSponsored` | `SB=B` et `SV=V` |
| `DisputeSOXAccountHardcodedSHA256` | dispute avec circuit SHA256 hardcoded |

### 1.5 Optimisation off-chain pour gros fichiers

Un probleme independant du gas est apparu lors des tests avec de gros fichiers. Le binding WASM direct echouait autour de `640 MiB` avec `RuntimeError: unreachable`. La cause etait la pression memoire : le fichier, le ciphertext, le circuit, `circuit_bytes` et les blocs materialises du ciphertext etaient gardes simultanement en memoire.

Patch effectue :

- calcul de `h_ct` directement sur des slices du ciphertext;
- suppression de la materialisation complete `Vec<Vec<u8>>` pour les blocs de ciphertext;
- serialization de `circuit_bytes` apres les accumulateurs pour reduire le pic memoire;
- test de non-regression prouvant que le nouveau `h_ct` direct donne la meme racine que l'ancien chemin;
- clarification : pour les gros fichiers, le chemin correct est le CLI Rust natif, pas le WASM direct.

## 2. Methodologie de mesure

### 2.1 Reference experimentale

Reference : version initiale executee localement.

Version actuelle : depot courant avec architecture specialisee, clones minimaux, disputes specialisees et optimisation off-chain.

Les tests ont ete executes avec Hardhat dans Docker pour les mesures gas, et avec le CLI Rust natif pour les gros fichiers.

### 2.2 Suites validees

| Suite | Resultat |
|---|---:|
| Version initiale executee localement | `1 passing` |
| Version actuelle, benchmark meme scope + architecture + Phase 3 + 1 GiB | `19 passing` |
| Suite Phase 3 specialisee complete | `25 passing` |
| Test Rust `h_ct` direct vs ancien `h_ct` materialise | `1 passing` |

## 3. Vue globale des gains

Cette table resume les gains principaux de la version actuelle par rapport a la version initiale.

| Axe | Version initiale | Version actuelle | Gain principal |
|---|---:|---:|---:|
| Cout marginal optimiste normal | `2,372,052` | environ `2,359,769` | leger gain, surtout deploy |
| Cout marginal `no_S_deposit` | non disponible | `500,720` | `-78.89%` vs total optimiste initial |
| Cout marginal `S=B` | non disponible | `516,349` | `-78.23%` vs total optimiste initial |
| Cout marginal `S=V` | non disponible | `556,309` | `-76.55%` vs total optimiste initial |
| Dispute self-sponsored | non disponible dans la version initiale | `7,165,940` | suppression d'une iteration `Step 7+8` |
| Hardcoded SHA256 1 GiB equivalent | preuve `h_circuit` `198,585` | gate hardcoded `29,639` a `32,390` | environ `-166k` a `-169k` gas |
| Precontrat 900 MiB | `40.23 s` | `22.85 s` | `-43.2%` temps |
| Precontrat 1 GiB | echoue | passe | support 1 GiB |

Le point central est que la version actuelle ne se contente pas de modifier quelques fonctions. Elle change le cout marginal du protocole : au lieu de redeployer un gros contrat par echange, elle deploie une infrastructure reutilisable puis cree des clones minimaux par echange.

### 3.1 Lecture importante du gain hardcoded sur grands fichiers

Le gain hardcoded SHA256 ne doit pas etre lu uniquement sur le total d'une dispute 16 KiB. Sur ce petit scenario, le total est domine par `triggerDispute`, donc l'economie de `Step 8` est diluee dans le total. C'est pour cela que le gain global apparait faible dans la dispute complete.

Le vrai effet du hardcoded apparait quand on regarde la partie qu'il optimise : la verification de l'appartenance au circuit dans `Step 8`. Dans le circuit generique, cette verification demande une preuve `pi_1` contre `h_circuit`. Dans le mode hardcoded SHA256, le circuit est determine par `|x|`, donc cette preuve disparait.

Sur petits fichiers, cela donne deja un gain local :

| Scenario | Normal `submitCommitment` | Hardcoded `submitCommitment` | Gain local Step 8 |
|---|---:|---:|---:|
| Dispute 16 KiB | `463,532` | `400,990` | `-62,542` |
| Dispute complete 16 KiB, cumul des `submitCommitment` | `877,768` | `752,684` | `-125,084` |

Sur grands fichiers, le gain devient plus important parce que la profondeur de la preuve `h_circuit` augmente :

| Taille equivalente | Preuve normale `h_circuit / pi_1` | Verification hardcoded | Gain |
|---|---:|---:|---:|
| 900 MiB | `192,267` | `29,639` a `32,390` | `159,877` a `162,628` |
| 1 GiB | `198,585` | `29,639` a `32,390` | `166,195` a `168,946` |

Conclusion : le hardcoded SHA256 n'est pas une optimisation globale de toute la dispute. C'est une optimisation ciblee de `Step 8`. Son effet est peu visible sur le total d'une petite dispute, mais il devient significatif pour les grands circuits, exactement parce qu'il supprime `pi_1` et la verification generique de `h_circuit`.

## 4. Partie optimiste : version initiale vs version actuelle

### 4.1 Reference initiale mesuree localement

| Mesure version initiale | Gas |
|---|---:|
| Deploiement `OptimisticSOXAccount` | `2,144,301` |
| Execution optimiste | `227,751` |
| Total optimiste par echange | `2,372,052` |

Ce total correspond au cout marginal par echange dans la version initiale : un contrat complet est deploye pour chaque echange, puis les appels optimistes sont executes.

### 4.2 Version actuelle : mode normal specialise

| Mesure actuelle | Gas |
|---|---:|
| Deploiement optimistic normal specialise | `2,126,849` |
| Execution optimiste meme scope | `232,920` |
| Total optimiste normal specialise | `2,359,769` |

Comparaison directe :

| Cas | Version initiale | Version actuelle | Ecart |
|---|---:|---:|---:|
| Optimistic deploy normal | `2,144,301` | `2,126,849` | `-17,452` (`-0.81%`) |
| Total optimiste normal | `2,372,052` | `2,359,769` | `-12,283` (`-0.52%`) |

Interpretation : le cas normal reste proche de la version initiale, car il conserve la logique complete. Le gain majeur vient des nouveaux modes specialises.

### 4.3 Version actuelle : cout marginal par clone

Ces chiffres sont les couts par nouvel echange lorsque la factory et les implementations ont deja ete deployees une fois. Ils remplacent donc le cout marginal `2,372,052 gas` de la version initiale pour les modes correspondants.

| Mode actuel | Creation clone | Execution incluse | Total par echange | Gain vs version initiale |
|---|---:|---|---:|---:|
| `no_S_deposit` | `299,694` | payment + key + complete | `500,720` | `-1,871,332` (`-78.89%`) |
| `S=B` | `393,412` | key + complete | `516,349` | `-1,855,703` (`-78.23%`) |
| `S=V` | `328,926` | payment + key + complete | `556,309` | `-1,815,743` (`-76.55%`) |

Interpretation : c'est le gain le plus important de la phase optimiste. La version initiale payait un deploiement complet par echange. La version actuelle paie seulement la creation d'un clone minimal et les appels utiles.

### 4.4 Detail des appels optimistes des clones

| Mode | Creation clone | Payment | Key | Complete | Total |
|---|---:|---:|---:|---:|---:|
| `no_S_deposit` | `299,694` | `82,272` | `61,363` | `57,391` | `500,720` |
| `S=B` | `393,412` | `0` | `61,363` | `61,574` | `516,349` |
| `S=V` | `328,926` | `104,446` | `61,363` | `61,574` | `556,309` |

Le mode `S=B` supprime le paiement buyer separe, car le buyer est deja sponsor initial. Le mode `no_S_deposit` supprime la logique de depot initial de `S` dans la phase optimiste.

## 5. Partie dispute : version initiale vs version actuelle

### 5.1 Scopes disponibles dans la version initiale

La version initiale mesuree localement donne les scopes suivants :

| Mesure version initiale | Gas |
|---|---:|
| Deploiement `DisputeSOXAccount` | `5,052,837` |
| Exchange + dispute triggering | `5,316,358` |
| Optimistic deploy + dispute init total | `7,460,671` |
| Challenge round average | `103,172` |
| `submitCommitment` reel 4 MiB SHA256 gate | `380,001` |

La version initiale ne contient pas les modes self-sponsored et hardcoded SHA256. Ces deux modes sont donc des extensions de la version actuelle, pas des chemins directement presents dans la version initiale.

### 5.2 Version actuelle : dispute complete

La mesure importante pour le self-sponsoring est la dispute complete jusqu'a l'etat final, car le gain vient de la reduction du nombre d'iterations de la boucle `Step 7+8`.

| Cas dispute actuel 16 KiB | Trigger dispute | Respond challenge | Give opinion | Submit commitment | Finalize | Total | Iterations `Step 7+8` |
|---|---:|---:|---:|---:|---:|---:|---:|
| normal, sponsors externes | `5,779,296` | `730,818` | `765,456` | `877,768` | `76,462` | `8,345,377` | `2` |
| self-sponsored `SB=B/SV=V` | `5,781,134` | `365,409` | `382,728` | `455,753` | `73,962` | `7,165,940` | `1` |
| hardcoded SHA256 | `5,787,348` | `730,818` | `765,456` | `752,684` | `76,462` | `8,310,242` | `2` |
| self-sponsored + hardcoded SHA256 | `5,789,186` | `365,409` | `382,728` | `393,199` | `73,962` | `7,193,335` | `1` |

### 5.3 Gains dans la dispute actuelle

| Optimisation | Gain total vs dispute actuelle normale | Gain sur `submitCommitment` | Explication |
|---|---:|---:|---|
| self-sponsored | `-1,179,437` (`-14.13%`) | `-422,015` (`-48.08%`) | une seule boucle `Step 7+8` |
| hardcoded SHA256 | `-35,135` (`-0.42%`) | `-125,084` (`-14.25%`) | suppression de la preuve `pi_1` |
| self-sponsored + hardcoded | `-1,152,042` (`-13.80%`) | `-484,569` (`-55.20%`) | combinaison des deux effets |

Interpretation : le self-sponsoring produit le gain structurel le plus visible dans une dispute complete. Le hardcoded SHA256 reduit bien `Step 8`, mais son effet sur le total 16 KiB est masque par le cout fixe de `triggerDispute`. Le tableau de grands circuits en section 6.3 donne donc la lecture la plus pertinente pour juger le hardcoded : a 1 GiB equivalent, la suppression de `pi_1` economise environ `166k` a `169k` gas sur la verification `h_circuit`.

## 6. Hardcoded SHA256

### 6.1 Clarification de `submitCommitment`

`submitCommitment` est la fonction Solidity correspondant au `Step 8`. Elle verifie on-chain la gate contestee, les valeurs associees et les preuves Merkle.

Dans le circuit generique, `submitCommitment` doit verifier une preuve d'appartenance au circuit via `h_circuit`. Cette preuve correspond a `pi_1`. Les `pi_1 items` sont les elements Merkle fournis pour verifier cette appartenance.

Dans le mode hardcoded SHA256, le circuit est determine par `|x|`. On n'a donc plus besoin de fournir `h_circuit` ni la preuve `pi_1` pour prouver que la gate appartient au circuit generique.

### 6.2 Effet mesure sur petits fichiers

| Taille | Normal `submitCommitment` | Hardcoded `submitCommitment` | `pi_1 items` normal | `pi_1 items` hardcoded | Gain |
|---|---:|---:|---:|---:|---:|
| 13 bytes | `251,420` | `234,626` | `3` | `0` | `-16,794` |
| 16 KiB | `463,532` | `400,990` | `10` | `0` | `-62,542` |

### 6.3 Effet mesure sur grands circuits equivalents

| Taille equivalente | Gates | Profondeur | Preuve normale `h_circuit` | Gate hardcoded | Economie |
|---|---:|---:|---:|---:|---:|
| 900 MiB | `29,491,205` | `25` | `192,267` | `29,639` a `32,390` | `159,877` a `162,628` |
| 1 GiB | `33,554,437` | `26` | `198,585` | `29,639` a `32,390` | `166,195` a `168,946` |

Interpretation : le hardcoded SHA256 est surtout interessant quand le circuit devient grand, car la preuve `h_circuit` grandit avec la profondeur. Sur petits fichiers, le gain existe mais reste masque par les couts fixes de dispute.

## 7. Gros fichiers off-chain

### 7.1 CLI natif : version initiale vs version actuelle

| Taille | Version initiale | Version actuelle | Gain |
|---|---:|---:|---:|
| 900 MiB | passe en `40.23 s`, RSS max `7,387,644 KiB` | passe en `22.85 s`, RSS max `6,388,400 KiB` | `-43.2%` temps, environ `-0.95 GiB` RSS |
| 1 GiB | echoue, process tue par `SIGKILL` autour de `7,404,640 KiB` RSS | passe en `23.6` a `24.7 s` en execution isolee | support 1 GiB |

### 7.2 WASM direct

Le WASM direct reste conserve pour l'integration JavaScript et les fichiers petits/moyens, mais il ne doit pas etre le chemin de benchmark pour 1 GiB.

| Taille WASM direct | Avant patch memoire | Apres patch memoire |
|---|---:|---:|
| 640 MiB | echoue | passe, `59.7 s` |
| 704 MiB | non valide | passe, `61.9 s` |
| 736 MiB | echoue | echoue |
| 900 MiB / 1 GiB | echoue | hors cible WASM |

Conclusion : la version actuelle repousse la limite WASM, mais le vrai support gros fichiers repose sur le CLI natif.

### 7.3 Dispute complete 1 GiB avec CLI natif

Pour repondre explicitement a la question du passage a 1 GiB, un benchmark end-to-end supplementaire a ete ajoute. Il ne mesure plus seulement le precontrat : il execute une dispute complete sur un fichier de `1 GiB`, avec generation native des reponses `hpre`, transactions on-chain pour tous les rounds, `Step 8`, puis finalisation jusqu'a l'etat `End`.

Le scenario mesure est volontairement explicite :

| Parametre | Valeur |
|---|---:|
| Taille fichier | `1,073,741,824 bytes` |
| Mode | hardcoded `desc = SHA256` |
| Sponsors de dispute | self-sponsored `SB=B`, `SV=V` |
| Branche de recherche | gauche, V disagree a chaque round |
| Gate finale | `g_1`, gate AES |
| Nombre de rounds `Step 7` | `26` |
| Etat final | `End` |

Ce scenario est une vraie execution complete de dispute, mais il faut noter qu'il termine sur une gate AES. Il mesure donc un cas complet valide, pas le cas local qui maximise uniquement le gain hardcoded sur la preuve `h_circuit / pi_1`.

Temps mesures :

| Mesure | Temps |
|---|---:|
| Precontrat CLI natif, wall-clock | `42.79 s` |
| Generation native dispute, wall-clock | `22.65 s` |
| Generation totale des `hpre` | `11.03 s` |
| Execution on-chain locale de la dispute | `0.43 s` |

Detail des premiers `hpre` :

| Round | Challenge | Temps `hpre` |
|---:|---:|---:|
| `0` | `16,777,219` | `5.47 s` |
| `1` | `8,388,610` | `2.47 s` |
| `2` | `4,194,305` | `1.20 s` |
| `3` | `2,097,153` | `0.70 s` |
| `4` | `1,048,577` | `0.36 s` |

Gas mesures :

| Etape | Gas |
|---|---:|
| Deploiement optimistic hardcoded | `2,668,072` |
| Paiement B | `104,441` |
| Envoi de cle V | `58,896` |
| Depot dispute `SB=B` | `106,954` |
| Trigger dispute / deploy dispute | `2,721,171` |
| Total chemin optimistic + trigger | `5,659,534` |
| `respondChallenge`, 26 rounds | `1,581,282` |
| `giveOpinion`, 26 rounds | `1,095,903` |
| `submitCommitmentLeft`, gate AES + preuve `h_ct`, sans `gateBytes/pi_1` | `5,577,706` |
| Finalize `completeDispute` | `75,667` |
| Total execution dispute apres trigger | `8,330,558` |
| Total complet mesure | `13,990,092` |

Point important : pendant ce benchmark, le contrat specialise a aussi ete corrige pour utiliser le meme decodage V2 que le contrat initial. Les fils negatifs `g_-i` sont maintenant relies a `h_ct`, et le CLI fournit une vraie preuve Merkle `proof2` pour le bloc ciphertext utilise par la gate AES. Sans cette correction, le chemin passait on-chain mais ne verifiait pas proprement l'appartenance du bloc ciphertext.

Point supplementaire apres le dernier patch : l'appel hardcoded strict passe `gateBytes = 0x` et `proof1 = []`. Le contrat reconstruit donc la gate attendue lui-meme, puis verifie seulement les temoins et preuves d'accumulateur necessaires.

## 8. Synthese : ce que la version actuelle apporte

La version actuelle ameliore la version initiale sur plusieurs axes.

| Axe | Apport |
|---|---|
| Architecture | passage d'un deploiement complet par echange a une infrastructure reutilisable + clones |
| Phase optimiste | cout marginal reduit de `2.37M` a environ `500k-556k` pour les variantes specialisees |
| `no_S_deposit` | suppression de la logique de depot initial de `S` dans la phase optimiste |
| `S=B` | fusion logique de `Step 1+2` |
| `SB=B/SV=V` | reduction du nombre d'iterations de dispute |
| Hardcoded SHA256 | suppression de `h_circuit` et `pi_1` dans `Step 8` |
| Gros fichiers | passage de 900 MiB supporte a 1 GiB supporte via CLI natif |
| Dispute 1 GiB | dispute hardcoded complete mesuree jusqu'a `End`, avec `26` rounds et preuves natives |

La transformation principale n'est donc pas une micro-optimisation locale. La version actuelle change le modele de cout marginal du protocole : les modes connus au precontrat ne paient plus pour une logique generique inutile.

## 9. Limites restantes

| Limite | Impact |
|---|---|
| `triggerDispute` reste tres couteux | principal cout fixe restant dans la dispute |
| `submitCommitmentLeft` AES reste couteux | le hardcoded supprime `pi_1`, mais l'evaluation AES et les preuves `h_ct/hpre` restent dominantes |
| WASM direct ne supporte pas 1 GiB | acceptable si le backend utilise le CLI natif |
| Certains tests legacy de preuve ne suivent plus l'interface actuelle | nettoyage necessaire pour hygiene de test suite |

## 10. Conclusion Phase 4

La Phase 4 est consideree comme terminee.

Les mesures montrent que la version actuelle ameliore la version initiale de maniere structurelle :

- le cas normal specialise revient au niveau de la version initiale, legerement en dessous sur le deploiement;
- les variantes optimistes avec clones reduisent le cout marginal par echange d'environ `77%` a `79%`;
- la dispute self-sponsored reduit effectivement le nombre d'iterations `Step 7+8`;
- le hardcoded SHA256 supprime bien les `pi_1 items`; sur 1 GiB equivalent, il economise environ `166k` a `169k` gas sur la preuve `h_circuit`;
- le chemin off-chain natif supporte maintenant 1 GiB, alors que la version initiale echoue dans cet environnement.
- une dispute complete hardcoded 1 GiB a ete executee jusqu'a `End` : `26` rounds, `11.03 s` de generation `hpre`, `8,330,558 gas` d'execution dispute apres trigger, `13,990,092 gas` au total avec chemin optimistic et trigger.

La prochaine cible d'optimisation devrait etre `submitCommitmentLeft` pour les gates AES, car le deploiement hardcoded a ete fortement reduit et le cout dominant se deplace vers l'evaluation/proof du `Step 8`.
