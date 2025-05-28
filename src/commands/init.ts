import path from "path";
import fs from "fs/promises";
import git from "isomorphic-git";
import { Config } from "../types";
import { saveConfig } from "../utils/config";

export async function initCmd(localDir: string, volumeRef: string) {
  // 1. Validate localDir exists
  try {
    const stat = await fs.stat(localDir);
    if (!stat.isDirectory()) throw new Error("Not a directory");
  } catch {
    console.error(`Error: \`${localDir}\` is invalid or not accessible.`);
    process.exit(1);
  }

  // 2. Initialize Git repo if needed
  const gitDir = path.join(localDir, ".git");
  try {
    await fs.access(gitDir);
  } catch {
    console.log("Initializing Git repository for delta tracking...");
    await git.init({ fs: fs as any, dir: localDir });
    await git.add({ fs: fs as any, dir: localDir, filepath: "." });
    await git.commit({
      fs: fs as any,
      dir: localDir,
      message: `Initial Commit`,
      author: { name: "Swarm Drive CLI", email: "swarm_drive_cli@solarpunk.buzz" },
    });
  }

  // 3. Save configuration
  const cfg: Config = { localDir, volumeRef };
  await saveConfig(cfg);

  // 4. Reset any previous .swarm-state.json so lastManifest is blank
  await fs.writeFile(path.resolve(".swarm-state.json"), JSON.stringify({}), "utf-8");

  console.log(`Configuration saved to .swarm-sync.json, state cleared`);
}
