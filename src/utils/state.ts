import fs from "fs/promises";
import path from "path";

export interface State {
  lastFiles?: string[];
  lastManifest?: string;
  lastFeedIndex?: string;
  lastSync?: string;
}

const STATE_PATH = path.resolve(process.cwd(), ".swarm-sync-state.json");

export async function loadState(): Promise<State> {
  try {
    const raw = await fs.readFile(STATE_PATH, "utf-8");
    const parsed = JSON.parse(raw) as State;
    if (parsed.lastFeedIndex === undefined) {
      parsed.lastFeedIndex = "0";
    }
    return parsed;
  } catch {
    // If missing or malformed → start fresh with feedIndex = "0"
    return { lastFeedIndex: "0" };
  }
}

export async function saveState(state: State): Promise<void> {
  await fs.writeFile(STATE_PATH, JSON.stringify(state, null, 2));
}
