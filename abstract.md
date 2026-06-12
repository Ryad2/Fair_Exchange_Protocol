# Gas-Aware Implementation of Sponsored Fair Exchange

Student: Ryad Mohamed Aouak  
Supervisor: Prof. Serge Vaudenay  
Institution: EPFL, LASEC  
Project type: Semester Project

## Abstract

This project continues an existing implementation of the Sponsored Fair Exchange protocol
(SOX), a smart-contract-based optimistic fair-exchange protocol with gas sponsors. The work
focuses on understanding the inherited implementation, implementing the main protocol
variants that affect gas consumption, and producing reproducible gas and runtime
measurements.

The initial implementation was first reconstructed and measured. The main variants were
then implemented: no initial sponsor deposit, \(S=B\), \(S=V\), self-sponsored disputes
\(S_B=B, S_V=V\), and a hardcoded \(desc=\mathrm{SHA256}(x)\) dispute path. A first
monolithic implementation validated the variants but increased deployment gas. The final
architecture therefore splits the implementation into specialized contracts, clone-based
optimistic escrows, specialized dispute accounts, and a dedicated hardcoded SHA-256 dispute
verifier.

The final clone-based optimistic paths reduce the marginal optimistic cost to 500,720 gas
for no \(S\)-deposit, 516,349 gas for \(S=B\), and 556,309 gas for \(S=V\), once the
reusable infrastructure is deployed. On a same-scope 4 MiB dispute initialization
comparison, the final specialized implementation costs 5,495,184 gas, compared with
7,054,365 gas for the initial implementation and 8,872,096 gas for the monolithic
intermediate implementation. The hardcoded SHA-256 mode removes the generic
\(h_\mathrm{circuit}\) proof \(\pi_1\) from Step 8 and reconstructs the disputed gate
on-chain from public metadata.

The project also validates a native Rust large-file path. A complete hardcoded SHA-256
dispute benchmark was executed for a 1 GiB input, including precontract generation,
26 challenge rounds, Step 8, and finalization. The work concludes with a discussion of the
remaining prototype limitations, including the inherited generic circuit encoding,
Merkle-domain separation, partial production verification workflow, and future directions
toward a cleaner factory or registry-based architecture.

## Keywords

Fair exchange, smart contracts, gas optimization, Ethereum, Solidity, ERC-4337, Merkle
commitments, SHA-256, Rust, large-file benchmarking.
