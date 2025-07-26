# Swarm Drive

A lightweight command‑line tool for two‑way syncing a local directory to Swarm via a Bee client. Think of it as your personal Swarm‑backed “drive.”

---

## 🚀 Features

* Point a local folder at an existing Swarm manifest (or start a new one)
* Two‑way diff & merge between your local files and the live manifest
  * Upload new or modified local files
  * Download new remote files
  * Delete files you removed locally (prune the manifest)
* Continuously monitor your folder and auto‑sync on changes
* Schedule periodic syncs at fixed intervals
* Helper commands to inspect postage batches, feed entries, and manifest contents

---

## 🔧 Prerequisites

* A **Bee node** running on `http://localhost:1633` (or adjust via `BEE_ENDPOINT`)
* `BEE_SIGNER_KEY` environment variable set to your private key (hex, `0x...`)
* A funded **postage batch** in Bee labeled `swarm-drive-stamp`

---

## 📦 Installation

```bash
git clone https://github.com/Solar-Punk-Ltd/swarm-drive.git
cd swarm-drive
npm install
npm run build
```

---

## 🧰 CLI Commands

### Command Alias:
```bash
swarm-drive
```

```bash
npm run
```

Both the above command works in the same way for a user. Commands enabled to be used with `swarm-drive` are listed below:

### 1. init

Initialize a local folder for syncing:

```bash
npm run init -- ./my-drive
```

This will:

* Create `.swarm-sync.json` with your `localDir`.
* Create empty `.swarm-sync-state.json`.

### 2. sync

Perform a one‑off two‑way sync (no arguments):

```bash
npm run sync
```

Under the hood it will:

1. Compare your local folder against the last‑seen manifest.
2. **Download** files that exist remotely but not locally.
3. **Upload** new or modified local files.
4. **Delete** removed local files from the manifest.
5. Persist the new manifest hash in state.

**Common scenarios:**

* **First sync** (empty state → upload all)
* **No changes** → “Nothing to sync” message
* **Local changes** → push diffs to Swarm
* **Remote changes** → pull down new or updated files

### 3. watch

Watch for file changes and auto‑sync:

#### 3s debounce:
```bash
npm run watch
```

#### override to 10s debounce:
```bash
npm run watch -- --debounce 10
```
Uses `chokidar` under the hood, debouncing rapid events.

### 4. schedule

Run `sync` every _intervalS_ seconds:

```bash
npm run schedule -- 60
```

This will:

1. Immediately run one sync at startup.
2. Every 60000 ms (1 minute), log "Scheduled interval reached: running sync…" and run `sync` again.

---

## 📚 Helper Commands

### feed-get [index]

Read a Swarm feed entry. Omit `[index]` for the latest; provide a number for a specific slot.

```bash
npm run feed-get -- <index>?  (e.g. npm run feed-get -- 0)
```

Behavior:

* If an index is provided, it attempts to download that entry via `makeFeedReader` and prints one of:
  * `Feed@<index> → <hex>` if a 32‑byte reference.
  * `Feed@<index> → zero address (empty)` if it’s a zero reference.
  * `Feed@<index> → payload length <n>, not a 32-byte reference` otherwise.
* If no index is provided, it uses `readDriveFeed`, which first tries “latest,” then falls back to index 0, printing:
  * `Feed@latest → <hex>` or
  * `Feed@latest → zero address (empty) or no feed entry yet`.

### feed-ls

Alias for `feed-get` with no index; shows the current `feed@latest` manifest reference.

```bash
npm run feed-ls
```

### manifest-ls <manifestRef>

List all files under a given Swarm manifest hash.

```bash
npm run manifest-ls -- <manifestHash>
```

Behavior:

* Prints `Manifest <manifestRef> is empty.` if no files.
* Otherwise, prints `Files under manifest <manifestRef>:` and lists each filename.

### list-stamps

List all local postage batches on the connected Bee node.

```bash
npm run stamp-list
```

Behavior:

* If no postage batches found: prints `No postage batches found on this node.`
* Otherwise, prints a list:
  * `• BatchID: <batchID>`
    ` Depth: <depth>`
    ` Amount: <amount>`
    ` Label: <label or (no label)>`

---

## 📖 Example Workflow

1. **Initialize**

   ```bash
   npm run init -- ./test-drive
   ```

2. **First sync** (empty state → upload all)

   ```bash
   npm run sync
   # ➕ UPLOAD: file1.txt
   # ➕ UPLOAD: file2.png
   # ✅ Synced: +2 added/changed, -0 removed → NEW_MANIFEST_HASH
   ```
3. **Local edit**

   ```bash
   echo "new content" > ./test-drive/file1.txt
   npm run sync
   # 🔄 REPLACE: file1.txt
   # ✅ Synced: ~1 updated → NEW_MANIFEST_HASH
   ```

4. **Remote upload** (from another machine)

   ```bash
   npm run sync # after remote changes
   # ⤵️ PULL NEW REMOTE → new-file.txt
   ```

5. **Local delete**

   ```bash
   rm ./test-drive/file2.png
   npm run sync
   # 🗑️ DELETE FROM REMOTE → file2.png
   ```
6. **Continuous sync**

   ```bash
   npm run watch -- --debounce 5000
   # Make changes → they auto‑sync
   ```

7. **Scheduled sync**

   ```bash
   npm run schedule -- 300000
   # Runs sync immediately, then every 5 minutes
   ```

8. **Feed inspection**

   ```bash
   npm run feed-get --    # show latest feed entry
   npm run feed-get -- 0  # show index 0 feed entry
   ```

9. **Manifest listing**

   ```bash
   npm run manifest-ls -- <manifestHash>
   ```

10. **Stamps listing**

   ```bash
    npm run stamp-list
   ```

---

## 📜 Scripts

Two helper Bash scripts are included to simplify setup and demonstration. Make sure they are executable before running.

1. `runDevNode.sh`
   - Purpose: Clones/builds a local Bee node (on branch `tmp/dev-feed`) and runs it on port 1633.
   - Usage:
     ```bash
     chmod +x scripts/runDevNode.sh
     ./scripts/runDevNode.sh
     ```

   After a few seconds, the script verifies Bee’s health endpoint. You should see:
     ```bash
     Bee node on port 1633 health check succeeded.
     ```
2. `sync.sh`
   - Purpose: Demonstrates a multi-step sync workflow (init, upload, modify, delete) using the CLI.
   - Usage:
     ```bash
     chmod +x scripts/sync.sh
     ./scripts/sync.sh
     ```

   This script will:
     * Export `BEE_SIGNER_KEY`.
     * Create a `data/` folder and run `init`.
     * Round 1: create `a.txt`, `b.txt`, `c.txt` → run `sync`.
     * Round 2: modify `b.txt`, `c.txt`, add `d.txt` → run `sync`.
     * Round 3: delete `b.txt` → run `sync`.
     * At each step, it prints feed references and lists manifest contents.


## 🛠️ Tips & Troubleshooting

* If you see **"No swarm-drive-stamp found"**, run:

  ```bash
  swarm-cli stamp buy --amount 10000000000000000 --depth 16 --label swarm-drive-stamp
  ```

* Delete `.swarm-sync-state.json` to force a fresh full sync.

---

Happy Swarming! 🐝