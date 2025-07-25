import { Bytes, FeedIndex } from "@ethersphere/bee-js";
import fg from "fast-glob";
import fs from "fs/promises";
import path from "path";

import { loadConfig } from "../utils/config";
import { DRIVE_FEED_TOPIC, SWARM_ZERO_ADDRESS } from "../utils/constants";
import { loadState, saveState } from "../utils/state";
import {
  createBeeWithBatch,
  downloadRemoteFile,
  listRemoteFilesMap,
  loadOrCreateMantarayNode,
  readDriveFeed,
  saveMantarayNode,
  updateManifest,
  writeDriveFeed,
} from "../utils/swarm";

export async function syncCmd(): Promise<void> {
  console.log("[syncCmd] Starting sync…");

  const cfg = await loadConfig();
  const state = await loadState();
  const prevFiles = state.lastFiles || [];
  const prevRemote = state.lastRemoteFiles || [];
  const lastSyncTime = state.lastSync ? Date.parse(state.lastSync) : 0;

  console.log("[syncCmd] Loaded state:", state);

  const { bee, swarmDriveBatch } = await createBeeWithBatch();
  if (!bee.signer) {
    throw new Error("🚨 bee.signer is not set");
  }
  const owner = bee.signer.publicKey().address().toString();

  const remainingBytes = swarmDriveBatch.remainingSize.toBytes();

  console.log("[syncCmd] Bee ready → owner:", owner);
  console.log(`[syncCmd] Stamp remaining bytes → ${remainingBytes} bytes`);

  const localFiles = await fg("**/*", { cwd: cfg.localDir, onlyFiles: true });
  console.log("[syncCmd] prevFiles:", prevFiles);
  console.log("[syncCmd] localFiles:", localFiles);

  if (state.skipFiles && state.skipFiles.length > 0) {
    state.skipFiles = state.skipFiles.filter(f => localFiles.includes(f));
    console.log("[syncCmd] skipFiles:", state.skipFiles);
  }

  const {
    reference: oldManifestRef,
    feedIndex,
    feedIndexNext,
  } = await readDriveFeed(bee, DRIVE_FEED_TOPIC.toUint8Array(), owner);
  const nextIndex = feedIndexNext ? feedIndexNext.toBigInt() : 0n;
  if (FeedIndex.MINUS_ONE.equals(feedIndex)) {
    console.log("[syncCmd] feed is empty; starting at slot 0");
  } else {
    console.log(`[syncCmd] feed@${feedIndex} →`, oldManifestRef);
  }

  const mantarayNode = await loadOrCreateMantarayNode(bee, oldManifestRef.toString());
  let remoteMap: Record<string, string> = {};
  if (!oldManifestRef.equals(SWARM_ZERO_ADDRESS)) {
    remoteMap = await listRemoteFilesMap(mantarayNode);
  }
  const remoteFiles = Object.keys(remoteMap);

  let toDeleteLocal: string[] = [];
  if (prevFiles && prevFiles.length > 0) {
    // todo: why set?
    const skipped = new Set(state.skipFiles || []);
    toDeleteLocal = prevFiles.filter(
      f => localFiles.includes(f) && !remoteFiles.includes(f) && prevRemote.includes(f) && !skipped.has(f),
    );
  }

  console.log("[syncCmd] toDeleteLocal (remote deletions):", toDeleteLocal);

  let toAdd = localFiles.filter(f => !remoteFiles.includes(f) && !toDeleteLocal.includes(f));
  const toDeleteRemote = remoteFiles.filter(f => prevFiles.includes(f) && !localFiles.includes(f));
  const toPullGeneral = remoteFiles.filter(f => !localFiles.includes(f) && !prevFiles.includes(f));

  const toPullConflict: string[] = [];
  let toUpload: string[] = [];
  for (const f of localFiles.filter(f => remoteMap[f])) {
    const abs = path.join(cfg.localDir, f);
    const [localBuf, remoteBuf] = await Promise.all([fs.readFile(abs), downloadRemoteFile(bee, mantarayNode, f)]);
    if (!new Bytes(localBuf).equals(new Bytes(remoteBuf))) {
      const stat = await fs.stat(abs);
      if (stat.mtimeMs >= lastSyncTime) {
        console.log(`🔄 Local newer → will upload ${f}`);
        toUpload.push(f);
      } else {
        console.log(`⤵️  Remote newer → will pull ${f}`);
        toPullConflict.push(f);
      }
    }
  }

  const toPull = Array.from(new Set([...toPullGeneral, ...toPullConflict]));

  console.log("[syncCmd] toAdd:", toAdd);
  console.log("[syncCmd] toDeleteLocal:", toDeleteLocal);
  console.log("[syncCmd] toDeleteRemote:", toDeleteRemote);
  console.log("[syncCmd] toPull:", toPull);
  console.log("[syncCmd] toUpload:", toUpload);

  if (
    toAdd.length === 0 &&
    toDeleteLocal.length === 0 &&
    toDeleteRemote.length === 0 &&
    toPull.length === 0 &&
    toUpload.length === 0
  ) {
    console.log("✅ [syncCmd] Nothing to sync.");
    state.lastFiles = localFiles;
    state.lastRemoteFiles = remoteFiles;
    state.lastSync = new Date().toISOString();
    await saveState(state);

    return;
  }

  const candidates = [...toAdd, ...toUpload];
  if (candidates.length > 0) {
    const stats = await Promise.all(
      candidates.map(f => fs.stat(path.join(cfg.localDir, f)).then(s => ({ path: f, size: s.size }))),
    );
    stats.sort((a, b) => a.size - b.size);

    const totalCandidates = stats.reduce((sum, s) => sum + s.size, 0);
    console.log(`[syncCmd] stamp has ${remainingBytes} bytes left; total drive size needed = ${totalCandidates} bytes`);

    let used = 0n;
    const willUpload = new Set<string>();
    const skipped: string[] = [];

    for (const { path: file, size } of stats) {
      const sz = BigInt(size);
      if (used + sz <= BigInt(remainingBytes)) {
        used += sz;
        willUpload.add(file);
      } else {
        skipped.push(file);
      }
    }

    if (skipped.length) {
      console.warn(`[syncCmd] Stamp full: skipping ${skipped.length} file(s):`, skipped);

      toDeleteLocal = toDeleteLocal.filter(f => !skipped.includes(f));
      console.log("[syncCmd] Preserving capacity-skipped files from deletion:", skipped);

      state.skipFiles = Array.from(new Set([...(state.skipFiles || []), ...skipped]));
    }

    toAdd = toAdd.filter(f => willUpload.has(f));
    toUpload = toUpload.filter(f => willUpload.has(f));
  }

  for (const f of toDeleteLocal) {
    console.log("🗑️  Remote deleted → removing local file", f);
    await fs.rm(path.join(cfg.localDir, f), { force: true });
    localFiles.splice(localFiles.indexOf(f), 1);
  }

  for (const f of toPull) {
    if (toDeleteLocal.includes(f)) continue;

    console.log("⤵️  Pull →", f);
    const data = await downloadRemoteFile(bee, mantarayNode, f);
    const dst = path.join(cfg.localDir, f);

    await fs.mkdir(path.dirname(dst), { recursive: true });
    await fs.writeFile(dst, data);

    if (!localFiles.includes(f)) localFiles.push(f);
  }

  const succeededAdds: string[] = [];
  for (const f of toAdd) {
    console.log("➕ Add →", f);
    try {
      await updateManifest(bee, swarmDriveBatch.batchID, mantarayNode, path.join(cfg.localDir, f), f, false);

      succeededAdds.push(f);
    } catch (err: any) {
      console.error(`Error uploading "${f}":`, err.message);
    }
  }

  let newManifestRef = await saveMantarayNode(bee, mantarayNode, swarmDriveBatch.batchID);
  if (!newManifestRef) {
    console.error("[syncCmd] Failed to save mantaray node after Add; aborting sync.");
    throw new Error("Failed to save mantaray node after Add; aborting sync.");
  }

  const succeededUploads: string[] = [];
  for (const f of toUpload) {
    console.log("⬆️  Upload →", f);
    try {
      await updateManifest(bee, swarmDriveBatch.batchID, mantarayNode, "", f, true);
      await updateManifest(bee, swarmDriveBatch.batchID, mantarayNode, path.join(cfg.localDir, f), f, false);
      succeededUploads.push(f);
    } catch (err: any) {
      console.error(`Error updating "${f}":`, err.message);
    }
  }

  newManifestRef = await saveMantarayNode(bee, mantarayNode, swarmDriveBatch.batchID);
  if (!newManifestRef) {
    console.error("[syncCmd] Failed to save mantaray node after Upload; aborting sync.");
    throw new Error("Failed to save mantaray node after Upload; aborting sync.");
  }

  for (const f of toDeleteRemote) {
    console.log("🗑️  Delete →", f);
    await updateManifest(bee, swarmDriveBatch.batchID, mantarayNode, "", f, true);
  }

  newManifestRef = await saveMantarayNode(bee, mantarayNode, swarmDriveBatch.batchID);
  if (!newManifestRef) {
    console.error("[syncCmd] Failed to save mantaray node after Remote Delete; aborting sync.");
    throw new Error("Failed to save mantaray node after Remote Delete; aborting sync.");
  }

  const realAdds = succeededAdds.filter(f => !toDeleteLocal.includes(f));
  const didChange = realAdds.length > 0 || succeededUploads.length > 0 || toDeleteRemote.length > 0;
  if (didChange) {
    console.log(`[syncCmd] Writing feed@${nextIndex} →`, newManifestRef);
    await writeDriveFeed(bee, DRIVE_FEED_TOPIC, swarmDriveBatch.batchID, newManifestRef, nextIndex);
  } else {
    console.log("✅ [syncCmd] No uploads to feed; skipping feed update.");
  }

  state.lastRemoteFiles = remoteFiles;

  state.lastFiles = localFiles;
  state.lastSync = new Date().toISOString();
  await saveState(state);
}
