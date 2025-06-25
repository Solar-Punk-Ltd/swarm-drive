// tests/unit/sync.spec.ts
import fs from "fs-extra";
import path from "path";
import os from "os";
import { syncCmd } from "../../src/commands/sync";
import * as swarm from "../../src/utils/swarm";
import { saveConfig } from "../../src/utils/config";
import { loadState, saveState } from "../../src/utils/state";

jest.mock("../../src/utils/swarm");

describe("sync command – latest remote-only implementation", () => {
  const tmp = path.join(os.tmpdir(), `swarm-drive-test-sync-${Date.now()}`);
  const cwdBefore = process.cwd();
  const DUMMY_REF = "a".repeat(64);
  const dummyBee = {
    signer: {
      publicKey: () => ({
        address: () => ({ toString: () => "ownerAddress" }),
      }),
    },
    // we’ll stub this below:
    makeFeedReader: jest.fn(),
  };

  beforeEach(async () => {
    await fs.ensureDir(tmp);
    process.chdir(tmp);

    // point the CLI at our temp dir
    await saveConfig({ localDir: tmp });
    // fresh state: no files, no manifest
    await saveState({ lastSync: "", lastFiles: [] });

    // stub out Bee client & feed writer
    (swarm.createBeeClient as jest.Mock).mockResolvedValue({
      bee: dummyBee,
      swarmDriveBatch: { batchID: "batch1" },
    });
    (swarm.writeDriveFeed as jest.Mock).mockResolvedValue(undefined);

    // default: no entries in the feed (slot 0 missing)
    (swarm.readFeedIndex as jest.Mock).mockResolvedValue(-1n);

    // whenever we do makeFeedReader().download(), return our dummy ref
    dummyBee.makeFeedReader = jest.fn().mockReturnValue({
      download: jest.fn().mockResolvedValue({
        payload: { toUint8Array: () => Buffer.from(DUMMY_REF, "hex") },
      }),
    });
  });

  afterEach(async () => {
    jest.resetAllMocks();
    process.chdir(cwdBefore);
    await fs.remove(tmp);
  });

  it("no-ops when nothing changed", async () => {
    // ─── First run: add a.txt ───────────────────────────────────────
    await fs.writeFile(path.join(tmp, "a.txt"), "foo");
    // feed empty
    (swarm.readFeedIndex as jest.Mock).mockResolvedValueOnce(-1n);
    // updateManifest returns our dummy manifest
    (swarm.updateManifest as jest.Mock).mockResolvedValueOnce(DUMMY_REF);

    await syncCmd();

    // ─── Second run: remote has exactly the same a.txt ─────────────
    // now stub readFeedIndex→0 so we pick up slot 0
    (swarm.readFeedIndex as jest.Mock).mockResolvedValueOnce(0n);
    // listRemoteFilesMap returns exactly that file
    (swarm.listRemoteFilesMap as jest.Mock).mockResolvedValueOnce({ "a.txt": "refA" });
    // downloadRemoteFile returns identical contents
    (swarm.downloadRemoteFile as jest.Mock).mockResolvedValueOnce(Buffer.from("foo"));

    const logSpy = jest.spyOn(console, "log").mockImplementation(() => {});
    await syncCmd();
    // check the spy
    expect(logSpy).toHaveBeenLastCalledWith("✅ [syncCmd] Nothing to sync.");
    logSpy.mockRestore();

    // we only ever wrote once (the first run)
    expect((swarm.writeDriveFeed as jest.Mock).mock.calls.length).toBe(1);

    const st = await loadState();
    expect(st.lastFiles).toEqual(["a.txt"]);
  });

  it("pulls a remote-only file when none locally", async () => {
    // remote manifest exists at slot 0
    (swarm.readFeedIndex as jest.Mock).mockResolvedValueOnce(0n);
    // remote contains c.txt
    (swarm.listRemoteFilesMap as jest.Mock).mockResolvedValueOnce({ "c.txt": "refC" });
    // downloadRemoteFile returns its data
    (swarm.downloadRemoteFile as jest.Mock).mockResolvedValueOnce(Buffer.from("dataC"));

    await syncCmd();

    // c.txt must have been created
    const content = await fs.readFile(path.join(tmp, "c.txt"), "utf8");
    expect(content).toBe("dataC");

    const st = await loadState();
    expect(st.lastFiles).toEqual(["c.txt"]);
  });

  it("uploads a modified local file", async () => {
    // ─── First run: upload b.txt ───────────────────────────────────
    await fs.writeFile(path.join(tmp, "b.txt"), "old");
    (swarm.readFeedIndex as jest.Mock).mockResolvedValueOnce(-1n);
    (swarm.updateManifest as jest.Mock).mockResolvedValueOnce(DUMMY_REF);
    await syncCmd();

    // ─── Second run: b.txt changed locally ────────────────────────
    (swarm.readFeedIndex as jest.Mock).mockResolvedValueOnce(0n);
    (swarm.listRemoteFilesMap as jest.Mock).mockResolvedValueOnce({ "b.txt": "refB" });
    (swarm.downloadRemoteFile as jest.Mock).mockResolvedValueOnce(Buffer.from("old"));

    // next two calls to updateManifest are: remove then add
    const REMOVED_REF = "c".repeat(64);
    const NEW_REF     = "d".repeat(64);
    // first two calls (initial run) consumed DUMMY_REF; next two are remove/add
    (swarm.updateManifest as jest.Mock)
      .mockResolvedValueOnce(REMOVED_REF)
      .mockResolvedValueOnce(NEW_REF);

    // actually change the file
    await fs.writeFile(path.join(tmp, "b.txt"), "new");
    await syncCmd();

    // updateManifest must have been called (remove + add)
    expect((swarm.updateManifest as jest.Mock).mock.calls.length).toBe(3);

    // and the **last** feed write must use NEW_REF
    expect(swarm.writeDriveFeed).toHaveBeenLastCalledWith(
      dummyBee,
      expect.anything(),
      "batch1",
      NEW_REF,
      expect.any(BigInt)
    );

    const st = await loadState();
    expect(st.lastFiles).toEqual(["b.txt"]);
  });
});
