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
  Reference,
  Bytes,
} from "@ethersphere/bee-js";
import { DEFAULT_BEE_URL, DRIVE_FEED_TOPIC, SWARM_DRIVE_STAMP_LABEL, SWARM_ZERO_ADDRESS } from "./constants";
import { isNotFoundError } from "./helpers";


export function makeBeeWithSigner(apiUrl?: string, privateKey?: string): Bee {
  const signerKey = privateKey ?? process.env.BEE_SIGNER_KEY;
  if (!signerKey) {
    throw new Error("🚨 BEE_SIGNER_KEY must be set in your environment");
  }

  const beeApiUrl = process.env.BEE_API ?? DEFAULT_BEE_URL
  if (!beeApiUrl) {
    throw new Error("🚨 BEE_API must be set for your bee client");
  }

  return new Bee(apiUrl ?? beeApiUrl, {
    signer: new PrivateKey(signerKey),
  });
}

export async function createBeeWithBatch(
  apiUrl?: string,
  signerKey?: string
): Promise<{ bee: Bee; swarmDriveBatch: PostageBatch }> {
  const bee = makeBeeWithSigner(apiUrl, signerKey);

  let swarmDriveBatch = await getBatch(bee, undefined, SWARM_DRIVE_STAMP_LABEL);

  if (!swarmDriveBatch) {
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
    const batch = await getBatch(bee, batchID);
    if (!batch) {
      throw new Error('Swarm Drive batch could not be created')
    }

    swarmDriveBatch = batch;
  }

  return { bee, swarmDriveBatch }
}

export async function getBatch(
  bee: Bee,
  batchId?: string | BatchId,
  label?: string,
): Promise<PostageBatch | undefined> {
  if (!batchId && !label) {
    throw new Error("Either batchId or label must be provided");
  }

  const batches = await bee.getPostageBatches();
  if (batchId) {
    return batches.find((b) => b.batchID.equals(batchId) && b.usable);
  }

  return batches.find((b) => b.label === label && b.usable);
}

export async function buyStamp(
  bee: Bee,
  amount: string | bigint,
  depth: number,
  label = SWARM_DRIVE_STAMP_LABEL
): Promise<BatchId> {
  return await bee.createPostageBatch(amount, depth, {
    label,
    waitForUsable: true,
  });
}

export async function addRemoveFork(
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
      node = await loadMantarayNode(bee, manifestRef);
    } catch (err: any) {
      node = new MantarayNode();
    }
  } else {
    node = new MantarayNode();
  }

  if (remove) {
    try {
      node.removeFork(prefix);
    } catch (err: any) {
      console.error("failed to remove fork: ", err);
    }
  } else {
    const data = await fs.readFile(localPath);
    const uploadRes = await bee.uploadData(batchId, data, { pin: true });
    node.addFork(prefix, uploadRes.reference.toString());
  }

  const saved = await node.saveRecursively(bee, batchId, { pin: true });
  return saved.reference.toString();
}

export async function updateManifest(
  bee: Bee,
  batchId: BatchId,
  manifestRef: string | undefined,
  localPath: string,
  prefix: string,
  remove = false
): Promise<string> {
  try {
    return await addRemoveFork(
      bee,
      batchId,
      manifestRef,
      localPath,
      prefix,
      remove,
    )
  } catch (err: any) {
    if (err.message.includes("Invalid array length")) {
      const batch = await getBatch(bee, batchId);
      console.log("Stamp remaining size: ", batch?.remainingSize);
      console.log("Stamp utilization: ", batch?.utilization);

      throw new Error(
        `Stamp capacity low: cannot update manifest with "${prefix}". ` +
        `You'll need a larger batch for this file.`
      )
    }

    throw err
  }
}

export async function listRemoteFilesMap(
  bee: Bee,
  manifestRef: string
): Promise<Record<string, string>> {
  const node = await loadMantarayNode(bee, manifestRef);

  const nodesMap = node.collectAndMap();
  const out: Record<string, string> = {};
  for (const [p, ref] of Object.entries(nodesMap)) {
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
  const node = await loadMantarayNode(bee, manifestRef);

  const leaf = node.find(prefix);
  if (!leaf) {
    throw new Error(`Path "${prefix}" not found in manifest ${manifestRef}`);
  }

  const ref = new Reference(leaf.targetAddress);
  const data = await bee.downloadData(ref);
  return data.toUint8Array();
}

async function loadMantarayNode(bee: Bee, ref: string | Reference): Promise<MantarayNode> {
  let node: MantarayNode;
    try {
      node = await MantarayNode.unmarshal(
        bee,
        new Reference(ref)
      );
      await node.loadRecursively(bee);
    } catch (err: any) {
      throw new Error(`Failed to load mantaray node: ${err}`);
    }

    return node;
}

export async function readDriveFeed(
  bee: Bee,
  identifier: string | Uint8Array,
  address: string,
  index?: FeedIndex,
): Promise<{ref: Bytes, index: bigint}> {
  const feedReader = bee.makeFeedReader(identifier, address);
  const feedUpdate = await feedReader.downloadReference(index ? { index } : undefined);
  return {ref: feedUpdate.reference, index: feedUpdate.feedIndex.toBigInt()};
}

export async function writeDriveFeed(
  bee: Bee,
  topic: Topic,
  batchId: BatchId,
  manifestRef: string,
  index?: bigint
): Promise<void> {
  const writer = bee.makeFeedWriter(topic.toUint8Array(), bee.signer!);
  await writer.uploadReference(batchId, new Reference(manifestRef),  index === undefined ? undefined : { index: FeedIndex.fromBigInt(index) });
}

