// // src/debugFeed.ts
// //
// // Augmented diagnostic script.  In addition to “build → upload manifest → write feed → poll until loadable,”
// // this version also (a) reads back the feed immediately after writing (always at index=0), and
// // (b) attempts to download the “foo.txt” file from the manifest via MantarayNode, logging timing for each step.
// //
// // Usage:
// //   $ export BEE_SIGNER_KEY="0x…"
// //   $ npx ts-node src/debugFeed.ts
// //

// import fs from "fs/promises";
// import path from "path";
// import os from "os";
// import {
//   Bee,
//   PrivateKey,
//   MantarayNode,
//   FeedIndex,
//   Reference as BeeReference,
//   Topic,
//   BatchId,
// } from "@ethersphere/bee-js";

// const BEE_URL = "http://localhost:1633";
// const LOCAL_DIR = path.join(os.tmpdir(), "debug-swarm-drive");

// if (!process.env.BEE_SIGNER_KEY || !process.env.BEE_SIGNER_KEY.startsWith("0x")) {
//   console.error("✖ BEE_SIGNER_KEY must be set in your environment and start with 0x");
//   process.exit(1);
// }
// const SIGNER_KEY = process.env.BEE_SIGNER_KEY;

// // A 32-byte zeroed topic for our “feed”
// const TOPIC = new Topic(Buffer.alloc(32));

// const FEED_PIN_POLL_INTERVAL = 200; // check every 200ms
// const FEED_PIN_POLL_TIMEOUT = 60_000; // give up after 60s

// async function loadManifestMap(
//   bee: Bee,
//   manifestRef: string
// ): Promise<Record<string, string>> {
//   const refObj = new BeeReference(manifestRef);
//   let node: MantarayNode;
//   try {
//     node = await MantarayNode.unmarshal(bee, refObj);
//   } catch {
//     throw new Error("invalid version hash");
//   }
//   try {
//     await node.loadRecursively(bee);
//   } catch {
//     throw new Error("invalid version hash");
//   }
//   const rawMap = node.collectAndMap();
//   const out: Record<string, string> = {};
//   for (const [fullPath, ref] of Object.entries(rawMap)) {
//     const key = fullPath.startsWith("/") ? fullPath.slice(1) : fullPath;
//     out[key] = ref.toString();
//   }
//   return out;
// }

// (async () => {
//   console.log("▶ Starting enhanced debugFeed.ts …\n");

//   // ─── (A) START UP DEV BEE NODES ──────────────────────────────────
//   try {
//     const { default: setupNodes } = await import(
//       "../tests/integration/test-node-setup/jestSetup"
//     );
//     await setupNodes();
//     console.log(" • Dev Bee nodes are up (via jestSetup).\n");
//   } catch (err) {
//     console.error("✖ Failed to start dev Bee nodes:", err);
//     process.exit(1);
//   }

//   // ─── (B) PREPARE LOCAL DIRECTORY ─────────────────────────────────
//   try {
//     await fs.rm(LOCAL_DIR, { recursive: true, force: true });
//   } catch {
//     // ignore
//   }
//   await fs.mkdir(LOCAL_DIR, { recursive: true });
//   console.log(" • Created local directory:", LOCAL_DIR, "\n");

//   // ─── (C) CONNECT TO BEE + CREATE POSTAGE BATCH ───────────────────
//   const bee = new Bee(BEE_URL, { signer: new PrivateKey(SIGNER_KEY) });
//   console.log(" • Connected to Bee at", BEE_URL);
//   console.log(" • Buying a new postage batch (1 ETH, depth=17) …");
//   const amount = "1000000000000000000"; // 1 ETH in wei
//   const depth = 17;
//   const batchID: BatchId = await bee.createPostageBatch(amount, depth);
//   console.log("   → Created batchID:", batchID);
//   // Wait ~2s for Bee to fully activate that batch:
//   await new Promise((r) => setTimeout(r, 2000));

//   // We'll write two rounds: index=0 then index=1
//   const writer = bee.makeFeedWriter(TOPIC.toUint8Array(), bee.signer!);
//   const reader = bee.makeFeedReader(
//     TOPIC.toUint8Array(),
//     bee.signer!.publicKey().address().toString()
//   );

