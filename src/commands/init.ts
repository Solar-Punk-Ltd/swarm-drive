import fs from "fs/promises";
import path from "path";

import { saveConfig } from "../utils/config";
import { CONFIG_FILE, DEFAULT_BEE_URL, STATE_PATH_NAME } from "../utils/constants";
import { createBeeWithBatch } from "../utils/swarm";
import { Config } from "../utils/types";

export async function initCmd(localDir: string): Promise<void> {
  const resolvedDir = path.resolve(localDir);

  try {
    const stat = await fs.stat(resolvedDir);
    if (!stat.isDirectory()) throw new Error("Not a directory");
  } catch {
    console.error(`Error: \`${localDir}\` is invalid or not accessible.`);
    process.exit(1);
  }

  const cfg: Config = { localDir: resolvedDir };
  await saveConfig(cfg);

  await fs.writeFile(path.resolve(STATE_PATH_NAME), JSON.stringify({}, null, 2), "utf-8");
  console.log(`Configuration saved to ${CONFIG_FILE}, state cleared`);
  console.log("Initializing Bee client and ensuring postage stamp exists…");

  try {
    const { swarmDriveBatch } = await createBeeWithBatch(
      process.env.BEE_API ?? DEFAULT_BEE_URL,
      process.env.BEE_SIGNER_KEY,
    );
    console.log(`Postage stamp ready → batchID: ${swarmDriveBatch.batchID.toString()}`);
  } catch (err: any) {
    console.error("Error: could not initialize Bee client or create stamp:", err.message || err);
  }
}
