// tests/integration/watch.integration.spec.ts
import dotenv from "dotenv";
dotenv.config();

import fs from "fs-extra";
import os from "os";
import path from "path";
import { spawnSync, spawn, ChildProcess } from "child_process";
import { Bee, PrivateKey, Reference } from "@ethersphere/bee-js";
import { buyStamp } from "./helpers";

// ── Import the very same 32-byte feed topic that the CLI uses ──
import { DRIVE_FEED_TOPIC } from "../../src/utils/constants";

jest.setTimeout(45_000);

const CLI_PATH = path.resolve(__dirname, "../../dist/cli.js");
const BEE_API = process.env.BEE_API ?? "http://localhost:1633"
const POSTAGE_LABEL = "swarm-drive-stamp";

describe("Swarm-CLI Integration Test: watch", () => {
  let tmpDir: string;
  let bee: Bee;
  let ownerAddress: string;
  let signerKey: string;
  let watchProc: ChildProcess | null = null;

  beforeAll(async () => {
    // Use either the environment‐provided key or a fallback.
    // The fallback must be funded on your Bee node.
    const FALLBACK_KEY =
      "0x0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
    signerKey = process.env.BEE_SIGNER_KEY?.startsWith("0x")
      ? process.env.BEE_SIGNER_KEY!
      : FALLBACK_KEY;

    // 1) Create a Bee client using the (funded) BEE_SIGNER_KEY
    bee = new Bee(BEE_API, { signer: new PrivateKey(signerKey) });
    ownerAddress = new PrivateKey(signerKey).publicKey().address().toString();

    // 2) Ensure “swarm-drive-stamp” exists (or else buy one)
    const allBatches = await bee.getAllPostageBatch();
    const existing = allBatches.find((b) => b.label === POSTAGE_LABEL);
    if (!existing) {
      // This account must already be funded on your local Bee node
      await buyStamp(bee, "10000000000000000000000", 18, POSTAGE_LABEL);
    }
  });

  beforeEach(async () => {
    tmpDir = path.join(os.tmpdir(), `swarm-cli-watch-${Date.now()}`);
    await fs.ensureDir(tmpDir);
    process.chdir(tmpDir);
  });

  afterEach(async () => {
    if (watchProc) {
      watchProc.kill();
      watchProc = null;
    }
    process.chdir(os.tmpdir());
    await fs.remove(tmpDir);
  });

  /** 
   * Helper: run `swarm-cli <...args>` synchronously; throw on non-zero exit. 
   * Always inject BEE_SIGNER_KEY so CLI can use it.
   */
  function runCli(args: string[]): string {
    const result = spawnSync(
      process.execPath,
      [CLI_PATH, ...args],
      {
        cwd: tmpDir,
        env: { ...process.env, BEE_SIGNER_KEY: signerKey },
        encoding: "utf-8",
      }
    );
    if (result.status !== 0) {
      const stderr = (result.stderr || "").trim();
      throw new Error(`"${args.join(" ")}" failed:\n${stderr}`);
    }
    return (result.stdout || "").trim();
  }

  it("detects file changes and updates the feed manifest", async () => {
    // 1) Create “data/” and run `swarm-cli init data`
    const dataDir = "data";
    fs.ensureDirSync(path.join(tmpDir, dataDir));
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

    // 2) Start `swarm-cli watch --debounce 0.1` in a long-running child process
    watchProc = spawn(
      process.execPath,
      [CLI_PATH, "watch", "--debounce", "0.1"],
      {
        cwd: tmpDir,
        env: { ...process.env, BEE_SIGNER_KEY: signerKey },
        stdio: ["ignore", "pipe", "pipe"],
      }
    );

    // 3) Wait a moment, then create “data/hello.txt”
    await new Promise((r) => setTimeout(r, 2500));
    const localFolder = path.join(tmpDir, dataDir);
    await fs.writeFile(path.join(localFolder, "hello.txt"), "Hello!", "utf-8");

    // 4) Now poll up to ~10 seconds for the manifest that contains “hello.txt”
    let foundManifest = "";
    for (let attempt = 1; attempt <= 10; attempt++) {
      // A) Ask for “feed@latest” (alias = feed-ls)
      const feedOut = runCli(["feed-ls"]);
      const parts = feedOut.split(/\s+/);
      if (parts.length >= 3) {
        const candidate = parts[2].trim();
        // Must be a valid 64-hex string and non-zero
        if (/^[0-9a-fA-F]{64}$/.test(candidate)) {
          // B) Try `manifest-ls <candidate>`
          const lsResult = spawnSync(
            process.execPath,
            [CLI_PATH, "manifest-ls", candidate],
            {
              cwd: tmpDir,
              env: { ...process.env, BEE_SIGNER_KEY: signerKey },
              encoding: "utf-8",
            }
          );
          if (lsResult.status === 0 && lsResult.stdout.match(/hello\.txt/)) {
            // Bingo! “hello.txt” has appeared under this manifest.
            foundManifest = candidate;
            break;
          }
        }
      }
      // If not found yet, wait 1 second and retry
      await new Promise((r) => setTimeout(r, 2500));
    }

    expect(foundManifest).toMatch(/^[0-9a-fA-F]{64}$/);

    // 5) Double-check: `manifest-ls <foundManifest>` must still contain “hello.txt”
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

    // 6) For completeness, also verify the raw payload is ≥ 32 bytes
    //    by downloading via Bee SDK (same 32-byte topic).
    const reader = bee.makeFeedReader(
      DRIVE_FEED_TOPIC.toUint8Array(),
      ownerAddress
    );
    let payload: Uint8Array = new Uint8Array();
    try {
      const msg = await reader.download();
      payload = msg.payload.toUint8Array();
    } catch {
      // If it fails once, we’ll still assert below on length
    }
    expect(payload.byteLength).toBeGreaterThanOrEqual(32);
  });
});
