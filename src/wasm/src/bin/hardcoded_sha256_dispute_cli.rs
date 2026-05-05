use anyhow::{bail, Context, Result};
use hex::encode;
use rayon::prelude::*;
use serde::Serialize;
use sha2_compress::{Sha2, SHA256};
use sha3::{Digest, Keccak256};
use std::fs;
use std::path::PathBuf;
use std::time::Instant;

#[derive(Serialize)]
struct RoundOutput {
    round: u32,
    challenge: u32,
    hpre_hex: String,
    hpre_ms: f64,
}

#[derive(Serialize)]
struct FinalLeftOutput {
    gate_num: u32,
    gate_bytes_hex: String,
    values_hex: Vec<String>,
    curr_acc_hex: String,
    proof1: Vec<Vec<String>>,
    proof2: Vec<Vec<String>>,
    proof_ext: Vec<Vec<String>>,
}

#[derive(Serialize)]
struct DisputeOutput {
    plaintext_bytes: u64,
    num_blocks: u32,
    num_gates: u32,
    direction: String,
    rounds: Vec<RoundOutput>,
    final_left: FinalLeftOutput,
    timings: TimingOutput,
}

#[derive(Serialize)]
struct TimingOutput {
    load_plaintext_ms: f64,
    load_ciphertext_head_ms: f64,
    all_hpre_ms: f64,
    final_step_ms: f64,
    total_ms: f64,
}

fn main() -> Result<()> {
    let started = Instant::now();
    let args = std::env::args().skip(1).collect::<Vec<_>>();
    if args.len() != 4 {
        bail!(
            "Usage: hardcoded_sha256_dispute_cli <plaintext_file> <ciphertext_file> <num_blocks> <num_gates>"
        );
    }

    let plaintext_path = PathBuf::from(&args[0]);
    let ciphertext_path = PathBuf::from(&args[1]);
    let num_blocks: u32 = args[2].parse().context("invalid num_blocks")?;
    let num_gates: u32 = args[3].parse().context("invalid num_gates")?;

    let load_plaintext_start = Instant::now();
    let plaintext =
        fs::read(&plaintext_path).with_context(|| format!("reading {:?}", plaintext_path))?;
    let load_plaintext_ms = elapsed_ms(load_plaintext_start);
    let plaintext_len = plaintext.len() as u64;

    let expected_blocks = plaintext.len().div_ceil(64);
    if expected_blocks != num_blocks as usize {
        bail!(
            "num_blocks mismatch: expected {}, got {}",
            expected_blocks,
            num_blocks
        );
    }

    let expected_gates = hardcoded_sha256_gate_count(plaintext.len(), num_blocks)?;
    if expected_gates != num_gates {
        bail!(
            "num_gates mismatch for hardcoded SHA256: expected {}, got {}",
            expected_gates,
            num_gates
        );
    }

    let load_ciphertext_start = Instant::now();
    let ciphertext = fs::read(&ciphertext_path)
        .with_context(|| format!("reading {:?}", ciphertext_path))?;
    if ciphertext.len() < 80 {
        bail!("ciphertext must contain 16-byte IV and at least one 64-byte block");
    }
    let iv = &ciphertext[..16];
    let first_ct_block = &ciphertext[16..80];
    let load_ciphertext_head_ms = elapsed_ms(load_ciphertext_start);

    let hpre_start = Instant::now();
    let rounds = compute_left_path_hpre(&plaintext, num_blocks, num_gates)?;
    let all_hpre_ms = elapsed_ms(hpre_start);

    let final_step_start = Instant::now();
    let first_plain_block = padded_block(&plaintext, 0);
    let curr_acc = keccak64(&first_plain_block);
    let gate_bytes = encode_aes_gate_one(iv);
    let proof2 = prove_ciphertext_block(&ciphertext, 1)?;
    let final_left = FinalLeftOutput {
        gate_num: 1,
        gate_bytes_hex: format!("0x{}", encode(gate_bytes)),
        values_hex: vec![format!("0x{}", encode(first_ct_block))],
        curr_acc_hex: format!("0x{}", encode(curr_acc)),
        proof1: vec![],
        proof2,
        proof_ext: vec![],
    };
    let final_step_ms = elapsed_ms(final_step_start);

    let out = DisputeOutput {
        plaintext_bytes: plaintext_len,
        num_blocks,
        num_gates,
        direction: "left/all-vendor-disagree".to_string(),
        rounds,
        final_left,
        timings: TimingOutput {
            load_plaintext_ms,
            load_ciphertext_head_ms,
            all_hpre_ms,
            final_step_ms,
            total_ms: elapsed_ms(started),
        },
    };

    println!("{}", serde_json::to_string_pretty(&out)?);
    Ok(())
}

