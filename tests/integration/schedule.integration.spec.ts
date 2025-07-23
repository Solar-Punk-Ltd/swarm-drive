import dotenv from "dotenv";
dotenv.config();

import fs from "fs-extra";
import os from "os";
import path from "path";
import { spawn, spawnSync, ChildProcess } from "child_process";

import { Bee, PrivateKey, Reference } from "@ethersphere/bee-js";
import { buyStamp } from "../../src/utils/swarm";

import { DEFAULT_BEE_URL, DRIVE_FEED_TOPIC } from "../../src/utils/constants";

jest.setTimeout(45_000);

const CLI_PATH = path.resolve(__dirname, "../../dist/cli.js");
const BEE_API = process.env.BEE_API ?? DEFAULT_BEE_URL
const POSTAGE_LABEL = "swarm-drive-stamp";

describe("Swarm-CLI Integration Test: schedule", () => {
  let tmpDir: string | undefined;
  let bee: Bee;
  let signerKey: string;
  let ownerAddress: string;
  let schedProc: ChildProcess | null = null;

  beforeAll(async () => {
    const FALLBACK_KEY =
      "0x0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

    signerKey = process.env.BEE_SIGNER_KEY?.startsWith("0x")
      ? process.env.BEE_SIGNER_KEY!
      : FALLBACK_KEY;

    bee = new Bee(BEE_API, { signer: new PrivateKey(signerKey) });
    ownerAddress = new PrivateKey(signerKey).publicKey().address().toString();

    const allBatches = await bee.getAllPostageBatch();
    const existing = allBatches.find((b) => b.label === POSTAGE_LABEL);
    if (!existing) {
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
    if (typeof tmpDir === "string") {
      process.chdir(os.tmpdir());
      await fs.remove(tmpDir);
      tmpDir = undefined;
    }
  });

  it("runs an initial sync and then repeats every 1 second", async () => {
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

    schedProc = spawn(
      process.execPath,
      [CLI_PATH, "schedule", "1"],
      {
        cwd: tmpDir,
        env: { ...process.env, BEE_SIGNER_KEY: signerKey },
        stdio: ["ignore", "pipe", "pipe"],
      }
    );

    await new Promise((r) => setTimeout(r, 1_500));
    const localFolder = path.join(tmpDir!, dataDir);
    await fs.writeFile(path.join(localFolder, "hello.txt"), "Hello!", "utf-8");

    let foundManifest = "";
    for (let attempt = 1; attempt <= 10; attempt++) {
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

      await new Promise((r) => setTimeout(r, 1_000));
    }

    expect(foundManifest).toMatch(/^[0-9a-fA-F]{64}$/);

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

    const reader = bee.makeFeedReader(
      DRIVE_FEED_TOPIC.toUint8Array(),
      ownerAddress
    );

    let payload: Uint8Array = new Uint8Array();
    try {
      const msg = await reader.download();
      payload = msg.payload.toUint8Array();
    } catch {
    }
    expect(payload.byteLength).toBeGreaterThanOrEqual(32);

    const sdkManifestRef = new Reference(payload.slice(0, 32)).toString();
    expect(sdkManifestRef).toHaveLength(64);
  });
});
