import { loadConfig } from "../utils/config";
import { loadState, saveState } from "../utils/state";
import { syncCmd } from "./sync";

export async function scheduleCmd(intervalSec: number): Promise<void> {
  const { localDir } = await loadConfig();

  console.log(`Scheduling sync for "${localDir}" every ${intervalSec} seconds…`);

  console.log("Initial run: running sync now…");
  await syncCmd();

  const state = await loadState();
  state.currentMode = "schedule";
  await saveState(state);

  setInterval(async () => {
    console.log("Scheduled interval reached: running sync…");
    try {
      await syncCmd();
    } catch (err) {
      console.error("Error during scheduled sync:", (err as Error).message);
    }
  }, intervalSec * 1000);
}