//   // ────────────────────────────────────────────────────────────────────────────────
//   //  ROUND 1: build+upload “hello world” → manifestRef1 → feed@index 0 → verify load
//   // ────────────────────────────────────────────────────────────────────────────────
//   console.log("\n>>> ROUND 1: BUILD + UPLOAD FIRST MANIFEST");

//   // 1.a) Write “hello world” into foo.txt
//   const fooPath = path.join(LOCAL_DIR, "foo.txt");
//   const initialContents = "hello world";
//   await fs.writeFile(fooPath, initialContents, "utf8");
//   console.log(`   • Wrote initial "${initialContents}" into`, fooPath);

//   // 1.b) Upload the bytes of foo.txt
//   const data1 = await fs.readFile(fooPath);
//   const upload1 = await bee.uploadData(batchID, data1, { pin: true });
//   console.log(`   • uploadData(foo.txt) → chunkRef = ${upload1.reference.toString()}`);

//   // 1.c) Add that fork under "/foo.txt", then save recursively → manifestRef1
//   const node1 = new MantarayNode();
//   node1.addFork("foo.txt", upload1.reference.toString());
//   const saved1 = await node1.saveRecursively(bee, batchID, { pin: true });
//   const ref1 = saved1.reference.toString();
//   console.log("   • Generated manifestRef #1 →", ref1);

//   // 1.d) Poll until Bee actually pins all chunks of that manifest
//   console.log("\n>>> ROUND 1a: POLL UNTIL manifestRef1 LOADABLE");
//   const startPin1 = Date.now();
//   let map1: Record<string, string> | null = null;
//   while (Date.now() - startPin1 < FEED_PIN_POLL_TIMEOUT) {
//     try {
//       map1 = await loadManifestMap(bee, ref1);
//       const elapsedPin1 = Date.now() - startPin1;
//       console.log(
//         `   • manifestRef1 is loadable after ${elapsedPin1} ms\n    → map keys:`,
//         Object.keys(map1)
//       );
//       break;
//     } catch (err: any) {
//       if ((err as Error).message.includes("invalid version hash")) {
//         await new Promise((r) => setTimeout(r, FEED_PIN_POLL_INTERVAL));
//         continue;
//       }
//       throw err;
//     }
//   }
//   if (!map1) {
//     console.error("   ✖ Timed out waiting for manifestRef1 to become loadable");
//     process.exit(1);
//   }

//   // 1.e) WRITE manifestRef1 INTO feed@index=0
//   console.log("\n>>> ROUND 1b: WRITE manifestRef1 INTO FEED@index=0");
//   const writeTs1 = Date.now();
//   await writer.uploadReference(batchID, new BeeReference(ref1), {
//     index: FeedIndex.fromBigInt(0n),
//   });
//   console.log(`   • Wrote feed@index=0 → ${ref1} at t=${writeTs1}`);

//   // 1.f) IMMEDIATELY try to READ that feed index=0 (no extra sleep)
//   console.log("\n>>> ROUND 1c: ATTEMPT to READ FEED@index=0");

//   const startFeedRead1 = Date.now();
//   let feedRef1: string | null = null;
//   let attempt1 = 0;

//   while (Date.now() - startFeedRead1 < FEED_PIN_POLL_TIMEOUT) {
//     attempt1++;

//     try {
//       // Always read at explicit index=0
//       const msg0 = await reader.download({ index: FeedIndex.fromBigInt(0n) });
//       const raw0 = msg0.payload.toUint8Array();
//       console.log(
//         `   [attempt ${attempt1}] reader.download({index:0}) returned length=${raw0.byteLength}, first-16 bytes=`,
//         Buffer.from(raw0.slice(0, 16)).toString("hex"),
//         raw0.byteLength > 16 ? "…" : ""
//       );
//       if (raw0.byteLength === 32) {
//         feedRef1 = new BeeReference(raw0).toString();
//         console.log(`     → accepted as 32-byte ref: ${feedRef1}`);
//         break;
//       }
//     } catch (err0) {
//       console.log(
//         `   [attempt ${attempt1}] reader.download({index:0}) threw (not pinned yet):`,
//         (err0 as Error).message
//       );
//     }

//     // wait a short interval and retry
//     await new Promise((r) => setTimeout(r, FEED_PIN_POLL_INTERVAL));
//   }

