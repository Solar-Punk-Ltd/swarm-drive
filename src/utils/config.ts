import fs from "fs/promises";
import path from "path";
import { Config } from "../types";

const CONFIG_FILE = ".swarm-sync.json";

const DEFAULT_CONFIG: Config & { lastSync?: string } = {
  localDir: "",
  volumeRef: "",
  lastManifest: "",
  watchIntervalMinutes: 10,
  lastSync: "",
};

export async function loadConfig(): Promise<Config & { lastSync?: string }> {
  try {
    const raw = await fs.readFile(path.resolve(CONFIG_FILE), "utf-8");
    return JSON.parse(raw);
  } catch {
    await saveConfig(DEFAULT_CONFIG);
    return DEFAULT_CONFIG;
  }
}

export async function saveConfig(cfg: Config & { lastSync?: string }): Promise<void> {
  await fs.writeFile(
    path.resolve(CONFIG_FILE),
    JSON.stringify(cfg, null, 2),
    "utf-8"
  );
}
