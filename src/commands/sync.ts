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

  let manifestRef = state.lastManifest;

  const { bee, ownerBatch } = await createBeeClient(
    "http://localhost:1633",
    process.env.BEE_SIGNER_KEY!
  );
  const batchID = ownerBatch.batchID;

  const remoteListing = manifestRef
    ? await listRemoteFiles(bee, manifestRef)
    : [];

  const localListing = await fg("**/*", {
    cwd: cfg.localDir,
    onlyFiles: true,
  });

  const toUpload = localListing.filter((f) => !remoteListing.includes(f));
  const toDelete = manifestRef
    ? remoteListing.filter((f) => !localListing.includes(f))
    : [];

  if (toUpload.length === 0 && toDelete.length === 0) {
    console.log("No local→Swarm changes detected.");
    return;
  }

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

  const newState: State = {
    lastManifest: manifestRef!,
    lastSync: new Date().toISOString(),
  };
  await saveState(newState);

  console.log("✅ Local→Swarm sync complete. New manifest:", manifestRef);
}
