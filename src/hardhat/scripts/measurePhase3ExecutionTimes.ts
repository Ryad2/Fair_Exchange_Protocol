import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { performance } from "node:perf_hooks";
import {
    bytes_to_hex,
    compute_precontract_values_v2,
    compute_proofs_v2,
    evaluate_circuit_v2_wasm,
    initSync,
} from "../../app/lib/crypto_lib/crypto_lib";

type TimingRow = {
    sizeMiB: number;
    sizeBytes: number;
    numBlocks: number;
    numGates: number;
    wasmPrecontractMs: number;
    wasmEvaluateMs: number;
    wasmProofMs: number;
    proof1Items: number;
    proof1Levels: number;
    rssPeakMiB: number;
};

type StreamingRow = {
    sizeMiB: number;
    sizeBytes: number;
    streamingSha256Ms: number;
    throughputMiBPerSecond: number;
    digestPrefix: string;
};

function parseSizesMiB(envName: string, fallback: number[]) {
    const raw = process.env[envName];
    if (!raw) {
        return fallback;
    }

    return raw
        .split(",")
        .map((value) => Number(value.trim()))
        .filter((value) => Number.isFinite(value) && value > 0);
}

function deterministicBytes(sizeBytes: number) {
    const file = new Uint8Array(sizeBytes);
    const pattern = new Uint8Array(Math.min(sizeBytes, 1024 * 1024));
    for (let i = 0; i < pattern.length; i++) {
        pattern[i] = (i * 31 + 17) & 0xff;
    }

    for (let offset = 0; offset < sizeBytes; offset += pattern.length) {
        file.set(pattern.subarray(0, Math.min(pattern.length, sizeBytes - offset)), offset);
    }
    return file;
}

function deterministicKey() {
    const key = new Uint8Array(16);
    for (let i = 0; i < key.length; i++) {
        key[i] = i + 1;
    }
    return key;
}

function proofItemCount(proof: Uint8Array[][]) {
    return proof.reduce((count, level) => count + level.length, 0);
}

function rssMiB() {
    return process.memoryUsage().rss / (1024 * 1024);
}

function measureStreamingSha256(sizeMiB: number): StreamingRow {
    const sizeBytes = sizeMiB * 1024 * 1024;
    const chunk = deterministicBytes(Math.min(sizeBytes, 1024 * 1024));
    const hash = createHash("sha256");
    const start = performance.now();

    let remaining = sizeBytes;
    while (remaining > 0) {
        const current = Math.min(chunk.length, remaining);
        hash.update(chunk.subarray(0, current));
        remaining -= current;
    }

    const streamingSha256Ms = performance.now() - start;
    return {
        sizeMiB,
        sizeBytes,
        streamingSha256Ms,
        throughputMiBPerSecond: sizeMiB / (streamingSha256Ms / 1000),
        digestPrefix: hash.digest("hex").slice(0, 16),
    };
}

async function main() {
    const wasmPath = join(__dirname, "../../app/lib/crypto_lib/crypto_lib_bg.wasm");
    const wasmBytes = readFileSync(wasmPath);
    const initStart = performance.now();
    initSync({ module: wasmBytes });
    const wasmInitMs = performance.now() - initStart;

    const sizesMiB = parseSizesMiB("PHASE3_TIMING_SIZES_MB", [1, 16, 64]);
    const streamingSizesMiB = parseSizesMiB("PHASE3_STREAMING_SHA256_MB", [900]);
    const key = deterministicKey();
    const timingRows: TimingRow[] = [];

    console.log("PHASE3_EXECUTION_TIMES_CONFIG=" + JSON.stringify({
        wasmInitMs: Number(wasmInitMs.toFixed(3)),
        sizesMiB,
        streamingSizesMiB,
        nodeVersion: process.version,
    }));

    for (const sizeMiB of sizesMiB) {
        const sizeBytes = sizeMiB * 1024 * 1024;
        const file = deterministicBytes(sizeBytes);
        let rssPeak = rssMiB();

        const preStart = performance.now();
        const precontract = compute_precontract_values_v2(file, key);
        const wasmPrecontractMs = performance.now() - preStart;
        rssPeak = Math.max(rssPeak, rssMiB());

        const evalStart = performance.now();
        const evaluatedBytes = evaluate_circuit_v2_wasm(
            precontract.circuit_bytes,
            precontract.ct,
            bytes_to_hex(key)
        ).to_bytes();
        const wasmEvaluateMs = performance.now() - evalStart;
        rssPeak = Math.max(rssPeak, rssMiB());

        const gateNum = Math.max(1, Math.floor(Number(precontract.num_gates) / 2));
        const proofStart = performance.now();
        const proofs = compute_proofs_v2(
            precontract.circuit_bytes,
            evaluatedBytes,
            precontract.ct,
            gateNum
        );
        const wasmProofMs = performance.now() - proofStart;
        rssPeak = Math.max(rssPeak, rssMiB());

        timingRows.push({
            sizeMiB,
            sizeBytes,
            numBlocks: Number(precontract.num_blocks),
            numGates: Number(precontract.num_gates),
            wasmPrecontractMs,
            wasmEvaluateMs,
            wasmProofMs,
            proof1Items: proofItemCount(proofs.proof1),
            proof1Levels: proofs.proof1.length,
            rssPeakMiB: rssPeak,
        });
    }

    const streamingRows = streamingSizesMiB.map(measureStreamingSha256);

    const roundedTimingRows = timingRows.map((row) => ({
        ...row,
        wasmPrecontractMs: Number(row.wasmPrecontractMs.toFixed(3)),
        wasmEvaluateMs: Number(row.wasmEvaluateMs.toFixed(3)),
        wasmProofMs: Number(row.wasmProofMs.toFixed(3)),
        rssPeakMiB: Number(row.rssPeakMiB.toFixed(1)),
    }));
    const roundedStreamingRows = streamingRows.map((row) => ({
        ...row,
        streamingSha256Ms: Number(row.streamingSha256Ms.toFixed(3)),
        throughputMiBPerSecond: Number(row.throughputMiBPerSecond.toFixed(3)),
    }));

    console.table(roundedTimingRows);
    console.log(`PHASE3_EXECUTION_TIMES_JSON=${JSON.stringify(roundedTimingRows)}`);

    console.table(roundedStreamingRows);
    console.log(`PHASE3_STREAMING_SHA256_JSON=${JSON.stringify(roundedStreamingRows)}`);
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
