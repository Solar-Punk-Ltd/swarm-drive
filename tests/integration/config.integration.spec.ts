import dotenv from "dotenv";
dotenv.config();

import { spawnSync } from "child_process";
import fs from "fs-extra";
import os from "os";
import path from "path";

jest.setTimeout(20000);

const CLI_PATH = path.resolve(__dirname, "../../dist/cli.js");

describe("Swarm-CLI Integration Tests (config)", () => {
  let tmpDir: string;
  const cwdBefore = process.cwd();

  beforeEach(async () => {
    tmpDir = path.join(os.tmpdir(), `swarm-cli-config-${Date.now()}`);
    await fs.ensureDir(tmpDir);
    process.chdir(tmpDir);
    // ensure no existing config
    await fs.remove(path.join(tmpDir, ".swarm-sync.json"));
  });

  afterEach(async () => {
    process.chdir(cwdBefore);
    await fs.remove(tmpDir);
  });

  function runCli(args: string[]) {
    return spawnSync(
      process.execPath,
      [CLI_PATH, ...args],
      { cwd: tmpDir, encoding: "utf8" }
    );
  }

  it("set and get localDir", () => {
    // set
    const folder = "data";
    const r1 = runCli(["config", "set", "localDir", folder]);
    expect(r1.status).toBe(0);
    expect(r1.stdout).toMatch(new RegExp(`localDir = ${folder}`));

    const cfg = fs.readJsonSync(path.join(tmpDir, ".swarm-sync.json"));
    expect(cfg.localDir).toBe(folder);

    const r2 = runCli(["config", "get", "localDir"]);
    expect(r2.status).toBe(0);
    expect(r2.stdout.trim()).toBe(`localDir = ${folder}`);
  });

  it("set and get numeric intervals", () => {
    let r = runCli(["config", "set", "watchIntervalSeconds", "42"]);
    expect(r.status).toBe(0);
    expect(r.stdout).toMatch(/watchIntervalSeconds = 42/);
    let cfg = fs.readJsonSync(path.join(tmpDir, ".swarm-sync.json"));
    expect(cfg.watchIntervalSeconds).toBe(42);

    r = runCli(["config", "set", "scheduleIntervalSeconds", "7"]);
    expect(r.status).toBe(0);
    expect(r.stdout).toMatch(/scheduleIntervalSeconds = 7/);
    cfg = fs.readJsonSync(path.join(tmpDir, ".swarm-sync.json"));
    expect(cfg.scheduleIntervalSeconds).toBe(7);

    r = runCli(["config", "get", "watchIntervalSeconds"]);
    expect(r.status).toBe(0);
    expect(r.stdout.trim()).toBe("watchIntervalSeconds = 42");

    r = runCli(["config", "get", "scheduleIntervalSeconds"]);
    expect(r.status).toBe(0);
    expect(r.stdout.trim()).toBe("scheduleIntervalSeconds = 7");
  });

  it("errors on invalid key", () => {
    const r = runCli(["config", "set", "nope", "123"]);
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/Error: "nope" is not a valid configuration key/);
  });

  it("errors on invalid numeric value", () => {
    const r1 = runCli(["config", "set", "watchIntervalSeconds", "-5"]);
    expect(r1.status).toBe(1);
    expect(r1.stderr).toMatch(/is not a valid non-negative integer/);

    const r2 = runCli(["config", "set", "scheduleIntervalSeconds", "foo"]);
    expect(r2.status).toBe(1);
    expect(r2.stderr).toMatch(/is not a valid non-negative integer/);
  });
});
