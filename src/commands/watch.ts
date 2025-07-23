import chokidar from "chokidar";
import debounce from "lodash.debounce";
import path from "path";

import { loadConfig } from "../utils/config";
import { loadState, saveState } from "../utils/state";

import { syncCmd } from "./sync";

export async function watchCmd(debounceSec?: number) {
  const { localDir, watchIntervalSeconds } = await loadConfig();

  const ms =
    debounceSec !== undefined
      ? debounceSec * 1000
      : watchIntervalSeconds !== undefined
        ? watchIntervalSeconds * 1000
        : 300;

  console.log(`Watching ${localDir} for changes (debounce: ${ms}ms)…`);
  console.log("Initial sync on watch start…");
  await syncCmd();

  const state = await loadState();
  state.currentMode = "watch";
  await saveState(state);

  const watcher = chokidar.watch(localDir, {
    ignoreInitial: true,
    depth: Infinity,
    ignored: (filePath: string) => {
      const name = path.basename(filePath);
      return name === ".swarm-sync.json" || name === ".swarm-sync-state.json";
    },
  });

  watcher.once("ready", () => {
    console.log("Watcher ready — now watching for file events…");
  });

  watcher.on("all", (event, filePath) => {
    console.log(`👀 watcher event: ${event} -> ${filePath}`);
  });

  const debouncedSync = debounce(async () => {
    console.log("Change detected, running sync…");
    await syncCmd();
  }, ms);

  watcher
    .on("add", debouncedSync)
    .on("change", debouncedSync)
    .on("unlink", debouncedSync)
    .on("error", err => console.error("Watcher error:", err));
}
