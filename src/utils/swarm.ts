import inquirer from 'inquirer'
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
const BEE_API = process.env.BEE_API ?? "http://localhost:1633"

export function makeBareBeeClient(): Bee {
  const signerKey = process.env.BEE_SIGNER_KEY;
  if (!signerKey) {
    throw new Error("🚨 BEE_SIGNER_KEY must be set in your environment");
  }
  if (!signerKey.startsWith("0x")) {
    throw new Error("🚨 BEE_SIGNER_KEY must start with 0x in your environment");
  }
  return new Bee(BEE_API, {
    signer: new PrivateKey(signerKey),
  });
}


export async function createBeeClient(
  apiUrl: string,
  signerKey: string
): Promise<{ bee: Bee; swarmDriveBatch: PostageBatch }> {
  if (!signerKey.startsWith('0x')) {
    throw new Error('BEE_SIGNER_KEY must start with 0x')
  }
  const bee = new Bee(apiUrl, { signer: new PrivateKey(signerKey) })

  let batch = (await bee.getAllPostageBatch()).find(
    (b) => b.label === SWARM_DRIVE_STAMP_LABEL && b.usable
  )

  if (!batch) {
    console.log(`No "${SWARM_DRIVE_STAMP_LABEL}" stamp found.`)
    const { amount, depth, confirm } = await inquirer.prompt([
      { name: 'confirm', type: 'confirm', message: 'Buy a new stamp now?' },
      { name: 'amount',   type: 'input',   message: 'Amount (in BZZ):', default: '100000000000' },
      { name: 'depth',    type: 'number',  message: 'Depth:',             default: 20 },
    ])
    if (!confirm) {
      throw new Error('Cannot proceed without a postage stamp')
    }
    const batchID = await buyStamp(bee, amount, depth, SWARM_DRIVE_STAMP_LABEL)
    batch = (await bee.getAllPostageBatch()).find((b) => b.batchID.equals(batchID))!
  }

  return { bee, swarmDriveBatch: batch }
}

export async function getOwnerStamp(
  bee: Bee
): Promise<PostageBatch | undefined> {
  const batches = await bee.getAllPostageBatch();
  return batches.find((b) => b.label === SWARM_DRIVE_STAMP_LABEL && b.usable);
}

export async function buyStamp(
  bee: Bee,
  amount: string | bigint,
  depth: number,
  label = SWARM_DRIVE_STAMP_LABEL
): Promise<BatchId> {
  const existing = (await bee.getAllPostageBatch()).find(
    (b) => b.label === label && b.usable
  );
  if (existing) {
    return existing.batchID;
  }
  return await bee.createPostageBatch(amount, depth, {
    label,
    waitForUsable: true,
  });
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
      node = await MantarayNode.unmarshal(
        bee,
        new BeeReference(manifestRef)
      );
      await node.loadRecursively(bee);
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
    node = await MantarayNode.unmarshal(
      bee,
      new BeeReference(manifestRef)
    );
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
    node = await MantarayNode.unmarshal(
      bee,
      new BeeReference(manifestRef)
    );
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
    if (raw.length === 32) {
      const ref = new BeeReference(raw);
      if (!ref.equals(SWARM_ZERO_ADDRESS)) {
        return ref.toString();
      }
    }
  } catch {
  }

  try {
    const msg0 = await reader.download({ index: FeedIndex.fromBigInt(0n) });
    const raw0 = msg0.payload.toUint8Array();
    if (raw0.length === 32) {
      const ref0 = new BeeReference(raw0);
      if (!ref0.equals(SWARM_ZERO_ADDRESS)) {
        return ref0.toString();
      }
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

export async function readFeedIndex(
  bee: Bee,
  topic: Topic,
  ownerAddress: string
): Promise<bigint> {
  const reader = bee.makeFeedReader(topic.toUint8Array(), ownerAddress);
  try {
    await reader.download({ index: FeedIndex.fromBigInt(0n) });
  } catch (err: any) {
    if (err.status === 404) {
      return -1n;
    }
    throw err;
  }
  let idx = 1n;
  while (true) {
    try {
      await reader.download({ index: FeedIndex.fromBigInt(idx) });
      idx++;
    } catch (err: any) {
      if (err.status === 404) {
        return idx - 1n;
      }
      throw err;
    }
  }
}
