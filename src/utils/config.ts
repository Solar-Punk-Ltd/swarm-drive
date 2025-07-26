import fs from "fs/promises";
import path from "path";

import { CONFIG_FILE } from "./constants";
import { Config } from "./types";

const DEFAULT_CONFIG: Config & { lastSync?: string } = {
  localDir: "",
  watchIntervalSeconds: 300,
  scheduleIntervalSeconds: 0,
  lastSync: "",
};

export async function loadConfig(): Promise<Config & { lastSync?: string }> {
  try {
    const raw = await fs.readFile(path.resolve(CONFIG_FILE), "utf8");
    return JSON.parse(raw);
  } catch {
    console.warn("Failed to load config, using default");
    await saveConfig(DEFAULT_CONFIG);
    return DEFAULT_CONFIG;
  }
}

export async function saveConfig(cfg: Config & { lastSync?: string }): Promise<void> {
  await fs.writeFile(path.resolve(CONFIG_FILE), JSON.stringify(cfg, null, 2), "utf8");
}
