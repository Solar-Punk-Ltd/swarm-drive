// tests/integration/helpers.integration.spec.ts
import dotenv from "dotenv";
dotenv.config();

import { spawnSync } from "child_process";
import fs from "fs-extra";
import os from "os";
import path from "path";

import { Bee, PrivateKey } from "@ethersphere/bee-js";
import { buyStamp } from "../../src/utils/swarm";
import { DEFAULT_BEE_URL } from "../../src/utils/constants";

jest.setTimeout(30000);

const CLI_PATH = path.resolve(__dirname, "../../dist/cli.js");
const BEE_API = process.env.BEE_API ?? DEFAULT_BEE_URL
const POSTAGE_LABEL = "swarm-drive-stamp";

describe("Swarm-CLI Integration Test: helpers (feed-get, feed-ls, manifest-ls)", () => {
  let tmpDir: string;
  let bee: Bee;
  let signerKey: string;

  beforeAll(async () => {
    const FALLBACK_KEY =
      "0x0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
    signerKey = process.env.BEE_SIGNER_KEY?.startsWith("0x")
      ? process.env.BEE_SIGNER_KEY!
      : FALLBACK_KEY;

    bee = new Bee(BEE_API, { signer: new PrivateKey(signerKey) });
    const allBatches = await bee.getAllPostageBatch();
    const existing = allBatches.find((b) => b.label === POSTAGE_LABEL);
    if (!existing) {
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
    const dataDir = "docs";
    fs.ensureDirSync(path.join(tmpDir, dataDir));
    runCli(["init", dataDir]);

    await fs.writeFile(path.join(tmpDir, dataDir, "x.md"), "X", "utf-8");
    runCli(["sync"]);

    await new Promise((r) => setTimeout(r, 1000));

    let ref0 = "";
    for (let i = 0; i < 5; i++) {
      const out = runCli(["feed-get", "0"]);
      const parts = out.split(/\s+/);
      if (parts.length >= 3 && /^[0-9a-fA-F]{64}$/.test(parts[2])) {
        ref0 = parts[2];
        break;
      }
      await new Promise((r) => setTimeout(r, 500));
    }
    expect(ref0).toMatch(/^[0-9a-fA-F]{64}$/);

    const ls = runCli(["feed-ls"]).split(/\s+/);
    expect(ls[2]).toBe(ref0);
  });

  it("`manifest-ls <ref>` lists the correct files (slot 1)", async () => {
    const dataDir = "data";
    fs.ensureDirSync(path.join(tmpDir, dataDir));
    runCli(["init", dataDir]);

    await fs.writeFile(path.join(tmpDir, dataDir, "foo.txt"), "foo", "utf-8");
    runCli(["sync"]);

    // give a moment for the feed to be published
    await new Promise((r) => setTimeout(r, 2500));

    // explicitly pull slot 1 (where foo.txt was pushed)
    const out1 = runCli(["feed-get", "1"]);
    const parts1 = out1.split(/\s+/);
    expect(parts1.length).toBeGreaterThanOrEqual(3);
    const manifestRef = parts1[2].trim();
    expect(manifestRef).toMatch(/^[0-9a-fA-F]{64}$/);

    const finalLs = runCli(["manifest-ls", manifestRef]);
    expect(finalLs).toMatch(/foo\.txt/);
  });
});
