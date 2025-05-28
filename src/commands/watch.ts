import chokidar from "chokidar";
import debounce from "lodash.debounce";
import { loadConfig } from "../utils/config";
import { syncCmd } from "./sync";

export async function watchCmd(debounceMs: number) {
  const { localDir } = await loadConfig();

  console.log(`Watching ${localDir} for changes (debounce: ${debounceMs}ms)…`);
  const watcher = chokidar.watch(localDir, {
    ignoreInitial: true,
    depth: Infinity,
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
