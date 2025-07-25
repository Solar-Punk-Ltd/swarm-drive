import { loadConfig } from "../utils/config";
import { loadState, saveState } from "../utils/state";
import { StateMode } from "../utils/types";

import { syncCmd } from "./sync";

export async function scheduleCmd(intervalSec: number): Promise<void> {
  const { localDir } = await loadConfig();

  console.log(`Scheduling sync for "${localDir}" every ${intervalSec} seconds…`);

  console.log("Initial run: running sync now…");
  try {
    await syncCmd();
  } catch (err: any) {
    console.error("Error during initial sync:", err.message || err);
  }

  const state = await loadState();
  state.currentMode = StateMode.SCHEDULE;
  await saveState(state);

  setInterval(async () => {
    try {
      await syncCmd();
    } catch (err: any) {
      console.error("Error during scheduled sync:", err.message || err);
    }
  }, intervalSec * 1000);
}