//   const elapsedFeedRead1 = Date.now() - startFeedRead1;
//   if (!feedRef1) {
//     console.error(
//       `   ✖ Timed out (> ${FEED_PIN_POLL_TIMEOUT} ms) waiting for a 32-byte feed entry at index=0.`
//     );
//     process.exit(1);
//   }
//   console.log(
//     `   • Found 32-byte feed entry at index=0 on attempt ${attempt1} → ${feedRef1} (took ${elapsedFeedRead1} ms)\n`
//   );
//   if (feedRef1 !== ref1) {
//     console.warn("   • ⚠️ feedRef1 did not match manifestRef1!");
//   } else {
//     console.log("   • ✅ feedRef1 matches manifestRef1");
//   }

//   // 1.g) TRY to DOWNLOAD “foo.txt” from manifestRef1
//   console.log("\n>>> ROUND 1d: ATTEMPT to DOWNLOAD 'foo.txt' from manifestRef1");
//   const startDl1 = Date.now();
//   {
//     // re-use loadManifestMap's logic to find the leaf, then downloadData:
//     const refObj = new BeeReference(ref1);
//     const nodeFetch1 = await MantarayNode.unmarshal(bee, refObj);
//     await nodeFetch1.loadRecursively(bee);
//     // find leaf for "foo.txt"
//     const leaf = nodeFetch1.find("foo.txt");
//     if (!leaf) {
//       console.error("   ✖ 'foo.txt' not found in manifestRef1!");
//     } else {
//       const targetRef = new BeeReference(leaf.targetAddress);
//       const chunkData = await bee.downloadData(targetRef);
//       const downloadedBytes = chunkData.toUint8Array();
//       const elapsedDl1 = Date.now() - startDl1;
//       const text1 = Buffer.from(downloadedBytes).toString("utf8");
//       console.log(
//         `   • Successfully downloaded 'foo.txt' after ${elapsedDl1} ms → content="${text1}"`
//       );
//     }
//   }

//   // ────────────────────────────────────────────────────────────────────────────────
//   //  ROUND 2: Overwrite foo.txt → upload second manifest → feed@index=1 → verify load
//   // ────────────────────────────────────────────────────────────────────────────────
//   console.log("\n\n>>> ROUND 2: MODIFY foo.txt → UPLOAD SECOND MANIFEST");
//   const modifiedContents = "now changed";
//   await fs.writeFile(fooPath, modifiedContents, "utf8");
//   console.log(`   • Overwrote foo.txt with "${modifiedContents}"`);

//   // 2.a) Create a fresh node, upload new bytes, save recursively → ref2
//   const node2 = new MantarayNode();
//   const data2 = await fs.readFile(fooPath);
//   const upload2 = await bee.uploadData(batchID, data2, { pin: true });
//   console.log(`   • uploadData(foo.txt new) → chunkRef = ${upload2.reference.toString()}`);
//   node2.addFork("foo.txt", upload2.reference.toString());
//   const saved2 = await node2.saveRecursively(bee, batchID, { pin: true });
//   const ref2 = saved2.reference.toString();
//   console.log("   • Generated manifestRef #2 →", ref2);

//   // 2.b) Poll until ref2 is loadable
//   console.log("\n>>> ROUND 2a: POLL UNTIL manifestRef2 LOADABLE");
//   const startPin2 = Date.now();
//   let map2: Record<string, string> | null = null;
//   while (Date.now() - startPin2 < FEED_PIN_POLL_TIMEOUT) {
//     try {
//       map2 = await loadManifestMap(bee, ref2);
//       const elapsedPin2 = Date.now() - startPin2;
//       console.log(
//         `   • manifestRef2 is loadable after ${elapsedPin2} ms\n    → map keys:`,
//         Object.keys(map2)
//       );
//       break;
//     } catch (err: any) {
//       if ((err as Error).message.includes("invalid version hash")) {
//         await new Promise((r) => setTimeout(r, FEED_PIN_POLL_INTERVAL));
//         continue;
//       }
//       throw err;
//     }
//   }
//   if (!map2) {
//     console.error("   ✖ Timed out waiting for manifestRef2 to become loadable");
//     process.exit(1);
//   }

