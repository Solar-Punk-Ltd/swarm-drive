// src/utils/fs.ts

import fg from "fast-glob";
import crypto from "crypto";
import fs from "fs/promises";
import path from "path";

export async function listFiles(dir: string): Promise<string[]> {
  return fg("**/*", { cwd: dir, onlyFiles: true });
}

export async function hashFile(filePath: string): Promise<string> {
  const abs = path.resolve(filePath);
  const data = await fs.readFile(abs);
  return crypto.createHash("sha256").update(data).digest("hex");
}
