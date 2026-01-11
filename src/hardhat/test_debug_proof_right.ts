import { expect } from "chai";
import hre from "hardhat";
import "@nomicfoundation/hardhat-chai-matchers";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { deployDisputeWithMockOptimistic } from "./deployers";
import { readFile } from "node:fs/promises";
import {
    bytes_to_hex,
    compute_precontract_values,
    compute_proof_right,
    evaluate_circuit,
    hpre,
    initSync,
} from "../../app/lib/crypto_lib";
import { ZeroHash } from "ethers";

const { ethers } = hre;

describe("Debug submitCommitmentRight", function () {
    let buyer: HardhatEthersSigner;
    let vendor: HardhatEthersSigner;

    before(async function () {
        [buyer, vendor] = await ethers.getSigners();
        const module = await readFile("../app/lib/crypto_lib/crypto_lib_bg.wasm");
        initSync({ module: module });
    });

    it("should debug proof right", async function () {
        const file = new Uint8Array(30).fill(0xEF);
        const key = new Uint8Array(16).fill(0x03);

        const {
            ct,
            circuit_bytes,
            description,
            commitment,
            num_blocks,
            num_gates,
        } = compute_precontract_values(file, key);

        const evaluated_bytes = evaluate_circuit(
            circuit_bytes,
            ct,
            [bytes_to_hex(key)],
            bytes_to_hex(description)
        ).to_bytes();

        const { contract } = await deployDisputeWithMockOptimistic(
            BigInt(num_blocks),
            BigInt(num_gates),
            commitment.c,
            buyer,
            vendor,
            buyer,
            vendor
        );

        // Passer la phase challenge-response
        let state = await contract.currState();
        while (state === 0n) {
            const challenge = await contract.chall();
            const hpre_res = hpre(evaluated_bytes, num_blocks, Number(challenge));
            await contract.connect(buyer).respondChallenge(hpre_res);
            await contract.connect(vendor).giveOpinion(true);
            state = await contract.currState();
        }

        const finalState = Number(await contract.currState());
        console.log(`Final state: ${finalState}, num_gates: ${num_gates}, num_blocks: ${num_blocks}`);

        if (finalState === 4) {
            const lastChallenge = num_gates - 1;
            const lastChallengeResponse = await contract.buyerResponses(lastChallenge);
            console.log(`buyerResponses[${lastChallenge}]: ${bytes_to_hex(new Uint8Array(lastChallengeResponse))}`);
            
            const expectedHpre = hpre(evaluated_bytes, num_blocks, lastChallenge);
            console.log(`Expected hpre(${lastChallenge}): ${bytes_to_hex(expectedHpre)}`);
            
            const proof = compute_proof_right(evaluated_bytes, num_blocks, num_gates);
            const proofConverted = Array.from(proof).map((layer: any) =>
                Array.from(layer).map((item: any) => bytes_to_hex(new Uint8Array(item)))
            );
            
            console.log(`Proof length: ${proofConverted.length} layers`);
            console.log(`First layer length: ${proofConverted[0]?.length || 0}`);
            
            // Vérifier si buyerResponses correspond
            if (bytes_to_hex(new Uint8Array(lastChallengeResponse)) !== bytes_to_hex(expectedHpre)) {
                console.log("❌ buyerResponses ne correspond pas à hpre!");
                // Corriger buyerResponses
                await contract.connect(buyer).respondChallenge(expectedHpre);
            }
            
            await contract.connect(vendor).submitCommitmentRight(proofConverted);
            const finalStateAfter = await contract.currState();
            console.log(`State after submitCommitmentRight: ${finalStateAfter}`);
        }
    });
});
