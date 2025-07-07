import fs from "fs-extra";
import path from "path";
import os from "os";

import { configSetCmd, configGetCmd } from "../../src/commands/config";
import * as cfgMod from "../../src/utils/config";

jest.mock("../../src/utils/config");

describe("config command", () => {
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

  describe("configSetCmd", () => {
    let saveConfigSpy: jest.SpyInstance;
    beforeEach(() => {
      (cfgMod.loadConfig as jest.Mock).mockResolvedValue({
        localDir: "foo",
        watchIntervalSeconds: 5,
        scheduleIntervalSeconds: 10,
      });
      saveConfigSpy = jest.spyOn(cfgMod, "saveConfig").mockResolvedValue();
    });

    it("sets localDir", async () => {
      const logSpy = jest.spyOn(console, "log").mockImplementation(() => {});
      await configSetCmd("localDir", "bar");
      expect(saveConfigSpy).toHaveBeenCalledWith(
        expect.objectContaining({ localDir: "bar" })
      );
      expect(logSpy).toHaveBeenCalledWith("localDir = bar");
    });

    it("sets watchIntervalSeconds to valid non-negative integer", async () => {
      const logSpy = jest.spyOn(console, "log").mockImplementation(() => {});
      await configSetCmd("watchIntervalSeconds", "30");
      expect(saveConfigSpy).toHaveBeenCalledWith(
        expect.objectContaining({ watchIntervalSeconds: 30 })
      );
      expect(logSpy).toHaveBeenCalledWith("watchIntervalSeconds = 30");
    });

    it("errors on invalid watchIntervalSeconds", async () => {
      const errSpy = jest.spyOn(console, "error").mockImplementation(() => {});
      const exitSpy = jest
        .spyOn(process, "exit")
        .mockImplementation((() => { throw new Error("exit"); }) as any);
      await expect(configSetCmd("watchIntervalSeconds", "-1")).rejects.toThrow("exit");
      expect(errSpy).toHaveBeenCalledWith(
        `Error: "-1" is not a valid non-negative integer for watchIntervalSeconds.`
      );
      exitSpy.mockRestore();
    });

    it("sets scheduleIntervalSeconds to valid non-negative integer", async () => {
      const logSpy = jest.spyOn(console, "log").mockImplementation(() => {});
      await configSetCmd("scheduleIntervalSeconds", "60");
      expect(saveConfigSpy).toHaveBeenCalledWith(
        expect.objectContaining({ scheduleIntervalSeconds: 60 })
      );
      expect(logSpy).toHaveBeenCalledWith("scheduleIntervalSeconds = 60");
    });

    it("errors on invalid scheduleIntervalSeconds", async () => {
      const errSpy = jest.spyOn(console, "error").mockImplementation(() => {});
      const exitSpy = jest
        .spyOn(process, "exit")
        .mockImplementation((() => { throw new Error("exit"); }) as any);
      await expect(configSetCmd("scheduleIntervalSeconds", "abc")).rejects.toThrow("exit");
      expect(errSpy).toHaveBeenCalledWith(
        `Error: "abc" is not a valid non-negative integer for scheduleIntervalSeconds.`
      );
      exitSpy.mockRestore();
    });

    it("errors on unknown key", async () => {
      const errSpy = jest.spyOn(console, "error").mockImplementation(() => {});
      const exitSpy = jest
        .spyOn(process, "exit")
        .mockImplementation((() => { throw new Error("exit"); }) as any);
      await expect(configSetCmd("fooBar", "123")).rejects.toThrow("exit");
      expect(errSpy).toHaveBeenCalledWith(
        `Error: "fooBar" is not a valid configuration key.`
      );
      exitSpy.mockRestore();
    });
  });

  describe("configGetCmd", () => {
    beforeEach(() => {
      (cfgMod.loadConfig as jest.Mock).mockResolvedValue({
        localDir: "my/data",
        watchIntervalSeconds: 7,
        scheduleIntervalSeconds: 13,
      });
    });

    it("gets localDir", async () => {
      const logSpy = jest.spyOn(console, "log").mockImplementation(() => {});
      await configGetCmd("localDir");
      expect(logSpy).toHaveBeenCalledWith("localDir = my/data");
    });

    it("gets watchIntervalSeconds", async () => {
      const logSpy = jest.spyOn(console, "log").mockImplementation(() => {});
      await configGetCmd("watchIntervalSeconds");
      expect(logSpy).toHaveBeenCalledWith("watchIntervalSeconds = 7");
    });

    it("gets scheduleIntervalSeconds", async () => {
      const logSpy = jest.spyOn(console, "log").mockImplementation(() => {});
      await configGetCmd("scheduleIntervalSeconds");
      expect(logSpy).toHaveBeenCalledWith("scheduleIntervalSeconds = 13");
    });

    it("errors on unknown key", async () => {
      const errSpy = jest.spyOn(console, "error").mockImplementation(() => {});
      const exitSpy = jest
        .spyOn(process, "exit")
        .mockImplementation((() => { throw new Error("exit"); }) as any);
      await expect(configGetCmd("fooBar")).rejects.toThrow("exit");
      expect(errSpy).toHaveBeenCalledWith(
        `Error: "fooBar" is not a valid configuration key.`
      );
      exitSpy.mockRestore();
    });
  });
});
