import { Bee, PrivateKey, FeedIndex } from "@ethersphere/bee-js"
import * as swarmUtils from "../utils/swarm"
import { DRIVE_FEED_TOPIC } from "../utils/constants"

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
  const bee = await makeBeeWithoutStamp()
  const owner = bee.signer!.publicKey().address().toString()

  if (typeof indexArg !== "number") {
    try {
      const ref = await swarmUtils.readDriveFeed(bee, DRIVE_FEED_TOPIC, owner)
      if (ref) {
        console.log(`Feed@latest → ${ref}`)
      } else {
        console.log(
          "Feed@latest → zero address (empty) or no feed entry yet"
        )
      }
    } catch (err: any) {
      console.error("Failed to read feed@latest:", err.message || err)
      throw new Error("Process exited with code: 1")
    }
    return
  }

  const slot = BigInt(indexArg)
  const reader = bee.makeFeedReader(
    DRIVE_FEED_TOPIC.toUint8Array(),
    owner
  )
  try {
    const msg = await reader.download({
      index: FeedIndex.fromBigInt(slot),
    })
    const raw = msg.payload.toUint8Array()
    if (raw.byteLength === 32) {
      const hex = Buffer.from(raw).toString("hex")
      if (/^0+$/.test(hex)) {
        console.log(`Feed@${slot} → zero address (empty)`)
      } else {
        console.log(`Feed@${slot} → ${hex}`)
      }
    } else {
      console.log(
        `Feed@${slot} → payload length ${raw.byteLength}, not a 32-byte reference.`
      )
    }
  } catch (err: any) {
    console.error(`Failed to read feed@${slot}:`, err.message || err)
    throw new Error("Process exited with code: 1")
  }
}

export async function feedLs(indexArg?: number): Promise<void> {
  const { feedGet } = await import("./helpers")
  return feedGet(indexArg)
}

export async function manifestLs(manifestRef: string): Promise<void> {
  const bee = swarmUtils.makeBareBeeClient()
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
  const bee = swarmUtils.makeBareBeeClient()
  const all = await bee.getAllPostageBatch()
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
