// tests/unit/init.spec.ts
import fs from "fs-extra";
import path from "path";
import os from "os";
import { initCmd } from "../../src/commands/init";
import { loadConfig } from "../../src/utils/config";
import { createBeeClient } from "../../src/utils/swarm";

jest.mock("../../src/utils/swarm");

const BEE_API = process.env.BEE_API ?? "http://localhost:1633"

describe("init command", () => {
  const tmp = path.join(os.tmpdir(), `swarm-drive-test-${Date.now()}`);
  const cwdBefore = process.cwd();
  let consoleLogSpy: jest.SpyInstance;
  let consoleErrorSpy: jest.SpyInstance;

  beforeAll(async () => {
    // set up a fake temporary directory as the CWD
    await fs.ensureDir(tmp);
    process.chdir(tmp);

    // provide a valid signer key for createBeeClient
    process.env.BEE_SIGNER_KEY = "0x" + "1".repeat(64);
  });

  afterAll(async () => {
    process.chdir(cwdBefore);
    await fs.remove(tmp);
  });

  beforeEach(() => {
    consoleLogSpy = jest.spyOn(console, "log").mockImplementation(() => {});
    consoleErrorSpy = jest.spyOn(console, "error").mockImplementation(() => {});
    (createBeeClient as jest.Mock).mockReset();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("creates .swarm-sync.json, clears state, and initializes postage stamp", async () => {
    // ensure the localDir exists
    const localDir = "my-folder";
    await fs.ensureDir(path.join(tmp, localDir));

    // stub createBeeClient to return a fake batch
    const fakeBatch = { batchID: { toString: () => "batch-123" } };
    (createBeeClient as jest.Mock).mockResolvedValue({
      bee: {} as any,
      swarmDriveBatch: fakeBatch,
    });

    // run init
    await initCmd(localDir);

    // 1) config file
    const cfg = await loadConfig();
    expect(cfg.localDir).toBe(path.resolve(localDir));
    expect(cfg).not.toHaveProperty("volumeRef");

    // 2) empty state file
    const stateFile = path.resolve(".swarm-sync-state.json");
    const state = await fs.readJson(stateFile);
    expect(state).toEqual({});

    // 3) stamp initialization calls
    expect(createBeeClient).toHaveBeenCalledWith(
      BEE_API,
      process.env.BEE_SIGNER_KEY
    );

    // 4) log messages for stamp creation
    expect(consoleLogSpy).toHaveBeenCalledWith(
      "Initializing Bee client and ensuring postage stamp exists…"
    );
    expect(consoleLogSpy).toHaveBeenCalledWith(
      "Postage stamp ready → batchID: batch-123"
    );
  });

  it("exits with error when localDir is invalid", async () => {
    const badPath = "does-not-exist";

    const exitSpy = jest
      .spyOn(process, "exit")
      .mockImplementation((code?: number) => {
        throw new Error(`Process exit: ${code}`);
      });

    await expect(initCmd(badPath)).rejects.toThrow("Process exit: 1");
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      `Error: \`${badPath}\` is invalid or not accessible.`
    );
    expect(exitSpy).toHaveBeenCalledWith(1);

    exitSpy.mockRestore();
  });
});
