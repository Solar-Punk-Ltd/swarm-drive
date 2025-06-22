// tests/integration/schedule.integration.spec.ts
import dotenv from "dotenv";
dotenv.config();

import fs from "fs-extra";
import os from "os";
import path from "path";
import { spawn, spawnSync, ChildProcess } from "child_process";

import { Bee, PrivateKey, Reference } from "@ethersphere/bee-js";
import { buyStamp } from "./helpers";

// ── Import the same 32-byte feed topic that the CLI uses ──
import { DRIVE_FEED_TOPIC } from "../../src/utils/constants";

jest.setTimeout(45_000);

const CLI_PATH = path.resolve(__dirname, "../../dist/cli.js");
const BEE_API = process.env.BEE_API ?? "http://localhost:1633"
const POSTAGE_LABEL = "swarm-drive-stamp";

describe("Swarm-CLI Integration Test: schedule", () => {
  let tmpDir: string | undefined;
  let bee: Bee;
  let signerKey: string;
  let ownerAddress: string;
  let schedProc: ChildProcess | null = null;

  beforeAll(async () => {
    // Use either the environment key or fall back to a known 0x-prefixed key.
    // Make sure the fallback is funded on your local Bee node if you rely on it.
    const FALLBACK_KEY =
      "0x0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

    signerKey = process.env.BEE_SIGNER_KEY?.startsWith("0x")
      ? process.env.BEE_SIGNER_KEY!
      : FALLBACK_KEY;

    // Create Bee client and ensure “swarm-drive-stamp” exists
    bee = new Bee(BEE_API, { signer: new PrivateKey(signerKey) });
    ownerAddress = new PrivateKey(signerKey).publicKey().address().toString();

    const allBatches = await bee.getAllPostageBatch();
    const existing = allBatches.find((b) => b.label === POSTAGE_LABEL);
    if (!existing) {
      // This account (fallback or real) must already be funded on your local Bee node
      await buyStamp(bee, "10000000000000000000000", 18, POSTAGE_LABEL);
    }
  });

  beforeEach(async () => {
    tmpDir = path.join(os.tmpdir(), `swarm-cli-sched-${Date.now()}`);
    await fs.ensureDir(tmpDir);
    process.chdir(tmpDir);
  });

  afterEach(async () => {
    if (schedProc) {
      schedProc.kill();
      schedProc = null;
    }
    // Only attempt to remove if tmpDir was actually set
    if (typeof tmpDir === "string") {
      process.chdir(os.tmpdir());
      await fs.remove(tmpDir);
      tmpDir = undefined;
    }
  });

  it("runs an initial sync and then repeats every 1 second", async () => {
    // 1) Create “data/” and run `swarm-cli init data`
    const dataDir = "data";
    fs.ensureDirSync(path.join(tmpDir!, dataDir));
    const initResult = spawnSync(
      process.execPath,
      [CLI_PATH, "init", dataDir],
      {
        cwd: tmpDir,
        env: { ...process.env, BEE_SIGNER_KEY: signerKey },
        encoding: "utf-8",
      }
    );
    expect(initResult.status).toBe(0);

    // 2) Start `swarm-cli schedule 1000` in a long-running child process
    schedProc = spawn(
      process.execPath,
      [CLI_PATH, "schedule", "1000"],
      {
        cwd: tmpDir,
        env: { ...process.env, BEE_SIGNER_KEY: signerKey },
        stdio: ["ignore", "pipe", "pipe"],
      }
    );

    // 3) Wait ~1.5s for the initial sync, then create “data/hello.txt”
    await new Promise((r) => setTimeout(r, 1_500));
    const localFolder = path.join(tmpDir!, dataDir);
    await fs.writeFile(path.join(localFolder, "hello.txt"), "Hello!", "utf-8");

    // 4) Poll up to ~10s (1s intervals) for a manifest that contains “hello.txt”
    let foundManifest = "";
    for (let attempt = 1; attempt <= 10; attempt++) {
      // A) Ask for “feed@latest” (alias = feed-ls)
      const feedOut = spawnSync(
        process.execPath,
        [CLI_PATH, "feed-ls"],
        {
          cwd: tmpDir,
          env: { ...process.env, BEE_SIGNER_KEY: signerKey },
          encoding: "utf-8",
        }
      ).stdout.trim();

      const parts = feedOut.split(/\s+/);
      if (parts.length >= 3) {
        const candidate = parts[2].trim();
        if (/^[0-9a-fA-F]{64}$/.test(candidate)) {
          // B) Check `manifest-ls <candidate>` for “hello.txt”
          const lsResult = spawnSync(
            process.execPath,
            [CLI_PATH, "manifest-ls", candidate],
            {
              cwd: tmpDir,
              env: { ...process.env, BEE_SIGNER_KEY: signerKey },
              encoding: "utf-8",
            }
          );
          if (
            lsResult.status === 0 &&
            lsResult.stdout.includes("hello.txt")
          ) {
            foundManifest = candidate;
            break;
          }
        }
      }

      // Not found yet → wait 1s and retry
      await new Promise((r) => setTimeout(r, 1_000));
    }

    expect(foundManifest).toMatch(/^[0-9a-fA-F]{64}$/);

    // 5) Double-check via `manifest-ls <foundManifest>`
    const finalLs = spawnSync(
      process.execPath,
      [CLI_PATH, "manifest-ls", foundManifest],
      {
        cwd: tmpDir,
        env: { ...process.env, BEE_SIGNER_KEY: signerKey },
        encoding: "utf-8",
      }
    );
    expect(finalLs.status).toBe(0);
    expect(finalLs.stdout).toMatch(/hello\.txt/);

    // 6) Finally, confirm via Bee SDK that feed@latest payload ≥ 32 bytes:
    const reader = bee.makeFeedReader(
      DRIVE_FEED_TOPIC.toUint8Array(),
      ownerAddress
    );

    let payload: Uint8Array = new Uint8Array();
    try {
      const msg = await reader.download();
      payload = msg.payload.toUint8Array();
    } catch {
      // If it fails once, we’ll assert below on length
    }
    expect(payload.byteLength).toBeGreaterThanOrEqual(32);

    // 7) And confirm the 64-hex again by slicing that payload:
    const sdkManifestRef = new Reference(payload.slice(0, 32)).toString();
    expect(sdkManifestRef).toHaveLength(64);
  });
});
