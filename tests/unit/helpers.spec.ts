jest.mock("@ethersphere/bee-js", () => {
  const ZERO_BUF = Buffer.alloc(32, 0);

  return {
    Bee: jest.fn(),
    PrivateKey: jest.fn(),
    Topic: class {
      constructor(_buf: Uint8Array) {}
      toUint8Array() {
        return Buffer.alloc(32, 0);
      }
    },
    Reference: class {
      private buf: Buffer;
      constructor(address: any) {
        this.buf = Buffer.isBuffer(address) ? address : ZERO_BUF;
      }
      equals(other: any) {
        const otherBuf = Buffer.isBuffer(other)
          ? other
          : other instanceof (this.constructor as any)
            ? (other as any).buf
            : null;
        return Buffer.isBuffer(otherBuf) && this.buf.equals(otherBuf);
      }
      toString() {
        return "00".repeat(32);
      }
    },
    NULL_ADDRESS: ZERO_BUF,
    FeedIndex: {
      fromBigInt: (_: bigint) => ({}),
    },
  };
});

import { Bee } from "@ethersphere/bee-js";

import { feedGet, listStamps, manifestLs } from "../../src/utils/swarm";
import * as swarmUtils from "../../src/utils/swarm";
jest.mock("../../src/utils/swarm");

