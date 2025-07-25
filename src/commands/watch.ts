import chokidar from "chokidar";
import debounce from "lodash.debounce";
import path from "path";

import { loadConfig } from "../utils/config";
import { CONFIG_FILE, STATE_PATH_NAME } from "../utils/constants";
import { loadState, saveState } from "../utils/state";
import { StateMode } from "../utils/types";

import { syncCmd } from "./sync";

export async function watchCmd(debounceSec?: number): Promise<void> {
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
  state.currentMode = StateMode.WATCH;
  await saveState(state);

  const watcher = chokidar.watch(localDir, {
    ignoreInitial: true,
    depth: Infinity,
    ignored: (filePath: string) => {
      const name = path.basename(filePath);
      return name === CONFIG_FILE || name === STATE_PATH_NAME;
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
