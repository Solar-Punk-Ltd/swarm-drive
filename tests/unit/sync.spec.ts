import fs from "fs-extra";
import path from "path";
import os from "os";
import { syncCmd } from "../../src/commands/sync";
import * as swarm from "../../src/utils/swarm";
import { saveConfig } from "../../src/utils/config";
import { loadState, saveState } from "../../src/utils/state";

jest.mock("../../src/utils/swarm");
jest.spyOn(swarm, "downloadRemoteFile")
    .mockResolvedValue(new Uint8Array());

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
    makeFeedReader: jest.fn(),
  };

  beforeEach(async () => {
    await fs.ensureDir(tmp);
    process.chdir(tmp);

    await saveConfig({ localDir: tmp });
    await saveState({ lastSync: "", lastFiles: [] });

    (swarm.createBeeClient as jest.Mock).mockResolvedValue({
      bee: dummyBee,
      swarmDriveBatch: {
        batchID: "batch1",
        remainingSize: {
          toBytes: () => 1_000_000,
        },
      },
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
    await fs.writeFile(path.join(tmp, "a.txt"), "foo");
    (swarm.readFeedIndex as jest.Mock).mockResolvedValueOnce(-1n);
    (swarm.safeUpdateManifest as jest.Mock).mockResolvedValueOnce(DUMMY_REF);

    await syncCmd();

    (swarm.readFeedIndex as jest.Mock).mockResolvedValueOnce(0n);
    (swarm.listRemoteFilesMap as jest.Mock).mockResolvedValueOnce({ "a.txt": "refA" });
    (swarm.downloadRemoteFile as jest.Mock).mockResolvedValueOnce(Buffer.from("foo"));

    const logSpy = jest.spyOn(console, "log").mockImplementation(() => {});
    await syncCmd();
    expect(logSpy).toHaveBeenLastCalledWith("✅ [syncCmd] Nothing to sync.");
    logSpy.mockRestore();

    expect((swarm.writeDriveFeed as jest.Mock).mock.calls.length).toBe(1);

    const st = await loadState();
    expect(st.lastFiles).toEqual(["a.txt"]);
  });

  it("pulls a remote-only file when none locally", async () => {
    (swarm.readFeedIndex as jest.Mock).mockResolvedValueOnce(0n);
    (swarm.listRemoteFilesMap as jest.Mock).mockResolvedValueOnce({ "c.txt": "refC" });
    (swarm.downloadRemoteFile as jest.Mock).mockResolvedValueOnce(Buffer.from("dataC"));

    await syncCmd();

    const content = await fs.readFile(path.join(tmp, "c.txt"), "utf8");
    expect(content).toBe("dataC");

    const st = await loadState();
    expect(st.lastFiles).toEqual(["c.txt"]);
  });

  it("uploads a modified local file", async () => {
    await fs.writeFile(path.join(tmp, "b.txt"), "old");
    (swarm.readFeedIndex as jest.Mock).mockResolvedValueOnce(-1n);
    (swarm.safeUpdateManifest as jest.Mock).mockResolvedValueOnce(DUMMY_REF);
    await syncCmd();

    (swarm.readFeedIndex as jest.Mock).mockResolvedValueOnce(0n);
    (swarm.listRemoteFilesMap as jest.Mock).mockResolvedValueOnce({ "b.txt": "refB" });
    (swarm.downloadRemoteFile as jest.Mock).mockResolvedValueOnce(Buffer.from("old"));

    const REMOVED_REF = "c".repeat(64);
    const NEW_REF     = "d".repeat(64);
    (swarm.safeUpdateManifest as jest.Mock)
      .mockResolvedValueOnce(REMOVED_REF)
      .mockResolvedValueOnce(NEW_REF);

    await fs.writeFile(path.join(tmp, "b.txt"), "new");
    await syncCmd();

    expect((swarm.safeUpdateManifest as jest.Mock).mock.calls.length).toBe(3);

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
