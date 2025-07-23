import dotenv from "dotenv";
dotenv.config();

import { spawnSync } from "child_process";
import fs from "fs-extra";
import os from "os";
import path from "path";

import { Bee, PrivateKey, BatchId } from "@ethersphere/bee-js";
import { buyStamp } from "../../src/utils/swarm";
import { DEFAULT_BEE_URL } from "../../src/utils/constants";

jest.setTimeout(30000);

const CLI_PATH = path.resolve(__dirname, "../../dist/cli.js");
const BEE_API = process.env.BEE_API ?? DEFAULT_BEE_URL
const POSTAGE_LABEL = "swarm-drive-stamp";

describe("Swarm-CLI Integration Tests (init / sync / helpers)", () => {
  let tmpDir: string;
  let bee: Bee;
  let signerKey: string;
  let ownerAddress: string;
  let postageBatchId: string;

  beforeAll(async () => {
    const FALLBACK_KEY = "0x0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
    signerKey = (process.env.BEE_SIGNER_KEY?.startsWith("0x")
      ? process.env.BEE_SIGNER_KEY!
      : FALLBACK_KEY
    );

    if (!signerKey || !signerKey.startsWith("0x")) {
      throw new Error(
        "Please set BEE_SIGNER_KEY to a 0x‐prefixed key before running integration tests."
      );
    }

    bee = new Bee(BEE_API, { signer: new PrivateKey(signerKey) });
    ownerAddress = new PrivateKey(signerKey).publicKey().address().toString();

    const allBatches = await bee.getAllPostageBatch();
    const existing = allBatches.find((b) => b.label === POSTAGE_LABEL);
    if (!existing) {
      const newBatchId: BatchId = await buyStamp(
        bee,
        "10000000000000000000000",
        18,
        POSTAGE_LABEL
      );
      postageBatchId = newBatchId.toString();
    } else {
      postageBatchId = existing.batchID.toString();
    }
  });

  beforeEach(async () => {
    tmpDir = path.join(os.tmpdir(), `swarm-cli-int-${Date.now()}`);
    await fs.ensureDir(tmpDir);
    process.chdir(tmpDir);
  });

  afterEach(async () => {
    process.chdir(os.tmpdir());
    if (tmpDir) {
      await fs.remove(tmpDir);
    }
  });

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
      const stderr = (result.stderr ?? "").trim() || "<no stderr>";
      throw new Error(`"${args.join(" ")}" failed:\n${stderr}`);
    }
    return (result.stdout ?? "").trim();
  }

  async function awaitLatestManifestViaCli(): Promise<string> {
    for (let attempt = 1; attempt <= 5; attempt++) {
      try {
        const feedLsOutput = runCli(["feed-ls"]);
        expect(feedLsOutput.startsWith("Feed@latest")).toBe(true);

        const feedGetOutput = runCli(["feed-get"]);
        const parts = feedGetOutput.split(/\s+/);
        if (parts.length >= 3) {
          const maybeHex = parts[2].trim();
          if (/^[0-9a-fA-F]{64}$/.test(maybeHex) && !/^0+$/.test(maybeHex)) {
            return maybeHex;
          }
        }
      } catch {
      }
      await new Promise((r) => setTimeout(r, 1000));
    }
    throw new Error("Timed out waiting for a non-zero manifest in feed-get");
  }

  it("init writes a valid config + empty state file", () => {
    const folderName = "myFolder";
    fs.ensureDirSync(path.join(tmpDir, folderName));

    const initResult = spawnSync(
      process.execPath,
      [CLI_PATH, "init", folderName],
      {
        cwd: tmpDir,
        env: { ...process.env, BEE_SIGNER_KEY: signerKey },
        encoding: "utf-8",
      }
    );
    expect(initResult.status).toBe(0);

    const cfg = fs.readJsonSync(path.join(tmpDir, ".swarm-sync.json"));
    expect(cfg.localDir).toBe(path.resolve(folderName));

    const stateFile = path.join(tmpDir, ".swarm-sync-state.json");
    expect(fs.existsSync(stateFile)).toBe(true);
    const stateObj = fs.readJsonSync(stateFile);
    expect(stateObj).toEqual({});
  });

  it("sync actually uploads a file and feed/manifest commands work", async () => {
    const dataDir = "data";
    fs.ensureDirSync(path.join(tmpDir, dataDir));
    runCli(["init", dataDir]);

    const localFolder = path.join(tmpDir, dataDir);
    await fs.writeFile(path.join(localFolder, "hello.txt"), "Hello, Swarm!", "utf-8");
    runCli(["sync"]);

    await new Promise((r) => setTimeout(r, 1000));

    const manifestRef = await awaitLatestManifestViaCli();
    expect(manifestRef).toHaveLength(64);

    const ls = runCli(["manifest-ls", manifestRef]);
    expect(ls).toMatch(/hello\.txt/);
  });

  it("sync after modifying a file still lists that file in the new manifest", async () => {
    const dataDir = "data";
    fs.ensureDirSync(path.join(tmpDir, dataDir));
    runCli(["init", dataDir]);

    const folder1 = path.join(tmpDir, dataDir);
    const fooPath = path.join(folder1, "foo.txt");
    await fs.writeFile(fooPath, "version1", "utf-8");
    runCli(["sync"]);

    await new Promise((r) => setTimeout(r, 1000));

    const manifestV1 = await awaitLatestManifestViaCli();
    expect(manifestV1).toHaveLength(64);

    await fs.writeFile(fooPath, "version2", "utf-8");
    runCli(["sync"]);

    await new Promise((r) => setTimeout(r, 1000));

    const manifestV2 = await awaitLatestManifestViaCli();
    expect(manifestV2).toHaveLength(64);

    const ls2 = runCli(["manifest-ls", manifestV2]);
    expect(ls2).toMatch(/hello\.txt/);
  });

  it("sync after deleting a file removes it from the remote manifest", async () => {
    const dataDir = "files";
    fs.ensureDirSync(path.join(tmpDir, dataDir));
    runCli(["init", dataDir]);

    const folder2 = path.join(tmpDir, dataDir);
    await fs.writeFile(path.join(folder2, "a.txt"), "A", "utf-8");
    await fs.writeFile(path.join(folder2, "b.txt"), "B", "utf-8");
    runCli(["sync"]);

    await new Promise((r) => setTimeout(r, 1000));

    const manifestV1 = await awaitLatestManifestViaCli();
    expect(manifestV1).toHaveLength(64);

    await fs.remove(path.join(folder2, "b.txt"));
    runCli(["sync"]);

    await new Promise((r) => setTimeout(r, 1000));

    const manifestV2 = await awaitLatestManifestViaCli();
    expect(manifestV2).toHaveLength(64);

    const lsResult = runCli(["manifest-ls", manifestV2]);
    expect(lsResult).toMatch(/hello\.txt/);
    expect(lsResult).not.toMatch(/b\.txt/);
  });

  it("feed-get 0 and feed-ls both return the same manifest reference", async () => {
    const dataDir = "docs";
    fs.ensureDirSync(path.join(tmpDir, dataDir));
    runCli(["init", dataDir]);

    const docsFolder = path.join(tmpDir, dataDir);
    await fs.writeFile(path.join(docsFolder, "x.md"), "X", "utf-8");
    runCli(["sync"]);

    await new Promise((r) => setTimeout(r, 1000));

    const feedGet0 = runCli(["feed-get", "0"]);
    const parts0 = feedGet0.split(/\s+/);
    if (parts0.length < 3) {
      throw new Error(`Unexpected "feed-get 0" output: "${feedGet0}"`);
    }
    const ref0 = parts0[2].trim();
    expect(ref0).toMatch(/^[0-9a-fA-F]{64}$/);

    const feedLsOutput = runCli(["feed-ls"]);
    const partsLatest = feedLsOutput.split(/\s+/);
    if (partsLatest.length < 3) {
      throw new Error(`Unexpected "feed-ls" output: "${feedLsOutput}"`);
    }
    const latestRef = partsLatest[2].trim();
    expect(latestRef).toBe(ref0);
  });
});
