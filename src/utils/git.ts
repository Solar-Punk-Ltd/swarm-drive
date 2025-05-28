// src/utils/git.ts

import git from "isomorphic-git";
import fs from "fs";
import path from "path";

/**
 * Initialize a Git repository in the given directory if it doesn't exist.
 */
export async function initGitRepo(dir: string): Promise<void> {
  const gitDir = path.join(dir, ".git");
  try {
    await fs.promises.access(gitDir);
    // already initialized
  } catch {
    // initialize
    await git.init({ fs: fs as any, dir });
    await git.add({ fs: fs as any, dir, filepath: "." });
    await git.commit({
      fs: fs as any,
      dir,
      message: 'Initial commit',
      author: {
        name: 'Swarm Sync CLI',
        email: 'swarm-sync@example.com'
      }
    });
  }
}

/**
 * Stage all changes and return a list of changed file statuses.
 * Returns entries of [filepath, headStatus, workdirStatus].
 */
export async function getGitChanges(
  dir: string
): Promise<Array<{ filepath: string; head: number; workdir: number }>> {
  await git.add({ fs: fs as any, dir, filepath: "." });
  const matrix: any[] = await git.statusMatrix({ fs: fs as any, dir });
  return matrix
    .filter(([_, head, workdir]) => head !== workdir)
    .map(([filepath, head, workdir]) => ({ filepath, head, workdir }));
}
