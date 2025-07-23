import type { Config } from "../types";
import { loadConfig, saveConfig } from "../utils/config";

export async function configSetCmd(key: string, value: string): Promise<void> {
  const cfg = (await loadConfig()) as Config & { lastSync?: string };

  switch (key) {
    case "localDir":
      // any string is fine
      cfg.localDir = value;
      await saveConfig(cfg);
      console.log(`localDir = ${cfg.localDir}`);
      break;

    case "watchIntervalSeconds": {
      const n = Number(value);
      if (!Number.isInteger(n) || n < 0) {
        console.error(`Error: "${value}" is not a valid non-negative integer for watchIntervalSeconds.`);
        process.exit(1);
      }
      cfg.watchIntervalSeconds = n;
      await saveConfig(cfg);
      console.log(`watchIntervalSeconds = ${cfg.watchIntervalSeconds}`);
      break;
    }

    case "scheduleIntervalSeconds": {
      const n = Number(value);
      if (!Number.isInteger(n) || n < 0) {
        console.error(`Error: "${value}" is not a valid non-negative integer for scheduleIntervalSeconds.`);
        process.exit(1);
      }
      cfg.scheduleIntervalSeconds = n;
      await saveConfig(cfg);
      console.log(`scheduleIntervalSeconds = ${cfg.scheduleIntervalSeconds}`);
      break;
    }

    default:
      console.error(`Error: "${key}" is not a valid configuration key.`);
      process.exit(1);
  }
}

export async function configGetCmd(key: string): Promise<void> {
  const cfg = (await loadConfig()) as Config & { lastSync?: string };

  switch (key) {
    case "localDir":
      console.log(`localDir = ${cfg.localDir}`);
      break;

    case "watchIntervalSeconds":
      console.log(`watchIntervalSeconds = ${cfg.watchIntervalSeconds}`);
      break;

    case "scheduleIntervalSeconds":
      console.log(`scheduleIntervalSeconds = ${cfg.scheduleIntervalSeconds}`);
      break;

    default:
      console.error(`Error: "${key}" is not a valid configuration key.`);
      process.exit(1);
  }
}
