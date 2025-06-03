import path from "path";
import fs from "fs/promises";
import { Config } from "../types";
import { saveConfig } from "../utils/config";

export async function initCmd(localDir: string) {
  try {
    const stat = await fs.stat(localDir);
    if (!stat.isDirectory()) throw new Error("Not a directory");
  } catch {
    console.error(`Error: \`${localDir}\` is invalid or not accessible.`);
    process.exit(1);
  }

  const cfg: Config = { localDir };
  await saveConfig(cfg);

  await fs.writeFile(path.resolve(".swarm-sync-state.json"), JSON.stringify({}, null, 2), "utf-8");

  console.log(`Configuration saved to .swarm-sync.json, state cleared`);
}
