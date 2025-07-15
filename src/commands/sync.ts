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
  safeUpdateManifest,
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
  const prevRemote = state.lastRemoteFiles || []
  const prevSkipped = state.skipFiles || []
  const lastSyncTime = state.lastSync ? Date.parse(state.lastSync) : 0

  console.log("[syncCmd] Loaded state:", state)

  const { bee, swarmDriveBatch } = await createBeeClient(
    BEE_API,
    process.env.BEE_SIGNER_KEY!
  )
  const batchID = swarmDriveBatch.batchID
  const owner = bee.signer!.publicKey().address().toString()
  const rawRemaining = swarmDriveBatch.remainingSize?.toBytes() ?? 0
  const remainingBytes = BigInt(rawRemaining)

  console.log("[syncCmd] Bee ready → owner:", owner)
  console.log(`[syncCmd] Stamp remaining bytes → ${rawRemaining} bytes`)
  const lastIndex = await readFeedIndex(bee, DRIVE_FEED_TOPIC, owner)

  console.log("[syncCmd] feed@latest index →", lastIndex)

  let oldManifest: string | undefined
  if (lastIndex >= 0n) {
    const reader = bee.makeFeedReader(
      DRIVE_FEED_TOPIC.toUint8Array(),
      owner
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

  if (state.skipFiles) {
    state.skipFiles = state.skipFiles.filter((f) => localFiles.includes(f));
  }
  
  let remoteMap: Record<string, string> = {}
  if (oldManifest) {
    try {
      remoteMap = await listRemoteFilesMap(bee, oldManifest)
    } catch {
      console.warn("[syncCmd] failed to load old manifest, assuming empty")
    }
  }
  const remoteFiles = Object.keys(remoteMap)

  const prevLocal = state.lastFiles || []
  const skipped   = new Set(state.skipFiles || [])

  let toDeleteLocal = prevLocal.filter(f =>
    localFiles.includes(f) &&
    !remoteFiles.includes(f) &&
    prevRemote.includes(f) &&
    !skipped.has(f)
  )

  console.log("[syncCmd] toDeleteLocal (remote deletions):", toDeleteLocal)

  let toAdd = localFiles.filter(
    f => !remoteFiles.includes(f) && !toDeleteLocal.includes(f)
  )
  const toDeleteRemote = remoteFiles.filter(
    f => prevFiles.includes(f) && !localFiles.includes(f)
  )
  const toPullGeneral = remoteFiles.filter(
    f => !localFiles.includes(f) && !prevFiles.includes(f)
  )

  const toPullConflict: string[] = []
  let toUpload: string[] = []
  for (const f of localFiles.filter(f => remoteMap[f])) {
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
  console.log("[syncCmd] toDeleteLocal:", toDeleteLocal)
  console.log("[syncCmd] toDeleteRemote:", toDeleteRemote)
  console.log("[syncCmd] toPull:", toPull)
  console.log("[syncCmd] toUpload:", toUpload)

  if (
    toAdd.length === 0 &&
    toDeleteLocal.length === 0 &&
    toDeleteRemote.length === 0 &&
    toPull.length === 0 &&
    toUpload.length === 0
  ) {
     console.log("✅ [syncCmd] Nothing to sync.")
     state.lastFiles = localFiles
     state.lastRemoteFiles = remoteFiles
     state.lastSync = new Date().toISOString()
     await saveState(state)
     return
  }

  const candidates = [...toAdd, ...toUpload];
  if (candidates.length > 0) {
    const stats = await Promise.all(
      candidates.map((f) =>
        fs.stat(path.join(cfg.localDir, f)).then((s) => ({ path: f, size: s.size }))
      )
    );
    stats.sort((a, b) => a.size - b.size);

    const totalCandidates = stats.reduce((sum, s) => sum + s.size, 0);
    console.log(
      `[syncCmd] stamp has ${rawRemaining} bytes left; total drive size needed = ${totalCandidates} bytes`
    );

    let used = 0n;
    const willUpload = new Set<string>();
    const skipped: string[] = [];

    for (const { path: file, size } of stats) {
      const sz = BigInt(size);
      if (used + sz <= remainingBytes) {
        used += sz;
        willUpload.add(file);
      } else {
        skipped.push(file);
      }
    }

    if (skipped.length) {
      console.warn(`[syncCmd] Stamp full: skipping ${skipped.length} file(s):`, skipped);

      const skippedSet = new Set(skipped);
      toDeleteLocal = toDeleteLocal.filter((f) => !skippedSet.has(f));
      console.log("[syncCmd] Preserving capacity-skipped files from deletion:", skipped);

      state.skipFiles = Array.from(
        new Set([...(state.skipFiles || []), ...skipped])
      );
    }

    toAdd = toAdd.filter((f) => willUpload.has(f));
    toUpload = toUpload.filter((f) => willUpload.has(f));
  }

  let newManifest = oldManifest

  for (const f of toDeleteLocal) {
    console.log("🗑️  Remote deleted → removing local file", f)
    await fs.rm(path.join(cfg.localDir, f), { force: true })
    localFiles.splice(localFiles.indexOf(f), 1)
  }

  for (const f of toPull) {
    if (toDeleteLocal.includes(f)) continue
    console.log("⤵️  Pull →", f)
    const data = await downloadRemoteFile(bee, oldManifest!, f)
    const dst = path.join(cfg.localDir, f)
    await fs.mkdir(path.dirname(dst), { recursive: true })
    await fs.writeFile(dst, data)
    if (!localFiles.includes(f)) localFiles.push(f)
  }

  const succeededAdds: string[] = []
  for (const f of toAdd) {
    console.log("➕ Add →", f)
    try {
      newManifest = await safeUpdateManifest(
        bee,
        batchID,
        newManifest,
        path.join(cfg.localDir, f),
        f,
        false
      )
      succeededAdds.push(f)
    } catch (err: any) {
      console.error(`Error uploading "${f}":`, err.message)
    }
  }
  toAdd = succeededAdds

  const succeededUploads: string[] = []
  for (const f of toUpload) {
    console.log("⬆️  Upload →", f)
    try {
      newManifest = await safeUpdateManifest(bee, batchID, newManifest, "", f, true)
      newManifest = await safeUpdateManifest(
        bee,
        batchID,
        newManifest,
        path.join(cfg.localDir, f),
        f,
        false
      )
      succeededUploads.push(f)
    } catch (err: any) {
      console.error(`Error updating "${f}":`, err.message)
    }
  }
  toUpload = succeededUploads

  for (const f of toDeleteRemote) {
    console.log("🗑️  Delete →", f)
    newManifest = await safeUpdateManifest(bee, batchID, newManifest, "", f, true)
  }

  const realAdds = toAdd.filter(f => !toDeleteLocal.includes(f))
  const didChange = realAdds.length > 0 || toUpload.length > 0 || toDeleteRemote.length > 0
  let nextIndex = lastIndex
  if (didChange) {
    nextIndex = oldManifest === undefined ? 0n : lastIndex + 1n
    console.log(`[syncCmd] Writing feed@${nextIndex} →`, newManifest)
    await writeDriveFeed(bee, DRIVE_FEED_TOPIC, batchID, newManifest!, nextIndex)
  } else {
    console.log("✅ [syncCmd] No uploads to feed; skipping feed update.")
  }

  state.lastRemoteFiles = remoteFiles

  state.lastFiles = localFiles
  state.lastSync = new Date().toISOString()
  await saveState(state)

}
