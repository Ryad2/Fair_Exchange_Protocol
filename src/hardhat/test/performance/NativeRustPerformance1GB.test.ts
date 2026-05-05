import { expect } from "chai";
import { execFile } from "node:child_process";
import { constants } from "node:fs";
import { access, mkdtemp, open, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { performance } from "node:perf_hooks";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

describe("Native Rust precontract performance - 1 GiB file", function () {
    this.timeout(15 * 60 * 1000);

    const FILE_SIZE_BYTES = 1024 * 1024 * 1024;
    const KEY_HEX = "000102030405060708090a0b0c0d0e0f";

    let tempDir: string;
    let inputPath: string;
    let cliPath: string;
    let precontract: {
        num_blocks: number;
        num_gates: number;
        ciphertext_path: string;
        circuit_path: string;
    };
    let elapsedMs = 0;

    before(async function () {
        cliPath = join(__dirname, "../../../wasm/target/release/precontract_cli");

        try {
            await access(cliPath, constants.X_OK);
        } catch {
            console.log(`Skipping 1 GiB native benchmark: missing executable ${cliPath}`);
            this.skip();
        }

        tempDir = await mkdtemp(join(tmpdir(), "sox-native-1g-"));
        inputPath = join(tempDir, "input-1g.bin");

        const handle = await open(inputPath, "w");
        await handle.truncate(FILE_SIZE_BYTES);
        await handle.close();
    });

    after(async function () {
        if (tempDir) {
            await rm(tempDir, { recursive: true, force: true });
        }
    });

    it("computes the 1 GiB precontract through the native CLI", async function () {
        const started = performance.now();
        const { stdout } = await execFileAsync(cliPath, [inputPath, KEY_HEX], {
            maxBuffer: 1024 * 1024,
        });
        elapsedMs = performance.now() - started;
        precontract = JSON.parse(stdout);

        const ciphertext = await stat(precontract.ciphertext_path);
        const circuit = await stat(precontract.circuit_path);

        console.log("NATIVE_PRECONTRACT_1G_JSON=" + JSON.stringify({
            elapsedMs,
            elapsedSeconds: elapsedMs / 1000,
            numBlocks: precontract.num_blocks,
            numGates: precontract.num_gates,
            ciphertextBytes: ciphertext.size,
            circuitBytes: circuit.size,
        }));

        expect(precontract.num_blocks).to.equal(16_777_216);
        expect(precontract.num_gates).to.equal(33_554_437);
        expect(ciphertext.size).to.equal(FILE_SIZE_BYTES + 16);
        expect(circuit.size).to.be.greaterThan(700 * 1024 * 1024);
    });

    it("prints the native 1 GiB benchmark summary", async function () {
        const seconds = elapsedMs / 1000;
        const throughput = 1 / seconds;

        console.log("\n" + "=".repeat(80));
        console.log("NATIVE RUST PRECONTRACT SUMMARY - 1 GiB FILE");
        console.log("=".repeat(80));
        console.log(`Precontract time: ${seconds.toFixed(2)} s`);
        console.log(`Throughput:       ${throughput.toFixed(3)} GiB/s`);
        console.log(`numBlocks:        ${precontract.num_blocks.toLocaleString()}`);
        console.log(`numGates:         ${precontract.num_gates.toLocaleString()}`);
        console.log("=".repeat(80) + "\n");

        expect(seconds).to.be.greaterThan(0);
    });
});
