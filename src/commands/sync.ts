import { BatchId, Bee, Bytes, FeedIndex, MantarayNode } from "@ethersphere/bee-js";
import fg from "fast-glob";
import fs from "fs/promises";
import path from "path";

import { loadConfig } from "../utils/config";
import { DRIVE_FEED_TOPIC } from "../utils/constants";
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
import { Config, State } from "../utils/types";

interface SyncContext {
  bee: Bee;
  owner: string;
  remainingBytes: number;
  batchID: BatchId;
  localDir: string;
  root: MantarayNode;
  nextIndex: bigint;
}

interface FileOperations {
  toAdd: string[];
  toUpload: string[];
  toPull: string[];
  toDeleteLocal: string[];
  toDeleteRemote: string[];
  toSkip: string[];
}

async function initMantarayNode(bee: Bee, owner: string): Promise<{ root: MantarayNode; nextIndex: bigint }> {
  const { reference, feedIndex, feedIndexNext } = await readDriveFeed(bee, DRIVE_FEED_TOPIC.toUint8Array(), owner);
  const nextIndex = feedIndexNext ? feedIndexNext.toBigInt() : 0n;

  if (FeedIndex.MINUS_ONE.equals(feedIndex)) {
    console.log("[syncCmd] feed is empty");
  } else {
    console.log(`[syncCmd] feed@${feedIndex} →`, reference);
  }

  const root = await loadOrCreateMantarayNode(bee, reference.toString());
  return { root, nextIndex };
}

async function initializeSyncContext(): Promise<{ context: SyncContext; config: Config; state: State }> {
  console.log("[syncCmd] Starting sync…");

  const { bee, swarmDriveBatch } = await createBeeWithBatch();
  if (!bee.signer) {
    throw new Error("🚨 bee.signer is not set");
  }

  const owner = bee.signer.publicKey().address().toString();
  const remainingBytes = swarmDriveBatch.remainingSize.toBytes();
  console.log("[syncCmd] Bee ready → owner:", owner);
  console.log(`[syncCmd] Stamp remaining bytes → ${remainingBytes} bytes`);

  const config = await loadConfig();
  const state = await loadState();

  console.log("[syncCmd] Loaded config:", config);
  console.log("[syncCmd] Loaded state:", state);

  const { root, nextIndex } = await initMantarayNode(bee, owner);

  const context: SyncContext = {
    bee,
    owner,
    remainingBytes,
    batchID: swarmDriveBatch.batchID,
    localDir: config.localDir,
    root,
    nextIndex,
  };

  return { context, config, state };
}

async function getFileLists(
  context: SyncContext,
  state: State,
): Promise<{
  localFiles: string[];
  remoteFiles: string[];
  remoteMap: Record<string, string>;
}> {
  const localFiles = await fg("**/*", { cwd: context.localDir, onlyFiles: true });
  console.log("[syncCmd] localFiles:", localFiles);

  let remoteMap: Record<string, string> = {};
  if (context.root.selfAddress) {
    remoteMap = await listRemoteFilesMap(context.root);
  }
  const remoteFiles = Object.keys(remoteMap);

  // TODO: return skipfiles and do not update them here
  // Update skip files to only include files that still exist locally
  if (state.skipFiles && state.skipFiles.length > 0) {
    state.skipFiles = state.skipFiles.filter(f => localFiles.includes(f));
    console.log("[syncCmd] skipFiles:", state.skipFiles);
  }

  return { localFiles, remoteFiles, remoteMap };
}

