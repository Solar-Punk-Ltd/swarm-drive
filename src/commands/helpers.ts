import { FeedIndex } from "@ethersphere/bee-js";

import { DRIVE_FEED_TOPIC } from "../utils/constants";
import * as swarmUtils from "../utils/swarm";

export async function feedGet(indexArg?: number): Promise<void> {
  const bee = swarmUtils.makeBeeWithSigner();
  if (!bee.signer) {
    throw new Error("🚨 bee.signer is not set");
  }

  const owner = bee.signer.publicKey().address().toString();

  let index: FeedIndex | undefined;
  if (indexArg === undefined) {
    index = undefined;
  } else if (typeof indexArg !== "number" || indexArg < 0) {
    throw new Error("Invalid index argument, process exited with code: 1");
  } else {
    index = FeedIndex.fromBigInt(BigInt(indexArg));
  }
  const slotStr = index !== undefined ? index.toBigInt() : "latest";

  const { reference, feedIndex } = await swarmUtils.readDriveFeed(bee, DRIVE_FEED_TOPIC.toUint8Array(), owner, index);
  if (FeedIndex.MINUS_ONE.equals(feedIndex)) {
    console.log(`Feed@${slotStr} → no feed entry yet`);
    return;
  }

  console.log(`Feed@${slotStr} → ${reference.toString()}`);
}

export async function manifestLs(manifestRef: string): Promise<void> {
  const bee = swarmUtils.makeBeeWithSigner();

  try {
    const node = await swarmUtils.loadOrCreateMantarayNode(bee, manifestRef);

    const map = await swarmUtils.listRemoteFilesMap(node);
    const files = Object.keys(map);
    if (files.length === 0) {
      console.log(`Manifest ${manifestRef} is empty.`);
    } else {
      console.log(`Files under manifest ${manifestRef}:`);
      for (const f of files) {
        console.log("  •", f);
      }
    }
  } catch (err: any) {
    console.error(`Failed to list manifest ${manifestRef}:`, err.message || err);
    throw new Error("Process exited with code: 1");
  }
}

export async function listStamps(): Promise<void> {
  const bee = swarmUtils.makeBeeWithSigner();
  const all = await bee.getPostageBatches();
  if (all.length === 0) {
    console.log("No postage batches found on this node.");
    return;
  }

  console.log("🗃️  Postage batches:");
  for (const b of all) {
    console.log(`  • BatchID: ${b.batchID.toString()}`);
    console.log(`    Depth:   ${b.depth}`);
    console.log(`    Amount:  ${b.amount}`);
    console.log(`    Label:   ${b.label ?? "(no label)"}`);
  }
}
