import { Bee, PrivateKey } from "@ethersphere/bee-js";
import { listRemoteFilesMap, makeBareBeeClient, readDriveFeed } from "../utils/swarm";
import { DRIVE_FEED_TOPIC, SWARM_ZERO_ADDRESS } from "../utils/constants";

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
  const signerKey = process.env.BEE_SIGNER_KEY;
  if (!signerKey) {
    throw new Error("🚨 BEE_SIGNER_KEY must be set in your environment");
  }
  if (!signerKey.startsWith("0x")) {
    throw new Error("🚨 BEE_SIGNER_KEY must start with 0x in your environment");
  }

  const bee = new Bee("http://localhost:1633", {
    signer: new PrivateKey(signerKey),
  });
  const ownerAddress = bee.signer!.publicKey().address().toString();

  if (typeof indexArg === "number") {
    try {
      const reader = bee.makeFeedReader(DRIVE_FEED_TOPIC.toUint8Array(), ownerAddress);
      const msg = await reader.download({ index: indexArg });
      const raw = msg.payload.toUint8Array();

      if (raw.byteLength === 32) {
        const hex = Buffer.from(raw).toString("hex");
        if (hex === SWARM_ZERO_ADDRESS.toString()) {
          console.log(`Feed@${indexArg} → zero address (empty)`);
        } else {
          console.log(`Feed@${indexArg} → ${hex}`);
        }
      } else {
        console.log(
          `Feed@${indexArg} → payload length ${raw.byteLength}, not a 32-byte reference.`
        );
      }
    } catch (err: any) {
      console.error(`Failed to read feed@${indexArg}:`, err.message || err);
      process.exit(1);
      throw new Error("Process exited with code: 1");
    }
    return;
  }

  try {
    const ref = await readDriveFeed(bee, DRIVE_FEED_TOPIC, ownerAddress);
    if (!ref) {
      console.log("Feed@latest → zero address (empty) or no feed entry yet");
    } else {
      console.log(`Feed@latest → ${ref}`);
    }
  } catch (err: any) {
    console.error("Failed to read feed@latest:", err.message || err);
    process.exit(1);
    throw new Error("Process exited with code: 1");
  }
}

export async function feedLs(): Promise<void> {
  await (module.exports as any).feedGet(undefined);
}

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
    throw new Error("Process exited with code: 1");
  }
}

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
