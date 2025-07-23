import { Bee, PrivateKey, FeedIndex } from "@ethersphere/bee-js"
import * as swarmUtils from "../utils/swarm"
import { DRIVE_FEED_TOPIC } from "../utils/constants"
import { isNotFoundError } from "../utils/helpers"

const BEE_API = process.env.BEE_API ?? "http://localhost:1633"

async function makeBeeWithoutStamp(): Promise<Bee> {
  const signerKey = process.env.BEE_SIGNER_KEY
  if (!signerKey) {
    throw new Error("🚨 BEE_SIGNER_KEY must be set in your environment")
  }
  if (!signerKey.startsWith("0x")) {
    throw new Error("🚨 BEE_SIGNER_KEY must start with 0x in your environment")
  }
  return new Bee(BEE_API, {
    signer: new PrivateKey(signerKey),
  })
}

export async function feedGet(indexArg?: number): Promise<void> {
  const bee = swarmUtils.makeBeeWithSigner()
  const owner = bee.signer!.publicKey().address().toString()

  let index: FeedIndex | undefined = undefined;
  if (typeof indexArg === "number" && indexArg >= 0) {
    index = FeedIndex.fromBigInt(BigInt(indexArg));
  }
  const slotStr = index ? index.toBigInt() : 'latest';

  try {
    const { ref } = await swarmUtils.readDriveFeed(bee, DRIVE_FEED_TOPIC.toUint8Array(), owner)
    console.log(`Feed@${slotStr} → ${ref}`)
  } catch (err: any) {
    if (isNotFoundError(err)) {
      console.log(`Feed@${slotStr} → no feed entry yet`);
      return;
    }

    console.error(`Failed to read feed@${slotStr}:`, err.message || err)
    throw new Error("Process exited with code: 1")
  }
}

export async function feedLs(indexArg?: number): Promise<void> {
  const { feedGet } = await import("./helpers")
  return feedGet(indexArg)
}

export async function manifestLs(manifestRef: string): Promise<void> {
  const bee = swarmUtils.makeBeeWithSigner()

  try {
    const map = await swarmUtils.listRemoteFilesMap(bee, manifestRef)
    const files = Object.keys(map)
    if (files.length === 0) {
      console.log(`Manifest ${manifestRef} is empty.`)
    } else {
      console.log(`Files under manifest ${manifestRef}:`)
      for (const f of files) {
        console.log("  •", f)
      }
    }
  } catch (err: any) {
    console.error(`Failed to list manifest ${manifestRef}:`, err.message || err)
    throw new Error("Process exited with code: 1")
  }
}

export async function listStamps(): Promise<void> {
  const bee = swarmUtils.makeBeeWithSigner()
  const all = await bee.getPostageBatches()
  if (all.length === 0) {
    console.log("No postage batches found on this node.")
    return
  }

  console.log("🗃️  Postage batches:")
  for (const b of all) {
    console.log(`  • BatchID: ${b.batchID.toString()}`)
    console.log(`    Depth:   ${b.depth}`)
    console.log(`    Amount:  ${b.amount}`)
    console.log(`    Label:   ${b.label ?? "(no label)"}`)
  }
}
