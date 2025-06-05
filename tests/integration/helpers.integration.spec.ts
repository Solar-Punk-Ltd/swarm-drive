import dotenv from "dotenv";
dotenv.config();

import { spawnSync } from "child_process";
import fs from "fs-extra";
import os from "os";
import path from "path";

import { Bee, PrivateKey } from "@ethersphere/bee-js";
import { buyStamp } from "./helpers";

jest.setTimeout(30000);

const CLI_PATH = path.resolve(__dirname, "../../dist/cli.js");
const BEE_API = "http://localhost:1633";
const POSTAGE_LABEL = "swarm-drive-stamp";

describe("Swarm-CLI Integration Test: helpers (feed-get, feed-ls, manifest-ls)", () => {
  let tmpDir: string;
  let bee: Bee;
  let signerKey: string;

  beforeAll(async () => {
    const FALLBACK_KEY = "0x0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
    signerKey = (process.env.BEE_SIGNER_KEY?.startsWith("0x")
      ? process.env.BEE_SIGNER_KEY!
      : FALLBACK_KEY
    );
    // 1) Create a Bee client with the real, funded BEE_SIGNER_KEY
    bee = new Bee(BEE_API, { signer: new PrivateKey(signerKey) });

    // 2) Ensure that a postage batch labeled "swarm-drive-stamp" already exists (or else buy one)
    const allBatches = await bee.getAllPostageBatch();
    const existing = allBatches.find((b) => b.label === POSTAGE_LABEL);
    if (!existing) {
      // This account must already be funded on your local Bee node
      await buyStamp(bee, "10000000000000000000000", 18, POSTAGE_LABEL);
    }
  });

  beforeEach(async () => {
    tmpDir = path.join(os.tmpdir(), `swarm-cli-helpers-${Date.now()}`);
    await fs.ensureDir(tmpDir);
    process.chdir(tmpDir);
  });

  afterEach(async () => {
    process.chdir(os.tmpdir());
    await fs.remove(tmpDir);
  });

  /**
   * Run `swarm-cli <...args>` synchronously; throw on non-zero exit.
   * Always inject BEE_SIGNER_KEY into the child-process env so the CLI sees it.
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

  it("`feed-get 0` and `feed-ls` both return the same manifest reference", async () => {
    // 1) Create “docs/” and run `swarm-cli init docs`
    const dataDir = "docs";
    fs.ensureDirSync(path.join(tmpDir, dataDir));
    runCli(["init", dataDir]);

    // 2) Write x.md inside docs/, then run `swarm-cli sync`
    const docsFolder = path.join(tmpDir, dataDir);
    await fs.writeFile(path.join(docsFolder, "x.md"), "X", "utf-8");
    runCli(["sync"]);

    // ── Give Bee 1 second to propagate the feed entry ──
    await new Promise((r) => setTimeout(r, 1000));

    // 3) Poll until `swarm-cli feed-get 0` returns a 64-hex manifest
    let ref0 = "";
    for (let attempt = 1; attempt <= 5; attempt++) {
      const out = runCli(["feed-get", "0"]);
      const parts = out.split(/\s+/);
      if (parts.length >= 3) {
        const maybe = parts[2].trim();
        if (/^[0-9a-fA-F]{64}$/.test(maybe)) {
          ref0 = maybe;
          break;
        }
      }
      await new Promise((r) => setTimeout(r, 500));
    }
    expect(ref0).toMatch(/^[0-9a-fA-F]{64}$/);

    // 4) Now run `swarm-cli feed-ls` (alias for “feed-get latest”) — it must show the same hex
    const feedLsOut = runCli(["feed-ls"]);
    const partsLs = feedLsOut.split(/\s+/);
    expect(partsLs.length).toBeGreaterThanOrEqual(3);
    const latestRef = partsLs[2].trim();
    expect(latestRef).toBe(ref0);
  });

  it("`manifest-ls <ref>` lists the correct files", async () => {
    // 1) Create “data/”, run `swarm-cli init data`, then sync a file named foo.txt
    const dataDir = "data";
    fs.ensureDirSync(path.join(tmpDir, dataDir));
    runCli(["init", dataDir]);

    const localFolder = path.join(tmpDir, dataDir);
    await fs.writeFile(path.join(localFolder, "foo.txt"), "foo", "utf-8");
    runCli(["sync"]);

    // ── The CLI writes .swarm-sync-state.json almost immediately ■ no need to poll “feed-get” again
    // Wait just 200ms to let the CLI finish saving its state
    await new Promise((r) => setTimeout(r, 200));

    // 2) Read `.swarm-sync-state.json` directly to grab the lastManifest
    const stateFile = path.join(tmpDir, ".swarm-sync-state.json");
    const stateObj = fs.readJsonSync(stateFile) as { lastManifest: string };
    const manifestRef = stateObj.lastManifest;
    expect(manifestRef).toMatch(/^[0-9a-fA-F]{64}$/);

    // 3) Finally, do `swarm-cli manifest-ls <manifestRef>` and check it contains “foo.txt”
    const finalLs = runCli(["manifest-ls", manifestRef]);
    expect(finalLs).toMatch(/foo\.txt/);
  });
});
