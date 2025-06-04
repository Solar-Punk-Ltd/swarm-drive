import fs from "fs-extra";
import path from "path";
import os from "os";
import { syncCmd } from "../../src/commands/sync";
import * as swarm from "../../src/utils/swarm";
import { saveConfig } from "../../src/utils/config";
import { loadState, saveState } from "../../src/utils/state";

jest.mock("../../src/utils/swarm");

describe("sync command - additional cases", () => {
  const tmp = path.join(os.tmpdir(), `swarm-drive-test-sync2-${Date.now()}`);
  const cwdBefore = process.cwd();
  const DUMMY_REF = "a".repeat(64);
  const dummyBee = {
    signer: { publicKey: () => ({ address: () => ({ toString: () => "ownerAddress" }) }) },
  };

  beforeEach(async () => {
    await fs.ensureDir(tmp);
    process.chdir(tmp);
    await saveConfig({ localDir: tmp });
    await saveState({ lastSync: "", lastManifest: undefined, lastFiles: [] });
    (swarm.createBeeClient as jest.Mock).mockResolvedValue({ bee: dummyBee, swarmDriveBatch: { batchID: "batch1" } });
    (swarm.writeDriveFeed as jest.Mock).mockResolvedValue(undefined);
  });

  afterEach(async () => {
    jest.resetAllMocks();
    process.chdir(cwdBefore);
    await fs.remove(tmp);
  });

  it("no-ops when nothing changed", async () => {
    // Set up initial state: first run uploads "a.txt"
    await fs.writeFile(path.join(tmp, "a.txt"), "foo");
    (swarm.readDriveFeed as jest.Mock).mockResolvedValueOnce(undefined);
    (swarm.updateManifest as jest.Mock).mockResolvedValueOnce(DUMMY_REF);
    await syncCmd();
    let st = await loadState();
    expect(st.lastFiles).toEqual(["a.txt"]);
    expect(st.lastManifest).toBe(DUMMY_REF);

    // Second run: same files on remote
    (swarm.readDriveFeed as jest.Mock).mockResolvedValueOnce(DUMMY_REF);
    (swarm.listRemoteFilesMap as jest.Mock).mockResolvedValueOnce({ "a.txt": "refA" });
    // stub downloadRemoteFile to match local
    (swarm.downloadRemoteFile as jest.Mock).mockResolvedValueOnce(Buffer.from("foo"));

    // Capture console output
    const logSpy = jest.spyOn(console, "log").mockImplementation(() => {});
    await syncCmd();
    expect(logSpy).toHaveBeenCalledWith("✅ [syncCmd] Nothing to sync.");
    logSpy.mockRestore();
  });

  it("pulls a remote-only file when local has none", async () => {
    // Local has no files
    (swarm.readDriveFeed as jest.Mock).mockResolvedValueOnce(DUMMY_REF);
    (swarm.listRemoteFilesMap as jest.Mock).mockResolvedValueOnce({ "c.txt": "refC" });
    (swarm.downloadRemoteFile as jest.Mock).mockResolvedValueOnce(Buffer.from("dataC"));

    // Stub updateManifest so that it does not change manifest
    // but in this pull‐only scenario, there is no add/modify/delete,
    // only pull. So manifestRef remains DUMMY_REF.
    await saveState({ lastSync: "", lastManifest: DUMMY_REF, lastFiles: [] });

    await syncCmd();

    // Verify c.txt was written
    const exists = await fs.pathExists(path.join(tmp, "c.txt"));
    expect(exists).toBe(true);
    expect((await fs.readFile(path.join(tmp, "c.txt"))).toString()).toBe("dataC");

    const st = await loadState();
    expect(st.lastFiles).toEqual(["c.txt"]);
    expect(st.lastManifest).toBe(DUMMY_REF);
  });

  it("recovers remoteMap when manifestRef fails but prevFiles === localFiles", async () => {
    // Create a.txt locally
    await fs.writeFile(path.join(tmp, "x.txt"), "abc");

    // Fake state: lastManifest = "bad", lastFiles = ["x.txt"]
    await saveState({ lastSync: "", lastManifest: "bad", lastFiles: ["x.txt"] });

    // readDriveFeed → returns "bad"
    (swarm.readDriveFeed as jest.Mock).mockResolvedValueOnce("bad");

    // listRemoteFilesMap("bad") throws → triggers recover logic
    (swarm.listRemoteFilesMap as jest.Mock).mockRejectedValueOnce(new Error("invalid version hash"));

    // Since prevFiles === localFiles, it should recover remoteMap = { x.txt: "bad" }
    // Therefore no toAdd, no toPul, no toDelete. So final is no‐op:
    (swarm.listRemoteFilesMap as jest.Mock).mockResolvedValueOnce({}); // for wait-loop, but manifestRef = "bad"

    const logSpy = jest.spyOn(console, "log").mockImplementation(() => {});
    await syncCmd();
    expect(logSpy).toHaveBeenCalledWith("✅ [syncCmd] Nothing to sync.");
    logSpy.mockRestore();
  });

  it("loops waiting for manifest to become loadable", async () => {
    // Scenario: we add a.txt to remote, updateManifest returns a NEW manifest
    await fs.writeFile(path.join(tmp, "a.txt"), "foo");
    (swarm.readDriveFeed as jest.Mock).mockResolvedValueOnce(undefined);
    (swarm.updateManifest as jest.Mock).mockResolvedValueOnce("newHash");

    // listRemoteFilesMap throws 404 twice, then succeeds
    (swarm.listRemoteFilesMap as jest.Mock)
      .mockRejectedValueOnce(Object.assign(new Error("invalid version hash"), { status: 404 }))
      .mockRejectedValueOnce(Object.assign(new Error("invalid version hash"), { status: 404 }))
      .mockResolvedValueOnce({ "a.txt": "someRef" });

    await syncCmd();
    // If no errors thrown, it means loop eventually passed
    const st = await loadState();
    expect(st.lastManifest).toBe("newHash");
  });
});
