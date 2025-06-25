import path from "path"
import fs from "fs/promises"
import { Config } from "../types"
import { saveConfig } from "../utils/config"
import { createBeeClient } from "../utils/swarm"

const BEE_API = process.env.BEE_API ?? "http://localhost:1633"

export async function initCmd(localDir: string) {
  const resolvedDir = path.resolve(localDir)

  try {
    const stat = await fs.stat(resolvedDir)
    if (!stat.isDirectory()) throw new Error("Not a directory")
  } catch {
    console.error(`Error: \`${localDir}\` is invalid or not accessible.`)
    process.exit(1)
  }

  const cfg: Config = { localDir: resolvedDir }
  await saveConfig(cfg)

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
        BEE_API,
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
    }
  } else {
    console.log("BEE_SIGNER_KEY not set; skipping Bee client initialization")
  }
}
