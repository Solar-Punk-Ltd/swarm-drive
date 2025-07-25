import { Bee, Bytes, FeedIndex } from "@ethersphere/bee-js";

import { feedGet, listStamps, manifestLs } from "../../src/commands/helpers";
import * as swarmUtils from "../../src/utils/swarm";
import { SWARM_ZERO_ADDRESS } from "../../src/utils/constants";
jest.mock("../../src/utils/swarm");

describe("helpers.ts", () => {
  let originalEnv: NodeJS.ProcessEnv;
  let logSpy: jest.SpyInstance;
  let errSpy: jest.SpyInstance;
  let exitSpy: jest.SpyInstance;

  const DUMMY_REF = "a".repeat(64);
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

  beforeAll(() => {
    originalEnv = { ...process.env };
    logSpy = jest.spyOn(console, "log").mockImplementation(() => {});
    errSpy = jest.spyOn(console, "error").mockImplementation(() => {});
    exitSpy = jest.spyOn(process, "exit").mockImplementation((code?: string | number | null | undefined) => {
      throw new Error(`Process exited with code: ${code}`);
    });
  });

  afterAll(() => {
    process.env = originalEnv;
    jest.restoreAllMocks();
  });

  describe("feedGet(indexArg)", () => {
    const dummySignerKey = "1".repeat(64);

    beforeEach(() => {
      process.env.BEE_SIGNER_KEY = dummySignerKey;
      (swarmUtils.listRemoteFilesMap as jest.Mock).mockReset();
      (swarmUtils.makeBeeWithSigner as jest.Mock).mockReturnValue({
        signer: {
          publicKey: () => ({ address: () => ({ toString: () => "ownerAddr" }) }),
        },
      } as any as Bee);
    });

    it("prints no feed entry yet when data is not found", async () => {
      (swarmUtils.readDriveFeed as jest.Mock).mockResolvedValue(NOT_FOUND_FEED_RESULT);
      await feedGet(5);
      expect(logSpy).toHaveBeenCalledWith(`Feed@${5} → no feed entry yet`);
    });

    it("prints data ref when found", async () => {
      (swarmUtils.readDriveFeed as jest.Mock).mockResolvedValue(FOUND_FEED_RESULT);
      await feedGet(5);
      expect(logSpy).toHaveBeenCalledWith(`Feed@${5} → ${FOUND_FEED_RESULT.payload.toString()}`);
    });

    it("throws on invalid index error", async () => {
      await expect(feedGet("random" as any)).rejects.toThrow("Invalid index argument, process exited with code: 1");
    });

    it("prints latest when no indexArg and readDriveFeed returns ref", async () => {
      (swarmUtils.readDriveFeed as jest.Mock).mockResolvedValue(FOUND_FEED_RESULT);
      await feedGet();
      expect(logSpy).toHaveBeenCalledWith(`Feed@latest → ${FOUND_FEED_RESULT.payload.toString()}`);
    });

    it("exits on readDriveFeed error", async () => {
      (swarmUtils.readDriveFeed as jest.Mock).mockRejectedValue(new Error("oops"));
      await expect(feedGet()).rejects.toThrow("oops");
    });
  });

  describe("manifestLs()", () => {
    beforeEach(() => {
      process.env.BEE_SIGNER_KEY = "2".repeat(64);
      jest.resetAllMocks();
    });

    it("prints empty when remote manifest has no files", async () => {
      const fakeBee = {} as Bee;
      (swarmUtils.makeBeeWithSigner as jest.Mock).mockReturnValue(fakeBee);
      (swarmUtils.listRemoteFilesMap as jest.Mock).mockResolvedValue({});

      await expect(manifestLs("someRef")).resolves.toBeUndefined();
      expect(logSpy).toHaveBeenCalledWith("Manifest someRef is empty.");
    });

    it("prints list of files when remote manifest has entries", async () => {
      const fakeBee = {} as Bee;
      (swarmUtils.makeBeeWithSigner as jest.Mock).mockReturnValue(fakeBee);
      (swarmUtils.listRemoteFilesMap as jest.Mock).mockResolvedValue({
        "a.txt": "refA",
        "b.txt": "refB",
      });

      await expect(manifestLs("someRef")).resolves.toBeUndefined();
      expect(logSpy).toHaveBeenCalledWith("Files under manifest someRef:");
      expect(logSpy).toHaveBeenCalledWith("  •", "a.txt");
      expect(logSpy).toHaveBeenCalledWith("  •", "b.txt");
    });

    it("exits on listRemoteFilesMap error", async () => {
      const fakeBee = {} as Bee;
      (swarmUtils.makeBeeWithSigner as jest.Mock).mockReturnValue(fakeBee);
      (swarmUtils.listRemoteFilesMap as jest.Mock).mockRejectedValue(new Error("fail"));

      await expect(manifestLs("badRef")).rejects.toThrow("Process exited with code: 1");
      expect(errSpy).toHaveBeenCalledWith("Failed to list manifest badRef:", "fail");
    });
  });

  describe("listStamps()", () => {
    it("prints no stamps if none exist", async () => {
      const fakeBee = { getPostageBatches: jest.fn().mockResolvedValue([]) } as any;
      (swarmUtils.makeBeeWithSigner as jest.Mock).mockReturnValue(fakeBee);

      await expect(listStamps()).resolves.toBeUndefined();
      expect(logSpy).toHaveBeenCalledWith("No postage batches found on this node.");
    });

    it("prints batch details when stamps exist", async () => {
      const fakeBatch = {
        batchID: { toString: () => "id1" },
        depth: 10,
        amount: 5,
        label: "lbl",
      };
      const fakeBee = {
        getPostageBatches: jest.fn().mockResolvedValue([fakeBatch]),
      } as any as Bee;
      (swarmUtils.makeBeeWithSigner as jest.Mock).mockReturnValue(fakeBee);

      await expect(listStamps()).resolves.toBeUndefined();
      expect(logSpy).toHaveBeenCalledWith("🗃️  Postage batches:");
      expect(logSpy).toHaveBeenCalledWith("  • BatchID: id1");
      expect(logSpy).toHaveBeenCalledWith("    Depth:   10");
      expect(logSpy).toHaveBeenCalledWith("    Amount:  5");
      expect(logSpy).toHaveBeenCalledWith("    Label:   lbl");
    });
  });
});
