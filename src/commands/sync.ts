// src/commands/sync.ts

import path from "path";
import fs from "fs/promises";
import fg from "fast-glob";
import {
  createBeeClient,
  updateManifest,
  listRemoteFilesMap,
  downloadRemoteFile,
} from "../utils/swarm";
import { Reference as BeeReference } from "@ethersphere/bee-js";
import { loadConfig } from "../utils/config";
import { loadState, saveState } from "../utils/state";

export async function syncCmd() {
  const cfg   = await loadConfig();
  const state = await loadState();

  // 1) Bee client
  const { bee, ownerBatch } = await createBeeClient(
    "http://localhost:1633",
    process.env.BEE_SIGNER_KEY!
  );
  const batchID = ownerBatch.batchID;

  // 2) Read current local listing
  let localFiles = await fg("**/*", {
    cwd: cfg.localDir,
    onlyFiles: true,
  });

  // 3) Previous local snapshot
  const prevFiles = state.lastFiles || [];

  // 4) Load remote manifest into a path→ref map
  let manifestRef = state.lastManifest;
  let remoteMap: Record<string,string> = {};
  if (manifestRef) {
    remoteMap = await listRemoteFilesMap(bee, manifestRef);
  }
  const remoteFiles = Object.keys(remoteMap);

  //
  // 5) Compute four sets
  //

  // 5a) Brand-new on remote: remote now but never saw locally before
  const toPull = remoteFiles.filter(f => 
    !localFiles.includes(f) && !prevFiles.includes(f)
  );

  // 5b) Deleted locally: you had it before, now it’s gone
  const toDeleteRemote = remoteFiles.filter(f =>
    prevFiles.includes(f) && !localFiles.includes(f)
  );

  // 5c) Brand-new local (never on remote)
  const toAdd = localFiles.filter(f => !remoteFiles.includes(f));

  // 5d) Modified: in both places but bytes differ
  const toModify: string[] = [];
  for (const f of localFiles.filter(f => remoteMap[f])) {
    const abs = path.join(cfg.localDir, f);
    const [ lb, rb ] = await Promise.all([
      fs.readFile(abs),
      bee.downloadData(new BeeReference(remoteMap[f])).then(r => r.toUint8Array()),
    ]);
    if (!Buffer.from(lb).equals(Buffer.from(rb))) {
      toModify.push(f);
    }
  }

  // 6) Nothing to do?
  if (
    toPull.length === 0 &&
    toDeleteRemote.length === 0 &&
    toAdd.length === 0 &&
    toModify.length === 0
  ) {
    console.log("✅ Nothing to sync.");
    return;
  }

  //
  // 7) Pull brand-new remote files into local
  //
  for (const f of toPull) {
    console.log("⤵️  PULL NEW REMOTE ⟶ LOCAL:", f);
    const bytes = await downloadRemoteFile(bee, manifestRef!, f);
    const dst   = path.join(cfg.localDir, f);
    await fs.mkdir(path.dirname(dst), { recursive: true });
    await fs.writeFile(dst, bytes);
    localFiles.push(f); // so subsequent steps see it
  }

  //
  // 8) Upload brand-new locals
  //
  for (const f of toAdd) {
    console.log("➕ UPLOAD LOCAL ⟶ REMOTE:", f);
    const abs = path.join(cfg.localDir, f);
    manifestRef = await updateManifest(bee, batchID, manifestRef, abs, f, false);
  }

  //
  // 9) Replace modified files
  //
  for (const f of toModify) {
    console.log("🔄 REPLACE REMOTE CONTENT:", f);
    // remove old
    manifestRef = await updateManifest(
      bee, batchID, manifestRef, path.join(cfg.localDir, f), f, true
    );
    // add new
    const abs = path.join(cfg.localDir, f);
    manifestRef = await updateManifest(
      bee, batchID, manifestRef, abs, f, false
    );
  }

  //
  // 10) Delete files you removed locally
  //
  for (const f of toDeleteRemote) {
    console.log("🗑️  DELETE REMOTE FORMERLY–LOCAL:", f);
    manifestRef = await updateManifest(
      bee, batchID, manifestRef, path.join(cfg.localDir, f), f, true
    );
  }

  //
  // 11) Persist new state (snapshot + manifest)
  //
  await saveState({
    lastFiles:    localFiles,
    lastManifest: manifestRef!,
    lastSync:     new Date().toISOString(),
  });

  //
  // 12) Summary
  //
  console.log(
    `✅ Synced:\n` +
    `   + pulled new remote:    ${toPull.join(", ")        || "(none)"}\n` +
    `   + uploaded new local:   ${toAdd.join(", ")         || "(none)"}\n` +
    `   ~ replaced modified:    ${toModify.join(", ")      || "(none)"}\n` +
    `   - deleted remote files: ${toDeleteRemote.join(", ")|| "(none)"}\n` +
    `→ Final manifest: ${manifestRef}`
  );
}
