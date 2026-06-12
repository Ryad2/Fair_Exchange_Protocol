# Speaker Notes - Story-First SOX Presentation

Target: 20 minutes presentation + 10 minutes Q&A.

Audience assumption: cryptography background, but no prior knowledge of blockchain, Ethereum, SOX, the inherited codebase, or the implementation architecture.

Presentation strategy: make the audience understand the problem before showing any numbers. The story is:

1. Fair exchange is hard.
2. A smart contract can act as a public judge, but public computation is expensive.
3. SOX keeps most work off-chain and uses disputes only when needed.
4. The inherited implementation worked, but was not gas-optimal and hard to measure.
5. I implemented the main variants, learned that monolithic contracts are wrong, and moved to specialized contracts.
6. This reduced honest-path gas, improved dispute gas, and enabled a 1 GiB hardcoded benchmark.
7. I also identified the remaining prototype and cryptographic-engineering limitations.

## Timing

- Slides 1-3: fair exchange and smart-contract motivation, 3 minutes.
- Slides 4-7: SOX protocol background from zero, 4 minutes.
- Slides 8-13: inherited implementation, project path, architecture, 5 minutes.
- Slides 14-19: results and validation, 6 minutes.
- Slides 20-22: limitations, future work, conclusion, 2 minutes.
- Backup slides: Q&A only.

## Slide 1 - Title

Keep it short.

Suggested wording:
"My project is about taking an existing implementation of Sponsored Fair Exchange and making it gas-aware, variant-aware, and experimentally measurable."

## Slide 2 - A simple question

Goal: make everyone care before introducing SOX.

Suggested wording:
"The motivating question is very simple. Alice wants to buy a digital file from Bob. If Bob sends first, Alice can keep the file without paying. If Alice pays first, Bob can disappear or send a wrong file. This is the fair-exchange problem."

Do not mention blockchain yet.

## Slide 3 - Fair exchange target

Goal: define correctness intuitively.

Suggested wording:
"The target is an all-or-nothing outcome. Either the buyer gets a file matching the public description and the vendor receives the payment, or the exchange is cancelled without one side gaining an unfair advantage."

Say "public judge" but not "Ethereum" yet.

## Slide 4 - Why a smart contract appears

Goal: introduce blockchain without jargon.

Suggested wording:
"For this talk, a smart contract is just a public deterministic judge. It can hold deposits and enforce the payout rules. The catch is that every operation executed by this public judge costs gas. So the main engineering question is what must be public and what can stay local."

This sets up the gas optimization naturally.

## Slide 5 - SOX idea in one picture

Goal: explain optimistic protocol.

Suggested wording:
"SOX is optimistic. In the common case, the vendor commits to the computation off-chain, the buyer pays, the vendor reveals the key, and the exchange completes. Only if the buyer complains do we use the dispute mechanism."

Important sentence:
"The dispute does not verify the whole file on-chain. It uses a binary search to locate one disputed computation step."

## Slide 6 - Cryptographic object behind SOX

Goal: connect to crypto background.

Suggested wording:
"The off-chain side builds the cryptographic material: AES-CTR decryption, SHA-256 description check, and commitments to the ciphertext, the circuit, and intermediate values. The on-chain side stores short commitments and verifies only small authenticated pieces."

This slide makes clear that the project is not simply a web app.

## Slide 7 - Baseline SOX flow

Goal: explain the protocol before variants.

Suggested wording:
"The baseline protocol has two paths. The optimistic path uses a sponsor S to fund the exchange, then B pays and V reveals the key. The dispute path starts when B complains, then the dispute sponsors S_B and S_V fund the dispute, the parties run a binary search, and the contract checks one local step."

Transition:
"My work keeps this logic, but changes how the modes are implemented and measured."

## Slide 8 - What I inherited

Goal: give credit and define starting point.

Suggested wording:
"The inherited system was already a substantial proof of concept: Rust and WebAssembly tooling, Solidity contracts, web interface, backend, and sponsored transaction infrastructure. But it had expensive per-exchange deployments, the main variants were not cleanly implemented, and gas numbers were difficult to compare."

