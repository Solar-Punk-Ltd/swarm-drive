jest.mock("../../src/commands/sync", () => ({
  syncCmd: jest.fn(),
}));

import { scheduleCmd } from "../../src/commands/schedule";
import { syncCmd } from "../../src/commands/sync";
import * as configUtils from "../../src/utils/config";

jest.useFakeTimers();

describe("scheduleCmd", () => {
  let loadConfigSpy: jest.SpyInstance;

  beforeEach(() => {
    loadConfigSpy = jest.spyOn(configUtils, "loadConfig").mockResolvedValue({ localDir: "dummy" } as any);

    jest.spyOn(console, "log").mockImplementation(() => {});
    jest.spyOn(console, "error").mockImplementation(() => {});

    (syncCmd as jest.Mock).mockClear();
  });

  afterEach(() => {
    jest.clearAllMocks();
    jest.clearAllTimers();
    loadConfigSpy.mockRestore();
  });

  it("runs syncCmd once immediately and then schedules at given interval", async () => {
    (syncCmd as jest.Mock).mockResolvedValue(undefined);

    const neverResolves = scheduleCmd(5);

    await Promise.resolve();
    await Promise.resolve();

    expect(syncCmd).toHaveBeenCalledTimes(1);
    expect(console.log).toHaveBeenCalledWith('Scheduling sync for "dummy" every 5 seconds…');
    expect(console.log).toHaveBeenCalledWith("Initial run: running sync now…");

    jest.advanceTimersByTime(5000);

    await Promise.resolve();
    expect(syncCmd).toHaveBeenCalledTimes(2);

    jest.advanceTimersByTime(5000);
    await Promise.resolve();
    expect(syncCmd).toHaveBeenCalledTimes(3);

    neverResolves.catch(() => {});
  });

  it("logs error if syncCmd throws during scheduled run", async () => {
    (syncCmd as jest.Mock).mockImplementationOnce(async () => {}).mockRejectedValueOnce(new Error("sync failed"));

    const neverResolves = scheduleCmd(2);

    await Promise.resolve();
    await Promise.resolve();

    jest.advanceTimersByTime(2000);
    await Promise.resolve();

    expect(console.error).toHaveBeenCalledWith("Error during scheduled sync:", "sync failed");

    neverResolves.catch(() => {});
  });
});
