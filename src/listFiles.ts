#!/usr/bin/env ts-node

import { createBeeClient, listRemoteFiles } from "./utils/swarm";
import { loadConfig } from "./utils/config";
import { loadState } from "./utils/state";

async function main() {
  const cfg = await loadConfig();
  const state = await loadState();

  const manifestRef = state.lastManifest;
  if (!manifestRef) {
    console.error("No manifest yet (nothing has been pushed).");
    process.exit(1);
  }

  // Use the same Bee endpoint and key you’ve been using:
  const { bee } = await createBeeClient(
    "http://localhost:1633",
    "0x19373b650320750baf5fe63aa2da57f52cd9e124e4d4242e6896de9c2ec94db3"
  );

  console.log(`🔍 Fetching file list from manifest ${manifestRef}…`);
  const files = await listRemoteFiles(bee, manifestRef);

  if (files.length === 0) {
    console.log("📭 The manifest is empty (no files).");
  } else {
    console.log(`📦 Files in manifest ${manifestRef}:`);
    for (const f of files) {
      console.log("  •", f);
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