// TODO: refactor, what is this doing?
async function resolveFileConflicts(
  context: SyncContext,
  localFiles: string[],
  remoteMap: Record<string, string>,
  lastSyncTime: number,
): Promise<{ toUpload: string[]; toPullConflict: string[] }> {
  const toUpload: string[] = [];
  const toPullConflict: string[] = [];

  for (const f of localFiles.filter(f => remoteMap[f])) {
    const abs = path.join(context.localDir, f);
    const [localBuf, remoteBuf] = await Promise.all([
      fs.readFile(abs),
      downloadRemoteFile(context.bee, context.root, f),
    ]);

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

  return { toUpload, toPullConflict };
}

async function calculateFileOperations(
  context: SyncContext,
  state: State,
  localFiles: string[],
  remoteFiles: string[],
  remoteMap: Record<string, string>,
): Promise<FileOperations> {
  const prevFiles = state.lastFiles || [];
  const prevRemote = state.lastRemoteFiles || [];
  const lastSyncTime = state.lastSync ? Date.parse(state.lastSync) : 0;
  const skipFilesSet = new Set(state.skipFiles || []);

  console.log("[syncCmd] prevFiles:", prevFiles);

  // Files to delete locally (were removed remotely)
  const toDeleteLocal = prevFiles.filter(
    f => localFiles.includes(f) && !remoteFiles.includes(f) && prevRemote.includes(f) && !skipFilesSet.has(f),
  );

  // Files to add (new local files)
  const toAdd = localFiles.filter(f => !remoteFiles.includes(f) && !toDeleteLocal.includes(f));

  // Files to delete remotely (removed locally)
  const toDeleteRemote = remoteFiles.filter(f => prevFiles.includes(f) && !localFiles.includes(f));

  // Files to pull (new remote files)
  const toPullGeneral = remoteFiles.filter(f => !localFiles.includes(f) && !prevFiles.includes(f));

  // Resolve conflicts for existing files
  const { toUpload, toPullConflict } = await resolveFileConflicts(context, localFiles, remoteMap, lastSyncTime);

  const toPull = Array.from(new Set([...toPullGeneral, ...toPullConflict]));

  console.log("[syncCmd] toDeleteLocal (remote deletions):", toDeleteLocal);
  console.log("[syncCmd] toAdd:", toAdd);
  console.log("[syncCmd] toDeleteRemote:", toDeleteRemote);
  console.log("[syncCmd] toPull:", toPull);
  console.log("[syncCmd] toUpload:", toUpload);

  return {
    toAdd,
    toUpload,
    toPull,
    toDeleteLocal,
    toDeleteRemote,
    toSkip: [], // Will be populated by capacity check
  };
}

async function checkCapacityAndOptimize(
  context: SyncContext,
  operations: FileOperations,
  state: State,
): Promise<FileOperations> {
  const candidates = [...operations.toAdd, ...operations.toUpload];

  if (candidates.length === 0) {
    return operations;
  }

  const stats = await Promise.all(
    candidates.map(f => fs.stat(path.join(context.localDir, f)).then(s => ({ path: f, size: s.size }))),
  );
  stats.sort((a, b) => a.size - b.size);

  const totalCandidates = stats.reduce((sum, s) => sum + s.size, 0);
  console.log(
    `[syncCmd] stamp has ${context.remainingBytes} bytes left; total drive size needed = ${totalCandidates} bytes`,
  );

  let used = 0n;
  const willUpload = new Set<string>();
  const skipped: string[] = [];

  for (const { path: file, size } of stats) {
    const sz = BigInt(size);
    if (used + sz <= BigInt(context.remainingBytes)) {
      used += sz;
      willUpload.add(file);
    } else {
      skipped.push(file);
    }
  }

  if (skipped.length > 0) {
    console.warn(`[syncCmd] Stamp full: skipping ${skipped.length} file(s):`, skipped);
    console.log("[syncCmd] Preserving capacity-skipped files from deletion:", skipped);

    // Update skip files in state
    state.skipFiles = Array.from(new Set([...(state.skipFiles || []), ...skipped]));

    // Filter operations to exclude skipped files
    operations.toDeleteLocal = operations.toDeleteLocal.filter(f => !skipped.includes(f));
    operations.toAdd = operations.toAdd.filter(f => willUpload.has(f));
    operations.toUpload = operations.toUpload.filter(f => willUpload.has(f));
    operations.toSkip = skipped;
  }

  return operations;
}

function hasOperations(operations: FileOperations): boolean {
  return (
    operations.toAdd.length > 0 ||
    operations.toDeleteLocal.length > 0 ||
    operations.toDeleteRemote.length > 0 ||
    operations.toPull.length > 0 ||
    operations.toUpload.length > 0
  );
}

async function executeLocalDeletions(
  context: SyncContext,
  operations: FileOperations,
  localFiles: string[],
): Promise<void> {
  for (const f of operations.toDeleteLocal) {
    console.log("🗑️  Remote deleted → removing local file", f);
    await fs.rm(path.join(context.localDir, f), { force: true });
    const index = localFiles.indexOf(f);
    if (index > -1) {
      localFiles.splice(index, 1);
    }
  }
}

async function executeFilePulls(context: SyncContext, operations: FileOperations, localFiles: string[]): Promise<void> {
  for (const f of operations.toPull) {
    if (operations.toDeleteLocal.includes(f)) continue;

    console.log("⤵️  Pull →", f);
    const data = await downloadRemoteFile(context.bee, context.root, f);
    const dst = path.join(context.localDir, f);

    await fs.mkdir(path.dirname(dst), { recursive: true });
    await fs.writeFile(dst, data);

    if (!localFiles.includes(f)) {
      localFiles.push(f);
    }
  }
}

async function executeFileAdditions(context: SyncContext, operations: FileOperations): Promise<string[]> {
  const succeededAdds: string[] = [];

  for (const f of operations.toAdd) {
    console.log("➕ Add →", f);
    try {
      await updateManifest(context.bee, context.batchID, context.root, path.join(context.localDir, f), f, false);
      succeededAdds.push(f);
    } catch (err: any) {
      console.error(`Error uploading "${f}":`, err.message);
    }
  }

  return succeededAdds;
}

async function executeFileUploads(context: SyncContext, operations: FileOperations): Promise<string[]> {
  const succeededUploads: string[] = [];

  for (const f of operations.toUpload) {
    console.log("⬆️  Upload →", f);
    try {
      // Remove old version first
      await updateManifest(context.bee, context.batchID, context.root, "", f, true);
      // Add new version
      await updateManifest(context.bee, context.batchID, context.root, path.join(context.localDir, f), f, false);
      succeededUploads.push(f);
    } catch (err: any) {
      console.error(`Error updating "${f}":`, err.message);
    }
  }

  return succeededUploads;
}

async function executeRemoteDeletions(context: SyncContext, operations: FileOperations): Promise<void> {
  for (const f of operations.toDeleteRemote) {
    console.log("🗑️  Delete →", f);
    await updateManifest(context.bee, context.batchID, context.root, "", f, true);
  }
}

async function saveManifestAndUpdateFeed(
  context: SyncContext,
  succeededAdds: string[],
  succeededUploads: string[],
  operations: FileOperations,
): Promise<string | undefined> {
  const newManifestRef = await saveMantarayNode(context.bee, context.root, context.batchID);
  if (!newManifestRef) {
    console.error("[syncCmd] Failed to save mantaray node; aborting sync.");
    throw new Error("Failed to save mantaray node; aborting sync.");
  }

  const realAdds = succeededAdds.filter(f => !operations.toDeleteLocal.includes(f));
  const didChange = realAdds.length > 0 || succeededUploads.length > 0 || operations.toDeleteRemote.length > 0;

  if (didChange) {
    console.log(`[syncCmd] Writing feed@${context.nextIndex} →`, newManifestRef);
    await writeDriveFeed(context.bee, DRIVE_FEED_TOPIC, context.batchID, newManifestRef, context.nextIndex);
  } else {
    console.log("✅ [syncCmd] No uploads to feed; skipping feed update.");
  }

  return newManifestRef;
}

async function updateFinalState(state: State, localFiles: string[], remoteFiles: string[]): Promise<void> {
  state.lastFiles = localFiles;
  state.lastRemoteFiles = remoteFiles;
  state.lastSync = new Date().toISOString();
  await saveState(state);
}

export async function syncCmd(): Promise<void> {
  const { context, state } = await initializeSyncContext();
  const { localFiles, remoteFiles, remoteMap } = await getFileLists(context, state);

  let operations = await calculateFileOperations(context, state, localFiles, remoteFiles, remoteMap);
  operations = await checkCapacityAndOptimize(context, operations, state);

  if (!hasOperations(operations)) {
    console.log("✅ [syncCmd] Nothing to sync.");
    await updateFinalState(state, localFiles, remoteFiles);
    return;
  }

  // 1. Delete local files that were removed remotely
  await executeLocalDeletions(context, operations, localFiles);

  // 2. Pull files from remote
  await executeFilePulls(context, operations, localFiles);

  // 3. Add new files to remote
  const succeededAdds = await executeFileAdditions(context, operations);

  // 4. Upload modified files to remote
  const succeededUploads = await executeFileUploads(context, operations);

  // 5. Delete files from remote
  await executeRemoteDeletions(context, operations);

  // 6. Save manifest and update feed
  await saveManifestAndUpdateFeed(context, succeededAdds, succeededUploads, operations);

  // 7. Update and save final state
  await updateFinalState(state, localFiles, remoteFiles);
}
