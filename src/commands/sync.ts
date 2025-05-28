// src/commands/sync.ts

import path from "path";
import fg from "fast-glob";
import {
  createBeeClient,
  updateManifest,
  listRemoteFiles,
} from "../utils/swarm";
import { loadConfig } from "../utils/config";
import { loadState, saveState } from "../utils/state";
import { State } from "../types";

export async function syncCmd() {
  const cfg = await loadConfig();
  const state: State = await loadState();

  // 0) Our “current” manifest (undefined if never pushed)
  let manifestRef = state.lastManifest;

  // 1) Init Bee once
  const { bee, ownerBatch } = await createBeeClient(
    "http://localhost:1633",
    process.env.BEE_SIGNER_KEY!
  );
  const batchID = ownerBatch.batchID;

  // 2) Pull full directory‐listing from Swarm (empty on first run)
  const remoteListing = manifestRef
    ? await listRemoteFiles(bee, manifestRef)
    : [];

  // 3) Glob your local folder
  const localListing = await fg("**/*", {
    cwd: cfg.localDir,
    onlyFiles: true,
  });

  // 4) Compute diffs
  const toUpload = localListing.filter((f) => !remoteListing.includes(f));
  const toDelete = manifestRef
    ? remoteListing.filter((f) => !localListing.includes(f))
    : [];

  if (toUpload.length === 0 && toDelete.length === 0) {
    console.log("No local→Swarm changes detected.");
    return;
  }

  // 5) Apply uploads
  for (const rel of toUpload) {
    console.log("UPLOAD:", rel);
    const abs = path.join(cfg.localDir, rel);
    manifestRef = await updateManifest(
      bee,
      batchID,
      manifestRef,
      abs,
      rel,
      false
    );
  }

  // 6) Apply deletions
  for (const rel of toDelete) {
    console.log("DELETE:", rel);
    const abs = path.join(cfg.localDir, rel);
    manifestRef = await updateManifest(
      bee,
      batchID,
      manifestRef,
      abs,
      rel,
      true
    );
  }

  // 7) Persist only the new manifest pointer + timestamp
  const newState: State = {
    lastManifest: manifestRef!,
    lastSync: new Date().toISOString(),
  };
  await saveState(newState);

  console.log("✅ Local→Swarm sync complete. New manifest:", manifestRef);
}
