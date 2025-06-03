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
  console.log("🔍 [syncCmd] Starting sync…");

  // 1️⃣ Load config + state
  const cfg = await loadConfig();
  let state = await loadState();
  console.log("🔍 [syncCmd] Loaded config:", cfg);
  console.log("🔍 [syncCmd] Loaded state:", state);

  // 2️⃣ Create Bee client + postage batch
  const { bee, swarmDriveBatch } = await createBeeClient(
    "http://localhost:1633",
    process.env.BEE_SIGNER_KEY!
  );
  const batchID = swarmDriveBatch.batchID;
  const ownerAddress = bee.signer!.publicKey().address().toString();
  console.log("🔍 [syncCmd] Bee client ready, batchID:", batchID);
  console.log("🔍 [syncCmd] Owner address:", ownerAddress);

  // 3️⃣ Determine “first-ever” vs “subsequent”
  let manifestRef: string | undefined = undefined;
  let lastFeedIndex: bigint = 0n;
  let prevFiles: string[] = [];

  if (state.lastManifest) {
    console.log(`🔍 [syncCmd] State has lastManifest = ${state.lastManifest}`);
    try {
      const testMap = await listRemoteFilesMap(bee, state.lastManifest);
      console.log(
        "🔍 [syncCmd] listRemoteFilesMap(state.lastManifest) succeeded, keys:",
        Object.keys(testMap)
      );
      if (Object.keys(testMap).length > 0) {
        manifestRef = state.lastManifest;
        lastFeedIndex = state.lastFeedIndex ? BigInt(state.lastFeedIndex) : 0n;
        prevFiles = state.lastFiles || [];
      } else {
        console.log(
          "🔍 [syncCmd] state.lastManifest pointed at an empty directory → first-ever"
        );
        manifestRef = undefined;
        lastFeedIndex = 0n;
        prevFiles = [];
      }
    } catch (err) {
      console.log(
        "⚠️  [syncCmd] listRemoteFilesMap(state.lastManifest) threw:",
        (err as Error).message
      );
      manifestRef = undefined;
      lastFeedIndex = 0n;
      prevFiles = [];
    }
  } else {
    console.log("🔍 [syncCmd] No state.lastManifest → first-ever");
    manifestRef = undefined;
    lastFeedIndex = 0n;
    prevFiles = [];
  }

  console.log("🔍 [syncCmd] Using manifestRef =", manifestRef);
  console.log("🔍 [syncCmd] Using lastFeedIndex =", lastFeedIndex);

  // 4️⃣ List local files
  const localFiles = await fg("**/*", {
    cwd: cfg.localDir,
    onlyFiles: true,
  });
  console.log("🔍 [syncCmd] localFiles:", localFiles);
  console.log("🔍 [syncCmd] prevFiles:", prevFiles);

  // 5️⃣ Build remoteMap (if we have a valid manifestRef)
  let remoteMap: Record<string, string> = {};

  if (manifestRef) {
    try {
      remoteMap = await listRemoteFilesMap(bee, manifestRef);
      console.log(
        "🔍 [syncCmd] listRemoteFilesMap(manifestRef) succeeded, remoteMap keys:",
        Object.keys(remoteMap)
      );
    } catch (err) {
      const msg = (err as Error).message;
      console.log(`⚠️  [syncCmd] listRemoteFilesMap(manifestRef) threw:`, msg);

      const sameSet =
        prevFiles.length === localFiles.length &&
        prevFiles.every((f) => localFiles.includes(f));

      if (sameSet && prevFiles.length > 0) {
        console.log("🔍 [syncCmd] prevFiles === localFiles → recovering remoteMap");
        for (const f of prevFiles) {
          remoteMap[f] = manifestRef!;
        }
      } else {
        console.log("🔍 [syncCmd] Unable to recover remoteMap → treating as empty");
        remoteMap = {};
      }
    }
  } else {
    console.log("🔍 [syncCmd] No manifestRef → remoteMap = {}");
  }

  const remoteFiles = Object.keys(remoteMap);
  console.log("🔍 [syncCmd] remoteFiles:", remoteFiles);

  // 6️⃣ Compute diffs
  const toPull = remoteFiles.filter(
    (f) => !localFiles.includes(f) && !prevFiles.includes(f)
  );
  const toDeleteRemote = remoteFiles.filter(
    (f) => prevFiles.includes(f) && !localFiles.includes(f)
  );
  const toAdd = localFiles.filter((f) => !remoteFiles.includes(f));

  // “toModify” if in both local & remote, but bytes differ
  const toModify: string[] = [];
  for (const f of localFiles.filter((f) => remoteMap[f])) {
    const abs = path.join(cfg.localDir, f);
    const [lb, rb] = await Promise.all([
      fs.readFile(abs),
      downloadRemoteFile(bee, manifestRef!, f),
    ]);
    if (!Buffer.from(lb).equals(Buffer.from(rb))) {
      toModify.push(f);
    }
  }

  console.log("🔍 [syncCmd] toPull:", toPull);
  console.log("🔍 [syncCmd] toDeleteRemote:", toDeleteRemote);
  console.log("🔍 [syncCmd] toAdd:", toAdd);
  console.log("🔍 [syncCmd] toModify:", toModify);

  // 7️⃣ If nothing changed at all, bail out
  if (
    toPull.length === 0 &&
    toDeleteRemote.length === 0 &&
    toAdd.length === 0 &&
    toModify.length === 0
  ) {
    console.log("✅ [syncCmd] Nothing to sync.");
    return;
  }

  // 8️⃣ Pull any brand-new remote files → local disk
  for (const f of toPull) {
    console.log("⤵️  [syncCmd] PULL NEW REMOTE ⟶ LOCAL:", f);
    const bytes = await downloadRemoteFile(bee, manifestRef!, f);
    const dst = path.join(cfg.localDir, f);
    await fs.mkdir(path.dirname(dst), { recursive: true });
    await fs.writeFile(dst, bytes);
    localFiles.push(f);
  }

  // 9️⃣ Upload brand-new local files → remote manifest
  for (const f of toAdd) {
    console.log("➕ [syncCmd] UPLOAD LOCAL ⟶ REMOTE:", f);
    const abs = path.join(cfg.localDir, f);
    manifestRef = await updateManifest(bee, batchID, manifestRef, abs, f, false);
    console.log("🔍 [syncCmd] After add, manifestRef =", manifestRef);
  }

  // 🔟 Replace modified files
  for (const f of toModify) {
    console.log("🔄 [syncCmd] REPLACE REMOTE CONTENT:", f);
    // (a) remove old fork
    manifestRef = await updateManifest(
      bee,
      batchID,
      manifestRef,
      path.join(cfg.localDir, f),
      f,
      true
    );
    console.log("🔍 [syncCmd] After remove fork, manifestRef =", manifestRef);

    // (b) upload new bytes
    const abs = path.join(cfg.localDir, f);
    manifestRef = await updateManifest(bee, batchID, manifestRef, abs, f, false);
    console.log("🔍 [syncCmd] After re-add, manifestRef =", manifestRef);
  }

  // 11️⃣ Delete any remote entries for files no longer present locally
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
    console.log("🔍 [syncCmd] After delete, manifestRef =", manifestRef);
  }

  // ──────────────────────────────────────────────────────────────────────────────
  // 12️⃣ Wait until final manifestRef is loadable
  // ──────────────────────────────────────────────────────────────────────────────
  if (manifestRef) {
    console.log(`🔍 [syncCmd] Waiting for manifest ${manifestRef} to be loadable…`);
    const startWait = Date.now();
    while (true) {
      try {
        await listRemoteFilesMap(bee, manifestRef);
        const elapsed = Date.now() - startWait;
        console.log(`   • Manifest is loadable after ${elapsed} ms`);
        break;
      } catch (err: any) {
        // Only retry on “invalid version hash” or 404 from Bee
        const msg = typeof err.message === "string" ? err.message : "";
        if (err.status === 404 || msg.includes("invalid version hash")) {
          // spin until it’s valid
          continue;
        }
        throw err;
      }
    }
  }

  // 13️⃣ Write our final manifestRef into the feed at exactly lastFeedIndex
  console.log(
    `🔍 [syncCmd] About to writeDriveFeed(feedIndex=${lastFeedIndex}, manifestRef=${manifestRef})…`
  );
  await writeDriveFeed(bee, DRIVE_FEED_TOPIC, batchID, manifestRef!, lastFeedIndex);
  console.log(`📡 [syncCmd] Updated drive feed@${lastFeedIndex} → ${manifestRef}`);

  // ★ give Bee a moment (≈500 ms) to finalize/pin the feed entry before returning
  await new Promise((r) => setTimeout(r, 500));

  // 15️⃣ Persist updated state (lastFiles, lastManifest, bumped feed index, timestamp)
  const nextFeedIndex = lastFeedIndex + 1n;
  await saveState({
    lastFiles: localFiles,
    lastManifest: manifestRef!,
    lastFeedIndex: nextFeedIndex.toString(),
    lastSync: new Date().toISOString(),
  });
  console.log("🔍 [syncCmd] Saved state with lastManifest =", manifestRef);

  // 16️⃣ Final summary
  console.log(
    `✅ [syncCmd] Synced:\n` +
      `   + pulled:   ${toPull.join(", ") || "(none)"}\n` +
      `   + uploaded: ${toAdd.join(", ") || "(none)"}\n` +
      `   ~ replaced: ${toModify.join(", ") || "(none)"}\n` +
      `   - deleted:  ${toDeleteRemote.join(", ") || "(none)"}\n` +
      `→ Final manifest: ${manifestRef}`
  );
}
