// src/utils/swarm.ts
import fs from "fs/promises";
import {
  Bee,
  PrivateKey,
  PostageBatch,
  BatchId,
  MantarayNode,
  FeedIndex,
  Topic,
  Reference as BeeReference,
} from "@ethersphere/bee-js";
import { SWARM_ZERO_ADDRESS } from "./constants";

const SWARM_DRIVE_STAMP_LABEL = "swarm-drive-stamp";

/**
 * Create a Bee client that simply connects to http://localhost:1633
 * using the private key stored in process.env.BEE_SIGNER_KEY.
 * (This function does NOT check for any postage stamps—it is for “read‐only” actions
 *   like listing stamps, reading feed, listing manifests, etc.)
 */
export function makeBareBeeClient(): Bee {
  const signerKey = process.env.BEE_SIGNER_KEY!;
  if (!signerKey.startsWith("0x")) {
    throw new Error("🚨 BEE_SIGNER_KEY must be set in your environment and start with 0x");
  }
  return new Bee("http://localhost:1633", {
    signer: new PrivateKey(signerKey),
  });
}

/**
 * Create a Bee client AND return the postage batch labeled "swarm-drive-stamp".
 * This is used in any function that needs to write to a Swarm Drive manifest or feed.
 * It will throw if no such stamp is found.
 */
export async function createBeeClient(
  apiUrl: string,
  signerKey: string
): Promise<{ bee: Bee; swarmDriveBatch: PostageBatch }> {
  if (!signerKey.startsWith("0x")) {
    throw new Error("BEE_SIGNER_KEY must start with 0x");
  }
  const signer = new PrivateKey(signerKey);
  const bee = new Bee(apiUrl, { signer });

  const allBatches = await bee.getAllPostageBatch();
  const swarmDriveBatch = allBatches.find(
    (b) => b.label === SWARM_DRIVE_STAMP_LABEL
  );
  if (!swarmDriveBatch) {
    throw new Error(
      `No swarm-drive-stamp found (label="${SWARM_DRIVE_STAMP_LABEL}").\n` +
        `Please run:\n` +
        `  swarm-cli stamp buy --amount <amt> --depth <depth> --label ${SWARM_DRIVE_STAMP_LABEL}`
    );
  }

  return { bee, swarmDriveBatch };
}

/**
 * Add or remove a single file from an existing Mantaray manifest. If remove=false,
 * it will upload data at `localPath` under the key `prefix`. If remove=true, it removes that prefix.
 * Returns the new manifest reference.
 */
export async function updateManifest(
  bee: Bee,
  batchId: BatchId,
  manifestRef: string | undefined,
  localPath: string,
  prefix: string,
  remove = false
): Promise<string> {
  let node: MantarayNode;

  if (manifestRef) {
    try {
      const manifestRefObj = new BeeReference(manifestRef);
      node = await MantarayNode.unmarshal(bee, manifestRefObj);
      try {
        await node.loadRecursively(bee);
      } catch {
        // If the old manifestRef no longer loads, start fresh
        throw new Error("invalid version hash");
      }
    } catch {
      node = new MantarayNode();
    }
  } else {
    node = new MantarayNode();
  }

  if (remove) {
    try {
      node.removeFork(prefix);
    } catch {
      // ignore if the fork didn't exist
    }
  } else {
    const data = await fs.readFile(localPath);
    const uploadRes = await bee.uploadData(batchId, data, { pin: true });
    node.addFork(prefix, uploadRes.reference.toString());
  }

  const saved = await node.saveRecursively(bee, batchId, { pin: true });
  return saved.reference.toString();
}

/**
 * Given a Swarm DRV manifest reference, download all of its leaf entries and
 * return a map from filename → 32‐byte reference‐hex.
 */
export async function listRemoteFilesMap(
  bee: Bee,
  manifestRef: string
): Promise<Record<string, string>> {
  let node: MantarayNode;
  try {
    const manifestRefObj = new BeeReference(manifestRef);
    node = await MantarayNode.unmarshal(bee, manifestRefObj);
  } catch {
    throw new Error("invalid version hash");
  }
  try {
    await node.loadRecursively(bee);
  } catch {
    throw new Error("invalid version hash");
  }

  const raw = node.collectAndMap();
  const out: Record<string, string> = {};
  for (const [p, ref] of Object.entries(raw)) {
    const key = p.startsWith("/") ? p.slice(1) : p;
    out[key] = ref.toString();
  }
  return out;
}

/**
 * Download a single file from a Swarm DRV manifest. Looks up `prefix` in the
 * given `manifestRef` and returns the bytes for that file.
 */
export async function downloadRemoteFile(
  bee: Bee,
  manifestRef: string,
  prefix: string
): Promise<Uint8Array> {
  let node: MantarayNode;
  try {
    const manifestRefObj = new BeeReference(manifestRef);
    node = await MantarayNode.unmarshal(bee, manifestRefObj);
  } catch {
    throw new Error("invalid version hash");
  }
  try {
    await node.loadRecursively(bee);
  } catch {
    throw new Error("invalid version hash");
  }

  const leaf = node.find(prefix);
  if (!leaf) {
    throw new Error(`Path "${prefix}" not found in manifest ${manifestRef}`);
  }
  const ref = new BeeReference(leaf.targetAddress);
  const data = await bee.downloadData(ref);
  return data.toUint8Array();
}

/**
 * Attempt one “latest” feed‐download; if that fails or is not 32 bytes,
 * fall back once to index=0. Return a valid 32‐byte reference‐string or undefined.
 */
export async function readDriveFeed(
  bee: Bee,
  topic: Topic,
  ownerAddress: string
): Promise<string | undefined> {
  const reader = bee.makeFeedReader(topic.toUint8Array(), ownerAddress);

  // 1) Try “latest” (no index)
  try {
    const msg = await reader.download();
    const raw = msg.payload.toUint8Array();
    if (raw.byteLength === 32) {
      const ref = new BeeReference(raw);
      if (!ref.equals(SWARM_ZERO_ADDRESS)) {
        return ref.toString();
      }
      return undefined;
    }
  } catch {
    // ignore, fall through to index=0 below
  }

  // 2) Fallback to index=0
  try {
    const msg0 = await reader.download({ index: FeedIndex.fromBigInt(0n) });
    const raw0 = msg0.payload.toUint8Array();
    if (raw0.byteLength === 32) {
      const ref0 = new BeeReference(raw0);
      if (!ref0.equals(SWARM_ZERO_ADDRESS)) {
        return ref0.toString();
      }
      return undefined;
    }
  } catch {
    // ignore
  }

  // Neither “latest” nor index=0 gave a 32‐byte reference → return undefined
  return undefined;
}

/**
 * Upload a new feed entry (32 bytes) at the given feed‐index. If index is omitted,
 * it defaults to 0. 
 */
export async function writeDriveFeed(
  bee: Bee,
  topic: Topic,
  ownerBatch: BatchId,
  manifestRef: string,
  index: bigint = 0n
): Promise<void> {
  const writer = bee.makeFeedWriter(topic.toUint8Array(), bee.signer!);
  await writer.uploadReference(ownerBatch, new BeeReference(manifestRef), {
    index: FeedIndex.fromBigInt(index),
  });
}
