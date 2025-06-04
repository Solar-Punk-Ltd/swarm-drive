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

export function makeBareBeeClient(): Bee {
  const signerKey = process.env.BEE_SIGNER_KEY!;
  if (!signerKey.startsWith("0x")) {
    throw new Error("🚨 BEE_SIGNER_KEY must be set in your environment and start with 0x");
  }
  return new Bee("http://localhost:1633", {
    signer: new PrivateKey(signerKey),
  });
}

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
    }
  } else {
    const data = await fs.readFile(localPath);
    const uploadRes = await bee.uploadData(batchId, data, { pin: true });
    node.addFork(prefix, uploadRes.reference.toString());
  }

  const saved = await node.saveRecursively(bee, batchId, { pin: true });
  return saved.reference.toString();
}

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

export async function readDriveFeed(
  bee: Bee,
  topic: Topic,
  ownerAddress: string
): Promise<string | undefined> {
  const reader = bee.makeFeedReader(topic.toUint8Array(), ownerAddress);

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
  }

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
  }

  return undefined;
}

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
