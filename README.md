# Swarm Drive

A lightweight command‑line tool for two‑way syncing a local directory to Swarm on Bee. Think of it as your personal Swarm‑backed “drive.”

---

## 🚀 Features

* Point a local folder at an existing Swarm manifest (or start a new one)
* Two‑way diff & merge between your local files and the live manifest
  * Upload new or modified local files
  * Download new remote files
  * Delete files you removed locally (prune the manifest)
* Continuously monitor your folder and auto‑sync on changes

---

## 🔧 Prerequisites

* A **Bee node** running on `http://localhost:1633` (or adjust via `BEE_ENDPOINT`)
* `BEE_SIGNER_KEY` environment variable set to your private key (hex, `0x...`)
* A funded **postage batch** in Bee labeled `sd-stamp`

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

### 1. `init`

Initialize a local folder for syncing:

```bash
npm run init -- ./my-drive YOUR_MANIFEST_HASH
```

This will:

* Create `.swarm-sync.json` with your `localDir` and `volumeRef`.
* Clear state in `.swarm-state.json`.

### 2. `sync`

Perform a one‑off two‑way sync:

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

### 3. `watch`

Watch for file changes and auto‑sync:

```bash
# default debounce = 300ms
npm run watch

# override to 10s debounce:
npm run watch -- --debounce 10000
```

Uses `chokidar` under the hood, debouncing rapid events.

---

## 📖 Example Workflow

1. **Initialize**

   ```bash
   npm run init -- ./test-drive abc123...def
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
   npm run addRemoteFile -- c.txt

   # back here:
   npm run sync
   # ⤵️ PULL NEW REMOTE → c.txt
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

---

## 🛠️ Tips & Troubleshooting

* If you see **"No sd‑stamp found"**, run:

  ```bash
  swarm-cli stamp buy --amount 1 --depth 16 --label sd-stamp
  ```
* Delete `.swarm-state.json` to force a fresh full sync.

---

Happy Swarming! 🐝
