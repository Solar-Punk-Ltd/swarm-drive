#!/usr/bin/env bash
set -euo pipefail

# ────────────────────────────────────────────────────────────────────────────────
# STEP 0: Ensure a Bee node is running on localhost:1633 (use runDevNode.sh)
# ────────────────────────────────────────────────────────────────────────────────
# (Make sure you have already created a postage batch labelled “swarm-drive-stamp”
#  on that Bee node; see your `start-bee.sh` / `buyStamp` process.)
#
# STEP 1: export your private‐key env‐var (the same key used to buy “swarm-drive-stamp”):
# ────────────────────────────────────────────────────────────────────────────────
export BEE_SIGNER_KEY="0x19373b650320750baf5fe63aa2da57f52cd9e124e4d4242e6896de9c2ec94db3"

# ────────────────────────────────────────────────────────────────────────────────
# STEP 2: create a fresh “data” folder and run `init`
# ────────────────────────────────────────────────────────────────────────────────
echo "mkdir -p data"
mkdir -p data

echo ""
echo "npx ts-node src/cli.ts init data"
npx ts-node src/cli.ts init data

# ────────────────────────────────────────────────────────────────────────────────
# ROUND 1: create a.txt, b.txt, c.txt → “sync”
# ────────────────────────────────────────────────────────────────────────────────
echo ""
echo "echo \"Contents of A\" > data/a.txt"
echo "Contents of A" > data/a.txt

echo "echo \"Contents of B\" > data/b.txt"
echo "Contents of B" > data/b.txt

echo "echo \"Contents of C\" > data/c.txt"
echo "Contents of C" > data/c.txt

echo ""
echo "npx ts-node src/cli.ts sync"
npx ts-node src/cli.ts sync

# Immediately show the new feed@latest reference:
echo ""
echo "npx ts-node src/cli.ts feed-ls"
npx ts-node src/cli.ts feed-ls

# Capture that manifest hash in a shell variable, then list its files:
current_manifest=$(npx ts-node src/cli.ts feed-get      \
  | awk '{ print $3 }')   # “Feed@latest → <hex>” ⇒ grab field 3

echo ""
echo "npx ts-node src/cli.ts manifest-ls $current_manifest"
npx ts-node src/cli.ts manifest-ls "$current_manifest"

# ────────────────────────────────────────────────────────────────────────────────
# ROUND 2: modify b.txt & c.txt, add d.txt → “sync”
# ────────────────────────────────────────────────────────────────────────────────
echo ""
echo "echo \"Updated B\" > data/b.txt"
echo "Updated B" > data/b.txt

echo "echo \"Updated C\" > data/c.txt"
echo "Updated C" > data/c.txt

echo "echo \"Contents of D\" > data/d.txt"
echo "Contents of D" > data/d.txt

echo ""
echo "npx ts-node src/cli.ts sync"
npx ts-node src/cli.ts sync

# Now show the updated feed@latest
echo ""
echo "npx ts-node src/cli.ts feed-ls"
npx ts-node src/cli.ts feed-ls

# Capture the new manifest hash, then list its files:
second_manifest=$(npx ts-node src/cli.ts feed-get        \
  | awk '{ print $3 }')

echo ""
echo "npx ts-node src/cli.ts manifest-ls $second_manifest"
npx ts-node src/cli.ts manifest-ls "$second_manifest"

# ────────────────────────────────────────────────────────────────────────────────
# ROUND 3: delete b.txt (leave a.txt, c.txt, d.txt) → “sync”
# ────────────────────────────────────────────────────────────────────────────────
echo ""
echo "rm data/b.txt"
rm data/b.txt

echo ""
echo "npx ts-node src/cli.ts sync"
npx ts-node src/cli.ts sync

# Finally, show the latest feed entry again and its manifest
echo ""
echo "npx ts-node src/cli.ts feed-ls"
npx ts-node src/cli.ts feed-ls

third_manifest=$(npx ts-node src/cli.ts feed-get         \
  | awk '{ print $3 }')

echo ""
echo "npx ts-node src/cli.ts manifest-ls $third_manifest"
npx ts-node src/cli.ts manifest-ls "$third_manifest"

echo ""
echo "✅ Multi‐file round‐trip via CLI succeeded."
