import fs from "fs-extra";
import path from "path";
import os from "os";
import { initCmd } from "../../src/commands/init";
import { loadConfig } from "../../src/utils/config";

describe("init command", () => {
  const tmp = path.join(os.tmpdir(), `swarm-drive-test-${Date.now()}`);
  const cwdBefore = process.cwd();

  beforeAll(async () => {
    await fs.ensureDir(tmp);
    process.chdir(tmp);
  });

  afterAll(async () => {
    process.chdir(cwdBefore);
    await fs.remove(tmp);
  });

  it("creates .swarm-sync.json and clears state", async () => {
    // inside this test, we're already in `tmp`
    await fs.ensureDir(path.join(tmp, "my-folder"));

    // run `initCmd("my-folder")`
    await initCmd("my-folder");

    // Verify that `.swarm-sync.json` was created correctly:
    const cfg = await loadConfig();
    expect(cfg.localDir).toBe("my-folder");
    expect(cfg).not.toHaveProperty("volumeRef");

    // Now that we’ve run `initCmd`, it should have written an *empty* state
    // under “.swarm-sync-state.json” in the current directory (`tmp`).
    // We resolve this path *after* we’ve chdir-ed into `tmp`.
    const stateFile = path.resolve(".swarm-sync-state.json");
    const state = await fs.readJson(stateFile);
    expect(state).toEqual({});
  });

  it("exits with error when localDir is invalid", async () => {
    const badPath = "does-not-exist";

    const errorSpy = jest.spyOn(console, "error").mockImplementation(() => {});
    const exitSpy = jest
      .spyOn(process, "exit")
      .mockImplementation((code?: number) => {
        throw new Error(`Process exit: ${code}`);
      });

    await expect(initCmd(badPath)).rejects.toThrow("Process exit: 1");
    expect(errorSpy).toHaveBeenCalledWith(
      `Error: \`${badPath}\` is invalid or not accessible.`
    );
    expect(exitSpy).toHaveBeenCalledWith(1);

    exitSpy.mockRestore();
    errorSpy.mockRestore();
  });
});
