import fs from "fs/promises";
import path from "path";
import { State } from "../types";

const STATE_FILE = ".swarm-state.json";

export async function loadState(): Promise<State> {
  try {
    const raw = await fs.readFile(path.resolve(STATE_FILE), "utf-8");
    return JSON.parse(raw) as State;
  } catch {
    return { lastSync: "", lastManifest: undefined, lastFiles: [] };
  }
}

export async function saveState(state: State): Promise<void> {
  await fs.writeFile(
    path.resolve(STATE_FILE),
    JSON.stringify(state, null, 2),
    "utf-8"
  );
}
