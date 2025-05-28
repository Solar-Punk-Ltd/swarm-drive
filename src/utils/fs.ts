// src/utils/fs.ts

import fg from "fast-glob";
import crypto from "crypto";
import fs from "fs/promises";
import path from "path";

/**
 * Recursively list all files under the given directory.
 */
export async function listFiles(dir: string): Promise<string[]> {
  return fg("**/*", { cwd: dir, onlyFiles: true });
}

/**
 * Compute SHA-256 hash of a file’s contents.
 */
export async function hashFile(filePath: string): Promise<string> {
  const abs = path.resolve(filePath);
  const data = await fs.readFile(abs);
  return crypto.createHash("sha256").update(data).digest("hex");
}
