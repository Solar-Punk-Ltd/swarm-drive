// src/listFeedFiles.ts
import { Bee, PrivateKey, Reference as BeeReference, Topic, FeedIndex } from "@ethersphere/bee-js";
import { listRemoteFilesMap } from "./utils/swarm";
import { DRIVE_FEED_TOPIC } from "./utils/constants";
import dotenv from "dotenv";
dotenv.config();

// ══════════════════════════════════════════════════════════════════
// ─── CONFIGURATION ────────────────────────────────────────────────
// ══════════════════════════════════════════════════════════════════

// Make sure BEE_SIGNER_KEY is set to a 0x-prefixed private key
if (!process.env.BEE_SIGNER_KEY || !process.env.BEE_SIGNER_KEY.startsWith("0x")) {
  console.error("✖ BEE_SIGNER_KEY must be set and start with 0x");
  process.exit(1);
}
const SIGNER_KEY = process.env.BEE_SIGNER_KEY!;

// The URL of your local Bee node:
const BEE_URL = "http://localhost:1633";

// Use the same Topic that your CLI writes to:
const TOPIC: Topic = DRIVE_FEED_TOPIC;

// ══════════════════════════════════════════════════════════════════
// ─── MAIN ─────────────────────────────────────────────────────────
// ══════════════════════════════════════════════════════════════════
;(async () => {
  // 1) Create a Bee client
  const bee = new Bee(BEE_URL, { signer: new PrivateKey(SIGNER_KEY) });

  // 2) Build a feed‐reader (owner = our signer’s address)
  const ownerAddress = new PrivateKey(SIGNER_KEY).publicKey().address().toString();
  const reader = bee.makeFeedReader(TOPIC.toUint8Array(), ownerAddress);

  // 3) Download “feed@latest” (no index argument)
  let manifestRef: string;
  try {
    const msg = await reader.download();
    const raw = msg.payload.toUint8Array();
    if (raw.byteLength !== 32) {
      console.error("✖ Feed payload was not exactly 32 bytes; maybe no manifest has been written yet?");
      process.exit(1);
    }
    const ref = new BeeReference(raw);
    // Compare against a 32‐byte zero reference:
    const zeroRef = new BeeReference("0".repeat(64));
    if (ref.equals(zeroRef)) {
      console.log("⚠️  Feed@latest is the zero‐address (no manifest published yet).");
      process.exit(0);
    }
    manifestRef = ref.toString();
  } catch (e) {
    console.error("✖ Could not read feed@latest:", (e as Error).message);
    process.exit(1);
  }

  console.log("▶ Latest manifest hash from feed@latest:", manifestRef);

  // 4) Call your helper to list everything under that manifest
  let fileMap: Record<string, string>;
  try {
    fileMap = await listRemoteFilesMap(bee, manifestRef);
  } catch (e) {
    console.error("✖ Could not load or unmarshal the manifest:", (e as Error).message);
    process.exit(1);
  }

  const filePaths = Object.keys(fileMap).sort();
  if (filePaths.length === 0) {
    console.log("⚠️  Manifest is empty (no files).");
    process.exit(0);
  }

  // 5) Print each file path (and the chunk reference it points to)
  console.log(`\nFiles under manifest ${manifestRef}:`);
  for (const p of filePaths) {
    console.log(` • ${p}  →  chunkRef: ${fileMap[p]}`);
  }
})().catch((err) => {
  console.error("✖ Unexpected error in listFeedFiles.ts:", err);
  process.exit(1);
});
