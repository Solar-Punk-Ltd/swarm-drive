import {
  BatchId,
  Bee,
  Bytes,
  FeedIndex,
  MantarayNode,
  PostageBatch,
  PrivateKey,
  Reference,
  Topic,
} from "@ethersphere/bee-js";
import fs from "fs/promises";
import inquirer from "inquirer";

import { DEFAULT_BEE_URL, SWARM_DRIVE_STAMP_LABEL, SWARM_ZERO_ADDRESS } from "./constants";
import { FeedPayloadResult } from "@ethersphere/bee-js/dist/types/modules/feed";
import { isNotFoundError } from "./helpers";

export function makeBeeWithSigner(apiUrl?: string, privateKey?: string): Bee {
  const signerKey = privateKey ?? process.env.BEE_SIGNER_KEY;
  if (!signerKey) {
    throw new Error("🚨 BEE_SIGNER_KEY must be set in your environment");
  }

  const beeApiUrl = process.env.BEE_API ?? DEFAULT_BEE_URL;
  if (!apiUrl) {
    console.warn(`Using default Bee API URL: ${DEFAULT_BEE_URL}`);
  }

  return new Bee(apiUrl ?? beeApiUrl, {
    signer: new PrivateKey(signerKey),
  });
}

export async function createBeeWithBatch(
  apiUrl?: string,
  signerKey?: string,
): Promise<{ bee: Bee; swarmDriveBatch: PostageBatch }> {
  const bee = makeBeeWithSigner(apiUrl, signerKey);

  let swarmDriveBatch = await getBatch(bee, undefined, SWARM_DRIVE_STAMP_LABEL);

  if (!swarmDriveBatch) {
    console.log(`No "${SWARM_DRIVE_STAMP_LABEL}" stamp found.`);
    const { amount, depth, confirm } = await inquirer.prompt([
      { name: "confirm", type: "confirm", message: "Buy a new stamp now?" },
      { name: "amount", type: "input", message: "Amount (in BZZ):", default: "100000000000" },
      { name: "depth", type: "number", message: "Depth:", default: 20 },
    ]);
    if (!confirm) {
      throw new Error("Cannot proceed without a postage stamp");
    }
    const batchID = await buyStamp(bee, amount, depth, SWARM_DRIVE_STAMP_LABEL);
    const batch = await getBatch(bee, batchID);
    if (!batch) {
      throw new Error("Swarm Drive batch could not be created");
    }

    swarmDriveBatch = batch;
  }

  return { bee, swarmDriveBatch };
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
    return batches.find(b => b.batchID.equals(batchId) && b.usable);
  }

  return batches.find(b => b.label === label && b.usable);
}

export async function buyStamp(
  bee: Bee,
  amount: string | bigint,
  depth: number,
  label = SWARM_DRIVE_STAMP_LABEL,
): Promise<BatchId> {
  return await bee.createPostageBatch(amount, depth, {
    label,
    waitForUsable: true,
  });
}

export async function addRemoveFork(
  bee: Bee,
  batchId: BatchId,
  node: MantarayNode,
  localPath: string,
  prefix: string,
  remove = false,
): Promise<void> {
  if (remove) {
    node.removeFork(prefix);
  } else {
    const data = await fs.readFile(localPath);
    const uploadRes = await bee.uploadData(batchId, data, { pin: true });
    node.addFork(prefix, uploadRes.reference.toString());
  }
}

export async function saveMantarayNode(bee: Bee, node: MantarayNode, batchId: BatchId): Promise<string | undefined> {
  try {
    const saved = await node.saveRecursively(bee, batchId, { pin: true });
    return saved.reference.toString();
  } catch (error: any) {
    console.error("Error saving mantaray node:", error.message);
  }
}

export async function updateManifest(
  bee: Bee,
  batchId: BatchId,
  node: MantarayNode,
  localPath: string,
  prefix: string,
  remove = false,
): Promise<void> {
  try {
    await addRemoveFork(bee, batchId, node, localPath, prefix, remove);
  } catch (err: any) {
    if (err.message.includes("Invalid array length")) {
      const batch = await getBatch(bee, batchId);
      console.log("Stamp remaining size: ", batch?.remainingSize);
      console.log("Stamp utilization: ", batch?.utilization);

      throw new Error(
        `Stamp capacity low: cannot update manifest with "${prefix}". ` + `You'll need a larger batch for this file.`,
      );
    }

    throw err;
  }
}

export async function listRemoteFilesMap(node: MantarayNode): Promise<Record<string, string>> {
  const nodesMap = node.collectAndMap();
  const out: Record<string, string> = {};
  for (const [p, ref] of Object.entries(nodesMap)) {
    console.log("bagoy listRemoteFilesMap p, ref", p, ref);
    const key = p.startsWith("/") ? p.slice(1) : p;
    out[key] = ref.toString();
  }
  return out;
}

export async function downloadRemoteFile(bee: Bee, node: MantarayNode, prefix: string): Promise<Uint8Array> {
  const leaf = node.find(prefix);
  if (!leaf) {
    throw new Error(`Path "${prefix}" not found in manifest ${new Reference(node.targetAddress).toString()}`);
  }

  const ref = new Reference(leaf.targetAddress);
  const data = await bee.downloadData(ref);
  return data.toUint8Array();
}

export async function loadOrCreateMantarayNode(bee: Bee, ref: string | Reference): Promise<MantarayNode> {
  if (new Reference(ref).equals(SWARM_ZERO_ADDRESS)) {
    return new MantarayNode();
  }

  try {
    const node = await MantarayNode.unmarshal(bee, new Reference(ref));
    await node.loadRecursively(bee);
  } catch (err: any) {
    console.log(`Failed to load mantaray node: ${err}, returning a new node.`);
  }

  return new MantarayNode();
}

export async function readDriveFeed(
  bee: Bee,
  identifier: string | Uint8Array,
  address: string,
  index?: FeedIndex,
): Promise<FeedPayloadResult> {
  try {
    const feedReader = bee.makeFeedReader(identifier, address);
    if (index !== undefined) {
      return await feedReader.download({ index });
    }
    return await feedReader.download();
  } catch (error) {
    if (isNotFoundError(error)) {
      return {
        feedIndex: FeedIndex.MINUS_ONE,
        feedIndexNext: FeedIndex.fromBigInt(0n),
        payload: SWARM_ZERO_ADDRESS,
      };
    }

    throw error;
  }
}

export async function writeDriveFeed(
  bee: Bee,
  topic: Topic,
  batchId: BatchId,
  manifestRef: string,
  index?: bigint,
): Promise<void> {
  const writer = bee.makeFeedWriter(topic.toUint8Array(), bee.signer);
  await writer.uploadReference(
    batchId,
    new Reference(manifestRef),
    index === undefined ? undefined : { index: FeedIndex.fromBigInt(index) },
  );
}
