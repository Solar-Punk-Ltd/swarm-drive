import fs from "fs-extra";
import os from "os";
import path from "path";

import { syncCmd } from "../../src/commands/sync";
import { saveConfig } from "../../src/utils/config";
import { loadState, saveState } from "../../src/utils/state";
import * as swarm from "../../src/utils/swarm";
import { StateMode } from "../../src/utils/types";
import { Bytes, FeedIndex } from "@ethersphere/bee-js";
import { SWARM_ZERO_ADDRESS } from "../../src/utils/constants";

jest.mock("../../src/utils/swarm");
jest.spyOn(swarm, "downloadRemoteFile").mockResolvedValue(new Uint8Array());

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

  const NOT_FOUND_FEED_RESULT = {
    feedIndex: FeedIndex.MINUS_ONE,
    feedIndexNext: FeedIndex.fromBigInt(0n),
    payload: SWARM_ZERO_ADDRESS,
  };

  const FOUND_FEED_RESULT = {
    feedIndex: FeedIndex.fromBigInt(0n),
    feedIndexNext: FeedIndex.fromBigInt(1n),
    payload: new Bytes(DUMMY_REF),
  };

  beforeEach(async () => {
    await fs.ensureDir(tmp);
    process.chdir(tmp);

    await saveConfig({ localDir: tmp });
    await saveState({ lastSync: "", lastFiles: [], currentMode: StateMode.MANUAL });

    (swarm.createBeeWithBatch as jest.Mock).mockResolvedValue({
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
    (swarm.readDriveFeed as jest.Mock).mockResolvedValue(NOT_FOUND_FEED_RESULT);

    // whenever we do makeFeedReader().download(), return our dummy ref
    dummyBee.makeFeedReader = jest.fn().mockReturnValue({
      download: jest.fn().mockResolvedValue({
        payload: new Bytes(DUMMY_REF),
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
    (swarm.readDriveFeed as jest.Mock).mockResolvedValueOnce(NOT_FOUND_FEED_RESULT);
    (swarm.updateManifest as jest.Mock).mockResolvedValueOnce(undefined);
    (swarm.saveMantarayNode as jest.Mock).mockResolvedValue(DUMMY_REF);

    await syncCmd();

    (swarm.readDriveFeed as jest.Mock).mockResolvedValueOnce(FOUND_FEED_RESULT);
    (swarm.listRemoteFilesMap as jest.Mock).mockResolvedValueOnce({ "a.txt": "refA" });
    (swarm.downloadRemoteFile as jest.Mock).mockResolvedValueOnce(Bytes.fromUtf8("foo").toUint8Array());

    const logSpy = jest.spyOn(console, "log").mockImplementation(() => {});
    await syncCmd();
    expect(logSpy).toHaveBeenCalledWith("✅ [syncCmd] Nothing to sync.");
    logSpy.mockRestore();

    expect((swarm.writeDriveFeed as jest.Mock).mock.calls).toHaveLength(1);

    const st = await loadState();
    expect(st.lastFiles).toEqual(["a.txt"]);
  });

  it("pulls a remote-only file when none locally", async () => {
    (swarm.readDriveFeed as jest.Mock).mockResolvedValueOnce(FOUND_FEED_RESULT);
    (swarm.listRemoteFilesMap as jest.Mock).mockResolvedValueOnce({ "c.txt": "refC" });
    (swarm.downloadRemoteFile as jest.Mock).mockResolvedValueOnce(Bytes.fromUtf8("dataC").toUint8Array());
    (swarm.saveMantarayNode as jest.Mock).mockResolvedValue(DUMMY_REF);

    await syncCmd();

    const content = await fs.readFile(path.join(tmp, "c.txt"), "utf8");
    expect(content).toBe("dataC");

    const st = await loadState();
    expect(st.lastFiles).toEqual(["c.txt"]);
  });

  it("uploads a modified local file", async () => {
    await fs.writeFile(path.join(tmp, "b.txt"), "old");
    (swarm.readDriveFeed as jest.Mock).mockResolvedValueOnce(NOT_FOUND_FEED_RESULT);
    (swarm.updateManifest as jest.Mock).mockResolvedValueOnce(undefined);
    (swarm.saveMantarayNode as jest.Mock).mockResolvedValue(DUMMY_REF);

    await syncCmd();

    (swarm.readDriveFeed as jest.Mock).mockResolvedValueOnce(FOUND_FEED_RESULT);
    (swarm.listRemoteFilesMap as jest.Mock).mockResolvedValueOnce({ "b.txt": "refB" });
    (swarm.downloadRemoteFile as jest.Mock)
      .mockResolvedValueOnce(Bytes.fromUtf8("old").toUint8Array())
      .mockResolvedValueOnce(Bytes.fromUtf8("old").toUint8Array());

    const REMOVED_REF = "c".repeat(64);
    const NEW_REF = "d".repeat(64);
    (swarm.updateManifest as jest.Mock).mockResolvedValueOnce(REMOVED_REF).mockResolvedValueOnce(NEW_REF);
    (swarm.saveMantarayNode as jest.Mock).mockResolvedValue(NEW_REF);

    await fs.writeFile(path.join(tmp, "b.txt"), "new");
    await syncCmd();

    expect((swarm.updateManifest as jest.Mock).mock.calls).toHaveLength(3);

    expect(swarm.writeDriveFeed).toHaveBeenLastCalledWith(
      dummyBee,
      expect.anything(),
      "batch1",
      NEW_REF,
      expect.any(BigInt),
    );

    const st = await loadState();
    expect(st.lastFiles).toEqual(["b.txt"]);
  });
});