Avoid criticizing the previous project. Say "research prototype" and "starting point".

## Slide 9 - My project roadmap

Goal: show methodology and workload.

Suggested wording:
"The project was not a single patch. First I had to reconstruct the execution path. Then I mapped implementation functions to protocol steps. Then I implemented the variants, measured them, discovered that the monolithic approach was too expensive, and redesigned the architecture with specialization."

This is where autonomy and methodology show.

## Slide 10 - The variants

Goal: define variants without overwhelming.

Suggested wording:
"The variants answer two questions: who pays, and when is the choice known? Some choices are known before the exchange starts, such as no S-deposit, S=B, and S=V. Other choices only matter once a dispute starts, such as S_B=B and S_V=V. The hardcoded SHA-256 mode is different: it specializes the circuit verification."

## Slide 11 - Negative result

Goal: show critical thinking.

Suggested wording:
"The first natural attempt was to put all variants into one contract. Functionally this validated the ideas, but it was the wrong gas architecture. The honest path increased from 2.30M to 3.05M gas. This negative result was important because it forced the pivot to specialized contracts."

Do not hide the negative result. It makes the story stronger.

## Slide 12 - Final architecture

Goal: explain final design simply.

Suggested wording:
"The final architecture chooses the mode before deployment. Reusable code is deployed once. Each exchange gets a thin specialized instance. This avoids paying for unused branches."

If asked about clones:
"A clone is a small contract instance that reuses implementation code already deployed once."

## Slide 13 - What I implemented

Goal: make work quantity visible.

Suggested wording:
"Concretely, the work touched contracts, native Rust tooling, frontend/backend mode selection, benchmarks, and the measurement methodology. The contribution is not only one optimization; it is a working and measurable variant-aware implementation."

## Slide 14 - Honest exchange cost

Goal: first major result.

Suggested wording:
"The initial honest exchange cost 2.30M gas per exchange. In the final clone-based architecture, after the reusable infrastructure is deployed once, the marginal cost drops to around 500k to 556k gas depending on the mode. This is about a fourfold reduction."

Clarify if asked:
"The 6.58M gas infrastructure is paid once. It should not be added to every exchange."

## Slide 15 - Baseline comparison window

Goal: second major result.

Suggested wording:
"Before looking at full dispute resolution, I first use the only window that is directly comparable across all architectures. This window creates the optimistic exchange and reaches the dispute trigger on a 4 MiB input. It stops before challenge rounds, Step 8, and finalization. In that window, the inherited implementation costs 7.05M gas. The monolithic validator costs 8.87M because it packs too much logic into one contract. The final normal clone costs 5.50M, so it improves by 22 percent over the initial implementation."

"Why stop at the trigger? Because this is the validated common baseline inherited from the previous implementation. A full dispute-to-End comparison would also need the same file size, same number of dispute iterations, same gate type, same proof-generation path, and the same variant semantics in the initial implementation. I did not want to mix a measured number with a reconstructed or non-equivalent one."

Important:
This is the slide that directly answers: "Did the final project improve over the inherited implementation?"
Say explicitly: "This is not a full dispute cost." The key lesson is architectural: same normal protocol, but cheaper factory/clone deployment.

## Slide 16 - Dispute resolution segment

Goal: show detailed variant performance.

Suggested wording:
"Now I switch to a different window. This one starts at the buyer-side dispute sponsor step and goes to the terminal state. It includes the dispute trigger, challenge rounds, Step 8, and finalization, but it excludes optimistic account creation, payment, and key release. That is why this table is not the previous slide plus resolution. Here the goal is not to compare with the initial implementation; it is to isolate the effect of the variants that the initial implementation did not have."

"The normal specialized dispute segment is already 10.94 percent cheaper than the monolithic version. Self-sponsoring saves challenge-loop work. Hardcoded SHA-256 removes generic circuit-opening work and uses a specialized dispute deployer. Together, self-sponsored plus hardcoded is the best measured variant at 4.04M gas."

