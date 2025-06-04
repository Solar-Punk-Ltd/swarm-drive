jest.mock("chokidar");
jest.mock("../../src/commands/sync");
jest.mock("../../src/utils/config");

import { EventEmitter } from "events";
import chokidar from "chokidar";
import { watchCmd } from "../../src/commands/watch";
import { syncCmd } from "../../src/commands/sync";
import { loadConfig } from "../../src/utils/config";

describe("watchCmd", () => {
  let fakeWatcher: EventEmitter;
  let originalConsoleLog: typeof console.log;
  let originalConsoleError: typeof console.error;

  beforeAll(() => {
    jest.useFakeTimers();
    originalConsoleLog = console.log;
    originalConsoleError = console.error;
    console.log = jest.fn();
    console.error = jest.fn();
  });

  afterAll(() => {
    jest.useRealTimers();
    console.log = originalConsoleLog;
    console.error = originalConsoleError;
  });

  beforeEach(() => {
    fakeWatcher = new EventEmitter();
    (chokidar.watch as jest.Mock).mockReturnValue(fakeWatcher);
    (loadConfig as jest.Mock).mockResolvedValue({ localDir: "/tmp/test-dir" });
    (syncCmd as jest.Mock).mockClear();
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it("starts watching and triggers sync on file events with debounce", async () => {
    await watchCmd(500);
    expect(syncCmd).not.toHaveBeenCalled();

    fakeWatcher.emit("add", "/tmp/test-dir/file1.txt");
    fakeWatcher.emit("change", "/tmp/test-dir/file1.txt");
    fakeWatcher.emit("unlink", "/tmp/test-dir/file2.txt");

    jest.advanceTimersByTime(500);
    jest.runAllTimers();
    await Promise.resolve();
    expect(syncCmd).toHaveBeenCalledTimes(1);

    fakeWatcher.emit("change", "/tmp/test-dir/file3.txt");
    jest.advanceTimersByTime(500);
    jest.runAllTimers();
    await Promise.resolve();
    expect(syncCmd).toHaveBeenCalledTimes(2);

    fakeWatcher.removeAllListeners();
  });

  it("logs an error when the watcher emits an error event", async () => {
    const consoleErrorSpy = jest.spyOn(console, "error").mockImplementation(() => {});
    await watchCmd(300);

    const error = new Error("Watcher failed");
    fakeWatcher.emit("error", error);
    expect(consoleErrorSpy).toHaveBeenCalledWith("Watcher error:", error);

    fakeWatcher.removeAllListeners();
    consoleErrorSpy.mockRestore();
  });
});
