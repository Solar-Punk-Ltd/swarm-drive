import fs from "fs/promises";

import { State } from "../utils/types";

import { STATE_PATH } from "./constants";

export async function loadState(): Promise<State> {
  try {
    const raw = await fs.readFile(STATE_PATH, "utf-8");
    return JSON.parse(raw) as State;
  } catch (err: any) {
    throw new Error(`Failed to load state from "${STATE_PATH}": ${err.message}`);
  }
}

export async function saveState(state: State): Promise<void> {
  await fs.writeFile(STATE_PATH, JSON.stringify(state, null, 2), "utf-8");
}
