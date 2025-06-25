import chokidar from "chokidar";
import debounce from "lodash.debounce";
import { loadConfig } from "../utils/config";
import { syncCmd } from "./sync";

export async function watchCmd(debounceMs: number) {
  const { localDir } = await loadConfig();

  console.log(`Watching ${localDir} for changes (debounce: ${debounceMs}ms)…`);
  console.log("Initial sync on watch start…");
  await syncCmd();

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
  }, debounceMs);

  watcher
    .on("add",    debouncedSync)
    .on("change", debouncedSync)
    .on("unlink", debouncedSync)
    .on("addDir", debouncedSync)
    .on("unlinkDir", debouncedSync)
    .on("error", (err) => console.error("Watcher error:", err));
}
