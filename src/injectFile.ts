// src/injectC.ts
import dotenv from "dotenv";
dotenv.config();

import {
  createBeeClient,
  writeDriveFeed,
} from "./utils/swarm";
import { DRIVE_FEED_TOPIC, SWARM_ZERO_ADDRESS } from "./utils/constants";
import {
  Bee,
  PrivateKey,
  FeedIndex,
  Reference as BeeReference,
  MantarayNode,
} from "@ethersphere/bee-js";

async function main() {
  // 0) Check key
  const signerKey = "0x19373b650320750baf5fe63aa2da57f52cd9e124e4d4242e6896de9c2ec94db3";
  if (!signerKey || !signerKey.startsWith("0x")) {
    console.error("✖ BEE_SIGNER_KEY must be set to a 0x-prefixed private key");
    process.exit(1);
  }

  // 1) Connect and find your swarm-drive batch
  const { bee, swarmDriveBatch } = await createBeeClient(
    "http://localhost:1633",
    signerKey
  );
  const batchID = swarmDriveBatch.batchID;

  // 2) Read current feed@0 (override) to get old manifest if any
  const owner = new PrivateKey(signerKey).publicKey().address().toString();
  const reader = bee.makeFeedReader(DRIVE_FEED_TOPIC.toUint8Array(), owner);

  let oldManifest: string | undefined;
  try {
    const msg = await reader.download({ index: FeedIndex.fromBigInt(0n) });
    const raw = msg.payload.toUint8Array();
    if (raw.length === 32) {
      const ref = new BeeReference(raw);
      if (!ref.equals(SWARM_ZERO_ADDRESS)) {
        oldManifest = ref.toString();
      }
    }
  } catch {
    // no feed entry yet
  }
  console.log("▶ Old manifest:", oldManifest ?? "(none)");

  // 3) Prepare a MantarayNode, loading the old manifest if it exists
  let node: MantarayNode;
  if (oldManifest) {
    const refObj = new BeeReference(oldManifest);
    node = await MantarayNode.unmarshal(bee, refObj);
    await node.loadRecursively(bee);
  } else {
    node = new MantarayNode();
  }

  // 4) Inject our in-memory c.txt
  const drivePath = "c.txt";
  const content = Buffer.from(
    `This is injected c.txt at ${new Date().toISOString()}\n`
  );
  console.log(`➕ Adding "${drivePath}" → ${content.length} bytes`);
  const upload = await bee.uploadData(batchID, content, { pin: true });
  node.addFork(drivePath, upload.reference.toString());

  // 5) Save the new manifest recursively
  const saved = await node.saveRecursively(bee, batchID, { pin: true });
  const newManifest = saved.reference.toString();
  console.log("✔ New manifestRef →", newManifest);

  // 6) Write it into feed@index=0
  const writer = bee.makeFeedWriter(
    DRIVE_FEED_TOPIC.toUint8Array(),
    bee.signer!
  );
  await writer.uploadReference(batchID, new BeeReference(newManifest), {
    index: FeedIndex.fromBigInt(0n),
  });
  console.log("✔ Wrote feed@0 →", newManifest);

  console.log("\n✅ injectC.ts done. Now run `swarm-cli sync` to pull in c.txt");
}

main().catch((err) => {
  console.error("✖ injectC.ts error:", err);
  process.exit(1);
});
