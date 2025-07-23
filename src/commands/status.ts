import { loadConfig } from "../utils/config";
import { loadState } from "../utils/state";

export async function statusCmd(): Promise<void> {
  let cfg;
  try {
    cfg = await loadConfig();
    if (!cfg.localDir) throw new Error();
  } catch {
    console.error('Error: config file ".swarm-sync.json" not found. Please run "swarm-drive init <localDir>" first.');
    process.exit(1);
  }

  const state = await loadState();

  console.log("Swarm Drive Status");
  console.log("------------------");
  console.log(`localDir: ${cfg.localDir}`);

  if (state.currentMode === "watch") {
    console.log("active mode: watch");
  } else if (state.currentMode === "schedule") {
    console.log("active mode: schedule");
  } else {
    console.log("active mode: manual");
  }

  if (cfg.watchIntervalSeconds !== undefined) {
    console.log(`watchIntervalSeconds: ${cfg.watchIntervalSeconds}`);
  }
  if (cfg.scheduleIntervalSeconds !== undefined) {
    console.log(`scheduleIntervalSeconds: ${cfg.scheduleIntervalSeconds}`);
  }

  if (state.lastSync) {
    const last = new Date(state.lastSync);
    const diffMs = Date.now() - last.getTime();
    const minsAgo = Math.floor(diffMs / 60000);
    console.log(`lastSync: ${state.lastSync} (${minsAgo} minute${minsAgo === 1 ? "" : "s"} ago)`);
  } else {
    console.log("lastSync: <no sync yet> — run “swarm-drive sync” to perform first upload");
  }

  if (state.lastFiles) {
    console.log(`lastFiles: ${state.lastFiles.length} files`);
  }
}
