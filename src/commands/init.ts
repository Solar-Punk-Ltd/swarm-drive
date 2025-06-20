import path from "path"
import fs from "fs/promises"
import { Config } from "../types"
import { saveConfig } from "../utils/config"
import { createBeeClient } from "../utils/swarm"

export async function initCmd(localDir: string) {
  // 1) Validate the local directory
  try {
    const stat = await fs.stat(localDir)
    if (!stat.isDirectory()) throw new Error("Not a directory")
  } catch {
    console.error(`Error: \`${localDir}\` is invalid or not accessible.`)
    process.exit(1)
  }

  // 2) Save the CLI config
  const cfg: Config = { localDir }
  await saveConfig(cfg)

  // 3) Clear any previous state
  await fs.writeFile(
    path.resolve(".swarm-sync-state.json"),
    JSON.stringify({}, null, 2),
    "utf-8",
  )
  console.log(`Configuration saved to .swarm-sync.json, state cleared`)

  if (process.env.BEE_SIGNER_KEY) {
    console.log("Initializing Bee client and ensuring postage stamp exists…")
    try {
      const { swarmDriveBatch } = await createBeeClient(
        "http://localhost:1633",
        process.env.BEE_SIGNER_KEY,
      )
      console.log(
        `Postage stamp ready → batchID: ${swarmDriveBatch.batchID.toString()}`,
      )
    } catch (err: any) {
      console.error(
        "Warning: could not initialize Bee client or create stamp:",
        err.message || err,
      )
      // we do NOT process.exit here — init still succeeds
    }
  } else if (!process.env.BEE_SIGNER_KEY) {
    console.log("BEE_SIGNER_KEY not set; skipping Bee client initialization")
  } else {
    console.log("Non-interactive environment; skipping Bee client initialization")
  }
}
