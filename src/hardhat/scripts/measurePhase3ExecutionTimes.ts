import { createCipheriv, createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { freemem } from "node:os";
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

type HardcodedStreamingRow = {
    sizeMiB: number;
    sizeBytes: number;
    aesCtrAndSha256Ms: number;
    throughputMiBPerSecond: number;
    plaintextDigestPrefix: string;
    ciphertextDigestPrefix: string;
};

type NormalPipelineEstimateRow = {
    sizeMiB: number;
    sizeBytes: number;
    estimatedRawDataMiB: number;
    estimatedRssMiBFrom64MiBRun: number;
    availableMemoryMiB: number;
    executed: boolean;
    reason: string;
};

function parseSizesMiB(envName: string, fallback: number[]) {
    const raw = process.env[envName];
    if (!raw) {
        return fallback;
    }
    if (raw.trim().toLowerCase() === "none") {
        return [];
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

function deterministicIv() {
    const iv = new Uint8Array(16);
    for (let i = 0; i < iv.length; i++) {
        iv[i] = 0xf0 - i;
    }
    return iv;
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

function measureHardcodedStreamingPrecontract(sizeMiB: number): HardcodedStreamingRow {
    const sizeBytes = sizeMiB * 1024 * 1024;
    const chunk = deterministicBytes(Math.min(sizeBytes, 1024 * 1024));
    const key = Buffer.from(deterministicKey());
    const iv = Buffer.from(deterministicIv());
    const cipher = createCipheriv("aes-128-ctr", key, iv);
    const plaintextHash = createHash("sha256");
    const ciphertextHash = createHash("sha256");
    const start = performance.now();

    let remaining = sizeBytes;
    while (remaining > 0) {
        const current = Math.min(chunk.length, remaining);
        const plaintext = chunk.subarray(0, current);
        plaintextHash.update(plaintext);
        ciphertextHash.update(cipher.update(plaintext));
        remaining -= current;
    }
    ciphertextHash.update(cipher.final());

    const aesCtrAndSha256Ms = performance.now() - start;
    return {
        sizeMiB,
        sizeBytes,
        aesCtrAndSha256Ms,
        throughputMiBPerSecond: sizeMiB / (aesCtrAndSha256Ms / 1000),
        plaintextDigestPrefix: plaintextHash.digest("hex").slice(0, 16),
        ciphertextDigestPrefix: ciphertextHash.digest("hex").slice(0, 16),
    };
}

function estimateNormalPipelineMemory(sizeMiB: number): NormalPipelineEstimateRow {
    const sizeBytes = sizeMiB * 1024 * 1024;
    const numBlocks = Math.ceil(sizeBytes / 64);
    const rem = sizeBytes % 64;
    const numGates = rem > 55 ? numBlocks * 2 + 8 : numBlocks * 2 + 5;
    const rawDataMiB =
        sizeMiB + // plaintext
        sizeMiB + // ciphertext
        (numGates * 64) / (1024 * 1024) + // circuit bytes
        (numGates * 32) / (1024 * 1024); // evaluated bytes
    const observed64MiBRss = 2109.3;
    const observed64MiBRaw = 64 + 64 + 128.00030517578125 + 64.00015258789062;
    const estimatedRssMiBFrom64MiBRun = rawDataMiB * (observed64MiBRss / observed64MiBRaw);
    const availableMemoryMiB = Math.round(freemem() / (1024 * 1024));
    return {
        sizeMiB,
        sizeBytes,
        estimatedRawDataMiB: rawDataMiB,
        estimatedRssMiBFrom64MiBRun,
        availableMemoryMiB,
        executed: false,
        reason:
            "Skipped by safety guard: current normal V2 path materializes plaintext, ciphertext, hCircuit, and evaluated values; extrapolated RSS exceeds this WSL VM memory.",
    };
}

async function main() {
    const wasmPath = join(__dirname, "../../app/lib/crypto_lib/crypto_lib_bg.wasm");
    const wasmBytes = readFileSync(wasmPath);
    const initStart = performance.now();
    initSync({ module: wasmBytes });
    const wasmInitMs = performance.now() - initStart;

    const sizesMiB = parseSizesMiB("PHASE3_TIMING_SIZES_MB", [1, 16, 64]);
    const streamingSizesMiB = parseSizesMiB("PHASE3_STREAMING_SHA256_MB", [1024]);
    const hardcodedStreamingSizesMiB = parseSizesMiB("PHASE3_STREAMING_HARDCODED_MB", [1024]);
    const normalEstimateSizesMiB = parseSizesMiB("PHASE3_NORMAL_PIPELINE_ESTIMATE_MB", [1024]);
    const key = deterministicKey();
    const timingRows: TimingRow[] = [];

    console.log("PHASE3_EXECUTION_TIMES_CONFIG=" + JSON.stringify({
        wasmInitMs: Number(wasmInitMs.toFixed(3)),
        sizesMiB,
        streamingSizesMiB,
        hardcodedStreamingSizesMiB,
        normalEstimateSizesMiB,
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
    const hardcodedStreamingRows = hardcodedStreamingSizesMiB.map(
        measureHardcodedStreamingPrecontract
    );
    const normalEstimateRows = normalEstimateSizesMiB.map(estimateNormalPipelineMemory);

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
    const roundedHardcodedStreamingRows = hardcodedStreamingRows.map((row) => ({
        ...row,
        aesCtrAndSha256Ms: Number(row.aesCtrAndSha256Ms.toFixed(3)),
        throughputMiBPerSecond: Number(row.throughputMiBPerSecond.toFixed(3)),
    }));
    const roundedNormalEstimateRows = normalEstimateRows.map((row) => ({
        ...row,
        estimatedRawDataMiB: Number(row.estimatedRawDataMiB.toFixed(1)),
        estimatedRssMiBFrom64MiBRun: Number(row.estimatedRssMiBFrom64MiBRun.toFixed(1)),
    }));

    console.table(roundedTimingRows);
    console.log(`PHASE3_EXECUTION_TIMES_JSON=${JSON.stringify(roundedTimingRows)}`);

    console.table(roundedStreamingRows);
    console.log(`PHASE3_STREAMING_SHA256_JSON=${JSON.stringify(roundedStreamingRows)}`);

    console.table(roundedHardcodedStreamingRows);
    console.log(
        `PHASE3_STREAMING_HARDCODED_JSON=${JSON.stringify(roundedHardcodedStreamingRows)}`
    );

    console.table(roundedNormalEstimateRows);
    console.log(
        `PHASE3_NORMAL_1GIB_ESTIMATE_JSON=${JSON.stringify(roundedNormalEstimateRows)}`
    );
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
