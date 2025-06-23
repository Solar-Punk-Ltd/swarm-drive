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

const BEE_API = process.env.BEE_API ?? "http://localhost:1633"

export async function syncCmd() {
  console.log("[syncCmd] Starting sync…")

  const cfg = await loadConfig()
  const state = await loadState()
  const prevFiles = state.lastFiles || []
  const lastSyncTime = state.lastSync ? Date.parse(state.lastSync) : 0

  console.log("[syncCmd] Loaded state:", state)

  const { bee, swarmDriveBatch } = await createBeeClient(
    BEE_API,
    process.env.BEE_SIGNER_KEY!
  )
  const batchID = swarmDriveBatch.batchID
  const ownerAddress = bee.signer!.publicKey().address().toString()
  console.log("[syncCmd] Bee ready → owner:", ownerAddress)

  const lastIndex = await readFeedIndex(bee, DRIVE_FEED_TOPIC, ownerAddress)
  console.log("[syncCmd] feed@latest index →", lastIndex)

  let oldManifest: string | undefined
  if (lastIndex >= 0n) {
    const reader = bee.makeFeedReader(
      DRIVE_FEED_TOPIC.toUint8Array(),
      ownerAddress
    )
    const msg = await reader.download({ index: FeedIndex.fromBigInt(lastIndex) })
    const raw = msg.payload.toUint8Array()
    if (raw.length === 32) {
      const ref = new BeeReference(raw)
      if (!ref.equals(SWARM_ZERO_ADDRESS)) {
        oldManifest = ref.toString()
      }
    }
    console.log(`[syncCmd] feed@${lastIndex} →`, oldManifest ?? "(empty)")
  } else {
    console.log("[syncCmd] feed is empty; starting at slot 0")
  }

  const localFiles = await fg("**/*", { cwd: cfg.localDir, onlyFiles: true })
  console.log("[syncCmd] prevFiles:", prevFiles)
  console.log("[syncCmd] localFiles:", localFiles)

  let remoteMap: Record<string, string> = {}
  if (oldManifest) {
    try {
      remoteMap = await listRemoteFilesMap(bee, oldManifest)
    } catch {
      console.warn("[syncCmd] failed to load old manifest, assuming empty")
    }
  }
  const remoteFiles = Object.keys(remoteMap)

  const toAdd = localFiles.filter((f) => !remoteFiles.includes(f))
  const toDeleteRemote = remoteFiles.filter(
    (f) => prevFiles.includes(f) && !localFiles.includes(f)
  )

  const toPullGeneral = remoteFiles.filter((f) => !localFiles.includes(f))

  const toPullConflict: string[] = []
  const toUpload: string[] = []
  for (const f of localFiles.filter((f) => remoteMap[f])) {
    const abs = path.join(cfg.localDir, f)
    const [localBuf, remoteBuf] = await Promise.all([
      fs.readFile(abs),
      downloadRemoteFile(bee, oldManifest!, f),
    ])
    if (!Buffer.from(localBuf).equals(Buffer.from(remoteBuf))) {
      const stat = await fs.stat(abs)
      if (stat.mtimeMs >= lastSyncTime) {
        console.log(`🔄 Local newer → will upload ${f}`)
        toUpload.push(f)
      } else {
        console.log(`⤵️  Remote newer → will pull ${f}`)
        toPullConflict.push(f)
      }
    }
  }

  const toPull = Array.from(new Set([...toPullGeneral, ...toPullConflict]))

  console.log("[syncCmd] toAdd:", toAdd)
  console.log("[syncCmd] toDeleteRemote:", toDeleteRemote)
  console.log("[syncCmd] toPull:", toPull)
  console.log("[syncCmd] toUpload:", toUpload)

  if (
    toAdd.length === 0 &&
    toDeleteRemote.length === 0 &&
    toPull.length === 0 &&
    toUpload.length === 0
  ) {
    console.log("✅ [syncCmd] Nothing to sync.")
    return
  }

  let newManifest = oldManifest

  for (const f of toPull) {
    console.log("⤵️  Pull →", f)
    const data = await downloadRemoteFile(bee, oldManifest!, f)
    const dst = path.join(cfg.localDir, f)
    await fs.mkdir(path.dirname(dst), { recursive: true })
    await fs.writeFile(dst, data)
    localFiles.push(f)
  }

  for (const f of toAdd) {
    console.log("➕ Add →", f)
    newManifest = await updateManifest(
      bee,
      batchID,
      newManifest,
      path.join(cfg.localDir, f),
      f,
      false
    )
  }

  for (const f of toUpload) {
    console.log("⬆️  Upload →", f)
    newManifest = await updateManifest(bee, batchID, newManifest, "", f, true)
    newManifest = await updateManifest(
      bee,
      batchID,
      newManifest,
      path.join(cfg.localDir, f),
      f,
      false
    )
  }

  for (const f of toDeleteRemote) {
    console.log("🗑️  Delete →", f)
    newManifest = await updateManifest(bee, batchID, newManifest, "", f, true)
  }

  console.log("[syncCmd] Pinning new manifest →", newManifest)

  const didChange =
    toAdd.length > 0 || toUpload.length > 0 || toDeleteRemote.length > 0
  let nextIndex = lastIndex
  if (didChange) {
    nextIndex = oldManifest === undefined ? 0n : lastIndex + 1n
    console.log(`[syncCmd] Writing feed@${nextIndex} →`, newManifest)
    await writeDriveFeed(
      bee,
      DRIVE_FEED_TOPIC,
      batchID,
      newManifest!,
      nextIndex
    )
  } else {
    console.log("✅ [syncCmd] No uploads to feed; skipping feed update.")
  }

  await saveState({
    lastFiles: localFiles,
    lastSync: new Date().toISOString(),
  })

  console.log(`✅ [syncCmd] Done → feed@${nextIndex}`)
}