Important:
If someone asks why 8.35M is smaller than 8.87M, answer: "Because they are different windows. Slide 16 excludes the optimistic setup that slide 15 includes."

## Slide 17 - Hardcoded SHA-256

Goal: explain correctness of hardcoded mode.

Suggested wording:
"In the generic mode, the vendor provides a gate and a proof pi_1 that this gate belongs to the circuit commitment. In the hardcoded SHA-256 mode, the contract reconstructs the expected gate from public metadata. So the vendor no longer provides pi_1 or authoritative gate bytes."

Important nuance:
"The vendor still provides witness values, but these are checked against commitments."

## Slide 18 - Local effect of hardcoding

Goal: answer why hardcoded does not magically remove all dispute gas.

Suggested wording:
"Locally, removing pi_1 clearly saves gas. On 16 KiB Step 8, the saving is 62k gas. On an isolated 1 GiB circuit-membership check, the saving is about 166k to 169k gas. But a full dispute includes many other costs, so the full gain depends also on deployment and challenge-loop structure."

## Slide 19 - Complete 1 GiB hardcoded dispute

Goal: headline scalability result.

Suggested wording:
"The scalability result is that the native path executes a complete hardcoded dispute for a 1 GiB input. The circuit has more than 33 million gates and the dispute uses 26 challenge rounds. The complete measured path reaches the terminal state at 13.99M gas in the self-sponsored hardcoded scenario."

Emphasize "complete measured path" and "terminal state".

## Slide 20 - Runtime

Goal: clarify native vs browser.

Suggested wording:
"For 1 GiB, the browser is not the right measurement environment. The native Rust CLI is the reliable path. The precontract generation takes between 22 and 49 seconds depending on run conditions, and the hpre generation over 26 rounds takes around 9.5 to 12 seconds."

If asked:
"These are local wall-clock times, not gas."

## Slide 21 - Validation

Goal: credibility.

Suggested wording:
"The measurements come from transaction receipts in executable Hardhat tests, plus native Rust benchmarks for large files. I also validated the local optimistic flow through the application. A lot of the work was making sure that comparisons use the same scope."

## Slide 22 - Limitations

Goal: show maturity.

Suggested wording:
"The final implementation is still a research prototype. The main limitations are local accounts instead of production wallets, backend availability, partial production verification workflow, and inherited cryptographic-format issues such as gate ambiguity and missing Merkle domain separation."

This honesty helps, not hurts.

## Slide 23 - Future work

Goal: connect to next research step.

Suggested wording:
"The next version should not add more flags. It should clean the architecture: registry or factory-first deployment, Step 1+2 fusion with signatures, cleaner gate encoding, Merkle domain separation, and real wallet integration."

## Slide 24 - Takeaways

Goal: end strongly.

Suggested wording:
"The three takeaways are: the proof of concept is now measurable and variant-aware; specialization is the main gas lesson; and the native large-file path makes a complete 1 GiB hardcoded dispute feasible."

Then stop. Do not add extra details after "Thank you".

## Backup Q&A

### Why not always hardcode SHA-256?

Because it is correct only when the description is exactly desc = SHA256(x). Arbitrary predicates still need the generic circuit commitment.

### Does V still provide values in Step 8?

Yes. The contract does not store the whole ciphertext or all intermediate values. V provides witness values, but the contract checks them against h_ct or hpre commitments before accepting the local gate result.

### Is 500k gas the full protocol cost?

It is the marginal optimistic cost per new exchange after the reusable factory and implementations have already been deployed. The one-time infrastructure cost is 6,584,001 gas.

### Is the 1 GiB result browser-based?

No. The 1 GiB benchmark uses the native Rust path integrated with the contracts. The browser path remains useful for demos and small or medium inputs.

### Why did the monolithic version matter if it was worse?

It was an intermediate validation step. It proved the variants could be executed, then revealed that adding all logic into one contract is not a gas optimization. That negative result motivated the final specialized architecture.

### What are the most important limitations?

Production wallet integration, enforced verification workflow, inherited gate-encoding ambiguity, and Merkle domain separation.