fn compute_left_path_hpre(
    plaintext: &[u8],
    num_blocks: u32,
    num_gates: u32,
) -> Result<Vec<RoundOutput>> {
    let mut rounds = Vec::new();
    let mut a = 1u32;
    let mut b = num_gates + 1;
    let mut round = 0u32;

    while a != b {
        let challenge = (a + b) / 2;
        let started = Instant::now();
        let hpre = hpre_prefix_root(plaintext, num_blocks, challenge)?;
        rounds.push(RoundOutput {
            round,
            challenge,
            hpre_hex: format!("0x{}", encode(hpre)),
            hpre_ms: elapsed_ms(started),
        });
        b = challenge;
        round += 1;
    }

    if a != 1 {
        bail!("left path ended at unexpected gate {}", a);
    }

    Ok(rounds)
}

fn hpre_prefix_root(plaintext: &[u8], num_blocks: u32, challenge: u32) -> Result<[u8; 32]> {
    if challenge == 0 {
        bail!("challenge must be 1-indexed");
    }

    let mut hashes: Vec<[u8; 32]> = (0..usize::min(challenge as usize, num_blocks as usize))
        .into_par_iter()
        .map(|i| keccak64(&padded_block(plaintext, i)))
        .collect();

    if challenge > num_blocks {
        hashes.push(keccak64(&padding_head_value(plaintext.len())));
    }
    if challenge > num_blocks + 1 {
        hashes.push(keccak64(&padding_full_value(plaintext.len())));
    }
    if challenge > num_blocks + 2 {
        if challenge != num_blocks + 3 {
            bail!(
                "left-path hpre generator only supports the first SHA gate above numBlocks; got challenge {}",
                challenge
            );
        }
        let first_block = padded_block(plaintext, 0);
        hashes.push(keccak64(&sha256_compress_default(&first_block)));
    }

    merkle_root(hashes).context("empty hpre prefix")
}

fn padded_block(data: &[u8], block_index: usize) -> [u8; 64] {
    let start = block_index * 64;
    let end = usize::min(start + 64, data.len());
    let mut block = [0u8; 64];
    if start < data.len() {
        block[..(end - start)].copy_from_slice(&data[start..end]);
    }
    block
}

fn padding_head_value(plaintext_len: usize) -> [u8; 64] {
    let mut extra = [0u8; 64];
    if plaintext_len % 64 == 0 {
        extra[0] = 0x80;
    } else {
        extra[plaintext_len % 64] = 0x80;
        if plaintext_len % 64 <= 55 {
            extra[56..].copy_from_slice(&((plaintext_len as u64) * 8).to_be_bytes());
        }
    }

    let mut out = [0u8; 64];
    out[..32].copy_from_slice(&extra[..32]);
    out
}

fn padding_full_value(plaintext_len: usize) -> [u8; 64] {
    let mut extra = [0u8; 64];
    if plaintext_len % 64 == 0 {
        extra[0] = 0x80;
        extra[56..].copy_from_slice(&((plaintext_len as u64) * 8).to_be_bytes());
    } else if plaintext_len % 64 <= 55 {
        extra[plaintext_len % 64] = 0x80;
        extra[56..].copy_from_slice(&((plaintext_len as u64) * 8).to_be_bytes());
    } else {
        extra[56..].copy_from_slice(&((plaintext_len as u64) * 8).to_be_bytes());
    }
    extra
}

fn hardcoded_sha256_gate_count(plaintext_len: usize, num_blocks: u32) -> Result<u32> {
    let rem = plaintext_len % 64;
    let blocks = num_blocks
        .checked_mul(2)
        .context("num_blocks overflow while computing gate count")?;
    if rem > 55 {
        blocks
            .checked_add(8)
            .context("gate count overflow for rem > 55")
    } else {
        blocks.checked_add(5).context("gate count overflow")
    }
}

fn encode_aes_gate_one(iv: &[u8]) -> [u8; 64] {
    let mut gate = [0u8; 64];
    gate[0] = 0x01;
    write_i48(&mut gate, 1, -1);
    gate[7..23].copy_from_slice(iv);
    gate[23] = 0x02;
    gate[24] = 0x00;
    gate
}

fn write_i48(out: &mut [u8; 64], offset: usize, value: i64) {
    let encoded = if value < 0 {
        ((1i128 << 48) + value as i128) as u64
    } else {
        value as u64
    };
    for i in 0..6 {
        out[offset + i] = ((encoded >> (8 * (5 - i))) & 0xff) as u8;
    }
}

fn sha256_compress_default(block: &[u8; 64]) -> [u8; 32] {
    let h1 = u32x8(&block[..32]);
    let h2 = u32x8(&block[32..]);
    let compressed = SHA256.compress(&h1, &h2);
    u32x8_to_bytes(&compressed)
}