//   // 2.c) WRITE manifestRef2 INTO feed@index=1
//   console.log("\n>>> ROUND 2b: WRITE manifestRef2 INTO FEED@index=1");
//   const writeTs2 = Date.now();
//   await writer.uploadReference(batchID, new BeeReference(ref2), {
//     index: FeedIndex.fromBigInt(1n),
//   });
//   console.log(`   • Wrote feed@index=1 → ${ref2} at t=${writeTs2}`);

//   // 2.d) READ BACK feed@index=1 (only index=1)
//   console.log("\n>>> ROUND 2c: ATTEMPT to READ FEED@index=1");
//   const startFeedRead2 = Date.now();
//   let feedRef2: string | null = null;
//   let attempt2 = 0;

//   while (Date.now() - startFeedRead2 < FEED_PIN_POLL_TIMEOUT) {
//     attempt2++;
//     try {
//       const msg1 = await reader.download({ index: FeedIndex.fromBigInt(1n) });
//       const raw1 = msg1.payload.toUint8Array();
//       console.log(
//         `   [attempt ${attempt2}] reader.download({index:1}) returned length=${raw1.byteLength}, first-16 bytes=`,
//         Buffer.from(raw1.slice(0, 16)).toString("hex"),
//         raw1.byteLength > 16 ? "…" : ""
//       );
//       if (raw1.byteLength === 32) {
//         feedRef2 = new BeeReference(raw1).toString();
//         console.log(`     → accepted as 32-byte ref: ${feedRef2}`);
//         break;
//       }
//     } catch (err1) {
//       console.log(
//         `   [attempt ${attempt2}] reader.download({index:1}) threw (not pinned yet):`,
//         (err1 as Error).message
//       );
//     }
//     await new Promise((r) => setTimeout(r, FEED_PIN_POLL_INTERVAL));
//   }

//   const elapsedFeedRead2 = Date.now() - startFeedRead2;
//   if (!feedRef2) {
//     console.error(
//       `   ✖ Timed out (> ${FEED_PIN_POLL_TIMEOUT} ms) waiting for a 32-byte feed entry at index=1`
//     );
//     process.exit(1);
//   }
//   console.log(
//     `   • Found 32-byte feed entry at index=1 on attempt ${attempt2} → ${feedRef2} (took ${elapsedFeedRead2} ms)`
//   );
//   if (feedRef2 !== ref2) {
//     console.warn("   • ⚠️ feedRef2 did not match manifestRef2!");
//   } else {
//     console.log("   • ✅ feedRef2 matches manifestRef2");
//   }

//   // 2.e) DOWNLOAD “foo.txt” from manifestRef2
//   console.log("\n>>> ROUND 2d: ATTEMPT to DOWNLOAD 'foo.txt' from manifestRef2");
//   const startDl2 = Date.now();
//   {
//     const refObj2 = new BeeReference(ref2);
//     const nodeFetch2 = await MantarayNode.unmarshal(bee, refObj2);
//     await nodeFetch2.loadRecursively(bee);
//     const leaf2 = nodeFetch2.find("foo.txt");
//     if (!leaf2) {
//       console.error("   ✖ 'foo.txt' not found in manifestRef2!");
//     } else {
//       const targetRef2 = new BeeReference(leaf2.targetAddress);
//       const chunkData2 = await bee.downloadData(targetRef2);
//       const downloadedBytes2 = chunkData2.toUint8Array();
//       const elapsedDl2 = Date.now() - startDl2;
//       const text2 = Buffer.from(downloadedBytes2).toString("utf8");
//       console.log(
//         `   • Successfully downloaded 'foo.txt' after ${elapsedDl2} ms → content="${text2}"`
//       );
//     }
//   }

//   // ─── (H) TEAR DOWN DEV BEE NODES ────────────────────────────────────────
//   console.log("\n>>> TEARDOWN: stopping Bee nodes …");
//   try {
//     const { default: teardownNodes } = await import(
//       "../tests/integration/test-node-setup/jestTeardown"
//     );
//     await teardownNodes();
//     console.log(" • Dev Bee nodes have been stopped (via jestTeardown).\n");
//   } catch (err) {
//     console.error("✖ Failed to stop dev Bee nodes:", err);
//     process.exit(1);
//   }

//   console.log("▶ Enhanced debugFeed.ts finished.\n");
// })().catch((err) => {
//   console.error("✖ Unexpected error in debugFeed.ts:", err);
//   process.exit(1);
// });
