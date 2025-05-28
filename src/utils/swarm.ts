import fs from "fs/promises";
import {
  Bee,
  PrivateKey,
  PostageBatch,
  BatchId,
  MantarayNode,
  Reference as BeeReference,
} from "@ethersphere/bee-js";

const OWNER_STAMP_LABEL = "owner-stamp";

/**
 * Instantiates a Bee HTTP client + picks out your "owner-stamp" batch.
 */
export async function createBeeClient(
  apiUrl: string,
  signerKey: string
): Promise<{ bee: Bee; ownerBatch: PostageBatch }> {
  if (!signerKey.startsWith("0x")) {
    throw new Error("BEE_SIGNER_KEY must start with 0x");
  }
  const signer = new PrivateKey(signerKey);
  const bee = new Bee(apiUrl, { signer });

  const allBatches = await bee.getAllPostageBatch();
  const ownerBatch = allBatches.find((b) => b.label === OWNER_STAMP_LABEL);
  if (!ownerBatch) {
    throw new Error(
      `No owner-stamp found (label="${OWNER_STAMP_LABEL}").\n` +
      `Please run:\n` +
      `  swarm-cli stamp buy --amount <amt> --depth <depth> --label ${OWNER_STAMP_LABEL}`
    );
  }

  return { bee, ownerBatch };
}

/**
 * Download (or init) a MantarayNode, apply an upload or delete,
 * then re-upload the marshaled node and return its new manifest reference.
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
      await node.loadRecursively(bee);
    } catch (err: any) {
      if (err.status === 404) {
        console.debug(`No existing manifest at ${manifestRef}, starting new node.`);
        node = new MantarayNode();
      } else {
        throw err;
      }
    }
  } else {
    node = new MantarayNode();
  }

  if (remove) {
    try {
      node.removeFork(prefix);
    } catch (err: any) {
      console.debug(`removeFork("${prefix}") no-op: ${err.message}`);
    }
  } else {
    const data = await fs.readFile(localPath);
    const up = await bee.uploadData(batchId, data, { pin: true });
    node.addFork(prefix, up.reference.toString());
  }

  const result = await node.saveRecursively(bee, batchId, { pin: true });
  return result.reference.toString();
}

/**
 * List all files currently in the Swarm manifest.
 * If the manifestRef doesn’t exist (404), we return [] rather than throw.
 */
export async function listRemoteFiles(
  bee: Bee,
  manifestRef: string | undefined
): Promise<string[]> {
  if (!manifestRef) return [];
  let node: MantarayNode;
  // **DIAGNOSTIC LOGGING START**
  console.log("⏳ Checking existence of manifest", manifestRef);
  try {
    // try to pull raw bytes
    const raw = await bee.downloadData(new BeeReference(manifestRef));
    console.log(`✅ raw manifest is ${raw.toUint8Array().length} bytes`);
  } catch (e: any) {
    console.warn(`⚠️  raw downloadData failed:`, e.status, e.message);
  }
  // **DIAGNOSTIC LOGGING END**

  try {
    const manifestRefObj = new BeeReference(manifestRef);
    node = await MantarayNode.unmarshal(bee, manifestRefObj);
    await node.loadRecursively(bee);
  } catch (err: any) {
    if (err.status === 404) {
      return [];
    }
    throw err;
  }
  return node.collect().map((n) => n.fullPathString);
}

/**
 * Download one file’s raw bytes from the manifest by its path.
 */
export async function downloadRemoteFile(
  bee: Bee,
  manifestRef: string,
  prefix: string
): Promise<Uint8Array> {
  const manifestRefObj = new BeeReference(manifestRef);
  const node = await MantarayNode.unmarshal(bee, manifestRefObj);
  await node.loadRecursively(bee);

  const leaf = node.find(prefix);
  if (!leaf) {
    throw new Error(`Path "${prefix}" not found in manifest ${manifestRef}`);
  }

  const ref = new BeeReference(leaf.targetAddress);
  const res = await bee.downloadFile(ref);

  return res.data.toUint8Array();
}
