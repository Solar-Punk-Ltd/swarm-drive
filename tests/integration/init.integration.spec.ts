import dotenv from "dotenv";
dotenv.config();

import { spawnSync } from "child_process";
import fs from "fs-extra";
import os from "os";
import path from "path";

jest.setTimeout(30000);

const CLI_PATH = path.resolve(__dirname, "../../dist/cli.js");

describe("Swarm-CLI Integration Tests (init only)", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = path.join(os.tmpdir(), `swarm-cli-init-${Date.now()}`);
    await fs.ensureDir(tmpDir);
    process.chdir(tmpDir);
  });

  afterEach(async () => {
    process.chdir(os.tmpdir());
    if (tmpDir) {
      await fs.remove(tmpDir);
    }
  });

  it("init writes a valid config + empty state file", () => {
    const folderName = "myFolder";
    fs.ensureDirSync(path.join(tmpDir, folderName));

    const result = spawnSync(
      process.execPath,
      [CLI_PATH, "init", folderName],
      {
        cwd: tmpDir,
        encoding: "utf-8",
      }
    );
    expect(result.status).toBe(0);

    const cfg = fs.readJsonSync(path.join(tmpDir, ".swarm-sync.json"));
    expect(cfg.localDir).toBe(folderName);

    const stateFile = path.join(tmpDir, ".swarm-sync-state.json");
    expect(fs.existsSync(stateFile)).toBe(true);
    const stateObj = fs.readJsonSync(stateFile);
    expect(stateObj).toEqual({});
  });
});
