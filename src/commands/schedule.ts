import { loadConfig } from "../utils/config";
import { syncCmd } from "./sync";

export async function scheduleCmd(intervalMs: number): Promise<void> {
  const { localDir } = await loadConfig();

  console.log(`Scheduling sync for "${localDir}" every ${intervalMs} ms…`);

  console.log("Initial run: running sync now…");
  await syncCmd();

  setInterval(async () => {
    console.log("Scheduled interval reached: running sync…");
    try {
      await syncCmd();
    } catch (err) {
      console.error("Error during scheduled sync:", (err as Error).message);
    }
  }, intervalMs);
}
