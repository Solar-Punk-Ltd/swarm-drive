import fs from "fs-extra";
import path from "path";
import os from "os";

import { statusCmd } from "../../src/commands/status";
import * as cfgMod from "../../src/utils/config";
import * as stateMod from "../../src/utils/state";

jest.mock("../../src/utils/config");
jest.mock("../../src/utils/state");

describe("status command", () => {
  const cwdBefore = process.cwd();
  let tmp: string;

  beforeEach(async () => {
    tmp = path.join(os.tmpdir(), `swarm-drive-test-status-${Date.now()}`);
    await fs.ensureDir(tmp);
    process.chdir(tmp);
    jest.clearAllMocks();
  });

  afterEach(async () => {
    process.chdir(cwdBefore);
    await fs.remove(tmp);
  });

  it("errors when config missing or invalid", async () => {
    (cfgMod.loadConfig as jest.Mock).mockRejectedValue(new Error("no config"));
    const errSpy = jest.spyOn(console, "error").mockImplementation(() => {});
    const exitSpy = jest
      .spyOn(process, "exit")
      .mockImplementation((() => { throw new Error("exit"); }) as any);
    await expect(statusCmd()).rejects.toThrow("exit");
    expect(errSpy).toHaveBeenCalledWith(
      'Error: config file ".swarm-sync.json" not found. Please run "swarm-drive init <localDir>" first.'
    );
    exitSpy.mockRestore();
  });

  it("prints manual mode when no mode is set", async () => {
    (cfgMod.loadConfig as jest.Mock).mockResolvedValue({ localDir: "/data" });
    (stateMod.loadState as jest.Mock).mockResolvedValue({});
    const logSpy = jest.spyOn(console, "log").mockImplementation(() => {});
    // freeze Date.now so “minutes ago” is 0
    jest.spyOn(Date, "now").mockReturnValue(new Date("2025-01-01T00:00:00Z").getTime());
    await statusCmd();
    expect(logSpy).toHaveBeenCalledWith("Swarm Drive Status");
    expect(logSpy).toHaveBeenCalledWith("------------------");
    expect(logSpy).toHaveBeenCalledWith("localDir: /data");
    expect(logSpy).toHaveBeenCalledWith("active mode: manual");
    expect(logSpy).toHaveBeenCalledWith(
      'lastSync: <no sync yet> — run “swarm-drive sync” to perform first upload'
    );
  });

  it("prints watch mode and intervals and last sync info", async () => {
    (cfgMod.loadConfig as jest.Mock).mockResolvedValue({
      localDir: "/data",
      watchIntervalSeconds: 15,
      scheduleIntervalSeconds: 45,
    });
    const lastSync = new Date("2025-01-01T00:10:00Z").toISOString();
    (stateMod.loadState as jest.Mock).mockResolvedValue({
      currentMode: "watch",
      lastSync,
      lastFiles: ["a.txt", "b.txt"],
    });
    jest.spyOn(Date, "now").mockReturnValue(new Date("2025-01-01T00:12:30Z").getTime());
    const logSpy = jest.spyOn(console, "log").mockImplementation(() => {});
    await statusCmd();

    expect(logSpy).toHaveBeenCalledWith("active mode: watch");
    expect(logSpy).toHaveBeenCalledWith("watchIntervalSeconds: 15");
    expect(logSpy).toHaveBeenCalledWith("scheduleIntervalSeconds: 45");
    expect(logSpy).toHaveBeenCalledWith(
      `lastSync: ${lastSync} (2 minutes ago)`
    );
    expect(logSpy).toHaveBeenCalledWith("lastFiles: 2 files");
  });

  it("prints schedule mode when currentMode is schedule", async () => {
    (cfgMod.loadConfig as jest.Mock).mockResolvedValue({ localDir: "/data" });
    (stateMod.loadState as jest.Mock).mockResolvedValue({ currentMode: "schedule" });
    const logSpy = jest.spyOn(console, "log").mockImplementation(() => {});
    await statusCmd();
    expect(logSpy).toHaveBeenCalledWith("active mode: schedule");
  });
});