describe("helpers.ts", () => {
  let originalEnv: NodeJS.ProcessEnv;
  let logSpy: jest.SpyInstance;
  let errSpy: jest.SpyInstance;
  let exitSpy: jest.SpyInstance;

  beforeAll(() => {
    originalEnv = { ...process.env };
    logSpy = jest.spyOn(console, "log").mockImplementation(() => {});
    errSpy = jest.spyOn(console, "error").mockImplementation(() => {});
    exitSpy = jest.spyOn(process, "exit").mockImplementation((code?: number) => {
      throw new Error(`Process exited with code: ${code}`);
    });
  });

  afterAll(() => {
    process.env = originalEnv;
    jest.restoreAllMocks();
  });

  describe("makeBeeWithSigner (indirectly via feedGet)", () => {
    it("throws if BEE_SIGNER_KEY is missing", async () => {
      delete process.env.BEE_SIGNER_KEY;
      await expect(feedGet()).rejects.toThrow(/must be set/);
    });

    it("throws if BEE_SIGNER_KEY does not start with 0x", async () => {
      process.env.BEE_SIGNER_KEY = "abcd";
      await expect(feedGet()).rejects.toThrow(/must start with 0x/);
    });
  });

  describe("feedGet(indexArg)", () => {
    const dummySignerKey = "0x" + "1".repeat(64);

    beforeEach(() => {
      process.env.BEE_SIGNER_KEY = dummySignerKey;
      (swarmUtils.readDriveFeed as jest.Mock).mockReset();
      (swarmUtils.listRemoteFilesMap as jest.Mock).mockReset();
      (swarmUtils.makeBeeWithSigner as jest.Mock).mockReset();
    });

    it("prints hex when payload is exactly 32 bytes (non-zero)", async () => {
      const fakePayload = Buffer.from("a".repeat(64), "hex");
      const fakeReader = {
        download: jest.fn().mockResolvedValue({
          payload: { toUint8Array: () => fakePayload },
        }),
      };
      const fakeBeeInstance = {
        signer: {
          publicKey: () => ({ address: () => ({ toString: () => "ownerAddr" }) }),
        },
        makeFeedReader: jest.fn().mockReturnValue(fakeReader),
      } as any as Bee;

      (Bee as jest.Mock).mockImplementation(() => fakeBeeInstance);

      await expect(feedGet(5)).resolves.toBeUndefined();
      expect(logSpy).toHaveBeenCalledWith(expect.stringMatching(/^Feed@5 → [0-9a-f]{64}$/));
    });

    it("prints zero-address when payload is 32 bytes of zero", async () => {
      const zeroBuf = Buffer.alloc(32, 0);
      const fakeReader = {
        download: jest.fn().mockResolvedValue({
          payload: { toUint8Array: () => zeroBuf },
        }),
      };
      const fakeBeeInstance = {
        signer: {
          publicKey: () => ({ address: () => ({ toString: () => "ownerAddr" }) }),
        },
        makeFeedReader: jest.fn().mockReturnValue(fakeReader),
      } as any as Bee;

      (Bee as jest.Mock).mockImplementation(() => fakeBeeInstance);

      await expect(feedGet(3)).resolves.toBeUndefined();
      expect(logSpy).toHaveBeenCalledWith("Feed@3 → zero address (empty)");
    });

    it("prints length-mismatch if payload is not 32 bytes", async () => {
      const shortBuf = Buffer.from("hello");
      const fakeReader = {
        download: jest.fn().mockResolvedValue({
          payload: { toUint8Array: () => shortBuf },
        }),
      };
      const fakeBeeInstance = {
        signer: {
          publicKey: () => ({ address: () => ({ toString: () => "ownerAddr" }) }),
        },
        makeFeedReader: jest.fn().mockReturnValue(fakeReader),
      } as any as Bee;

      (Bee as jest.Mock).mockImplementation(() => fakeBeeInstance);

      await expect(feedGet(2)).resolves.toBeUndefined();
      expect(logSpy).toHaveBeenCalledWith("Feed@2 → payload length 5, not a 32-byte reference.");
    });

    it("calls process.exit(1) on download error", async () => {
      const fakeReader = {
        download: jest.fn().mockRejectedValue(new Error("download failed")),
      };
      const fakeBeeInstance = {
        signer: {
          publicKey: () => ({ address: () => ({ toString: () => "ownerAddr" }) }),
        },
        makeFeedReader: jest.fn().mockReturnValue(fakeReader),
      } as any as Bee;

      (Bee as jest.Mock).mockImplementation(() => fakeBeeInstance);

      await expect(feedGet(1)).rejects.toThrow("Process exited with code: 1");
      expect(errSpy).toHaveBeenCalledWith("Failed to read feed@1:", "download failed");
    });

    it("prints latest when no indexArg and readDriveFeed returns ref", async () => {
      const fakeBeeInstance = {
        signer: {
          publicKey: () => ({ address: () => ({ toString: () => "ownerAddr" }) }),
        },
      } as any as Bee;
      (Bee as jest.Mock).mockImplementation(() => fakeBeeInstance);

      (swarmUtils.readDriveFeed as jest.Mock).mockResolvedValue("abcdef");
      await expect(feedGet()).resolves.toBeUndefined();
      expect(logSpy).toHaveBeenCalledWith("Feed@latest → abcdef");
    });

    it("prints zero-address when no indexArg and readDriveFeed returns undefined", async () => {
      const fakeBeeInstance = {
        signer: {
          publicKey: () => ({ address: () => ({ toString: () => "ownerAddr" }) }),
        },
      } as any as Bee;
      (Bee as jest.Mock).mockImplementation(() => fakeBeeInstance);

      (swarmUtils.readDriveFeed as jest.Mock).mockResolvedValue(undefined);
      await expect(feedGet()).resolves.toBeUndefined();
      expect(logSpy).toHaveBeenCalledWith("Feed@latest → zero address (empty) or no feed entry yet");
    });

    it("exits on readDriveFeed error", async () => {
      const fakeBeeInstance = {
        signer: {
          publicKey: () => ({ address: () => ({ toString: () => "ownerAddr" }) }),
        },
      } as any as Bee;
      (Bee as jest.Mock).mockImplementation(() => fakeBeeInstance);

      (swarmUtils.readDriveFeed as jest.Mock).mockRejectedValue(new Error("oops"));
      await expect(feedGet()).rejects.toThrow("Process exited with code: 1");
      expect(errSpy).toHaveBeenCalledWith("Failed to read feed@latest:", "oops");
    });
  });

  describe("manifestLs()", () => {
    beforeEach(() => {
      process.env.BEE_SIGNER_KEY = "0x" + "2".repeat(64);
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
      const fakeBee = { getAllPostageBatch: jest.fn().mockResolvedValue([]) } as any;
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
        getAllPostageBatch: jest.fn().mockResolvedValue([fakeBatch]),
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
