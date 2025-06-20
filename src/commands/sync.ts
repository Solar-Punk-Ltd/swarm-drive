import path from "path"
import fs from "fs/promises"
import fg from "fast-glob"

import {
  FeedIndex,
  Reference as BeeReference,
} from "@ethersphere/bee-js"
import {
  createBeeClient,
  downloadRemoteFile,
  listRemoteFilesMap,
  updateManifest,
  writeDriveFeed,
  readFeedIndex,
} from "../utils/swarm"
import { loadConfig } from "../utils/config"
import { loadState, saveState } from "../utils/state"
import { DRIVE_FEED_TOPIC, SWARM_ZERO_ADDRESS } from "../utils/constants"

export async function syncCmd() {
  console.log("[syncCmd] Starting sync…")

  // 1️⃣  Load config + previous snapshot
  const cfg     = await loadConfig()
  const state   = await loadState()
  const prevFiles = state.lastFiles || []
  console.log("[syncCmd] Loaded state:", state)

  // 2️⃣  Connect to Bee
  const { bee, swarmDriveBatch } = await createBeeClient(
    "http://localhost:1633",
    process.env.BEE_SIGNER_KEY!
  )
  const batchID      = swarmDriveBatch.batchID
  const ownerAddress = bee.signer!.publicKey().address().toString()
  console.log("[syncCmd] Bee ready → owner:", ownerAddress)

  // 3️⃣  Figure out the last feed index & fetch that manifest
  const lastIndex = await readFeedIndex(bee, DRIVE_FEED_TOPIC, ownerAddress)
  console.log("[syncCmd] feed@latest index →", lastIndex)

  let oldManifest: string | undefined
  if (lastIndex >= 0n) {
    // load whatever is at slot = lastIndex
    const reader = bee.makeFeedReader(DRIVE_FEED_TOPIC.toUint8Array(), ownerAddress);
    const msg    = await reader.download({ index: FeedIndex.fromBigInt(lastIndex) });
    const raw    = msg.payload.toUint8Array();
    if (raw.length === 32) {
      const ref = new BeeReference(raw);
      if (!ref.equals(SWARM_ZERO_ADDRESS)) {
        oldManifest = ref.toString();
      }
    }
    console.log(`[syncCmd] feed@${lastIndex} →`, oldManifest ?? "(empty)");
  } else {
    console.log("[syncCmd] feed is empty; starting at slot 0");
  }

  // 4️⃣  Scan local directory
  const localFiles = await fg("**/*", { cwd: cfg.localDir, onlyFiles: true })
  console.log("[syncCmd] prevFiles:", prevFiles)
  console.log("[syncCmd] localFiles:", localFiles)

  // 5️⃣  Build the remote-map from the old manifest
  let remoteMap: Record<string,string> = {}
  if (oldManifest) {
    try {
      remoteMap = await listRemoteFilesMap(bee, oldManifest)
    } catch {
      console.warn("[syncCmd] failed to load old manifest, assuming empty")
    }
  }
  const remoteFiles = Object.keys(remoteMap)

  // 6️⃣  Compute diff sets
  const toPull         = remoteFiles.filter(f => !localFiles.includes(f) && !prevFiles.includes(f))
  const toDeleteRemote = remoteFiles.filter(f => prevFiles.includes(f)    && !localFiles.includes(f))
  const toAdd          = localFiles.filter(  f => !remoteFiles.includes(f))

  const toModify: string[] = []
  for (const f of localFiles.filter(f => remoteMap[f])) {
    const abs = path.join(cfg.localDir, f)
    const [lb, rb] = await Promise.all([
      fs.readFile(abs),
      downloadRemoteFile(bee, oldManifest!, f),
    ])
    if (!Buffer.from(lb).equals(Buffer.from(rb))) {
      toModify.push(f)
    }
  }

  console.log("[syncCmd] toPull:", toPull)
  console.log("[syncCmd] toDeleteRemote:", toDeleteRemote)
  console.log("[syncCmd] toAdd:", toAdd)
  console.log("[syncCmd] toModify:", toModify)

  if (
    toPull.length === 0 &&
    toDeleteRemote.length === 0 &&
    toAdd.length === 0 &&
    toModify.length === 0
  ) {
    console.log("✅ [syncCmd] Nothing to sync.")
    return
  }

  // 7️⃣  Apply changes locally & build up a new manifest
  let newManifest = oldManifest

  // pull down any purely-remote files
  for (const f of toPull) {
    console.log("⤵️  Pull new remote →", f)
    const data = await downloadRemoteFile(bee, oldManifest!, f)
    const dst  = path.join(cfg.localDir, f)
    await fs.mkdir(path.dirname(dst), { recursive: true })
    await fs.writeFile(dst, data)
    localFiles.push(f)
  }

  // upload new local files
  for (const f of toAdd) {
    console.log("➕ Add local →", f)
    newManifest = await updateManifest(
      bee, batchID, newManifest, path.join(cfg.localDir, f), f, false
    )
  }

  // replace modified files
  for (const f of toModify) {
    console.log("🔄 Replace →", f)
    newManifest = await updateManifest(
      bee, batchID, newManifest, "", f, true   // remove old
    )
    newManifest = await updateManifest(
      bee, batchID, newManifest, path.join(cfg.localDir, f), f, false
    )
  }

  // delete files no longer locally present
  for (const f of toDeleteRemote) {
    console.log("🗑️  Delete remote →", f)
    newManifest = await updateManifest(
      bee, batchID, newManifest, "", f, true
    )
  }

  // 8️⃣  Pin the new manifest in Bee (pin under your postage batch)
  console.log("[syncCmd] Pinning new manifest →", newManifest)
  // (we rely on updateManifest having pinned each leaf and the root)

  // 9️⃣  **Append** to the feed at ++index
  const nextIndex = oldManifest === undefined ? 0n : lastIndex + 1n
  console.log(`[syncCmd] Writing feed@${nextIndex} →`, newManifest)
  await writeDriveFeed(bee, DRIVE_FEED_TOPIC, batchID, newManifest!, nextIndex)

  // 🔟  Save only your local snapshot (no manifest or feedIndex in state)
  await saveState({
    lastFiles: localFiles,
    lastSync:  new Date().toISOString(),
  })

  console.log(`✅ [syncCmd] Done → feed@${nextIndex}`)
}
