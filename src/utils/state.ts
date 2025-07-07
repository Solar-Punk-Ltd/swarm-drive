import fs from "fs/promises"
import path from "path"

export interface State {
  lastFiles?: string[]
  skipFiles?: string[]
  lastRemoteFiles?: string[]
  lastSync?: string
  currentMode?: "watch" | "schedule"
}

const STATE_PATH = path.resolve(process.cwd(), ".swarm-sync-state.json")

export async function loadState(): Promise<State> {
  try {
    const raw = await fs.readFile(STATE_PATH, "utf-8")
    return JSON.parse(raw) as State
  } catch {
    return {}
  }
}

export async function saveState(state: State): Promise<void> {
  await fs.writeFile(STATE_PATH, JSON.stringify(state, null, 2), "utf-8")
}
