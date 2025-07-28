import { spawnSync } from "child_process";
import fs from "fs-extra";
import os from "os";
import path from "path";

import { CONFIG_FILE, STATE_PATH_NAME } from "../../src/utils/constants";
import { StateMode } from "../../src/utils/types";

jest.setTimeout(20000);

const CLI_PATH = path.resolve(__dirname, "../../dist/cli.js");

describe("Swarm-CLI Integration Tests (status)", () => {
  let tmpDir: string;
  const cwdBefore = process.cwd();

  beforeEach(async () => {
    tmpDir = path.join(os.tmpdir(), `swarm-cli-status-${Date.now()}`);
    await fs.ensureDir(tmpDir);
    process.chdir(tmpDir);
    await fs.remove(path.join(tmpDir, CONFIG_FILE));
    await fs.remove(path.join(tmpDir, STATE_PATH_NAME));
  });

  afterEach(async () => {
    process.chdir(cwdBefore);
    await fs.remove(tmpDir);
  });

  function runCli(args: string[]) {
    const result = spawnSync(process.execPath, [CLI_PATH, ...args], {
      cwd: tmpDir,
      encoding: "utf8",
    });

    return result;
  }

  it("errors if no config exists", () => {
    const r = runCli(["status"]);
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/Error: config file ".swarm-sync.json" not found/);
  });

  it("prints defaults when config exists but no state", () => {
    fs.writeJsonSync(path.join(tmpDir, CONFIG_FILE), { localDir: "foo" });
    const r = runCli(["status"]);
    expect(r.status).toBe(0);
    const out = r.stdout.split("\n").map(l => l.trim());
    expect(out).toContain("Swarm Drive Status");
    expect(out).toContain("localDir: foo");
    expect(out).toContain("active mode: manual");
    expect(out).toContain("lastSync: <no sync yet> — run “swarm-drive sync” to perform first upload");
  });

  it("reflects watch mode and prints only watchIntervalSeconds", () => {
    // seed config and state for watch
    fs.writeJsonSync(path.join(tmpDir, CONFIG_FILE), {
      localDir: "watched",
      watchIntervalSeconds: 5,
    });
    const now = new Date().toISOString();
    fs.writeJsonSync(path.join(tmpDir, STATE_PATH_NAME), {
      currentMode: StateMode.WATCH,
      lastSync: now,
      lastFiles: ["x.txt"],
    });

    const r = runCli(["status"]);
    expect(r.status).toBe(0);
    const out = r.stdout.split("\n").map(l => l.trim());

    expect(out).toContain("localDir: watched");
    expect(out).toContain("active mode: watch");
    expect(out).toContain("watchIntervalSeconds: 5");
    // scheduleIntervalSeconds was not set, so shouldn't appear:
    expect(out.some(l => l.startsWith("scheduleIntervalSeconds"))).toBe(false);

    expect(out.find(l => l.startsWith("lastSync:"))).toMatch(new RegExp(`lastSync: ${now} \\(\\d+ minute`));
    expect(out).toContain("lastFiles: 1 files");
  });

  it("reflects schedule mode, intervals, lastSync and file count", () => {
    fs.writeJsonSync(path.join(tmpDir, CONFIG_FILE), {
      localDir: "bar",
      watchIntervalSeconds: 12,
      scheduleIntervalSeconds: 34,
    });
    const now = new Date().toISOString();
    fs.writeJsonSync(path.join(tmpDir, STATE_PATH_NAME), {
      currentMode: StateMode.SCHEDULE,
      lastSync: now,
      lastFiles: ["a.txt", "b.txt", "c.txt"],
    });
    const r = runCli(["status"]);
    expect(r.status).toBe(0);
    const out = r.stdout.split("\n").map(l => l.trim());
    expect(out).toContain("localDir: bar");
    expect(out).toContain("active mode: schedule");
    expect(out).toContain("watchIntervalSeconds: 12");
    expect(out).toContain("scheduleIntervalSeconds: 34");
    expect(out.find(l => l.startsWith("lastSync:"))).toMatch(new RegExp(`lastSync: ${now} \\(\\d+ minute`));
    expect(out).toContain("lastFiles: 3 files");
  });
});
