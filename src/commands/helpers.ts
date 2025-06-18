import { Bee, PrivateKey, FeedIndex } from "@ethersphere/bee-js";
import { listRemoteFilesMap, makeBareBeeClient, readFeedIndex } from "../utils/swarm";
import { DRIVE_FEED_TOPIC } from "../utils/constants";

async function makeBeeWithoutStamp(): Promise<Bee> {
  const signerKey = process.env.BEE_SIGNER_KEY;
  if (!signerKey) {
    throw new Error("🚨 BEE_SIGNER_KEY must be set in your environment");
  }
  if (!signerKey.startsWith("0x")) {
    throw new Error("🚨 BEE_SIGNER_KEY must start with 0x in your environment");
  }
  return new Bee("http://localhost:1633", {
    signer: new PrivateKey(signerKey),
  });
}

export async function feedGet(indexArg?: number): Promise<void> {
  const bee = new Bee("http://localhost:1633", { signer: new PrivateKey(process.env.BEE_SIGNER_KEY!) });
  const owner = bee.signer!.publicKey().address().toString();

  // if they asked for a specific index, keep that:
  let slot: bigint;
  if (typeof indexArg === "number") {
    slot = BigInt(indexArg);
  } else {
    // no indexArg → fetch highest slot
    slot = await readFeedIndex(bee, DRIVE_FEED_TOPIC, owner);
  }

  const reader = bee.makeFeedReader(
    DRIVE_FEED_TOPIC.toUint8Array(),
    owner
  );
  try {
    const msg = await reader.download({
      index: FeedIndex.fromBigInt(slot),
    });
    const raw = msg.payload.toUint8Array();
    if (raw.byteLength === 32) {
      const hex = Buffer.from(raw).toString("hex");
      console.log(`Feed@${slot} → ${hex}`);
    } else {
      console.log(`Feed@${slot} → payload ${raw.byteLength} bytes`);
    }
  } catch (err: any) {
    console.error(`Feed@${slot} →`, err.status === 404 ? "(empty)" : err);
    process.exit(1);
  }
}

/** List just slot 0 by default */
export async function feedLs(): Promise<void> {
  // passing no indexArg → feedGet will default to slot 0
  await feedGet();
}

/** List the files under a given manifest reference */
export async function manifestLs(manifestRef: string): Promise<void> {
  const bee = await makeBeeWithoutStamp();
  try {
    const map = await listRemoteFilesMap(bee, manifestRef);
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
    process.exit(1);
  }
}

/** Show your postage batches */
export async function listStamps(): Promise<void> {
  const bee = makeBareBeeClient();
  const allBatches = await bee.getAllPostageBatch();
  if (allBatches.length === 0) {
    console.log("No postage batches found on this node.");
    return;
  }
  console.log("🗃️  Postage batches:");
  for (const b of allBatches) {
    console.log(`  • BatchID: ${b.batchID.toString()}`);
    console.log(`    Depth:   ${b.depth}`);
    console.log(`    Amount:  ${b.amount}`);
    console.log(`    Label:   ${b.label ?? "(no label)"}`);
    console.log("");
  }
}