fn u32x8(input: &[u8]) -> [u32; 8] {
    let mut out = [0u32; 8];
    for i in 0..8 {
        out[i] = ((input[i * 4] as u32) << 24)
            | ((input[i * 4 + 1] as u32) << 16)
            | ((input[i * 4 + 2] as u32) << 8)
            | (input[i * 4 + 3] as u32);
    }
    out
}

fn u32x8_to_bytes(input: &[u32; 8]) -> [u8; 32] {
    let mut out = [0u8; 32];
    for (i, word) in input.iter().enumerate() {
        out[i * 4] = ((word >> 24) & 0xff) as u8;
        out[i * 4 + 1] = ((word >> 16) & 0xff) as u8;
        out[i * 4 + 2] = ((word >> 8) & 0xff) as u8;
        out[i * 4 + 3] = (word & 0xff) as u8;
    }
    out
}

fn keccak64(value: &[u8]) -> [u8; 32] {
    let mut block = [0u8; 64];
    let len = usize::min(value.len(), 64);
    block[..len].copy_from_slice(&value[..len]);
    let mut hasher = Keccak256::new();
    hasher.update(block);
    hasher.finalize().into()
}

fn merkle_root(mut layer: Vec<[u8; 32]>) -> Option<[u8; 32]> {
    if layer.is_empty() {
        return None;
    }
    while layer.len() > 1 {
        let current = &layer;
        let indices: Vec<usize> = (0..current.len()).step_by(2).collect();
        layer = indices
            .into_par_iter()
            .map(|i| {
                if i + 1 < current.len() {
                    let mut hasher = Keccak256::new();
                    hasher.update(current[i]);
                    hasher.update(current[i + 1]);
                    hasher.finalize().into()
                } else {
                    current[i]
                }
            })
            .collect();
    }
    Some(layer[0])
}

fn prove_ciphertext_block(ciphertext: &[u8], ct_idx: usize) -> Result<Vec<Vec<String>>> {
    if ciphertext.len() < 16 {
        bail!("ciphertext must contain the 16-byte IV");
    }
    let data_len = ciphertext.len() - 16;
    let data_blocks = data_len.div_ceil(64);
    if ct_idx == 0 || ct_idx > data_blocks {
        bail!("ct_idx {} out of bounds for {} data blocks", ct_idx, data_blocks);
    }

    let leaf_count = data_blocks + 1;
    let mut layer: Vec<[u8; 32]> = (0..leaf_count)
        .into_par_iter()
        .map(|i| {
            if i == 0 {
                return keccak64(&ciphertext[..16]);
            }
            let start = 16 + (i - 1) * 64;
            let end = usize::min(start + 64, ciphertext.len());
            keccak64(&ciphertext[start..end])
        })
        .collect();

    let mut idx = ct_idx;
    let mut proof: Vec<Vec<String>> = Vec::new();
    while layer.len() > 1 {
        let neighbor = if idx % 2 == 0 { idx + 1 } else { idx - 1 };
        if neighbor < layer.len() {
            proof.push(vec![format!("0x{}", encode(layer[neighbor]))]);
        } else {
            proof.push(vec![]);
        }

        let current = &layer;
        let indices: Vec<usize> = (0..current.len()).step_by(2).collect();
        layer = indices
            .into_par_iter()
            .map(|i| {
                if i + 1 < current.len() {
                    let mut hasher = Keccak256::new();
                    hasher.update(current[i]);
                    hasher.update(current[i + 1]);
                    hasher.finalize().into()
                } else {
                    current[i]
                }
            })
            .collect();
        idx >>= 1;
    }

    Ok(proof)
}

fn elapsed_ms(started: Instant) -> f64 {
    started.elapsed().as_secs_f64() * 1000.0
}

#[cfg(test)]
mod tests {
    use super::*;
    use crypto_lib::{compute_precontract_values_v2, evaluate_circuit_v2_wasm, hpre_v2};

    #[test]
    fn native_left_path_hpre_matches_wasm_reference() {
        let mut plaintext = vec![0u8; 1024];
        for (i, byte) in plaintext.iter_mut().enumerate() {
            *byte = (i & 0xff) as u8;
        }
        let key = [0x11u8; 16];
        let pre = compute_precontract_values_v2(&mut plaintext.clone(), &key);
        let evaluated =
            evaluate_circuit_v2_wasm(&pre.circuit_bytes, &pre.ct, hex::encode(key)).to_bytes();

        let mut a = 1u32;
        let mut b = pre.num_gates + 1;
        while a != b {
            let challenge = (a + b) / 2;
            let native = hpre_prefix_root(&plaintext, pre.num_blocks, challenge).unwrap();
            let reference = hpre_v2(&evaluated, pre.num_blocks as usize, challenge as usize);
            assert_eq!(native.to_vec(), reference, "challenge {challenge}");
            b = challenge;
        }
    }
}
