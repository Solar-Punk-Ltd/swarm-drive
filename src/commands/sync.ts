// src/commands/sync.ts

import path from "path";
import fs from "fs/promises";
import fg from "fast-glob";

import {
  createBeeClient,
  updateManifest,
  listRemoteFilesMap,
  downloadRemoteFile,
  writeDriveFeed,
} from "../utils/swarm";
import { loadConfig } from "../utils/config";
import { loadState, saveState } from "../utils/state";
import { DRIVE_FEED_TOPIC } from "../utils/constants";

export async function syncCmd() {
  console.log("[syncCmd] Starting sync…");

  const cfg = await loadConfig();
  const state = await loadState();
  console.log("[syncCmd] Loaded config:", cfg);
  console.log("[syncCmd] Loaded state:", state);

  const { bee, swarmDriveBatch } = await createBeeClient(
    "http://localhost:1633",
    process.env.BEE_SIGNER_KEY!
  );
  const batchID = swarmDriveBatch.batchID;
  const ownerAddress = bee.signer!.publicKey().address().toString();
  console.log("[syncCmd] Bee client ready, batchID:", batchID);
  console.log("[syncCmd] Owner address:", ownerAddress);

  // Initialize from state
  let manifestRef: string | undefined = state.lastManifest;
  const lastFeedIndex: bigint = state.lastFeedIndex ? BigInt(state.lastFeedIndex) : 0n;
  const prevFiles: string[] = state.lastFiles || [];

  console.log("[syncCmd] Using manifestRef =", manifestRef);
  console.log("[syncCmd] Using lastFeedIndex =", lastFeedIndex);

  // List local files
  const localFiles = await fg("**/*", {
    cwd: cfg.localDir,
    onlyFiles: true,
  });
  console.log("[syncCmd] localFiles:", localFiles);
  console.log("[syncCmd] prevFiles:", prevFiles);

  // Build remoteMap
  let remoteMap: Record<string, string> = {};
  if (manifestRef) {
    try {
      remoteMap = await listRemoteFilesMap(bee, manifestRef);
      console.log(
        "[syncCmd] listRemoteFilesMap(manifestRef) succeeded, remoteMap keys:",
        Object.keys(remoteMap)
      );
    } catch (err) {
      console.log(
        "⚠️  [syncCmd] listRemoteFilesMap(manifestRef) threw:",
        (err as Error).message
      );
      // recovery if localFiles match prevFiles
      const sameSet =
        prevFiles.length === localFiles.length &&
        prevFiles.every((f) => localFiles.includes(f));

      if (sameSet && prevFiles.length > 0) {
        console.log("[syncCmd] prevFiles === localFiles → recovering remoteMap");
        for (const f of prevFiles) {
          remoteMap[f] = manifestRef!;
        }
      } else {
        console.log("[syncCmd] Unable to recover remoteMap → treating as empty");
        remoteMap = {};
        manifestRef = undefined;
      }
    }
  } else {
    console.log("[syncCmd] No manifestRef → remoteMap = {}");
  }

  const remoteFiles = Object.keys(remoteMap);
  console.log("[syncCmd] remoteFiles:", remoteFiles);

  // Determine differences
  const toPull = remoteFiles.filter(
    (f) => !localFiles.includes(f) && !prevFiles.includes(f)
  );
  const toDeleteRemote = remoteFiles.filter(
    (f) => prevFiles.includes(f) && !localFiles.includes(f)
  );
  const toAdd = localFiles.filter((f) => !remoteFiles.includes(f));

  const toModify: string[] = [];
  // Only attempt to compare contents if downloadRemoteFile returns a Buffer
  for (const f of localFiles.filter((f) => remoteMap[f])) {
    const abs = path.join(cfg.localDir, f);
    const [lb, rb] = await Promise.all([
      fs.readFile(abs),
      downloadRemoteFile(bee, manifestRef!, f),
    ]);
    if (rb instanceof Buffer && !Buffer.from(lb).equals(rb)) {
      toModify.push(f);
    }
  }

  console.log("[syncCmd] toPull:", toPull);
  console.log("[syncCmd] toDeleteRemote:", toDeleteRemote);
  console.log("[syncCmd] toAdd:", toAdd);
  console.log("[syncCmd] toModify:", toModify);

  // Nothing to do?
  if (
    toPull.length === 0 &&
    toDeleteRemote.length === 0 &&
    toAdd.length === 0 &&
    toModify.length === 0
  ) {
    console.log("✅ [syncCmd] Nothing to sync.");
    return;
  }

  // Pull remote‐only files
  for (const f of toPull) {
    console.log("⤵️  [syncCmd] PULL NEW REMOTE ⟶ LOCAL:", f);
    const bytes = await downloadRemoteFile(bee, manifestRef!, f);
    const dst = path.join(cfg.localDir, f);
    await fs.mkdir(path.dirname(dst), { recursive: true });
    await fs.writeFile(dst, bytes);
    localFiles.push(f);
  }

  // Upload new local files
  for (const f of toAdd) {
    console.log("➕ [syncCmd] UPLOAD LOCAL ⟶ REMOTE:", f);
    const abs = path.join(cfg.localDir, f);
    manifestRef = await updateManifest(bee, batchID, manifestRef, abs, f, false);
    console.log("[syncCmd] After add, manifestRef =", manifestRef);
  }

  // Update modified files
  for (const f of toModify) {
    console.log("🔄 [syncCmd] REPLACE REMOTE CONTENT:", f);
    manifestRef = await updateManifest(
      bee,
      batchID,
      manifestRef,
      path.join(cfg.localDir, f),
      f,
      true
    );
    console.log("[syncCmd] After remove fork, manifestRef =", manifestRef);

    const abs = path.join(cfg.localDir, f);
    manifestRef = await updateManifest(bee, batchID, manifestRef, abs, f, false);
    console.log("[syncCmd] After re-add, manifestRef =", manifestRef);
  }

  // Delete remote files that no longer exist locally
  for (const f of toDeleteRemote) {
    console.log("🗑️  [syncCmd] DELETE REMOTE FORMERLY–LOCAL:", f);
    manifestRef = await updateManifest(
      bee,
      batchID,
      manifestRef,
      path.join(cfg.localDir, f),
      f,
      true
    );
    console.log("[syncCmd] After delete, manifestRef =", manifestRef);
  }

  // Wait until the new manifest is loadable
  if (manifestRef) {
    console.log(`[syncCmd] Waiting for manifest ${manifestRef} to be loadable…`);
    const startWait = Date.now();
    while (true) {
      try {
        await listRemoteFilesMap(bee, manifestRef);
        const elapsed = Date.now() - startWait;
        console.log(`   • Manifest is loadable after ${elapsed} ms`);
        break;
      } catch (err: any) {
        const msg = typeof err.message === "string" ? err.message : "";
        if (err.status === 404 || msg.includes("invalid version hash")) {
          continue;
        }
        throw err;
      }
    }
  }

  console.log(
    `[syncCmd] About to writeDriveFeed(feedIndex=${lastFeedIndex}, manifestRef=${manifestRef})…`
  );
  await writeDriveFeed(bee, DRIVE_FEED_TOPIC, batchID, manifestRef!, lastFeedIndex);
  console.log(`[syncCmd] Updated drive feed@${lastFeedIndex} → ${manifestRef}`);

  // Pause briefly before saving state
  await new Promise((r) => setTimeout(r, 500));

  const nextFeedIndex = lastFeedIndex + 1n;
  await saveState({
    lastFiles: localFiles,
    lastManifest: manifestRef!,
    lastFeedIndex: nextFeedIndex.toString(),
    lastSync: new Date().toISOString(),
  });
  console.log("[syncCmd] Saved state with lastManifest =", manifestRef);

  console.log(
    `✅ [syncCmd] Synced:\n` +
      `   + pulled:   ${toPull.join(", ") || "(none)"}\n` +
      `   + uploaded: ${toAdd.join(", ") || "(none)"}\n` +
      `   ~ replaced: ${toModify.join(", ") || "(none)"}\n` +
      `   - deleted:  ${toDeleteRemote.join(", ") || "(none)"}\n` +
      `→ Final manifest: ${manifestRef}`
  );
}
