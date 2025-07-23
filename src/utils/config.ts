import fs from "fs/promises";
import path from "path";

import { Config } from "../types";

import { CONFIG_FILE } from "./constants";

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
    await saveConfig(DEFAULT_CONFIG);
    return DEFAULT_CONFIG;
  }
}

export async function saveConfig(cfg: Config & { lastSync?: string }): Promise<void> {
  await fs.writeFile(path.resolve(CONFIG_FILE), JSON.stringify(cfg, null, 2), "utf8");
}
