import chokidar from "chokidar";
import debounce from "lodash.debounce";
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

  // → Record that we're now in "watch" mode
  const state = await loadState();
  state.currentMode = "watch";
  await saveState(state);

  const watcher = chokidar.watch(localDir, {
    ignoreInitial: true,
    depth: Infinity,
  });

  watcher.once("ready", () => {
    console.log("Watcher ready — now watching for file events…");
  });

  const debouncedSync = debounce(async () => {
    console.log("Change detected, running sync…");
    await syncCmd();
  }, ms);

  watcher
    .on("add",    debouncedSync)
    .on("change", debouncedSync)
    .on("unlink", debouncedSync)
    .on("addDir", debouncedSync)
    .on("unlinkDir", debouncedSync)
    .on("error", (err) => console.error("Watcher error:", err));
}
